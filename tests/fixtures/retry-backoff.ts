/**
 * Issue 15 fixture helpers: the production classifier/backoff lives in src/app/retry-policy.ts (re-exported here);
 * this adds the seeded PRNG and the options-shaped retryDecision the fault-characterization spec uses.
 */
import { retryDecision as decide, TransportFailure, type RetryDecision } from '../../src/app/retry-policy.ts'
export { classifyError, serverNotBefore, type ErrorClass, type RetryDecision } from '../../src/app/retry-policy.ts'

/** Deterministic seeded PRNG (mulberry32) so tests and benchmarks reproduce exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Compatibility shape: `serverNotBefore` (absolute) becomes a typed TransportFailure carrying the equivalent
 * delta-seconds Retry-After, because the reviewed boundary ignores duck-typed `retryAfter` on plain errors.
 */
export function retryDecision(error: unknown, attempt: number, base: number, max: number, rng: () => number,
  options: { serverNotBefore?: number; now?: number } = {}): RetryDecision {
  const now = options.now ?? 0
  const transport = options.serverNotBefore !== undefined && error instanceof Error
    ? new TransportFailure(error.message, { retryAfter: (options.serverNotBefore - now) / 1000 }, now)
    : error
  return decide(transport, attempt, base, max, rng, now)
}

/**
 * FROZEN BASELINE model of src/app/effects.ts attempt() @ reviewed/correctness-stage-b (base SHA
 * 5752c4c99778ba5a0abe59ace4988270e4612855; integration base e50b32b): delay = min(retry_max,
 * retry_base * 2^min(attempts,16)) after each failure, no jitter, no error classification, no Retry-After channel,
 * error persisted as String(error). Exists only to keep the historical Issue-15 fault characterization executable
 * after the reviewed repair (34f9ad6) changed live behavior; it is NOT current production behavior.
 */
export const BASELINE_BASE_SHA = '5752c4c99778ba5a0abe59ace4988270e4612855'
export function baselineBackoff(attempts: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** Math.min(attempts, 16))
}
export interface FrozenRow { key: string; attempts: number; due: number; error: string }
export class FrozenBaselineQueue {
  private readonly rows: FrozenRow[] = []
  constructor(private readonly base: number, private readonly max: number) {}
  enqueue(key: string): void { this.rows.push({ key, attempts: 0, due: 0, error: '' }) }
  dues(): number[] { return this.rows.map(row => row.due) }
  row(key: string): FrozenRow {
    const row = this.rows.find(r => r.key === key)
    if (!row) throw new Error(`no frozen row ${key}`)
    return row
  }
  /** Dispatch every due row once, in enqueue order; each failure reschedules exactly like baseline attempt(). */
  dispatch(now: number, fail: (key: string) => Error): number {
    let ran = 0
    for (const row of this.rows) {
      if (row.due > now) continue
      ran++
      const error = fail(row.key)
      row.attempts += 1
      row.error = String(error)
      row.due = now + baselineBackoff(row.attempts - 1, this.base, this.max)
    }
    return ran
  }
}
