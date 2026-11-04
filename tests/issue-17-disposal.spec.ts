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
