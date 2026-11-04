/**
 * Issue 15 fixture-only candidate: classified retry decisions with bounded-jitter exponential backoff.
 * NOT wired into production. Implements the mandate's formula for retryable errors, with retry index n starting at zero:
 *   a_n = min(d_max, d_base * 2^n);  j_n ~ Uniform(0.5 * a_n, a_n);  delay_n = max(j_n, server_not_before - now, 0)
 * `server_not_before` comes from valid retry/reset instructions (such as a Retry-After) when supplied.
 * Permanent, unauthorised, cancelled and programming errors are never retried by the candidate.
 */

/** Error classes from the mandate (Issue 15), in the order a classifier should consider them. */
export type ErrorClass = 'cancelled' | 'unauthorized' | 'permanent' | 'programming_error' | 'rate_limited' | 'provider_temporary' | 'transient'
/** Retryable classes; everything else must stop instead of consuming attempts forever. */
const RETRYABLE: ReadonlySet<ErrorClass> = new Set(['rate_limited', 'provider_temporary', 'transient'])

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined

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
 * Classify a failure for retry purposes. Structured fields (`status`, `code`, `name`) win over message text;
 * cancellation is detected by abort names/signals, never by message content alone.
 */
export function classifyError(error: unknown): ErrorClass {
  if (record(error)?.name === 'AbortError' || record(error)?.code === 'ABORT_ERR' || record(error)?.cancelled === true) return 'cancelled'
  const status = Number(record(error)?.status ?? record(error)?.statusCode)
  const code = String(record(error)?.code ?? record(error)?.type ?? '')
  if (status === 401 || status === 403 || /AUTH|UNAUTHORIZED|FORBIDDEN|PERMISSION/i.test(code)) return 'unauthorized'
  if (status === 429 || /RATE_LIMIT|THROTTLE|QUOTA/i.test(code)) return 'rate_limited'
  if (status === 400 || status === 404 || status === 410 || status === 422 || /INVALID|NOT_FOUND|BAD_REQUEST/i.test(code)) return 'permanent'
  if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) return 'programming_error'
  if (status === 408 || status === 425 || (status >= 500 && status < 600) || /UNAVAILABLE|OVERLOADED|TIMEOUT|SERVER/i.test(code)) return 'provider_temporary'
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|UND_ERR|FETCH_FAILED/i.test(code)
    || error instanceof Error && /network|socket|connection|timed out/i.test(error.message)) return 'transient'
  // Unknown failures retry like transient ones: the workload is durable, and abandoning it silently is worse than backoff.
  return 'transient'
}

/** Retry decision for a failure: retryable classes get a bounded-jitter delay; the rest stop. */
export type RetryDecision = { retry: true; class: ErrorClass; delay: number } | { retry: false; class: ErrorClass }
export function retryDecision(error: unknown, attempt: number, base: number, max: number, rng: () => number,
  options: { serverNotBefore?: number; now?: number } = {}): RetryDecision {
  const kind = classifyError(error)
  if (!RETRYABLE.has(kind)) return { retry: false, class: kind }
  const a = Math.min(max, base * 2 ** attempt)
  const jittered = 0.5 * a + rng() * 0.5 * a // Uniform(0.5 * a_n, a_n)
  const serverWait = options.serverNotBefore !== undefined && options.now !== undefined ? options.serverNotBefore - options.now : 0
  return { retry: true, class: kind, delay: Math.max(jittered, serverWait, 0) }
}

/** Parse a Retry-After style instruction into an absolute earliest time, or undefined when absent/invalid. */
export function serverNotBefore(header: unknown, now: number): number | undefined {
  if (typeof header === 'number' && Number.isFinite(header)) return header > 1e12 ? header : now + header * 1000 // epoch ms vs delay seconds
  if (typeof header === 'string') {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return now + seconds * 1000
    const at = Date.parse(header)
    if (Number.isFinite(at)) return at
  }
  return undefined
}
