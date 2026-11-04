/**
 * Stage D, Issue 17 follow-up: the slot-free wake. A worker whose turn ends quietly (its end relays nothing) frees its
 * slot without kicking the effects queue, so a queued launch waits for the 2-second Passes interval (measured in
 * issue-17-concurrency.spec.ts: ~1.9s vs ~11ms when a relay happened to kick). The candidate fix wakes the queue when a
 * slot-free completes and launches wait. Failing-first: the refill-latency assertions here fail on the base (refill at
 * the next pass) and pass with the wake. Guards: no dispatch or spin while paused (launch limit 0), no resurrection of
 * a cancelled queued launch, no oversubscription. Cancellation, person priority and crash recovery are covered by the
 * issue-16/17 scenarios, which run unchanged against the wake.
 */
import { afterEach, expect, it } from 'vitest'
import { sleep, waitUntil } from '../fixtures/async.ts'
import { feishu, startRuntime, type Host } from './host.ts'
import { SlotProbe, evidence } from './probe.ts'

let hosts: Host[] = []
let probes: SlotProbe[] = []
afterEach(async () => { for (const p of probes) p.dispose(); probes = []; for (const h of hosts) await h.stop(); hosts = [] })

async function host(capacity: number) {
  const h = await startRuntime()
  hosts.push(h)
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: capacity } })
  return h
}
const running = (h: Host, sessionId: string) => h.agents.get(sessionId)?.status === 'running'
const idle = (h: Host, sessionId: string) => {
  const agent = h.agents.get(sessionId)
  if (!agent || agent.status === 'idle') return
  agent.status = 'idle'
  h.ctx.emit('agent/status', { agent, status: 'idle' } as never)
}
const mark = (probe: SlotProbe, ticketId: string, name: string) => probe.marks.get(ticketId)?.[name] ?? NaN

it('quiet turn end: a queued launch refills the freed slot at once, not at the next pass', async () => {
  const h = await host(1)
  const probe = new SlotProbe(h)
  probes.push(probe)
  const t1 = await h.acceptedTicket(feishu('1', '@bot task 1'))
  const t2 = await h.acceptedTicket(feishu('2', '@bot task 2'))
  probe.mark(t1.ticket.id, 'accepted'); probe.mark(t2.ticket.id, 'accepted')
  expect(running(h, t1.sessionId)).toBe(true)
  expect(h.agents.get(t2.sessionId)).toBeUndefined() // queued behind the full slot
  // A non-empty prior summary makes this turn end quiet: the settle relays nothing, so no relay effect can kick the queue.
  await h.runTool(t1.sessionId, 'orchestrator_report', { state: 'progress', summary: 'Working on it' })
  await h.runtime.idle()
  const relaysBefore = h.relays(h.runtime.masterId).length
  idle(h, t1.sessionId)
  await waitUntil(() => running(h, t2.sessionId), 6000)
  const refillMs = mark(probe, t2.ticket.id, 'assignmentStarted') - mark(probe, t1.ticket.id, 'turnEnded')
  evidence('issue-17-slot-refill-kick-quiet', {
    scenario: 'capacity 1; t2 queued behind t1; t1 ends quietly (non-empty prior summary, nothing relayed)',
    refillMs,
    note: 'failing-first: on the base this is ~one 2s pass interval; with the slot-free wake it is tens of ms',
  })
  // The end relayed nothing: the refill cannot have come from a relay's kick.
  expect(h.relays(h.runtime.masterId).length).toBe(relaysBefore)
  expect(probe.peakUsed).toBeLessThanOrEqual(1)
  expect(refillMs).toBeLessThan(500)
}, 60_000)

it('handoff: freeing the slot by handing off wakes a queued launch at once', async () => {
  const h = await host(1)
  const probe = new SlotProbe(h)
  probes.push(probe)
  const t1 = await h.acceptedTicket(feishu('1', '@bot task 1'))
  const t2 = await h.acceptedTicket(feishu('2', '@bot task 2'))
  probe.mark(t1.ticket.id, 'accepted'); probe.mark(t2.ticket.id, 'accepted')
  await h.runTool(t1.sessionId, 'orchestrator_report', { state: 'blocked', summary: 'Which color?' })
  await h.runtime.idle()
  idle(h, t1.sessionId)
  await waitUntil(() => running(h, t2.sessionId), 6000)
  const refillMs = mark(probe, t2.ticket.id, 'assignmentStarted') - mark(probe, t1.ticket.id, 'turnEnded')
  evidence('issue-17-slot-refill-kick-handoff', {
    scenario: 'capacity 1; t2 queued behind t1; t1 hands off to a person with a blocked report, freeing its slot',
    refillMs,
    note: 'failing-first: on the base the handoff frees the slot without a kick, so t2 waits for the next pass',
  })
  expect(probe.stateOf(t1.ticket.id)).toBe('handed-off')
  expect(probe.peakUsed).toBeLessThanOrEqual(1)
  expect(refillMs).toBeLessThan(500)
}, 60_000)

it('paused: the wake neither dispatches nor spins; the queued launch waits for resume', async () => {
  const h = await host(1)
  const probe = new SlotProbe(h)
  probes.push(probe)
  const t1 = await h.acceptedTicket(feishu('1', '@bot task 1'))
  const t2 = await h.acceptedTicket(feishu('2', '@bot task 2'))
  await h.runTool(t1.sessionId, 'orchestrator_report', { state: 'progress', summary: 'Working on it' })
  await h.runtime.idle()
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, paused: true })
  let kicks = 0
  const effects = h.runtime.effects
  const original = effects.kick.bind(effects)
  effects.kick = () => { kicks++; original() }
  idle(h, t1.sessionId)
  await sleep(400)
  evidence('issue-17-slot-refill-kick-paused', {
    scenario: 'capacity 1, processing paused; t2 queued behind t1; t1 ends quietly',
    kicks, t2Started: running(h, t2.sessionId),
    note: 'the wake may fire but dispatch holds launches at limit 0 while paused; kicks must stay bounded (no busy loop)',
  })
  expect(h.agents.get(t2.sessionId)).toBeUndefined()
  expect(kicks).toBeLessThanOrEqual(2)
  effects.kick = original
  h.runtime.store.saveSettings({ ...settings, paused: false })
  await h.runtime.pump()
  await h.runtime.idle()
  await waitUntil(() => running(h, t2.sessionId), 6000)
  expect(probe.peakUsed).toBeLessThanOrEqual(1)
}, 60_000)

it('a cancelled queued launch is not resurrected by the wake', async () => {
  const h = await host(1)
  const probe = new SlotProbe(h)
  probes.push(probe)
  const t1 = await h.acceptedTicket(feishu('1', '@bot task 1'))
  const t2 = await h.acceptedTicket(feishu('2', '@bot task 2'))
  const t3 = await h.acceptedTicket(feishu('3', '@bot task 3'))
  probe.mark(t1.ticket.id, 'accepted'); probe.mark(t2.ticket.id, 'accepted'); probe.mark(t3.ticket.id, 'accepted')
  await h.runtime.engine.stopTicket(t2.ticket.id)
  await h.runtime.idle()
  await h.runTool(t1.sessionId, 'orchestrator_report', { state: 'progress', summary: 'Working on it' })
  await h.runtime.idle()
  idle(h, t1.sessionId)
  await waitUntil(() => running(h, t3.sessionId), 6000)
  const refillMs = mark(probe, t3.ticket.id, 'assignmentStarted') - mark(probe, t1.ticket.id, 'turnEnded')
  await h.runtime.idle()
  evidence('issue-17-slot-refill-kick-cancelled', {
    scenario: 'capacity 1; t2 queued then cancelled before its launch; t3 queued behind it; t1 ends quietly',
    refillMs,
    note: 'the wake dispatches the launch queue, whose per-launch revalidation skips the ended ticket; t3 refills promptly',
  })
  expect(h.agents.get(t2.sessionId)).toBeUndefined()
  expect(h.runtime.effects.pending('launch')).toBe(false)
  expect(refillMs).toBeLessThan(500)
  expect(probe.peakUsed).toBeLessThanOrEqual(1)
}, 60_000)
