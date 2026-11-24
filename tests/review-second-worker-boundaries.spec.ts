/** Second pass: cancellation and assignment ownership are rechecked before worker reports mutate durable ticket state. */
import { afterEach, expect, it, vi } from 'vitest'
import { Commands } from '../src/infra/commands.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

it('rejects an already cancelled ready report without ending its still-running ticket', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const before = h.runtime.store.tickets.get(ticket.id)
  const report = h.tools.get(sessionId)!.get('orchestrator_report')!
  await expect(report.execute({ state: 'ready', summary: 'Cancelled result' }, { signal: AbortSignal.abort() })).rejects.toThrow()
  expect(h.runtime.store.tickets.get(ticket.id)).toEqual(before)
})

it('rejects cancellation during PR lookup before claiming the PR or committing a report', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const before = h.runtime.store.tickets.get(ticket.id)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  vi.mocked(Commands.prototype.gh).mockImplementation((async (args: string[]) => {
    if (args[1]?.includes('/pulls/')) {
      entered.resolve(); await release.promise
      return { state: 'open', user: { login: 'agent-bot' }, html_url: 'https://github.com/acme/widgets/pull/42',
        head: { ref: `agent/${ticket.execution?.name}`, sha: 'h1', repo: { full_name: 'acme/widgets' } } }
    }
    return { default_branch: 'master', permissions: { push: true } }
  }) as never)
  const abort = new AbortController()
  const report = h.tools.get(sessionId)!.get('orchestrator_report')!
  const outcome = report.execute({ state: 'progress', summary: 'Cancelled result', pr_number: 42 }, { signal: abort.signal })
    .then(() => 'recorded', () => 'refused')
  await entered.promise
  abort.abort(); release.resolve()
  expect(await outcome).toBe('refused')
  expect(h.runtime.store.tickets.get(ticket.id)).toEqual(before)
  expect(h.runtime.store.threads.get('github:42')).toBeUndefined()
})

it('does not attach an error queued by the replaced assignment to its successor', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const first = h.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!
  h.ctx.emit('agent/error', { agent: h.agents.get(sessionId), error: new Error('First assignment failed') } as never)
  // The error handler queued its durable update; replacement happens before that microtask runs.
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
