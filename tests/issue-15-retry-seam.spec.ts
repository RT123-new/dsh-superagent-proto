/**
 * Issue 15 production seam: Effects classifies failures, applies bounded-jitter backoff with an injected clock and
 * seeded RNG, honors transport-supplied retryAfter, and parks permanent/unauthorised rows visibly (never dropped;
 * explicit re-enqueue rearms). Fault characterization lives in tests/issue-15-retry-backoff.spec.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { BLOCKED_RECHECK_MS, Effects, Later } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { TransportFailure, classifyError } from '../src/app/retry-policy.ts'
import { mulberry32 } from './fixtures/retry-backoff.ts'

let directory: string
let store: Store
let clock: number
let board: HealthBoard
const t0 = Date.parse('2026-09-09T00:00:00Z')
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const row = (key = 'x') => store.db.prepare("SELECT attempts, due, error FROM effect WHERE kind = 'relay' AND key = ?").get(key) as { attempts: number; due: number; error: string }

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'issue15-seam-'))
  store = new Store(join(directory, 'db.sqlite'))
  clock = t0
  board = new HealthBoard()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

const make = (seed: number) => { const fx = new Effects(store, board, () => clock, undefined as never, mulberry32(seed)); fx.start(); return fx }

it('applies bounded-jitter backoff within [0.5*a_n, a_n] of the configured base/max, deterministically per seed', async () => {
  const fx = make(7)
  fx.handle('relay', async () => { throw new Error('flaky') }, { ordered: true })
  fx.enqueue('relay', 'x', { text: 'x' })
  await flush()
  const delays: number[] = []
  for (let attempt = 0; attempt < 7; attempt++) {
    delays.push(row().due - clock)
    clock = row().due
    fx.kick(); await flush()
  }
  const a = (n: number) => Math.min(60_000, 2000 * 2 ** n)
  delays.forEach((delay, n) => { expect(delay).toBeGreaterThanOrEqual(0.5 * a(n)); expect(delay).toBeLessThanOrEqual(a(n)) })
  await fx.drain()
  // Same seed reproduces the same schedule on a fresh queue over the same store state history.
  const store2path = join(directory, 'db2.sqlite')
  const store2 = new Store(store2path)
  const fx2 = new Effects(store2, new HealthBoard(), () => t0, undefined as never, mulberry32(7))
  fx2.start()
  fx2.handle('relay', async () => { throw new Error('flaky') }, { ordered: true })
  fx2.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect((store2.db.prepare("SELECT due FROM effect WHERE kind = 'relay'").get() as { due: number }).due - t0).toBe(delays[0])
  store2.close()
})

it('keeps Later semantics: reschedule at the base delay without consuming an attempt', async () => {
  const fx = make(3)
  fx.handle('relay', async () => { throw new Later('slots full') }, { ordered: true })
  fx.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect(row().attempts).toBe(0)
  expect(row().due - t0).toBe(2000)
  await fx.drain()
})

it('parks a permanent failure visibly without automatic re-execution, with structured status kept', async () => {
  const fx = make(3)
  fx.handle('relay', async () => { throw Object.assign(new Error('Issue deleted'), { status: 410 }) }, { ordered: true })
  fx.enqueue('relay', 'x', { text: 'x' })
  await flush()
  const parked = row()
  expect(parked.due - t0).toBe(BLOCKED_RECHECK_MS)
  expect(parked.error.startsWith('blocked:permanent:')).toBe(true)
  expect(parked.error).toContain('"status":410')
  expect(board.all['relay']?.state).toBe('error') // visible at once, not after FAILURES_BEFORE_ERROR
  // Passing the legacy timestamp does not dispatch the blocked operation.
  clock = parked.due
  fx.kick(); await flush()
  expect(row().due).toBe(parked.due)
  await fx.drain()
})

it('rearms a parked row only on explicit re-enqueue', async () => {
  const fx = make(3)
  let fail = true
  fx.handle('relay', async () => { if (fail) throw Object.assign(new Error('forbidden'), { status: 403 }) }, { ordered: true })
  fx.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect(row().error.startsWith('blocked:unauthorized:')).toBe(true)
  fail = false
  fx.enqueue('relay', 'x', { text: 'x' }) // explicit rearm: upsert resets attempts and due
  await fx.idle()
  expect(fx.pending('relay')).toBe(false)
  await fx.drain()
})

it('honors a transport-supplied retryAfter beyond the jittered delay', async () => {
  const fx = make(3)
  fx.handle('relay', async () => { throw new TransportFailure('rate limited', { status: 429, retryAfter: 45 }, clock) }, { ordered: true })
  fx.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect(row().due - t0).toBe(45_000)
  expect(row().error).toContain('"serverNotBeforeMs":')
  await fx.drain()
})

it('classifies from structured fields only', () => {
  expect(classifyError(Object.assign(new Error('x'), { status: 401 }))).toBe('unauthorized')
  expect(classifyError(Object.assign(new Error('x'), { status: 404 }))).toBe('permanent')
  expect(classifyError(new SyntaxError('bad code'))).toBe('programming_error')
  expect(classifyError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('cancelled')
  expect(classifyError(Object.assign(new Error('x'), { status: 503 }))).toBe('provider_temporary')
  expect(classifyError(new Error('socket hang up'))).toBe('transient') // unknown failures retry like transient ones
})
