/**
 * Stage D, Issue 17 follow-up: paired benchmark for the slot-free wake. The same seeded workloads run against the code
 * without the wake (DSH_REFILL_ARM=baseline) and with it (DSH_REFILL_ARM=variant, the default); raw samples land in one
 * evidence file per arm for the paired analysis (refill-bench-analyze.mjs). Every worker reports progress and then ends
 * its turn with nothing to say, so every refill is a quiet turn end: without the wake each one waits for the 2-second
 * Passes interval. The capacity-1 profile gives clean per-refill latencies (no other workers relaying incidental kicks);
 * the wider profiles measure end-to-end makespan where incidental relay kicks mix in. DSH_REFILL_FULL=1 widens the grid
 * for the reported evidence; the default grid keeps routine `pnpm test` fast. Worker turns are ended by the harness, so
 * this measures scheduling machinery, not model latency; token cost is NOT TESTED (paid model calls frozen).
 */
import { afterEach, expect, it } from 'vitest'
import { sleep, waitUntil } from '../fixtures/async.ts'
import { feishu, startRuntime, type Host } from './host.ts'
import { SlotProbe, evidence, percentile, prng, summarize } from './probe.ts'

const ARM = process.env.DSH_REFILL_ARM === 'baseline' ? 'baseline' : 'variant'
const FULL = process.env.DSH_REFILL_FULL === '1'
const profiles = FULL
  ? [{ capacity: 1, n: 6 }, { capacity: 3, n: 12 }, { capacity: 6, n: 18 }, { capacity: 12, n: 24 }]
  : [{ capacity: 1, n: 4 }, { capacity: 3, n: 9 }, { capacity: 12, n: 12 }]
const seeds = FULL ? [11, 29, 47, 83, 129] : [11, 29, 47]

let hosts: Host[] = []
afterEach(async () => { for (const h of hosts) await h.stop(); hosts = [] })

/** Seeded mix: 60% short (30ms), 30% medium (100ms), 10% long (400ms), as the Issue 17 capacity matrix uses. */
const mix = (rand: () => number) => { const u = rand(); return u < 0.6 ? 30 : u < 0.9 ? 100 : 400 }
const running = (h: Host, sessionId: string) => h.agents.get(sessionId)?.status === 'running'
const idle = (h: Host, sessionId: string) => {
  const agent = h.agents.get(sessionId)
  if (!agent || agent.status === 'idle') return
  agent.status = 'idle'
  h.ctx.emit('agent/status', { agent, status: 'idle' } as never)
}

interface QuietRun {
  capacity: number; seed: number; n: number; failed: number; makespanMs: number
  refillsMs: number[]; queueWaitsMs: number[]; completionsMs: number[]; peakUsed: number
}

async function runQuiet(options: { capacity: number; n: number; seed: number }): Promise<QuietRun> {
  const h = await startRuntime()
  hosts.push(h)
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: options.capacity } })
  const probe = new SlotProbe(h)
  const rand = prng(options.seed)
  const queue = Array.from({ length: options.n }, () => mix(rand))
  const turns = new Set<string>()
  // Each worker reports progress, lets that relay drain, then ends its turn with nothing to say: a quiet turn end.
  ;(h.ctx as any).on('agent/status', ({ agent, status }: any) => {
    if (status !== 'running' || typeof agent?.id !== 'string' || !agent.id.startsWith('worker-')) return
    if (turns.has(agent.id)) return
    turns.add(agent.id)
    const duration = queue.shift() ?? 30
    setTimeout(() => void (async () => {
      try {
        await h.runTool(agent.id, 'orchestrator_report', { state: 'progress', summary: 'Working on it' })
        await h.runtime.idle()
      } catch { return }
      idle(h, agent.id)
    })(), duration)
  })
  const accepted: string[] = []
  const started = Date.now()
  for (let i = 0; i < options.n; i++) {
    const one = await h.acceptedTicket(feishu(`${100 + i}`, `@bot task ${i}`))
    probe.mark(one.ticket.id, 'accepted')
    accepted.push(one.ticket.id)
  }
  const done = () => accepted.filter(ticketId => probe.marks.get(ticketId)?.turnEnded).length
  const failed = () => accepted.filter(ticketId =>
    h.runtime.store.tickets.get(ticketId)?.assignments.at(-1)?.report?.state === 'failed').length
  const deadline = Date.now() + 150_000
  while (done() + failed() < options.n) {
    if (Date.now() > deadline) throw new Error(`quiet workload stalled: done=${done()} failed=${failed()} of ${options.n}`)
    await sleep(20)
  }
  const makespanMs = Date.now() - started
  const at = (ticketId: string, name: string) => probe.marks.get(ticketId)?.[name] ?? NaN
  // Capacity 1 refills strictly in acceptance order: refill i is t[i+1]'s start after t[i]'s turn end.
  const refillsMs = options.capacity === 1
    ? accepted.slice(1).map((ticketId, i) => Math.max(0, at(ticketId, 'assignmentStarted') - at(accepted[i]!, 'turnEnded')))
    : []
  const queueWaitsMs = accepted.map(ticketId => Math.max(0, at(ticketId, 'assignmentStarted') - at(ticketId, 'accepted')))
  const completionsMs = accepted.map(ticketId => Math.max(0, (at(ticketId, 'turnEnded') || at(ticketId, 'assignmentStarted')) - at(ticketId, 'accepted')))
  probe.dispose()
  return { capacity: options.capacity, seed: options.seed, n: options.n, failed: failed(), makespanMs,
    refillsMs, queueWaitsMs, completionsMs, peakUsed: probe.peakUsed }
}

it(`slot-free wake paired bench (${ARM}, ${FULL ? 'full' : 'default'} grid): quiet turn ends across capacities and seeds`, async () => {
  const runs: QuietRun[] = []
  for (const profile of profiles) for (const seed of seeds) runs.push(await runQuiet({ ...profile, seed }))
  const refills = runs.flatMap(run => run.refillsMs)
  evidence(`issue-17-slot-refill-kick-bench-${ARM}${FULL ? '-full' : ''}`, {
    scenario: 'every worker reports progress then ends quietly; launch queue refills after quiet turn ends; '
      + 'capacity-1 refills are per-event latencies, wider profiles report makespan/queue waits; no harness pumps',
    arm: ARM, grid: { profiles, seeds }, tokenCost: 'NOT TESTED - paid model calls frozen; scheduling machinery only',
    runs,
    refillsSummary: refills.length ? { n: refills.length, ...summarize(refills) } : undefined,
  })
  for (const run of runs) {
    expect(run.failed).toBe(0)
    expect(run.peakUsed).toBeLessThanOrEqual(run.capacity)
  }
  // The wake's promise, asserted on the variant arm only: quiet refills are prompt, not pass-interval-bound.
  if (ARM === 'variant') expect(percentile(refills, 95)).toBeLessThan(500)
}, 600_000)
