/** Issue 9: `slot_wait` is the time from a launch effect's first enqueue to its worker slot being reserved. It is not model start. */
import { afterEach, expect, it, vi } from 'vitest'
import { DshExecutor } from '../src/executor/dsh.ts'
import { Later } from '../src/app/effects.ts'
import { Metrics } from '../src/infra/metrics.ts'
import { Probe } from '../src/infra/metrics-probe.ts'

afterEach(() => { vi.useRealTimers() })

function setup(maxWorkers = 4) {
  const metrics = new Metrics({ mono: () => performance.now(), wall: () => Date.now() })
  const ticket = { id: 't1', title: 'x', ended: undefined as unknown, createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z',
    origin: { triggerId: 'tr1' }, mandate: { strength: 'explicit', basis: {} },
    assignments: [{ id: 'a1', state: 'pending', createdAt: '2026-11-04T00:00:00.000Z' }], inputs: [], undelivered: [] as string[], attention: undefined }
  const state = { ticket, max: maxWorkers }
  const handlers = new Map<string, (payload: never) => Promise<void>>()
  const host = {
    context: { on: () => () => {}, agents: { get: () => undefined } }, engine: {},
    store: { tickets: { get: (id: string) => state.ticket.id === id ? state.ticket : undefined, open: () => [] },
      settings: () => ({ executor: { maxWorkers: state.max, prepare: '' } }), atomic: (run: () => void) => run(), afterCommit: (run: () => void) => run() },
    effects: { enqueue: vi.fn(), handle: (name: string, run: never) => { handlers.set(name, run) } },
    health: { set: vi.fn(), get: vi.fn(() => undefined) }, machine: { stateDir: '/tmp' }, lifetime: new AbortController().signal,
    sessions: {}, closing: () => false, paused: () => false, authorized: () => true, environment: () => [], sourceLink: vi.fn(), repliedTo: vi.fn(),
    probe: new Probe(metrics),
  }
  const executor = new DshExecutor(host as never)
  const launch = () => handlers.get('launch')!({ ticketId: 't1', assignmentId: 'a1' } as never).catch(() => {})
  const samples = () => metrics.snapshot().durations['slot_wait|internal']
  return { executor, state, launch, samples, metrics, ticket }
}

it('records enqueue-to-reserve once, and a repeat launch attempt does not record again', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.executor.start(h.ticket as never, h.ticket.assignments[0] as never)
  await vi.advanceTimersByTimeAsync(250)
  await h.launch()
  expect(h.samples()).toMatchObject({ count: 1, maxMs: 250 })
  await h.launch()
  expect(h.samples()!.count).toBe(1)
})

it('counts a denied reservation as attempts, keeps the first stamp, and records the whole wait when granted', async () => {
  vi.useFakeTimers()
  const h = setup(0)
  h.executor.start(h.ticket as never, h.ticket.assignments[0] as never)
  await vi.advanceTimersByTimeAsync(100)
  await h.launch()
  expect(h.samples()).toBeUndefined()
  expect(h.metrics.snapshot().counters['launch_slot_denied']).toBe(1)
  h.state.max = 2
  await vi.advanceTimersByTimeAsync(400)
  await h.launch()
  expect(h.samples()).toMatchObject({ count: 1, maxMs: 500 })
})

it('records nothing for an ended ticket, for a launch whose enqueue predates a restart, or after stop', async () => {
  vi.useFakeTimers()
  const ended = setup()
  ended.executor.start(ended.ticket as never, ended.ticket.assignments[0] as never)
  ended.ticket.ended = { at: 'x', by: 'human', outcome: 'stopped' }
  await ended.launch()
  expect(ended.samples()).toBeUndefined()
  const restarted = setup()
  await restarted.launch()
  expect(restarted.samples()).toBeUndefined()
  const stopped = setup()
  stopped.executor.start(stopped.ticket as never, stopped.ticket.assignments[0] as never)
  stopped.executor.stop(stopped.ticket as never, stopped.ticket.assignments[0] as never, 'x')
  await stopped.launch()
  expect(stopped.samples()).toBeUndefined()
})

it('counts a dropped stamp when the bounded map is full', () => {
  const h = setup()
  for (let i = 0; i < 5001; i++) h.executor.start(h.ticket as never, { id: `a${i}` } as never)
  expect(h.metrics.snapshot().counters['launch_stamp_dropped']).toBe(1)
})
void Later

it('uses the injected monotonic clock and clears stamps at disposal', async () => {
  const h = setup()
  let now = 50
  const metrics = new Metrics({ mono: () => now })
  ;(h.executor as unknown as { probe: Probe }).probe = new Probe(metrics)
  h.executor.start(h.ticket as never, h.ticket.assignments[0] as never)
  now = 350
  await h.launch()
  expect(metrics.snapshot().durations['slot_wait|internal']).toMatchObject({ maxMs: 300 })
  const disposed = setup()
  disposed.executor.start(disposed.ticket as never, disposed.ticket.assignments[0] as never)
  disposed.executor.dispose()
  expect((disposed.executor as unknown as { launchStamps: Map<string, number> }).launchStamps.size).toBe(0)
})
