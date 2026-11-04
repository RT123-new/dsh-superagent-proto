/**
 * Classified retry decisions for durable effect retries (Issue 15).
 * For retry index n starting at zero, retryable failures use bounded-jitter exponential backoff:
 *   a_n = min(d_max, d_base * 2^n);  j_n ~ Uniform(0.5 * a_n, a_n);  delay_n = max(j_n, server_not_before - now, 0)
 * `server_not_before` comes only from structured transport-supplied fields (`retryAfter` on the thrown error); arbitrary
 * exception message text is never treated as authority. Classification reads structured fields (`name`, `status`,
 * `statusCode`, `code`) only. Permanent, unauthorised, cancelled and programming failures are not retried: Effects
 * parks them visibly (`blocked:<class>` on the row and an immediate error health entry) instead of silently dropping
 * them, and an explicit re-enqueue of the same key rearms the row (the enqueue upsert resets attempts and due).
 */

/** Error classes for retry decisions, in the order a classifier should consider them. */
export type ErrorClass = 'cancelled' | 'unauthorized' | 'permanent' | 'programming_error' | 'rate_limited' | 'provider_temporary' | 'transient'
/** Retryable classes; everything else parks instead of consuming attempts. */
const RETRYABLE: ReadonlySet<ErrorClass> = new Set(['rate_limited', 'provider_temporary', 'transient'])

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined

/** Classify a failure from its structured fields; unknown failures retry like transient ones (durability beats abandonment). */
export function classifyError(error: unknown): ErrorClass {
  if (record(error)?.name === 'AbortError' || record(error)?.code === 'ABORT_ERR' || record(error)?.cancelled === true) return 'cancelled'
  const status = Number(record(error)?.status ?? record(error)?.statusCode)
  const code = String(record(error)?.code ?? record(error)?.type ?? '')
  if (status === 401 || status === 403 || /AUTH|UNAUTHORIZED|FORBIDDEN|PERMISSION/i.test(code)) return 'unauthorized'
  if (status === 429 || /RATE_LIMIT|THROTTLE|QUOTA/i.test(code)) return 'rate_limited'
  if (status === 400 || status === 404 || status === 410 || status === 422 || /INVALID|NOT_FOUND|BAD_REQUEST/i.test(code)) return 'permanent'
  if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) return 'programming_error'
  if (status === 408 || status === 425 || (status >= 500 && status < 600) || /UNAVAILABLE|OVERLOADED|TIMEOUT|SERVER/i.test(code)) return 'provider_temporary'
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|UND_ERR|FETCH_FAILED/i.test(code)) return 'transient'
  return 'transient'
}

/** Parse a transport-supplied Retry-After style instruction into an absolute earliest time, or undefined when absent/invalid. */
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

/** The retry decision for a failure. */
export type RetryDecision = { retry: true; class: ErrorClass; delay: number } | { retry: false; class: ErrorClass }
export function retryDecision(error: unknown, attempt: number, base: number, max: number, rng: () => number, now: number): RetryDecision {
  const kind = classifyError(error)
  if (!RETRYABLE.has(kind)) return { retry: false, class: kind }
  const a = Math.min(max, base * 2 ** attempt)
  const jittered = 0.5 * a + rng() * 0.5 * a
  const notBefore = serverNotBefore(record(error)?.retryAfter, now)
  const serverWait = notBefore !== undefined ? notBefore - now : 0
  return { retry: true, class: kind, delay: Math.max(jittered, serverWait, 0) }
}

/** Structured error record persisted on the row: keeps class and transport status instead of only String(error). */
export function errorRecord(error: unknown, kind: ErrorClass): string {
  const source = record(error)
  const status = Number(source?.status ?? source?.statusCode)
  return JSON.stringify({
    class: kind,
    message: error instanceof Error ? error.message : String(error),
    ...(Number.isFinite(status) && status ? { status } : {}),
    ...(source?.retryAfter !== undefined ? { retryAfter: source.retryAfter } : {}),
  }).slice(0, 1000)
}
