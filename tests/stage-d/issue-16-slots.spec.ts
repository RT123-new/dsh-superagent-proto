/**
 * Stage D, Issue 16: how long worker slots stay occupied, by state, measured against the real DshExecutor/WorkerSlots
 * in the in-memory runtime. Deterministic: the harness controls turn ends, job ends, dispatch pumps and timers.
 * The effects queue dispatches on kicks (enqueue, task end, 2s pass), so scenarios pump explicitly at chosen moments:
 * a queued launch that starts right after a pump had a free slot; one that does not was blocked by slot occupancy.
 * Wall-clock durations are recorded as evidence; assertions check invariants and directional findings, not exact ms.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { latestAssignment } from '../../src/core/index.ts'
import { sleep, waitUntil } from '../fixtures/async.ts'
import { feishu, startRuntime, type Host } from './host.ts'
import { SlotProbe, evidence } from './probe.ts'

let h: Host
let probe: SlotProbe
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { probe?.dispose(); await h.stop() })

const capacity = (n: number) => {
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: n } })
}
/** The turn of a Session's agent ends, and DSH says so. */
const idle = (sessionId: string) => {
  const agent = h.agents.get(sessionId)!
  agent.status = 'idle'
  h.ctx.emit('agent/status', { agent, status: 'idle' } as never)
}
const accept = async (id: string) => {
  const one = await h.acceptedTicket(feishu(id, `@bot fix ${id}`))
  probe.mark(one.ticket.id, 'accepted')
  probe.sample(`accepted:${one.ticket.id}`)
  return one
}
const running = (sessionId: string) => h.agents.get(sessionId)?.status === 'running'
// Clock-resolution noise can make an immediate start read a few ms before the accept mark; clamp at 0.
const queueWaitMs = (ticketId: string) =>
  Math.max(0, (probe.marks.get(ticketId)?.assignmentStarted ?? NaN) - (probe.marks.get(ticketId)?.accepted ?? NaN))
const injected = (sessionId: string) => vi.mocked(h.agents.get(sessionId)!.inject).mock.calls.map(([message]) =>
  message.content.map(block => block.type === 'text' ? block.text : '').join(''))

it('A: background work after a turn holds the slot until quiet; queued launches wait for it', async () => {
  capacity(3)
  probe = new SlotProbe(h)
  const t1 = await accept('1'), t2 = await accept('2'), t3 = await accept('3')
  const t4 = await accept('4'), t5 = await accept('5'), t6 = await accept('6')
  // t1..t3 running; t4..t6 queued behind the full capacity.
  expect(running(t1.sessionId)).toBe(true)
  expect(h.agents.get(t5.sessionId)).toBeUndefined()
  // t1 ends its turn leaving a shell job running: the slot stays held in background-wait.
  const j1 = h.jobs.run(t1.sessionId, 'npm test')
  idle(t1.sessionId)
  await waitUntil(() => probe.stateOf(t1.ticket.id) === 'background-wait')
  // t2 ends quiet: its slot frees at once; a pump launches t4.
  idle(t2.sessionId)
  await waitUntil(() => probe.stateOf(t2.ticket.id) === 'idle')
  await h.runtime.pump(); await h.runtime.idle()
  await waitUntil(() => running(t4.sessionId))
  // t3 ends its turn leaving a job too. Every slot is now a turn (t4) or background-wait (t1, t3):
  // pumping admits neither t5 nor t6.
  const j3 = h.jobs.run(t3.sessionId, 'npm run build')
  idle(t3.sessionId)
  await waitUntil(() => probe.stateOf(t3.ticket.id) === 'background-wait')
  await sleep(100)
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.agents.get(t5.sessionId)).toBeUndefined()
  expect(h.agents.get(t6.sessionId)).toBeUndefined()
  probe.sample('blocked-by-background')
  await sleep(150)
  // t1's job ends ~250ms after its turn: the worker wakes, its next turn ends quiet, the slot frees, t5 launches.
  h.jobs.end(j1)
  await waitUntil(() => running(t1.sessionId))
  idle(t1.sessionId)
  await waitUntil(() => probe.stateOf(t1.ticket.id) === 'idle')
  await h.runtime.pump(); await h.runtime.idle()
  await waitUntil(() => running(t5.sessionId))
  probe.sample('t5-launched')
  // Still no slot for t6: t4 and t5 run turns, t3 waits on background.
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.agents.get(t6.sessionId)).toBeUndefined()
  await sleep(350)
  // t3's job ends ~600ms after its turn: only then can t6 launch.
  h.jobs.end(j3)
  await waitUntil(() => running(t3.sessionId))
  idle(t3.sessionId)
  await waitUntil(() => probe.stateOf(t3.ticket.id) === 'idle')
  await h.runtime.pump(); await h.runtime.idle()
  await waitUntil(() => running(t6.sessionId))
  probe.sample('t6-launched')
  for (const one of [t4, t5, t6]) { idle(one.sessionId) }
  await h.runtime.idle()
  probe.sample('done')
  const report = probe.report()
  evidence('issue-16-a-background-holds-slot', {
    scenario: 'capacity 3, 6 tickets; t1 ~250ms and t3 ~600ms of background work after their turns; explicit pumps',
    queueWaitMs: Object.fromEntries([t1, t2, t3, t4, t5, t6].map(one => [one.ticket.id, queueWaitMs(one.ticket.id)])),
    ...report,
  })
  // t6's launch was blocked by background-held slots far longer than t4's, which waited only for t2's turn to end.
  expect(queueWaitMs(t6.ticket.id)).toBeGreaterThan(queueWaitMs(t4.ticket.id) + 300)
  expect(report.stateSlotMs['background-wait']).toBeGreaterThan(400)
  expect(report.peakUsed).toBeLessThanOrEqual(3)
})

it('B: a handoff to a person frees the slot while owned jobs run on, collected and still cancellable', async () => {
  capacity(1)
  probe = new SlotProbe(h)
  const t1 = await accept('1')
  await h.runTool(t1.sessionId, 'orchestrator_report', { state: 'blocked', summary: 'Which color?' }); await h.runtime.idle()
  const j1 = h.jobs.run(t1.sessionId, 'dev server')
  idle(t1.sessionId)
  await waitUntil(() => probe.stateOf(t1.ticket.id) === 'handed-off')
  expect(h.runtime.executor.activeCount()).toBe(0)
  probe.sample('handed-off')
  // The free slot admits t2 at once while t1's server keeps running for the person.
  const t2 = await accept('2')
  expect(running(t2.sessionId)).toBe(true)
  probe.sample('t2-running-while-j1-runs')
  // The job's end is collected and told to the worker by injection: no turn, no slot.
  h.jobs.end(j1)
  await waitUntil(() => injected(t1.sessionId).some(text => text.includes('ended')))
  expect(h.agents.get(t1.sessionId)!.status).toBe('idle')
  expect(probe.stateOf(t1.ticket.id)).toBe('handed-off')
  expect(h.runtime.executor.activeCount()).toBe(1) // t2's turn only
  // t2 hands off with a job too; ending its Assignment kills the job it left (cancellation authority preserved).
  await h.runTool(t2.sessionId, 'orchestrator_report', { state: 'blocked', summary: 'Approve the preview?' }); await h.runtime.idle()
  const j2 = h.jobs.run(t2.sessionId, 'preview server')
  idle(t2.sessionId)
  await waitUntil(() => probe.stateOf(t2.ticket.id) === 'handed-off')
  await h.runtime.engine.stopTicket(t2.ticket.id)
  await h.runtime.idle()
  await waitUntil(() => !h.jobs.service.list(t2.sessionId).some(job => job.status === 'running'))
  probe.sample('t2-stopped')
  evidence('issue-16-b-handoff-frees-slot', {
    scenario: 'capacity 1; t1 hands off with a live job, t2 launches immediately; job end collected by injection; t2 left-job killed on stop',
    t2QueueWaitMs: queueWaitMs(t2.ticket.id), ...probe.report(),
  })
  expect(queueWaitMs(t2.ticket.id)).toBeLessThan(500)
  expect(probe.report().peakUsed).toBeLessThanOrEqual(1)
})

it('C: cancelling an assignment in background-wait kills its jobs and frees the slot promptly', async () => {
  capacity(1)
  probe = new SlotProbe(h)
  const t1 = await accept('1')
  h.jobs.run(t1.sessionId, 'watch mode')
  idle(t1.sessionId)
  await waitUntil(() => probe.stateOf(t1.ticket.id) === 'background-wait')
  const t2 = await accept('2')
  expect(h.agents.get(t2.sessionId)).toBeUndefined()
  const stopped = Date.now()
  await h.runtime.engine.stopTicket(t1.ticket.id)
  await h.runtime.idle()
  await waitUntil(() => running(t2.sessionId))
  probe.sample('t2-running')
  const releaseMs = (probe.marks.get(t2.ticket.id)?.assignmentStarted ?? NaN) - stopped
  await waitUntil(() => !h.jobs.service.list(t1.sessionId).some(job => job.status === 'running'))
  evidence('issue-16-c-cancel-background-wait', {
    scenario: 'capacity 1; t1 cancelled during background-wait; t2 queued behind it',
    slotReleaseToNextStartMs: releaseMs, ...probe.report(),
  })
  expect(releaseMs).toBeLessThan(500)
  expect(probe.report().peakUsed).toBeLessThanOrEqual(1)
})

it('D: a crashed worker turn frees its slot during the retry backoff, then recovers', async () => {
  capacity(1)
  probe = new SlotProbe(h)
  const t1 = await accept('1')
  const busy = Object.assign(new Error('Service Unavailable'), { status: 503 })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let backoffSlotFree = false
  try {
    h.ctx.emit('agent/error', { agent: h.agents.get(t1.sessionId), turn: 1, step: 1, error: busy } as never)
    idle(t1.sessionId) // the failed turn ends, as DSH ends it
    await vi.advanceTimersByTimeAsync(0)
    probe.sample('backing-off')
    backoffSlotFree = h.runtime.executor.activeCount() === 0
    // The free slot admits another launch while t1 backs off.
    const t2 = await accept('2')
    expect(running(t2.sessionId)).toBe(true)
    idle(t2.sessionId)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(0)
  } finally { vi.useRealTimers() }
  probe.sample('retried')
  const retried = h.deliveries.mock.calls.some(([call]) => call.sessionId === t1.sessionId
    && call.text.includes('Your last turn failed for a passing reason'))
  evidence('issue-16-d-crash-backoff-slot', {
    scenario: 'capacity 1; transient turn failure, 15s backoff (fake timers); slot free during backoff admits t2',
    backoffSlotFree, retried, ...probe.report(),
  })
  expect(backoffSlotFree).toBe(true)
  expect(retried).toBe(true)
})

it('E: a person\'s follow-up wakes its worker in one slot beyond the limit while launches wait', async () => {
  capacity(3)
  probe = new SlotProbe(h)
  const t1 = await accept('1'), t2 = await accept('2'), t3 = await accept('3')
  idle(t1.sessionId)
  await waitUntil(() => probe.stateOf(t1.ticket.id) === 'idle') // t1's turn ended quiet; its slot freed
  const t4 = await accept('4') // takes the freed slot
  const t5 = await accept('5') // queued: t2, t3, t4 hold all three slots
  await h.runtime.pump(); await h.runtime.idle()
  expect(h.agents.get(t5.sessionId)).toBeUndefined()
  h.runtime.receive(feishu('9', '一的补充', { mentions: [], root_id: 'om_1', sender_id: 'ou_guest' }))
  await h.runtime.idle()
  probe.sample('person-woken')
  const t5LaunchedWhilePersonWoken = h.agents.get(t5.sessionId) !== undefined
  evidence('issue-16-e-person-extra-slot', {
    scenario: 'capacity 3 full; a person message wakes t1 in the +1 slot while t5\'s launch waits',
    t5LaunchedWhilePersonWoken, ...probe.report(),
  })
  expect(running(t1.sessionId)).toBe(true)
  expect(t5LaunchedWhilePersonWoken).toBe(false)
  expect(probe.report().peakPerson).toBe(4)
  for (const one of [t1, t2, t3, t4]) idle(one.sessionId)
  await h.runtime.pump(); await h.runtime.idle()
  await waitUntil(() => running(t5.sessionId))
})

it('F: background work past the 30-minute limit is killed and the slot released', async () => {
  capacity(1)
  probe = new SlotProbe(h)
  const t1 = await accept('1')
  h.jobs.run(t1.sessionId, 'forgotten job')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  try {
    idle(t1.sessionId)
    await vi.advanceTimersByTimeAsync(0)
    expect(probe.stateOf(t1.ticket.id)).toBe('background-wait')
    probe.sample('settling-begins') // the look starts within the same fake instant, so the wait is fully accounted
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    probe.sample('15-minutes-in')
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    probe.sample('29-minutes-in')
    expect(probe.stateOf(t1.ticket.id)).toBe('background-wait') // still holding its slot near the limit
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.advanceTimersByTimeAsync(0)
    probe.sample('limit-reached') // sampled while the fake clock still stands at +31 minutes
  } finally { vi.useRealTimers() }
  const ticket = h.runtime.store.tickets.get(t1.ticket.id)!
  const jobsLeft = h.jobs.service.list(t1.sessionId).filter(job => job.status === 'running').length
  evidence('issue-16-f-background-limit', {
    scenario: 'capacity 1; job left running past the 30-minute background limit (fake timers)',
    reportState: latestAssignment(ticket)?.report?.state, summary: latestAssignment(ticket)?.report?.summary,
    jobsLeftRunning: jobsLeft, stateAfter: probe.stateOf(t1.ticket.id), activeCount: h.runtime.executor.activeCount(),
    ...probe.report(),
  })
  expect(latestAssignment(ticket)?.report?.state).toBe('waiting')
  expect(latestAssignment(ticket)?.report?.summary).toContain('killed')
  expect(jobsLeft).toBe(0)
  expect(probe.stateOf(t1.ticket.id)).toBe('idle')
  expect(h.runtime.executor.activeCount()).toBe(0)
})
