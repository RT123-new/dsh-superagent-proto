/**
 * Issue 15 fixture helpers: the production classifier/backoff lives in src/app/retry-policy.ts (re-exported here);
 * this adds the seeded PRNG and the options-shaped retryDecision the fault-characterization spec uses.
 */
import { retryDecision as decide, type RetryDecision } from '../../src/app/retry-policy.ts'
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

/** Compatibility shape: `serverNotBefore` (absolute) becomes a transport-style `retryAfter` delay on a copy of the error. */
export function retryDecision(error: unknown, attempt: number, base: number, max: number, rng: () => number,
  options: { serverNotBefore?: number; now?: number } = {}): RetryDecision {
  const now = options.now ?? 0
  const transport = options.serverNotBefore !== undefined && error instanceof Error
    ? Object.assign(new Error(error.message), { retryAfter: (options.serverNotBefore - now) / 1000 })
    : error
  return decide(transport, attempt, base, max, rng, now)
}
