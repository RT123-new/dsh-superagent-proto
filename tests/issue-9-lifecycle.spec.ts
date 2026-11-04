/** Issue 9 lifecycle timelines: durations between observed events, failures apart from successes, unmatched starts never guessed. */
import { beforeEach, expect, it } from 'vitest'
import { Metrics } from '../src/infra/metrics.ts'
import { Probe } from '../src/infra/metrics-probe.ts'
import { DomainTimeline, SessionTimeline } from '../src/infra/metrics-lifecycle.ts'
import { processUsage } from '../src/infra/metrics-process.ts'
import type { DomainEvent } from '../src/core/ports.ts'

let mono: number
let metrics: Metrics
let probe: Probe
beforeEach(() => { mono = 0; metrics = new Metrics({ mono: () => mono }); probe = new Probe(metrics) })
const at = '2026-11-04T00:00:00.000Z'
const ev = (type: string, data: Record<string, unknown>) => ({ type, at, data }) as unknown as DomainEvent
const dur = (key: string) => metrics.snapshot().durations[key]
const failed = (key: string) => metrics.snapshot().failedDurations[key]

it('DomainTimeline measures trigger to evaluation, evaluation, decision to ticket, launch and ticket lifetime from observed events', () => {
  const t = new DomainTimeline(probe, () => mono, 5000, id => id === 'd1' ? 'e1' : undefined)
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 5
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['t1'], strength: 'weak' })); mono += 20
  t.observe(ev('decision.recorded', { decisionId: 'd1', kind: 'accept', threadKey: 'th' })); mono += 3
  t.observe(ev('ticket.created', { ticketId: 'k1', decisionId: 'd1', strength: 'weak' })); mono += 40
  t.observe(ev('assignment.started', { ticketId: 'k1', assignmentId: 'a1' })); mono += 100
  t.observe(ev('ticket.ended', { ticketId: 'k1', by: 'worker', outcome: 'merged' }))
  expect(dur('trigger_to_eval_start|internal')?.maxMs).toBe(5)
  expect(dur('eval_run|internal')?.maxMs).toBe(20)
  expect(dur('decision_to_ticket|internal')?.maxMs).toBe(3)
  expect(dur('assignment_launch|internal')?.maxMs).toBe(40)
  expect(dur('ticket_lifetime|internal')?.maxMs).toBe(140)
  const c = metrics.snapshot().counters
  expect([c.ticket_created, c.decision_accept, c.ticket_outcome_merged]).toEqual([1, 1, 1])
})

it('measures the mandate T_i: one correlated request-received to terminal task latency per task', () => {
  const t = new DomainTimeline(probe, () => mono, 5000, id => id === 'd1' ? 'e1' : undefined)
  t.arrived('t1'); mono += 7
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 5
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['t1'], strength: 'weak' })); mono += 20
  t.observe(ev('decision.recorded', { decisionId: 'd1', kind: 'accept', threadKey: 'th' })); mono += 3
  t.observe(ev('ticket.created', { ticketId: 'k1', decisionId: 'd1', strength: 'weak' })); mono += 140
  t.observe(ev('ticket.ended', { ticketId: 'k1', by: 'worker', outcome: 'merged' }))
  expect(dur('task_total|internal')?.maxMs).toBe(175)                                   // t_terminal - t_received: the intake arrival, every stage included
  expect(dur('source_to_eval_queue|internal')?.maxMs).toBe(7)                           // the intake window is part of T_i, not lost
  expect(dur('trigger_to_eval_start|internal')?.maxMs).toBe(5)                          // W_i still measured from the queue commit
  expect(dur('ticket_lifetime|internal')?.maxMs).toBe(140)
})

it('T_i uses the earliest received trigger of the eval and survives a resume; a terminal without the chain is unmatched, not guessed', () => {
  const t = new DomainTimeline(probe, () => mono, 5000, id => id === 'd1' ? 'e1' : undefined)
  t.arrived('t1'); mono += 4
  t.arrived('t2'); mono += 1
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 2
  t.observe(ev('trigger.received', { triggerId: 't2', threads: [], queued: true })); mono += 3
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['t1', 't2'], strength: 'weak' })); mono += 10
  t.observe(ev('decision.recorded', { decisionId: 'd1', kind: 'accept', threadKey: 'th' })); mono += 5
  t.observe(ev('ticket.created', { ticketId: 'k1', decisionId: 'd1', strength: 'weak' })); mono += 50
  t.observe(ev('ticket.resumed', { ticketId: 'k1', triggerId: 't9' })); mono += 20
  t.observe(ev('ticket.ended', { ticketId: 'k1', by: 'worker', outcome: 'merged' }))
  expect(dur('task_total|internal')?.maxMs).toBe(95)                                    // 4+1+2+3+10+5+50+20 from t1's intake arrival; resume does not rebase
  const before = metrics.snapshot().counters.lifecycle_unmatched ?? 0
  t.observe(ev('ticket.ended', { ticketId: 'k-orphan', by: 'human', outcome: 'stopped' }))
  expect(metrics.snapshot().counters.lifecycle_unmatched).toBe(before + 1)
  expect(dur('task_total|internal')?.maxMs).toBe(95)                                    // no second sample
})

it('a start that was never observed records nothing and is counted, not guessed as zero', () => {
  const t = new DomainTimeline(probe, () => mono, 5000, id => id === 'd1' ? 'e1' : undefined)
  t.observe(ev('assignment.started', { ticketId: 'old', assignmentId: 'a' }))
  t.observe(ev('decision.recorded', { decisionId: 'd', kind: 'ignore', threadKey: 'never-started' }))
  expect(metrics.snapshot().durations).toEqual({})
  expect(metrics.snapshot().counters.lifecycle_unmatched).toBe(2)
})

it('T_i reaches every accepted ticket of an eval: an ignore and earlier accepts never consume the receipt', () => {
  const byDecision: Record<string, string> = { d1: 'e1', d2: 'e1', d3: 'e1' }
  const t = new DomainTimeline(probe, () => mono, 5000, id => byDecision[id])
  t.arrived('t1'); mono += 4
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 5
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['t1'], strength: 'weak' })); mono += 10
  t.observe(ev('decision.recorded', { decisionId: 'd1', kind: 'ignore', threadKey: 'th' })); mono += 3
  t.observe(ev('decision.recorded', { decisionId: 'd2', kind: 'accept', threadKey: 'th' })); mono += 7
  t.observe(ev('ticket.created', { ticketId: 'k1', decisionId: 'd2', strength: 'weak' })); mono += 2
  t.observe(ev('decision.recorded', { decisionId: 'd3', kind: 'accept', threadKey: 'th' })); mono += 11
  t.observe(ev('ticket.created', { ticketId: 'k2', decisionId: 'd3', strength: 'weak' })); mono += 20
  t.observe(ev('ticket.ended', { ticketId: 'k1', by: 'worker', outcome: 'merged' })); mono += 6
  t.observe(ev('ticket.ended', { ticketId: 'k2', by: 'worker', outcome: 'merged' }))
  const d = dur('task_total|internal')
  expect(d?.count).toBe(2)                                                            // both accepted tickets measured; the ignore consumed nothing
  expect(d?.maxMs).toBe(68)                                                           // k2: 4+5+10+3+7+2+11+20+6 from the original receipt
  expect(d?.sumMs).toBe(130)                                                          // k1: 62, k2: 68
})

it('T_i keeps the original receipt across a requeue of the same trigger, with no spurious unmatched', () => {
  const byDecision: Record<string, string> = { d1: 'e1', d2: 'e2' }
  const t = new DomainTimeline(probe, () => mono, 5000, id => byDecision[id])
  t.arrived('t1'); mono += 4
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 5
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['t1'], strength: 'weak' })); mono += 10
  t.observe(ev('decision.recorded', { decisionId: 'd1', kind: 'accept', threadKey: 'th' })); mono += 3
  t.observe(ev('ticket.created', { ticketId: 'k1', decisionId: 'd1', strength: 'weak' })); mono += 8
  t.observe(ev('ticket.ended', { ticketId: 'k1', by: 'human', outcome: 'stopped' })); mono += 30
  // The same trigger is queued again; the intake does not re-note an arrival for it.
  const unmatchedBefore = metrics.snapshot().counters.lifecycle_unmatched ?? 0
  t.observe(ev('trigger.received', { triggerId: 't1', threads: [], queued: true })); mono += 6
  expect(metrics.snapshot().counters.lifecycle_unmatched ?? 0).toBe(unmatchedBefore)   // the round-1 arrival was already accounted
  t.observe(ev('eval.started', { evalId: 'e2', threadKey: 'th', triggerIds: ['t1'], strength: 'weak' })); mono += 9
  t.observe(ev('decision.recorded', { decisionId: 'd2', kind: 'accept', threadKey: 'th' })); mono += 4
  t.observe(ev('ticket.created', { ticketId: 'k2', decisionId: 'd2', strength: 'weak' })); mono += 12
  t.observe(ev('ticket.ended', { ticketId: 'k2', by: 'worker', outcome: 'merged' }))
  expect(dur('task_total|internal')?.maxMs).toBe(91)                                  // k2 still measures from the original receipt (mono 0)
})

it('pending state is bounded: the oldest unmatched entry drops and is counted', () => {
  const t = new DomainTimeline(probe, () => mono, 3)
  for (let i = 0; i < 10; i++) t.observe(ev('trigger.received', { triggerId: `t${i}`, threads: [], queued: true }))
  expect(metrics.snapshot().counters.lifecycle_dropped).toBe(14)  // 7 drops from each of the two trigger-keyed pending chains (W_i and T_i)
})

it('DomainTimeline never throws on a malformed event', () => {
  const t = new DomainTimeline(probe, () => mono, 5000, id => id === 'd1' ? 'e1' : undefined)
  expect(() => t.observe({ type: 'eval.started', at, data: {} } as unknown as DomainEvent)).not.toThrow()
  expect(metrics.snapshot().counters.metrics_error).toBe(1)
})

it('SessionTimeline times turn, model call and tool call; failures go to the failure series', () => {
  const s = new SessionTimeline(probe, () => mono)
  s.observe('w1', { type: 'turn/start', data: { turn: 1 } }); mono += 1
  s.observe('w1', { type: 'step/start', data: { turn: 1, step: 1 } }); mono += 30
  s.observe('w1', { type: 'assistant/message', data: { turn: 1, step: 1 } })
  s.observe('w1', { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1' } }); mono += 7
  s.observe('w1', { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c1' } } })
  s.observe('w1', { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c2' } }); mono += 2
  s.observe('w1', { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true } } })
  s.observe('w1', { type: 'step/start', data: { turn: 1, step: 2 } }); mono += 4
  s.observe('w1', { type: 'assistant/attempt', data: { turn: 1, step: 2 } }); mono += 1
  s.observe('w1', { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
  expect(dur('step_to_settlement|internal')).toMatchObject({ count: 1, maxMs: 30 })
  expect(failed('step_to_settlement|internal')).toMatchObject({ count: 1, maxMs: 4 })
  expect(dur('tool_run|internal')).toMatchObject({ count: 1, maxMs: 7 })
  expect(failed('tool_run|internal')).toMatchObject({ count: 1, maxMs: 2 })
  expect(dur('worker_turn|internal')).toBeUndefined()
  expect(failed('worker_turn|internal')).toMatchObject({ count: 1, maxMs: 45 })
})

it('SessionTimeline keeps sessions apart and ignores a result with no observed call', () => {
  const s = new SessionTimeline(probe, () => mono)
  s.observe('a', { type: 'turn/start', data: { turn: 1 } }); mono += 5
  s.observe('b', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  s.observe('a', { type: 'tool/result', data: { message: { toolCallId: 'x' } } })
  expect(dur('worker_turn|internal')).toBeUndefined()
  expect(metrics.snapshot().counters.lifecycle_unmatched).toBe(2)
})

it('processUsage reports process-scoped CPU and memory', () => {
  const p = processUsage()
  expect(p.scope).toBe('process'); expect(p.cpuUserMicros).toBeGreaterThan(0); expect(p.rssBytes).toBeGreaterThan(0); expect(p.heapUsedBytes).toBeGreaterThan(0)
})

it('source_to_eval_queue runs from application receipt to a queued Eval entry, and only for triggers actually queued', () => {
  const t = new DomainTimeline(probe, () => mono, 5000)
  t.arrived('q1'); mono += 7
  t.observe(ev('trigger.received', { triggerId: 'q1', threads: [], queued: true }))
  expect(dur('source_to_eval_queue|internal')).toMatchObject({ count: 1, maxMs: 7 })
  t.arrived('o1'); mono += 50
  t.observe(ev('trigger.received', { triggerId: 'o1', threads: [], queued: false }))
  expect(dur('source_to_eval_queue|internal')?.count).toBe(1)
  expect(metrics.snapshot().counters.trigger_not_queued).toBe(1)
  // A not-queued trigger has no queue entry, so it never reaches evaluation start.
  mono += 1
  t.observe(ev('eval.started', { evalId: 'e1', threadKey: 'th', triggerIds: ['o1'], strength: 'weak' }))
  expect(dur('trigger_to_eval_start|internal')).toBeUndefined()
})

it('a queued trigger whose receipt was not observed records no queue sample and an abandoned receipt is forgotten', () => {
  const t = new DomainTimeline(probe, () => mono, 5000)
  t.observe(ev('trigger.received', { triggerId: 'r1', threads: [], queued: true }))
  expect(dur('source_to_eval_queue|internal')).toBeUndefined()
  expect(metrics.snapshot().counters.lifecycle_unmatched).toBe(1)
  t.arrived('d1'); t.abandoned('d1'); mono += 3
  t.observe(ev('trigger.received', { triggerId: 'd1', threads: [], queued: true }))
  expect(dur('source_to_eval_queue|internal')).toBeUndefined()
})
