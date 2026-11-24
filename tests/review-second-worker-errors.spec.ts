/** Deferred worker failures must retain the assignment that owned them when observed. */
import { afterEach, expect, it, vi } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

it('does not attach an error queued by the replaced assignment to its successor', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const first = h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!
  h.ctx.emit('agent/error', { agent: h.agents.get(sessionId), error: new Error('First assignment failed') } as never)
  h.runtime.engine.assignmentInterrupted(ticket.id, first.id)
  await h.runtime.idle()
  const assignments = h.runtime.store.tickets.get(ticket.id)!.assignments
  expect(assignments).toHaveLength(2)
  expect(assignments[0]!.state).toBe('ended')
  expect(assignments[1]!.report).toBeUndefined()
})

it('still records an error for the assignment that remains current', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  h.ctx.emit('agent/error', { agent: h.agents.get(sessionId), error: new Error('Current assignment failed') } as never)
  await vi.waitFor(() => expect(h!.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!.report).toMatchObject({
    state: 'failed', summary: 'Error: Current assignment failed',
  }))
})

it('does not attach a retry-delivery failure to the replacement assignment', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const first = h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!
  const executor = (h.runtime as unknown as { executor: { after(ms: number, callback: () => void): void } }).executor
  let retry!: () => void
  vi.spyOn(executor, 'after').mockImplementationOnce((_ms, callback) => { retry = callback })
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<void>()
  const prompt = h.runtime.sessions.prompt.bind(h.runtime.sessions)
  vi.spyOn(h.runtime.sessions, 'prompt').mockImplementation(async (...args) => {
    if (args[1].startsWith('retry:')) { entered.resolve(); await response.promise; return }
    await prompt(...args)
  })
  h.ctx.emit('agent/error', { agent: h.agents.get(sessionId), error: Object.assign(new Error('Unavailable'), { status: 503 }) } as never)
  retry(); await entered.promise
  h.runtime.engine.assignmentInterrupted(ticket.id, first.id)
  response.reject(new Error('Old retry delivery failed'))
  await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!.report).toBeUndefined()
})
