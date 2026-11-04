import { afterEach, expect, it } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'
import { ticketCard, ticketDetails } from '../src/app/cards.ts'
import { composePrompt, defaultPrompts } from '../src/app/prompts.ts'
import { correction } from '../scripts/context-workload.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('preserves complete older corrections and review evidence behind compact ready-card pointers', async () => {
  host = await startRuntime()
  const { ticket, sessionId } = await host.acceptedTicket(feishu('1', '@bot fix the regression'))
  const stored = host.runtime.store.tickets.get(ticket.id)!
  const summary = `Outcome: fixed regression.\n${'Supporting evidence. '.repeat(40)}\n${correction}\nChecks: pnpm check exit0; head abc123; limitations: no browser verification.`
  const ready = { ...stored, assignments: stored.assignments.map(item => ({ ...item, report: { state: 'ready' as const, summary, at: '2026-11-01T00:00:00Z' } })) }
  host.runtime.store.tickets.save(ready)
  const card = ticketCard(ready)
  expect(card.state).toBe('person/review')
  expect(card.preview.length).toBeLessThanOrEqual(160)
  const detail = ticketDetails(ready, [], [])
  const pointer = detail.assignments.items[0]!.report!.read
  expect(pointer).toBe(`ticket/${ticket.id}/report/${stored.assignments[0]!.id}`)
  const evidence = await host.runTool(sessionId, 'orchestrator_read', { resource: pointer })
  expect(evidence).toMatchObject({ text: summary, next_offset: null })
  expect(await host.runTool(sessionId, 'orchestrator_read', { resource: `ticket/${ticket.id}/result` })).toMatchObject({ text: summary })
  await expect(host.runTool(sessionId, 'orchestrator_read', { resource: 'ticket/unrelated/result' })).rejects.toThrow('does not belong')
})

it('ready remains review, not completed or merged, and questions outrank review', async () => {
  host = await startRuntime()
  const { ticket } = await host.acceptedTicket(feishu('2', '@bot fix the regression'))
  const ready = { ...ticket, assignments: ticket.assignments.map(item => ({ ...item,
    report: { state: 'ready' as const, summary: 'Ready for review, not merged.', at: '' } })) }
  expect(ticketCard(ready)).toMatchObject({ state: 'person/review' })
  expect(ticketCard({ ...ready, attention: { question: 'Approve the visible change?' } })).toMatchObject({ state: 'person/answer' })
  expect(ticketCard({ ...ready, assignments: ready.assignments.map(item => ({ ...item, report: { ...item.report, state: 'blocked' as const } })) })).toMatchObject({ state: 'person/blocked' })
})

it('existing delivery guidance separates author and merger and never treats readiness as approval', () => {
  const prompt = composePrompt(defaultPrompts(), 'worker')
  for (const text of ['Never enable auto-merge as the agent account', 'When this section names no merge CLI, a person merges every PR',
    'Never approve or merge on behalf of a reviewer', 'each approval those instructions require covers that commit',
    'PR description describes the current solution, relevant verification and material limitations']) expect(prompt).toContain(text)
})
