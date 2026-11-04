import { afterEach, expect, it, vi } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'
import { deferred, sleep } from './fixtures/async.ts'
import type { Assignment, Ticket } from '../src/core/index.ts'

let h: Host | undefined
const methods = () => h!.runtime.executor as unknown as { workerIdle(ticket: Ticket, assignment: Assignment, agent: unknown): Promise<void> }
afterEach(async () => { await h?.stop(); h = undefined; vi.restoreAllMocks() })
async function scenario() {
  h = await startRuntime()
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 1 } })
  const first = await h.acceptedTicket(feishu('1', '@bot first'))
  const next = await h.acceptedTicket(feishu('2', '@bot next'))
  await h.runTool(first.sessionId, 'orchestrator_report', { state: 'progress', summary: 'Prior evidence preserved' })
  await h.runtime.idle()
  const agent = h.agents.get(first.sessionId)!
  // Directly exercise the actual idle handler without an extra status-event invocation.
  agent.status = 'idle'
  const latest = h.runtime.store.tickets.get(first.ticket.id)!
  return { first, next, agent, latest, assignment: latest.assignments.at(-1)! }
}

it('a committed quiet completion kicks only after the report transaction closes', async () => {
  const s = await scenario()
  let inside = false, checked = 0
  const atomic = h!.runtime.store.atomic.bind(h!.runtime.store)
  vi.spyOn(h!.runtime.store, 'atomic').mockImplementation((operation: () => unknown) => atomic(() => {
    const previous = inside; inside = true
    try { return operation() } finally { inside = previous }
  }) as never)
  const pending = h!.runtime.effects.pending.bind(h!.runtime.effects)
  vi.spyOn(h!.runtime.effects, 'pending').mockImplementation((kind, key) => { if (kind === 'launch') { expect(inside).toBe(false); checked++ } return pending(kind, key) })
  await methods().workerIdle(s.latest, s.assignment, s.agent)
  await h!.runtime.idle()
  expect(checked).toBeGreaterThan(0)
  expect(h!.agents.get(s.next.sessionId)?.status).toBe('running')
})

it('a rollback in the completion report never runs the new kick', async () => {
  const s = await scenario(), effects = h!.runtime.effects
  const kick = vi.spyOn(effects, 'kick')
  const report = h!.runtime.engine.report.bind(h!.runtime.engine)
  vi.spyOn(h!.runtime.engine, 'report').mockImplementation((...args) => { report(...args); throw new Error('rollback proof') })
  await expect(methods().workerIdle(s.latest, s.assignment, s.agent)).rejects.toThrow('rollback proof')
  expect(kick).not.toHaveBeenCalled()
  expect(h!.runtime.store.tickets.get(s.first.ticket.id)?.assignments.at(-1)?.report?.state).toBe('progress')
  expect(h!.agents.get(s.next.sessionId)).toBeUndefined()
})

it.each(['ended', 'replaced'] as const)('a stale idle for an %s assignment cannot launch or report', async kind => {
  const s = await scenario()
  const changed = kind === 'ended' ? { ...s.latest, ended: { at: '', by: 'person' as const, outcome: 'stopped' as const } }
    : { ...s.latest, assignments: s.latest.assignments.map(item => ({ ...item, id: 'replacement' })) }
  h!.runtime.store.tickets.save(changed as Ticket)
  const kick = vi.spyOn(h!.runtime.effects, 'kick'), report = vi.spyOn(h!.runtime.engine, 'report')
  await methods().workerIdle(s.latest, s.assignment, s.agent)
  expect(kick).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled()
})

it('an in-flight idle handler cannot kick or mutate after executor disposal', async () => {
  const s = await scenario(), gate = deferred()
  const agent = { ...s.agent, status: 'idle', whenIdle: () => gate.promise }
  const report = vi.spyOn(h!.runtime.engine, 'report'), kick = vi.spyOn(h!.runtime.effects, 'kick')
  const work = methods().workerIdle(s.latest, s.assignment, agent)
  h!.runtime.executor.dispose()
  gate.resolve(); await work
  expect(report).not.toHaveBeenCalled()
  expect(kick).not.toHaveBeenCalled()
})

it('a ready report that arrives during quiet settlement still refills promptly without overwriting it', async () => {
  const s = await scenario(), gate = deferred(), subagents = h!.ctx.get('subagents') as unknown as { waitForChildren: (...args: unknown[]) => Promise<boolean> }
  vi.spyOn(subagents, 'waitForChildren').mockImplementation(async () => { await gate.promise; return false })
  const work = methods().workerIdle(s.latest, s.assignment, s.agent)
  await sleep(1)
  const current = h!.runtime.store.tickets.get(s.first.ticket.id)!
  h!.runtime.store.tickets.save({ ...current, assignments: current.assignments.map(item => ({ ...item, report: { state: 'ready', summary: 'Ready evidence', at: '2026-11-04T07:00:00Z' } })) })
  gate.resolve(); await work; await h!.runtime.idle()
  expect(h!.runtime.store.tickets.get(s.first.ticket.id)?.assignments.at(-1)?.report?.summary).toBe('Ready evidence')
  expect(h!.agents.get(s.next.sessionId)?.status).toBe('running')
})

it('disposing during background settlement aborts the pending look without a later report or kick', async () => {
  const s = await scenario(), gate = deferred()
  const subagents = h!.ctx.get('subagents') as unknown as { waitForChildren: (...args: unknown[]) => Promise<boolean> }
  vi.spyOn(subagents, 'waitForChildren').mockImplementation(async () => { await gate.promise; return false })
  const report = vi.spyOn(h!.runtime.engine, 'report'), kick = vi.spyOn(h!.runtime.effects, 'kick')
  const work = methods().workerIdle(s.latest, s.assignment, s.agent)
  await sleep(1)
  h!.runtime.executor.dispose()
  await work
  expect(report).not.toHaveBeenCalled(); expect(kick).not.toHaveBeenCalled()
  gate.resolve()
})
