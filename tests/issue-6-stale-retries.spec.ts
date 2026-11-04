/**
 * Issue 6 (mandate Part 2): a delayed transient-failure retry must not outlive its authorization.
 * The retry must revalidate - ticket exists and is live, its Assignment is still the running one, processing is not
 * paused - immediately before the retried message commits to the worker Session, not only before the backoff wait.
 * A stale retry is discarded silently (no failure report); a pause engaging mid-delivery reschedules the retry.
 *
 * The Sessions.prompt double below honours the AgentDelivery contract: `authorize` runs immediately before the
 * message commits, after the asynchronous waits inside delivery.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { DshExecutor } from '../src/executor/dsh.ts'

/** DshExecutor's private timing: TRANSIENT_BACKOFF_MS for the first retry, SLOT_WAIT_MS for pause/slot waits. */
const BACKOFF_MS = 15_000, SLOT_WAIT_MS = 5_000

const liveTicket = () => ({
  id: 't1', title: 'Fix regression', ended: undefined as unknown,
  createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z',
  origin: { triggerId: 'tr1' }, mandate: { strength: 'explicit', basis: {} },
  assignments: [{ id: 'a1', state: 'running', createdAt: '2026-11-04T00:00:00.000Z' }],
  inputs: [], undelivered: [] as string[], attention: undefined,
})

function setup() {
  const state = { ticket: liveTicket(), paused: false, closing: false }
  const handlers = new Map<string, (payload: never) => void>()
  const delivered: { sessionId: string; requestId: string; text: string }[] = []
  const pending: { commit: () => void }[] = []
  let failure: unknown
  const ctx = {
    on: (event: string, handler: never) => { handlers.set(event, handler); return () => {} },
    agents: { get: () => undefined },
  }
  const sessions = {
    prompt: vi.fn((sessionId: string, requestId: string, text: string, _mode: unknown, authorize?: () => void, accepted?: () => void) =>
      new Promise<void>((resolve, reject) => {
        // Delivery's asynchronous gap, then the commit-time contract AgentDelivery documents.
        pending.push({ commit: () => {
          try { authorize?.() } catch (error) { reject(error); return }
          if (failure) { const error = failure; failure = undefined; reject(error); return }
          delivered.push({ sessionId, requestId, text }); accepted?.(); resolve()
        } })
      })),
    ensure: vi.fn(), promptedId: (id: string) => id, relay: vi.fn(), holds: vi.fn(async () => false),
  }
  const engine = { report: vi.fn(() => state.ticket), assignmentStarted: vi.fn(), inputsDelivered: vi.fn(), inputsRead: vi.fn(),
    turnEnded: vi.fn(), deliveryFailed: vi.fn(), assignmentInterrupted: vi.fn() }
  const host = {
    context: ctx, engine,
    store: { tickets: { get: (id: string) => state.ticket?.id === id ? state.ticket : undefined, open: () => state.ticket ? [state.ticket] : [] },
      settings: () => ({ executor: { maxWorkers: 4 } }), atomic: (run: () => void) => run(), afterCommit: (run: () => void) => run() },
    effects: { enqueue: vi.fn(), handle: vi.fn() },
    health: { set: vi.fn(), get: vi.fn(() => undefined) },
    machine: { stateDir: '/tmp' }, lifetime: new AbortController().signal,
    sessions, closing: () => state.closing, paused: () => state.paused,
    environment: () => [], sourceLink: vi.fn(), repliedTo: vi.fn(),
  }
  const executor = new DshExecutor(host as never)
  executor.install()
  return { state, sessions, engine, delivered, pending,
    failNext: (error: unknown) => { failure = error },
    transientError: () => handlers.get('agent/error')!({ agent: { id: 'worker-t1' }, error: new Error('fetch failed') } as never) }
}

afterEach(() => { vi.useRealTimers() })

it('delivers the retry under its stable idempotency id while the ticket and assignment stay authorized', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  expect(h.sessions.prompt).toHaveBeenCalledTimes(1)
  expect(h.sessions.prompt.mock.calls[0]![1]).toBe('retry:a1:1')
  h.pending.at(-1)!.commit()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.delivered).toHaveLength(1)
  expect(h.engine.report).not.toHaveBeenCalled()
})

it('abandons a retry whose ticket ended during the backoff wait', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  h.state.ticket = { ...h.state.ticket, ended: { at: '2026-11-04T00:01:00.000Z', by: 'human', outcome: 'stopped' } }
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  expect(h.sessions.prompt).not.toHaveBeenCalled()
})

it('discards a retry whose ticket ended while its message awaited delivery, without a failure report', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  expect(h.sessions.prompt).toHaveBeenCalledTimes(1)
  // The ticket ends during the asynchronous gap inside delivery.
  h.state.ticket = { ...h.state.ticket, ended: { at: '2026-11-04T00:01:00.000Z', by: 'human', outcome: 'stopped' } }
  h.pending.at(-1)!.commit()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.delivered).toHaveLength(0)
  expect(h.engine.report).not.toHaveBeenCalled()
  expect(h.sessions.relay).not.toHaveBeenCalled()
})

it('discards a retry whose assignment was replaced while its message awaited delivery', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  // A replacement Assignment took the ticket over during the delivery gap.
  h.state.ticket = { ...h.state.ticket,
    assignments: [{ id: 'a1', state: 'ended', createdAt: '2026-11-04T00:00:00.000Z' },
      { id: 'a2', state: 'running', createdAt: '2026-11-04T00:01:00.000Z' }] }
  h.pending.at(-1)!.commit()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.delivered).toHaveLength(0)
  expect(h.engine.report).not.toHaveBeenCalled()
})

it('reschedules a retry when processing pauses during delivery, and delivers it once after the pause', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  h.state.paused = true
  h.pending.at(-1)!.commit()
  // Still paused: the retry waits without prompting again.
  await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS)
  expect(h.sessions.prompt).toHaveBeenCalledTimes(1)
  expect(h.delivered).toHaveLength(0)
  h.state.paused = false
  await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS)
  expect(h.sessions.prompt).toHaveBeenCalledTimes(2)
  // The same stable idempotency id, so a partial earlier commit could not duplicate the message.
  expect(h.sessions.prompt.mock.calls[1]![1]).toBe('retry:a1:1')
  h.pending.at(-1)!.commit()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.delivered).toHaveLength(1)
})

it('reports a failed delivery of an authorized retry on the ticket', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.transientError()
  await vi.advanceTimersByTimeAsync(BACKOFF_MS)
  h.failNext(new Error('session gone'))
  h.pending.at(-1)!.commit()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.engine.report).toHaveBeenCalledWith('t1', expect.objectContaining({ state: 'failed' }))
})
