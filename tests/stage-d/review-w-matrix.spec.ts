/**
 * Review copy (Phase 7 controlled matrix): W in {1,3,6,12}, light and saturated (set REVIEW_MATRIX=1 to run; wall-clock, scripted turn durations, no model calls) plus the pause-under-load check that always runs.
 * Derived from tests/stage-d/issue-17-concurrency.spec.ts.
 *
 * Stage D, Issue 17: worker concurrency and scheduling benchmarks at capacities 3, 6 and 12 with seeded synthetic
 * workloads against the real Effects queue, WorkerSlots and DshExecutor. Worker turns are ended by the harness after
 * their scripted duration, so this measures scheduling machinery (queueing, dispatch, slot transitions), not model
 * latency; the token-cost dimension is NOT TESTED here because paid model calls are frozen (the live-validation
 * workstream owns the real model path). The refill-latency scenario measures how a freed slot reaches a queued launch
 * (effect kicks vs the 2-second pass interval); the workload scenarios pump after turn ends to measure the scheduling
 * machinery rather than pass-interval quantization.
 */
import { afterEach, expect, it } from 'vitest'
import { sleep, waitUntil } from '../fixtures/async.ts'
import { feishu, startRuntime, type Host } from './host.ts'
import { SlotProbe, evidence, mean, prng, summarize } from './probe.ts'

let hosts: Host[] = []
afterEach(async () => { for (const h of hosts) await h.stop(); hosts = [] })

const capacity = (h: Host, n: number) => {
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: n } })
}
const running = (h: Host, sessionId: string) => h.agents.get(sessionId)?.status === 'running'
const idle = (h: Host, sessionId: string) => {
  const agent = h.agents.get(sessionId)
  if (!agent || agent.status === 'idle') return
  agent.status = 'idle'
  h.ctx.emit('agent/status', { agent, status: 'idle' } as never)
}
/** Seeded mix: 60% short (30ms), 30% medium (100ms), 10% long (400ms). */
const mix = (rand: () => number) => { const u = rand(); return u < 0.6 ? 30 : u < 0.9 ? 100 : 400 }

interface RunResult {
  capacity: number; seed: number; n: number; failed: number
  makespanMs: number; idealMs: number; overheadRatio: number
  queueWait: ReturnType<typeof summarize>; completion: ReturnType<typeof summarize>
  peakUsed: number; memRssDeltaMB: number
}

async function runWorkload(options: { capacity: number; n: number; seed: number; pump: boolean; durations?: number[]; failAt?: Set<number>; pauseWindow?: boolean }): Promise<RunResult & { startedDuringPause?: number }> {
  const h = await startRuntime()
  hosts.push(h)
  capacity(h, options.capacity)
  const probe = new SlotProbe(h)
  const rand = prng(options.seed)
  const durations = options.durations ?? Array.from({ length: options.n }, () => mix(rand))
  const totalWork = durations.reduce((sum, d) => sum + d, 0)
  // End each worker's first turn after its scripted duration; launch order is FIFO, matching acceptance order.
  const queue = [...durations]
  const turns = new Set<string>()
  const memBefore = process.memoryUsage().rss
  ;(h.ctx as any).on('agent/status', ({ agent, status }: any) => {
    if (status !== 'running' || typeof agent?.id !== 'string' || !agent.id.startsWith('worker-')) return
    if (turns.has(agent.id)) return
    turns.add(agent.id)
    const duration = queue.shift() ?? 30
    const index = turns.size - 1
    if (options.failAt?.has(index)) {
      setTimeout(() => h.ctx.emit('agent/error', { agent, turn: 1, step: 1, error: new Error('synthetic hard failure') } as never), 5)
      return
    }
    setTimeout(() => idle(h, agent.id), duration)
  })
  const accepted: { ticketId: string }[] = []
  const started = Date.now()
  for (let i = 0; i < options.n; i++) {
    const one = await h.acceptedTicket(feishu(`${100 + i}`, `@bot task ${i}`))
    probe.mark(one.ticket.id, 'accepted')
    accepted.push({ ticketId: one.ticket.id })
  }
  const done = () => accepted.filter(({ ticketId }) => probe.marks.get(ticketId)?.turnEnded).length
  const failed = () => accepted.filter(({ ticketId }) =>
    h.runtime.store.tickets.get(ticketId)?.assignments.at(-1)?.report?.state === 'failed').length
  const startedCount = () => accepted.filter(({ ticketId }) => probe.marks.get(ticketId)?.assignmentStarted !== undefined).length
  let phase = options.pauseWindow ? 0 : 2, atPause = 0, pauseUntil = 0, startedDuringPause: number | undefined
  const setPaused = (value: boolean) => { const settings = h.runtime.store.settings(); h.runtime.store.saveSettings({ ...settings, paused: value }) }
  const deadline = Date.now() + 120_000
  while (done() + failed() < options.n) {
    if (Date.now() > deadline) throw new Error(`workload stalled: done=${done()} failed=${failed()} of ${options.n}`)
    if (phase === 0 && startedCount() >= options.capacity) { setPaused(true); atPause = startedCount(); pauseUntil = Date.now() + 400; phase = 1 }
    else if (phase === 1 && Date.now() >= pauseUntil) { startedDuringPause = startedCount() - atPause; setPaused(false); phase = 2 }
    if (options.pump) await h.runtime.pump()
    await sleep(20)
  }
  const makespanMs = Date.now() - started
  probe.sample('workload-done')
  const queueWaits = accepted.map(({ ticketId }) =>
    Math.max(0, (probe.marks.get(ticketId)?.assignmentStarted ?? NaN) - (probe.marks.get(ticketId)?.accepted ?? NaN)))
  const completions = accepted.map(({ ticketId }) =>
    Math.max(0, (probe.marks.get(ticketId)?.turnEnded ?? probe.marks.get(ticketId)?.assignmentStarted ?? NaN) - (probe.marks.get(ticketId)?.accepted ?? NaN)))
  const idealMs = totalWork / options.capacity
  const result: RunResult = {
    capacity: options.capacity, seed: options.seed, n: options.n, failed: failed(),
    makespanMs, idealMs, overheadRatio: makespanMs / idealMs,
    queueWait: summarize(queueWaits), completion: summarize(completions),
    peakUsed: probe.peakUsed, memRssDeltaMB: (process.memoryUsage().rss - memBefore) / 1e6,
  }
  ;(result as any).startedDuringPause = startedDuringPause
  probe.dispose()
  return result as RunResult & { startedDuringPause?: number }
}

import { writeFileSync } from 'node:fs'
const out: unknown[] = []
// Review matrix (Phase 7): W in {1,3,6,12}, light and saturated profiles, same seeds across W (matched workloads), real runtime, scripted turn durations, no model calls.
for (const profile of ['light', 'saturated'] as const) {
  it.skipIf(!process.env.REVIEW_MATRIX)(`review matrix ${profile}`, async () => {
    for (const seed of [11, 29, 47]) for (const w of [1, 3, 6, 12]) {
      const n = profile === 'light' ? 4 : 24
      const r = await runWorkload({ capacity: w, n, seed, pump: true })
      out.push({ profile, ...r, queueWait: undefined, completion: undefined, queueWaitP95: r.queueWait.p95, completionP95: r.completion.p95, queueWaitMedian: r.queueWait.median })
      expect(r.failed).toBe(0)
      expect(r.peakUsed).toBeLessThanOrEqual(w)
    }
    writeFileSync(process.env.REVIEW_MATRIX_OUT ?? `/tmp/rev-matrix-${profile}.json`, JSON.stringify(out, null, 1))
  }, 600_000)
}

it('review pause under load: no assignment starts while paused; resume completes every task', async () => {
  const rows: unknown[] = []
  for (const seed of [11, 29, 47]) {
    const r = await runWorkload({ capacity: 3, n: 12, seed, pump: true, pauseWindow: true, durations: Array(12).fill(250) })
    rows.push({ seed, failed: r.failed, makespanMs: r.makespanMs, startedDuringPause: r.startedDuringPause })
    expect(r.failed).toBe(0)
    expect(r.startedDuringPause).toBe(0)
  }
}, 120_000)
