/** Review phase 3 (mandate §10): the remaining operator-visible error fields - overview outgoing.error and ticket delivery
 *  note/deliveryError - render the typed class and whitelisted status only; arbitrary provider prose never renders.
 *  Private stored history (effect.error, ticket.delivery.error) intentionally keeps its bounded record. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Store } from '../src/app/store.ts'
import { Effects } from '../src/app/effects.ts'
import { Outbox } from '../src/app/outbox.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { CliError } from '../src/infra/commands.ts'
import { Engine, MemoryRepositories, runningAssignment, type Assessor, type Candidate, type Executor, type Outcome, type Policy, type Trigger } from '../src/core/index.ts'
import { overview } from '../src/app/views/overview.ts'
import { ticketSummary } from '../src/app/views/records.ts'
import { executorLoad } from '../src/app/views/tickets.ts'
import { healthErrorDetail } from '../src/app/retry-policy.ts'

const MARKER = 'SECRET-MARKER-7f3a9c2e'

it('overview outgoing.error renders the typed class and whitelisted status, never the stored provider prose', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'overview-redact-'))
  const store = new Store(join(dir, 'db.sqlite'))
  let clock = 1_000_000
  const board = new HealthBoard()
  const effects = new Effects(store, board, () => clock)
  const sources = {
    instance: () => ({ enabled: true }), instances: () => [], channelAllowed: () => true,
    channelIdempotency: () => 'idem-key', channelIdempotencyWindow: () => undefined,
    send: async () => { throw new CliError(`provider exploded: token=${MARKER}`, 503) },
  }
  const outbox = new Outbox({ store, effects, sources: sources as never, commands: {} as never, paused: () => false })
  outbox.send({ id: 'r1', channel: { source: 'github', thread: 'github:1', address: { number: '1' } }, text: 'hello', kind: 'reply' })
  effects.start()
  for (let attempt = 0; attempt < 3; attempt++) {
    await effects.idle()
    clock = (store.db.prepare("SELECT due FROM effect WHERE kind = 'reply'").get() as { due: number }).due + 1
  }
  await effects.idle()
  const view = overview({ store, sources: sources as never, links: vi.fn() as never }, board.all as never, 'v1', executorLoad(store, 0))
  const problem = view.problems.find(item => item.kind === 'outgoing')
  expect(problem && problem.kind === 'outgoing' ? problem.outgoing.attempts : 0).toBeGreaterThanOrEqual(3)
  const rendered = problem && problem.kind === 'outgoing' ? problem.outgoing.error : ''
  expect(rendered).not.toContain(MARKER)
  expect(rendered).toContain('provider_temporary')
  expect(rendered).toContain('503')
  // Private stored history is unchanged on purpose: the bounded record keeps its prose for debugging.
  expect(String(store.db.prepare("SELECT error FROM effect WHERE kind = 'reply'").get()?.error ?? '')).toContain(MARKER)
  await effects.drain()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function engineHarness() {
  const repo = new MemoryRepositories()
  const requests: Candidate[] = []
  const assessor: Assessor = { request: vi.fn((candidate: Candidate) => { requests.push(candidate) }), release: vi.fn() }
  const launches: [string, string][] = []
  const executor: Executor = { start: vi.fn((ticket, assignment) => { launches.push([ticket.id, assignment.id]) }), deliver: vi.fn(), stop: vi.fn() }
  const policy: Policy = {
    version: 'v1', paused: false, evalTimeoutMs: 60_000,
    gate: trigger => trigger.human ? { admissible: true, strength: 'explicit', basis: { via: 'listed' } } : { admissible: false, reason: 'not human' },
    revalidate: () => true, admitsInferred: () => false,
  } as Policy
  const engine = new Engine({ repo, scope: { scope: () => ({ listened: true, observed: false }) }, policy: () => policy, assessor, executor,
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} }, now: () => '2026-09-23T00:00:00.000Z' })
  const trigger: Trigger = { id: '1', source: 'chat', threads: [{ source: 'chat', id: 't1' }], actor: { source: 'chat', id: 'alice' }, human: true,
    at: '2026-09-23T00:00:00.000Z', text: 'hi', channel: { source: 'chat', thread: 't1', address: { message: '1' } }, meta: {} }
  engine.receive(trigger)
  engine.evaluateDue()
  const decision = engine.decide('1', { kind: 'accept', title: 'Fix', scope: 'small', reason: 'requested', acknowledgement: 'ok', evalId: requests.at(-1)!.evalId } as unknown as Outcome)
  for (const [ticket, assignment] of launches) engine.assignmentStarted(ticket, assignment)
  return { repo, engine, ticketId: decision.ticketId! }
}

it('ticket delivery note and deliveryError render the typed detail, never the stored prose; the private record is preserved', () => {
  const { repo, engine, ticketId } = engineHarness()
  const ticket = repo.tickets.get(ticketId)!
  const assignment = runningAssignment(ticket)!.id
  const failure = new CliError(`feishu: send failed token=${MARKER}`, 503)
  engine.deliveryFailed(ticketId, assignment, String(failure), healthErrorDetail(failure))
  const summary = ticketSummary(repo.tickets.get(ticketId)!)
  expect(summary).toMatchObject({ stage: 'person', action: 'delivery' })
  expect(summary.note).toMatchObject({ error: true })
  expect(summary.note!.text).not.toContain(MARKER)
  expect(summary.note!.text).toContain('provider_temporary')
  expect(summary.deliveryError ?? '').not.toContain(MARKER)
  expect(summary.deliveryError ?? '').toContain('503')
  // Private stored history is unchanged on purpose (bounded 300-char record, not rendered).
  expect(repo.tickets.get(ticketId)!.delivery!.error).toContain(MARKER)
})

it('a legacy delivery record without a typed detail degrades to a generic class, never prose', () => {
  const { repo, engine, ticketId } = engineHarness()
  const ticket = repo.tickets.get(ticketId)!
  engine.deliveryFailed(ticketId, runningAssignment(ticket)!.id, `feishu: message recalled ${MARKER}`)
  const summary = ticketSummary(repo.tickets.get(ticketId)!)
  expect(summary.note!.text).not.toContain(MARKER)
  expect(summary.note!.text.length).toBeGreaterThan(0)
  expect(summary.deliveryError ?? '').not.toContain(MARKER)
})
