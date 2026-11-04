/**
 * Issue 15 — retry backoff may produce excessive delay.
 *
 * Baseline characterization @ reviewed/correctness-stage-b (src/app/effects.ts attempt()):
 * delay = min(retry_max, retry_base * 2^min(attempts,16)) — pure exponential with no jitter, no error classification,
 * and no server `not-before` (Retry-After) handling. These tests prove the three consequences deterministically:
 *  1. correlated failures retry in lockstep (zero spread of `due`), producing synchronized bursts;
 *  2. permanent/unauthorised failures retry forever at the same cost as transient ones;
 *  3. a server's explicit wait instruction cannot be honored (there is no channel for it at all).
 * They then verify the fixture-only candidate in tests/fixtures/retry-backoff.ts against the mandate's formula.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { classifyError, mulberry32, retryDecision, serverNotBefore } from './fixtures/retry-backoff.ts'

let directory: string
let store: Store
let clock: number
let effects: Effects
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const dues = () => (store.db.prepare("SELECT due FROM effect WHERE kind = 'relay' ORDER BY seq").all() as { due: number }[]).map(row => row.due)

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'issue15-'))
  store = new Store(join(directory, 'db.sqlite'))
  clock = Date.parse('2026-09-09T00:00:00Z')
  effects = new Effects(store, new HealthBoard(), () => clock)
  effects.start()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

it('BASELINE: backoff doubles deterministically to the configured cap (no jitter, no classification)', async () => {
  effects.handle('relay', async () => { throw new Error('boom') }, { ordered: true })
  effects.enqueue('relay', 'x', { text: 'x' })
  await flush()
  const schedule: number[] = []
  for (let i = 0; i < 8; i++) {
    schedule.push(dues()[0]! - clock)
    clock = dues()[0]!
    effects.kick(); await flush()
  }
  expect(schedule).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  // Same for the launch/reply configuration [5000, 300000].
  const launchDelay = (attempts: number) => Math.min(300_000, 5000 * 2 ** Math.min(attempts, 16))
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(launchDelay)).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000])
})

it('BASELINE FAULT: 50 relays failing at the same instant retry in lockstep — zero spread, one synchronized burst', async () => {
  let wave = 0
  const concurrence: number[] = []
  effects.handle('relay', async () => { concurrence.push(wave); throw new Error('main session down') })
  for (let i = 0; i < 50; i++) effects.enqueue('relay', `r${i}`, { text: `report ${i}` })
  await flush()
  const firstDues = new Set(dues())
  expect(firstDues.size).toBe(1) // every row is due at exactly the same millisecond
  wave = 1
  clock = dues()[0]!
  effects.kick(); await flush()
  await effects.idle()
  // All 50 retries ran in the same dispatch wave: a 50x burst against the (already struggling) downstream.
  expect(concurrence.filter(w => w === 1)).toHaveLength(50)
  expect(new Set(dues()).size).toBe(1)
})

it('BASELINE FAULT: a permanent (401) failure is retried forever, indistinguishable from a transient one', async () => {
  let calls = 0
  effects.handle('relay', async () => { calls++; throw Object.assign(new Error('unauthorized'), { status: 401 }) }, { ordered: true })
  effects.enqueue('relay', 'x', { text: 'x' })
  await flush()
  for (let i = 0; i < 10; i++) {
    clock = dues()[0]!
    effects.kick(); await flush()
  }
  expect(calls).toBe(11) // eleven paid attempts against a failure that can never succeed
  const row = store.db.prepare("SELECT attempts, error FROM effect WHERE kind = 'relay'").get() as { attempts: number; error: string }
  expect(row.attempts).toBe(11)
  // The recorded error drops the structured status entirely, so the queue could not classify it even if it tried.
  expect(row.error).toBe('Error: unauthorized')
})

it('CANDIDATE: classification retires permanent, unauthorised, cancelled and programming failures', () => {
  expect(retryDecision(Object.assign(new Error('no'), { status: 401 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(Object.assign(new Error('no'), { status: 403 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(Object.assign(new Error('bad'), { status: 400 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(Object.assign(new Error('gone'), { status: 410 }), 0, 2000, 60000, mulberry32(1)).retry).toBe(false)
  expect(retryDecision(Object.assign(new Error('aborted'), { name: 'AbortError' }), 0, 2000, 60000, mulberry32(1)).class).toBe('cancelled')
  expect(retryDecision(new TypeError('undefined is not a function'), 0, 2000, 60000, mulberry32(1)).class).toBe('programming_error')
  expect(retryDecision(Object.assign(new Error('slow down'), { status: 429 }), 0, 2000, 60000, mulberry32(1)).class).toBe('rate_limited')
  expect(retryDecision(Object.assign(new Error('oops'), { status: 503 }), 0, 2000, 60000, mulberry32(1)).class).toBe('provider_temporary')
  expect(retryDecision(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 0, 2000, 60000, mulberry32(1)).class).toBe('transient')
})

it('CANDIDATE: delay follows a_n = min(d_max, d_base*2^n), j_n ~ Uniform(0.5 a_n, a_n), clamped by server_not_before', () => {
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
  // Retry-After parsing: delay-seconds, HTTP-date, and garbage.
  expect(serverNotBefore('30', now)).toBe(now + 30_000)
  expect(serverNotBefore(new Date(now + 45_000).toUTCString(), now)).toBe(now + 45_000)
  expect(serverNotBefore('not-a-date', now)).toBeUndefined()
  expect(serverNotBefore(undefined, now)).toBeUndefined()
})

it('CANDIDATE: jitter desynchronizes a correlated 50-failure burst (paired with the lockstep fault above)', () => {
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
