/**
 * Final review phase 2.2: tools must not stay registered on a worker Session whose assignment was stopped during decoration.
 * Real Sessions.decorate on the host fixture's agent (fake controller); the skills scope is held open by the same hook as tests/issue-5-decoration-races.spec.ts.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, expect, it, vi } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
const privates = () => h!.runtime.sessions as unknown as { decorate(agent: Agent, authorize?: () => void): Promise<void>; release(agent: Agent): void }
const names = (sessionId: string) => [...h!.tools.get(sessionId)?.keys() ?? []]

async function setup() {
  h = await startRuntime()
  const { sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const agent = h.agents.get(sessionId)! as unknown as Agent
  expect(names(sessionId).length, 'the worker has its tools while its assignment is live').toBeGreaterThan(0)
  privates().release(agent)
  return { agent, sessionId }
}
function holdScope(agent: Agent) {
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  vi.spyOn(agent.ctx, 'inject').mockImplementationOnce(((_deps: unknown, callback: (scope: unknown) => void) => {
    entered.resolve()
    const pending = wait.promise.then(() => callback({ skills: { register: () => () => {} } }))
    return Object.assign(pending, { dispose: async () => {} })
  }) as never)
  return { entered, wait }
}

it('after release the worker has no tools (baseline for the proofs below)', async () => {
  const { sessionId } = await setup()
  expect(names(sessionId)).toEqual([])
})
it('stopped while the skills scope is unavailable: no tool is registered when the scope arrives late', async () => {
  const { agent, sessionId } = await setup(); const scope = holdScope(agent)
  let revoked = false
  const pending = privates().decorate(agent, () => { if (revoked) throw new Error('Assignment cancelled') })
  await scope.entered.promise
  revoked = true; scope.wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(names(sessionId)).toEqual([])
})
it('characterization: ensure stopped after the tools registered leaves them registered on the stopped worker (the preset is dropped, the binding is not released)', async () => {
  const { sessionId } = await setup()
  const sessions = h!.runtime.sessions as unknown as { ensure(id: string, cwd: string, title: string, role: 'worker', authorize: () => void): Promise<Agent> }
  const ticket = h!.runtime.store.tickets.list()[0]!
  let seen = 0
  const pending = sessions.ensure(sessionId, ticket.execution?.directory ?? '', ticket.title, 'worker', () => { const n = names(sessionId).length; seen = Math.max(seen, n); if (n > 0) throw new Error('Assignment cancelled') })
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(seen).toBeGreaterThan(0)
  expect(names(sessionId)).toContain('orchestrator_report')
})
it('what a leftover tool does once its ticket ended: orchestrator_report refuses and records nothing', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  h.runtime.engine.stopTicket(ticket.id)
  await vi.waitFor(() => expect(h!.runtime.store.tickets.get(ticket.id)!.ended).toBeDefined())
  const before = JSON.stringify(h.runtime.store.tickets.get(ticket.id))
  await expect(h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: 'late report' })).rejects.toThrow('Ticket ended')
  expect(JSON.stringify(h.runtime.store.tickets.get(ticket.id))).toBe(before)
})
it('control: an unrevoked decoration registers the worker tools', async () => {
  const { agent, sessionId } = await setup()
  await privates().decorate(agent, () => {})
  expect(names(sessionId).length).toBeGreaterThan(0)
})
const handbackState = (triggerId: string) => JSON.stringify(h!.runtime.store.triggers.disposition(triggerId) ?? null)
/** A follow-up on the ticket's Thread reaches the live ticket's worker, which may hand it back. */
async function withFollowUp() {
  h = await startRuntime()
  const first = await h.acceptedTicket(feishu('1', '@bot fix'))
  const more = feishu('2', '@bot another change', { root_id: 'om_1' })
  h.runtime.receive(more); await h.runtime.idle()
  return { ...first, triggerId: more.id }
}
it('control: on a live ticket orchestrator_trigger_handback records the hand-back for a trigger that reached the ticket', async () => {
  const { sessionId, triggerId } = await withFollowUp()
  await h!.runTool(sessionId, 'orchestrator_trigger_handback', { trigger_id: triggerId, reason: 'beyond this ticket' })
  expect(handbackState(triggerId)).toContain('beyond this ticket')
})
it('after the ticket ended, orchestrator_trigger_handback on a trigger that reached it changes no state', async () => {
  const { ticket, sessionId, triggerId } = await withFollowUp()
  h!.runtime.engine.stopTicket(ticket.id)
  await vi.waitFor(() => expect(h!.runtime.store.tickets.get(ticket.id)!.ended).toBeDefined())
  const before = handbackState(triggerId)
  await h!.runTool(sessionId, 'orchestrator_trigger_handback', { trigger_id: triggerId, reason: 'late hand-back' }).catch(() => {})
  expect(handbackState(triggerId)).toBe(before)
})
