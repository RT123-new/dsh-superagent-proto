/**
 * Issue 15 — retry backoff may produce excessive delay.
 *
 * FROZEN BASELINE @ reviewed/correctness-stage-b (base SHA 5752c4c99778ba5a0abe59ace4988270e4612855; integration
 * base e50b32b): src/app/effects.ts attempt() was delay = min(retry_max, retry_base * 2^min(attempts,16)) — pure
 * exponential with no jitter, no error classification, no server `not-before` (Retry-After) channel, and the error
 * persisted as String(error). Live production @ 34f9ad6 no longer exhibits those faults, so the three baseline
 * characterizations now run against the frozen model (FrozenBaselineQueue in tests/fixtures/retry-backoff.ts) with
 * the historical numbers preserved verbatim and labeled with the base SHA. The remaining tests assert CURRENT
 * production semantics: classified bounded-jitter backoff, visible blocked parking with explicit-rearm only, and the
 * typed TransportFailure boundary as the sole server-scheduling authority.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { TransportFailure } from '../src/infra/transport-failure.ts'
import { BASELINE_BASE_SHA, FrozenBaselineQueue, baselineBackoff, classifyError, mulberry32, retryDecision, serverNotBefore } from './fixtures/retry-backoff.ts'

let directory: string
let store: Store
let board: HealthBoard
let clock: number
let effects: Effects
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const dues = () => (store.db.prepare("SELECT due FROM effect WHERE kind = 'relay' ORDER BY seq").all() as { due: number }[]).map(row => row.due)

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'issue15-'))
  store = new Store(join(directory, 'db.sqlite'))
  board = new HealthBoard()
  clock = Date.parse('2026-09-09T00:00:00Z')
  effects = new Effects(store, board, () => clock)
  effects.start()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

it('FROZEN BASELINE @ 5752c4c: backoff doubled deterministically to the configured cap (no jitter, no classification)', () => {
  const q = new FrozenBaselineQueue(2000, 60000)
  q.enqueue('x')
  let now = 0
  const schedule: number[] = []
  for (let i = 0; i < 8; i++) {
    q.dispatch(now, () => new Error('boom'))
    schedule.push(q.dues()[0]! - now)
    now = q.dues()[0]!
  }
  expect(schedule).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  expect(BASELINE_BASE_SHA).toBe('5752c4c99778ba5a0abe59ace4988270e4612855')
  // Same for the launch/reply configuration [5000, 300000].
  const launchDelay = (attempts: number) => baselineBackoff(attempts, 5000, 300000)
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(launchDelay)).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000])
})

it('FROZEN BASELINE FAULT @ 5752c4c: 50 relays failing at the same instant retried in lockstep — zero spread, one synchronized burst', () => {
  const q = new FrozenBaselineQueue(2000, 60000)
  for (let i = 0; i < 50; i++) q.enqueue(`r${i}`)
  let wave = 0
  const concurrence: number[] = []
  const fail = () => { concurrence.push(wave); return new Error('main session down') }
  q.dispatch(0, fail)
  const firstDues = new Set(q.dues())
  expect(firstDues.size).toBe(1) // every row was due at exactly the same millisecond
  wave = 1
  const ran = q.dispatch(q.dues()[0]!, fail)
  // All 50 retries ran in the same dispatch wave: a 50x burst against the (already struggling) downstream.
  expect(ran).toBe(50)
  expect(concurrence.filter(w => w === 1)).toHaveLength(50)
  expect(new Set(q.dues()).size).toBe(1)
})

it('FROZEN BASELINE FAULT @ 5752c4c: a permanent (401) failure was retried forever, indistinguishable from a transient one', () => {
  const q = new FrozenBaselineQueue(2000, 60000)
  q.enqueue('x')
  let calls = 0
  let now = 0
  for (let i = 0; i < 11; i++) {
    calls += q.dispatch(now, () => Object.assign(new Error('unauthorized'), { status: 401 }))
    now = q.dues()[0]!
  }
  expect(calls).toBe(11) // eleven paid attempts against a failure that can never succeed
  const row = q.row('x')
  expect(row.attempts).toBe(11)
  // The recorded error dropped the structured status entirely, so the queue could not classify it even post-hoc.
  expect(row.error).toBe('Error: unauthorized')
})

it('CURRENT PRODUCTION @ 34f9ad6: classification retires permanent, unauthorised, cancelled and programming failures', () => {
  expect(retryDecision(new TransportFailure('no', { status: 401 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(new TransportFailure('no', { status: 403 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(new TransportFailure('bad', { status: 400 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(new TransportFailure('gone', { status: 410 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(Object.assign(new Error('aborted'), { name: 'AbortError' }), 0, 2000, 60000, mulberry32(1)).class).toBe('cancelled')
  // Reviewed semantics: a bare TypeError is also how transient fetch failures surface, so it no longer parks;
  // only explicit programming classes (RangeError, SyntaxError) do.
  expect(retryDecision(new TypeError('fetch failed'), 0, 2000, 60000, mulberry32(1)).class).toBe('transient')
  expect(retryDecision(new RangeError('out of range'), 0, 2000, 60000, mulberry32(1)).class).toBe('programming_error')
  expect(retryDecision(new TransportFailure('slow down', { status: 429 }), 0, 2000, 60000, mulberry32(1)).class).toBe('rate_limited')
  expect(retryDecision(new TransportFailure('oops', { status: 503 }), 0, 2000, 60000, mulberry32(1)).class).toBe('provider_temporary')
  expect(retryDecision(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 0, 2000, 60000, mulberry32(1)).class).toBe('transient')
})

it('CURRENT PRODUCTION @ 34f9ad6: delay follows a_n = min(d_max, d_base*2^n), j_n ~ Uniform(0.5 a_n, a_n), clamped by server_not_before', () => {
  const now = 1_000_000
  // Deterministic per seed.
  const seq = (seed: number, n: number) => {
    const rng = mulberry32(seed)
    return Array.from({ length: n }, (_, attempt) => retryDecision(new Error('x'), attempt, 2000, 60000, rng, { now }))
  }
  expect(seq(42, 10)).toEqual(seq(42, 10))
  expect(seq(42, 10)).not.toEqual(seq(43, 10))
  // Bounds: 0.5 * a_n <= j_n <= a_n with a_n capped at d_max.
  const rng = mulberry32(7)
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = Math.min(60000, 2000 * 2 ** attempt)
    for (let i = 0; i < 100; i++) {
      const decision = retryDecision(new Error('x'), attempt, 2000, 60000, rng, { now })
      if (decision.retry) { expect(decision.delay).toBeGreaterThanOrEqual(0.5 * a); expect(decision.delay).toBeLessThanOrEqual(a) }
    }
  }
  // server_not_before wins when it exceeds the jittered delay; an elapsed one adds nothing.
  const late = retryDecision(new Error('x'), 0, 2000, 60000, () => 0, { serverNotBefore: now + 30_000, now })
  expect(late).toMatchObject({ retry: true, delay: 30_000 })
  const elapsed = retryDecision(new Error('x'), 0, 2000, 60000, () => 0, { serverNotBefore: now - 5_000, now })
  expect(elapsed).toMatchObject({ retry: true, delay: 1000 }) // 0.5 * a_0 with rng() = 0
  // Strict Retry-After parsing: delta-seconds (number or integer string) and exact IMF-fixdate only.
  expect(serverNotBefore('30', now)).toBe(now + 30_000)
  expect(serverNotBefore(30, now)).toBe(now + 30_000)
  expect(serverNotBefore(new Date(now + 45_000).toUTCString(), now)).toBe(now + 45_000)
  expect(serverNotBefore('', now)).toBeUndefined()
  expect(serverNotBefore('-1', now)).toBeUndefined()
  expect(serverNotBefore('1.5', now)).toBeUndefined()
  expect(serverNotBefore('not-a-date', now)).toBeUndefined()
  expect(serverNotBefore(undefined, now)).toBeUndefined()
})

it('CURRENT PRODUCTION @ 34f9ad6: only the typed TransportFailure boundary supplies server scheduling', () => {
  const now = 1_000_000
  // A plain thrown object claiming a server schedule has no authority; its status still classifies.
  const duck = retryDecision({ status: 429, retryAfter: 99999999 }, 0, 2000, 60000, () => 0, { now })
  expect(duck).toMatchObject({ retry: true, class: 'rate_limited', delay: 1000 })
  // A typed TransportFailure's Retry-After is honored above the jittered delay.
  const typed = retryDecision(new TransportFailure('slow', { status: 429, retryAfter: '30' }, now), 0, 2000, 60000, () => 0, { now })
  expect(typed).toMatchObject({ retry: true, class: 'rate_limited', delay: 30_000 })
  expect(classifyError(new TransportFailure('no', { status: 401 }))).toBe('unauthorized')
})

it('CURRENT PRODUCTION @ 34f9ad6: jitter desynchronizes a correlated 50-failure burst (paired with the frozen lockstep fault above)', () => {
  const now = 1_000_000
  const rng = mulberry32(11)
  const firstRetry = Array.from({ length: 50 }, () =>
    (retryDecision(new Error('x'), 0, 2000, 60000, rng, { now }) as { delay: number }).delay)
  // Same failure instant, but retries spread across [1000, 2000] ms instead of one millisecond.
  expect(new Set(firstRetry).size).toBeGreaterThan(40)
  // Worst 100 ms bucket holds a fraction of the burst, not all 50.
  const buckets = new Map<number, number>()
  for (const delay of firstRetry) buckets.set(Math.floor(delay / 100), (buckets.get(Math.floor(delay / 100)) ?? 0) + 1)
  expect(Math.max(...buckets.values())).toBeLessThanOrEqual(15)
  // Median delay stays near 0.75 * a_0 = 1500 ms: jitter spreads the burst without adding systematic delay.
  const sorted = [...firstRetry].sort((a, b) => a - b)
  expect(sorted[25]!).toBeGreaterThan(1300)
  expect(sorted[25]!).toBeLessThan(1700)
})

it('CURRENT PRODUCTION @ 34f9ad6: an unauthorised transport failure parks visibly after one attempt and never re-dispatches on time alone', async () => {
  let calls = 0
  effects.handle('relay', async () => { calls++; throw new TransportFailure('unauthorized', { status: 401 }, clock) }, { ordered: true })
  effects.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect(calls).toBe(1)
  // No timed re-run without changed authority: not after the legacy parked-row interval, not after several hours.
  clock += 4 * 3600_000
  effects.kick(); await flush(); await effects.idle()
  expect(calls).toBe(1)
  const row = store.db.prepare("SELECT attempts, error FROM effect WHERE kind = 'relay'").get() as { attempts: number; error: string }
  expect(row.attempts).toBe(1)
  expect(row.error).toContain('blocked:unauthorized')
  expect(row.error).toContain('"status":401')
  expect(effects.pending('relay', 'x')).toBe(true) // parked, never silently dropped
  expect(board.all.relay?.state).toBe('error')
  // Explicit rearm: re-enqueueing the key resets attempts/due through the upsert and the operation runs again.
  effects.enqueue('relay', 'x', { text: 'x' })
  await flush()
  expect(calls).toBe(2)
})

it('CURRENT PRODUCTION @ 34f9ad6: live correlated transient failures desynchronize via bounded jitter', async () => {
  effects.handle('relay', async () => { throw new Error('main session down') })
  for (let i = 0; i < 50; i++) effects.enqueue('relay', `r${i}`, { text: `report ${i}` })
  await flush()
  await effects.idle()
  const spread = dues().map(due => due - clock)
  // Same failure instant, but retries spread across [0.5 * a_0, a_0] = [1000, 2000] ms instead of one millisecond.
  expect(new Set(spread).size).toBeGreaterThan(40)
  for (const delay of spread) {
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(2000)
  }
})
