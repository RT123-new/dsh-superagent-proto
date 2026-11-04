/**
 * Issue 13 fixture: deterministic virtual-time harness that measures central-coordinator (main Session) load.
 * Real Store + Effects + HealthBoard with an injected clock; handlers mirror production registrations
 * (relay/notice ordered serial; assessment limit 4; launch limited by worker slots; delivery limit 4; reply limit 1)
 * and complete after simulated service times. No model calls: interaction volume, queue age and payload bytes are the
 * measurable proxies; token cost is out of scope offline (labeled in the report).
 * Variants: relay dispatch 'baseline' (ordered, one global stream) vs 'partitioned' (per-ticket streams, Issue 14
 * candidate), and an optional main-Session outage window that makes relay deliveries fail.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effects } from '../../src/app/effects.ts'
import { Store } from '../../src/app/store.ts'
import { HealthBoard } from '../../src/infra/health.ts'
import { mulberry32 } from './retry-backoff.ts'
import { PartitionedQueue } from './partitioned-queue.ts'

export interface SimOptions {
  seed: number
  workers: number
  tickets?: number
  assessments?: number
  relayVariant: 'baseline' | 'partitioned'
  outage?: { start: number; end: number }
  /** Extra relay burst: `count` relays across `acrossTickets` conversations, enqueued at `at` (tests HOL blocking). */
  relayBurst?: { at: number; count: number; acrossTickets: number }
}
export interface KindStats { enqueued: number; coalesced: number; ran: number; bytes: number; queueAges: number[]; latencies: number[] }
export interface RelayRecord { key: string; partition: string; enqueuedAt: number; queueAge: number; latency: number }
export interface SimResult {
  seed: number; workers: number; variant: string; outage: boolean
  kinds: Record<string, KindStats>
  relays: RelayRecord[]
  coordinatorInteractions: number; coordinatorBytes: number; simDurationMs: number
}

/** Simulated service times (ms): delivering a steer/inject/card into the main Session, preparing a launch, etc. */
const T = { relay: 1500, notice: 800, assessment: 3000, launch: 9000, delivery: 2000, reply: 4000 }
const HORIZON = 600_000
const NOTICE_NAMES = ['prompts', 'settings', 'retry-health', 'triggers', 'tickets', 'metrics']
type Kind = 'relay' | 'notice' | 'assessment' | 'launch' | 'delivery' | 'reply'

export async function runCoordinatorSim(options: SimOptions): Promise<SimResult> {
  const { seed, workers, relayVariant, outage } = options
  const ticketCount = options.tickets ?? 200
  const assessmentCount = options.assessments ?? 120
  const directory = mkdtempSync(join(tmpdir(), 'issue13-'))
  const store = new Store(join(directory, 'db.sqlite'))
  let clock = Date.parse('2026-09-09T00:00:00Z')
  const t0 = clock
  const rng = mulberry32(seed)
  const uniform = (lo: number, hi: number) => lo + rng() * (hi - lo)
  const effects = new Effects(store, new HealthBoard(), () => clock)
  const relayPartition = new Map<string, string>()
  const partitioned = new PartitionedQueue(store.db, 'relay', () => clock, key => relayPartition.get(key) ?? key)

  let timerSeq = 0
  const timers: { at: number; seq: number; fn: () => void }[] = []
  const after = (ms: number, fn: () => void) => {
    timers.push({ at: clock + ms, seq: timerSeq++, fn })
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
  }
  const flush = () => new Promise<void>(resolve => setImmediate(resolve))

  const all: Record<string, KindStats> = {}
  const stats = (kind: string): KindStats => (all[kind] ??= { enqueued: 0, coalesced: 0, ran: 0, bytes: 0, queueAges: [], latencies: [] })
  const enqueuedAt = new Map<string, number>()
  const relays: RelayRecord[] = []
  let active = 0
  let running = 0

  const enqueue = (kind: Kind, key: string, payload: object) => {
    const stat = stats(kind)
    if (relayVariant === 'partitioned' && kind === 'relay') {
      if (partitioned.pending().includes(key)) stat.coalesced++
      partitioned.enqueue(key, payload)
    } else {
      if (effects.pending(kind, key)) stat.coalesced++
      effects.enqueue(kind, key, payload as never)
    }
    stat.enqueued++
    stat.bytes += JSON.stringify(payload).length
    enqueuedAt.set(`${kind}:${key}`, clock)
  }

  const inOutage = () => !!outage && clock >= outage.start && clock < outage.end
  /** Handler factory: runs after the service time; fails if the outage held at dispatch start. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serve = (kind: Kind, ms: number, fail?: () => boolean) => async (_payload: any, key: string) => {
    const at = enqueuedAt.get(`${kind}:${key}`) ?? clock
    const startedAt = clock
    const willFail = fail?.() ?? false
    running++
    await new Promise<void>(resolve => after(ms, resolve))
    running--
    if (willFail) throw new Error(`${kind} delivery failed (main Session unavailable)`)
    const stat = stats(kind)
    stat.ran++
    stat.queueAges.push(startedAt - at)
    stat.latencies.push(clock - at)
    if (kind === 'relay') relays.push({ key, partition: relayPartition.get(key) ?? key, enqueuedAt: at, queueAge: startedAt - at, latency: clock - at })
  }

  // Production handler registrations (src/app/sessions.ts, assessment.ts, outbox.ts, executor/dsh.ts).
  if (relayVariant === 'baseline') effects.handle('relay', serve('relay', T.relay, inOutage), { ordered: true })
  effects.handle('notice', serve('notice', T.notice), { ordered: true })
  effects.handle('assessment', serve('assessment', T.assessment), { limit: () => 4 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  effects.handle('launch', async (payload: { ticketId: string }, key: string) => {
    active++ // a running launch reserves its slot, as WorkerSlots.launches() does
    await serve('launch', T.launch)(payload, key)
    const ticketId = payload.ticketId
    after(uniform(60_000, 240_000), () => { active-- })
    scheduleTicketTraffic(ticketId)
  }, { limit: () => Math.max(0, workers - active), retry: [5000, 300_000] })
  effects.handle('delivery', serve('delivery', T.delivery), { limit: () => 4, quiet: true })
  effects.handle('reply', serve('reply', T.reply), { limit: () => 1, retry: [5000, 300_000] })

  const ticketTraffic = new Map<string, [number, () => void][]>()
  function scheduleTicketTraffic(ticketId: string): void {
    for (const [offset, fn] of ticketTraffic.get(ticketId) ?? []) after(offset, fn)
    ticketTraffic.delete(ticketId)
  }
  effects.start()

  // --- Workload generation (all decisions seeded; event schedule fixed up front) ---
  for (let i = 0; i < ticketCount; i++) {
    const ticketId = `ticket-${i}`
    const arrival = i % 10 === 0 ? uniform(0, 5_000) : i % 10 < 5 ? uniform(0, HORIZON) : HORIZON / 2 + uniform(0, 30_000) // bursty
    after(arrival, () => enqueue('launch', `asg-${i}`, { ticketId, assignmentId: `asg-${i}` }))
    const traffic: [number, () => void][] = []
    for (let r = 0; r < 8; r++) {
      const key = `report:${ticketId}:${r}`
      traffic.push([uniform(5_000, 200_000), () => {
        relayPartition.set(key, ticketId)
        enqueue('relay', key, { text: `Worker report ${r} for ${ticketId}: ${'x'.repeat(Math.floor(uniform(200, 900)))}` })
      }])
    }
    for (let n = 0; n < 3; n++) {
      const name = NOTICE_NAMES[Math.floor(rng() * NOTICE_NAMES.length)]!
      traffic.push([uniform(5_000, 200_000), () => enqueue('notice', name, { value: { revision: Math.floor(rng() * 50) }, summary: `${name} changed` })])
    }
    for (let d = 0; d < 4; d++) traffic.push([uniform(5_000, 200_000), () => enqueue('delivery', ticketId, { ticketId })])
    for (let p = 0; p < 3; p++) traffic.push([uniform(5_000, 200_000), () => enqueue('reply', `msg-${ticketId}-${p}`, {})])
    ticketTraffic.set(ticketId, traffic)
  }
  for (let a = 0; a < assessmentCount; a++) {
    after(uniform(0, HORIZON), () => enqueue('assessment', `eval-${a}`, { triggerId: `trigger-${a}` }))
  }
  if (options.relayBurst) {
    const { at, count, acrossTickets } = options.relayBurst
    after(at, () => {
      for (let i = 0; i < count; i++) {
        const ticket = `burst-ticket-${i % acrossTickets}`
        const key = `burst:${ticket}:${Math.floor(i / acrossTickets)}`
        relayPartition.set(key, ticket)
        enqueue('relay', key, { text: `Burst report ${i}: ${'y'.repeat(400)}` })
      }
    })
  }

  // --- Drive virtual time: fire timers in order; kick queues after every advance; unstick backoff rows. ---
  const pendingRows = () => Number(store.db.prepare('SELECT COUNT(*) AS n FROM effect').get()?.n ?? 0)
  const minDue = () => Number(store.db.prepare('SELECT MIN(due) AS due FROM effect').get()?.due ?? Infinity)
  for (;;) {
    await flush()
    if (running === 0 && timers.length === 0) {
      effects.kick()
      if (relayVariant === 'partitioned') await partitioned.dispatch(serve('relay', T.relay, inOutage))
      await flush()
      if (running === 0 && timers.length === 0) {
        if (pendingRows() === 0) break
        if (minDue() > clock) clock = minDue() // rows waiting out a backoff: advance to their due, as a periodic kicker would
        continue
      }
    }
    if (timers.length > 0) {
      const next = timers[0]!.at
      if (next > clock) clock = next
      while (timers.length > 0 && timers[0]!.at <= clock) timers.shift()!.fn()
      effects.kick()
      if (relayVariant === 'partitioned' && running === 0) await partitioned.dispatch(serve('relay', T.relay, inOutage))
    }
  }
  await effects.drain()

  const coordinatorInteractions = stats('relay').ran + stats('notice').ran + stats('assessment').ran
  const coordinatorBytes = stats('relay').bytes + stats('notice').bytes + stats('assessment').bytes
  const result: SimResult = {
    seed, workers, variant: relayVariant, outage: !!outage, kinds: all, relays,
    coordinatorInteractions, coordinatorBytes, simDurationMs: clock - t0,
  }
  store.close()
  rmSync(directory, { recursive: true, force: true })
  return result
}

/** Percentile of a sample (linear interpolation), for report tables. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index), hi = Math.ceil(index)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo)
}

/** Paired bootstrap per mandate 9.2: 10000 resamples over matched pairs, 2.5/97.5 percentiles of relative improvement. */
export function pairedBootstrap(baseline: readonly number[], variant: readonly number[], statistic: (xs: number[]) => number,
  seed = 1, samples = 10_000): { estimate: number; ci: [number, number] } {
  if (baseline.length !== variant.length || !baseline.length) throw new Error('paired samples must match and be non-empty')
  const relative = (b: number[], v: number[]) => (statistic(b) - statistic(v)) / statistic(b) // lower is better
  const estimate = relative([...baseline], [...variant])
  const rng = mulberry32(seed)
  const n = baseline.length
  const distribution: number[] = []
  for (let s = 0; s < samples; s++) {
    const b: number[] = [], v: number[] = []
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); b.push(baseline[j]!); v.push(variant[j]!) }
    distribution.push(relative(b, v))
  }
  distribution.sort((a, b) => a - b)
  return { estimate, ci: [distribution[Math.floor(0.025 * samples)]!, distribution[Math.floor(0.975 * samples)]!] }
}
