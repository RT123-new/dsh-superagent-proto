import { CliError } from '../infra/commands.ts'
import { TransportFailure } from '../infra/transport-failure.ts'
/** CliError's optional typed metadata is supplied only by the transport adapter; plain thrown objects cannot opt in. */
function transportOf(error: unknown): TransportFailure | undefined {
  if (error instanceof TransportFailure) return error
  const metadata = error instanceof CliError ? (error as CliError & { transportFailure?: TransportFailure }).transportFailure : undefined
  return metadata instanceof TransportFailure ? metadata : undefined
}
/** The trusted not-before (epoch ms) carried by a typed transport failure, if any. */
export const serverNotBeforeOf = (error: unknown): number | undefined => transportOf(error)?.serverNotBeforeMs
export { TransportFailure, serverNotBefore } from '../infra/transport-failure.ts'
/**
 * Classified retry decisions for durable effect retries (Issue 15).
 * For retry index n starting at zero, retryable failures use bounded-jitter exponential backoff:
 *   a_n = min(d_max, d_base * 2^n);  j_n ~ Uniform(0.5 * a_n, a_n);  delay_n = max(j_n, server_not_before - now, 0)
 * `server_not_before` comes only from structured transport-supplied fields (the typed TransportFailure boundary error); arbitrary
 * exception message text is never treated as authority. Classification reads structured fields (`name`, `status`,
 * `statusCode`, `code`) only. Permanent, unauthorised, cancelled and programming failures are not retried: Effects
 * parks them visibly (`blocked:<class>` on the row and an immediate error health entry) instead of silently dropping
 * them, and an explicit re-enqueue of the same key rearms the row (the enqueue upsert resets attempts and due).
 */

/** Error classes for retry decisions, in the order a classifier should consider them. */
export type ErrorClass = 'cancelled' | 'unauthorized' | 'permanent' | 'programming_error' | 'rate_limited' | 'provider_temporary' | 'transient'
/** Retryable classes; everything else parks instead of consuming attempts. */
/** Longest server embargo Effects will schedule; longer ones fail closed (blocked) rather than being truncated. */
export const MAX_SERVER_WAIT_MS = 24 * 3600_000
const RETRYABLE: ReadonlySet<ErrorClass> = new Set(['rate_limited', 'provider_temporary', 'transient'])

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined

/** Classify a failure from structured fields and the existing CLI error type; unknown failures retry like transient ones (durability beats abandonment). */
export function classifyError(error: unknown): ErrorClass {
  if (record(error)?.name === 'AbortError' || record(error)?.code === 'ABORT_ERR' || record(error)?.cancelled === true) return 'cancelled'
  const status = transportOf(error)?.status ?? (error instanceof CliError ? error.code : Number(record(error)?.status ?? record(error)?.statusCode))
  const code = String(record(error)?.code ?? record(error)?.type ?? '')
  // The same request would exceed the output cap again: park visibly instead of re-downloading it forever.
  if (error instanceof CliError && error.oversized) return 'permanent'
  if (error instanceof CliError && error.unreadable) return 'transient'
  // GitHub reports primary and secondary rate limits as HTTP 403 (or 429); only the CLI's own diagnostic distinguishes them from a permission failure.
  // This chooses the class only; no delay is ever read from the text.
  if (status === 403 && error instanceof CliError && /^gh: (API rate limit exceeded|You have exceeded a secondary rate limit)/.test(error.message)) return 'rate_limited'
  if (status === 401 || status === 403 || /AUTH|UNAUTHORIZED|FORBIDDEN|PERMISSION/i.test(code)) return 'unauthorized'
  if (status === 429 || /RATE_LIMIT|THROTTLE|QUOTA/i.test(code)) return 'rate_limited'
  if (status === 400 || status === 404 || status === 410 || status === 422 || /INVALID|NOT_FOUND|BAD_REQUEST/i.test(code)) return 'permanent'
  // TypeError also represents transient fetch failures; only explicit programming classes park automatically.
  if (error instanceof RangeError || error instanceof SyntaxError) return 'programming_error'
  if (status === 408 || status === 425 || (status !== undefined && status >= 500 && status < 600) || /UNAVAILABLE|OVERLOADED|TIMEOUT|SERVER/i.test(code)) return 'provider_temporary'
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|UND_ERR|FETCH_FAILED/i.test(code)) return 'transient'
  return 'transient'
}

/**
 * Operator-facing health detail for a failure (mandate §10): the stable typed class plus a whitelisted numeric status only.
 * Error message text is never included - a length bound is a limit, not redaction, and provider prose is arbitrary remote text.
 */
export function healthErrorDetail(error: unknown): string {
  const kind = classifyError(error)
  const status = transportOf(error)?.status ?? (error instanceof CliError ? error.code : Number(record(error)?.status ?? record(error)?.statusCode))
  return Number.isFinite(status) && status ? `${kind} (HTTP ${status})` : kind
}

/**
 * Operator-facing rendering of a STORED error record (mandate §10): emits only the blocked marker, the typed class and a
 * whitelisted numeric status from our structured record. Stored message text (arbitrary provider prose) is never rendered;
 * an unparseable legacy record degrades to its blocked-class marker or a generic 'failure', never raw text.
 */
export function healthStoredError(stored: unknown): string {
  if (typeof stored !== 'string' || !stored) return 'none recorded'
  const blocked = /^blocked:([a-z_]+): /.exec(stored)
  try {
    const rec = JSON.parse(stored.slice(blocked ? blocked[0].length : 0)) as { class?: unknown, status?: unknown }
    const cls = typeof rec.class === 'string' && /^[a-z_]+$/.test(rec.class) ? rec.class : 'transient'
    const status = typeof rec.status === 'number' && Number.isFinite(rec.status) && rec.status ? ` (HTTP ${rec.status})` : ''
    return blocked ? `blocked:${cls}${status}` : `${cls}${status}`
  } catch {
    return blocked ? `blocked:${blocked[1]}` : 'failure'
  }
}

/** The retry decision for a failure. */
export type RetryDecision = { retry: true; class: ErrorClass; delay: number } | { retry: false; class: ErrorClass }
export function retryDecision(error: unknown, attempt: number, base: number, max: number, rng: () => number, now: number): RetryDecision {
  const kind = classifyError(error)
  if (!RETRYABLE.has(kind)) return { retry: false, class: kind }
  const n = Number.isFinite(attempt) ? Math.min(Math.max(0, attempt), 30) : 0
  const ceiling = Number.isFinite(max) && max > 0 ? max : 0
  const a = Math.min(ceiling, Number.isFinite(base) && base > 0 ? base * 2 ** n : 0)
  const u = rng()
  const jittered = 0.5 * a + (Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 1) * 0.5 * a
  const notBefore = transportOf(error)?.serverNotBeforeMs
  const serverWait = notBefore !== undefined && Number.isFinite(now) ? notBefore - now : 0
  // A trusted not-before beyond the representable horizon must never be shortened (that would dispatch inside the embargo): park visibly instead.
  if (serverWait > MAX_SERVER_WAIT_MS) return { retry: false, class: kind }
  return { retry: true, class: kind, delay: Math.max(jittered, serverWait, 0) }
}

/** Structured error record persisted on the row: keeps class and transport status instead of only String(error). */
export function errorRecord(error: unknown, kind: ErrorClass): string {
  const source = record(error)
  const status = transportOf(error)?.status ?? (error instanceof CliError ? error.code : Number(source?.status ?? source?.statusCode))
  return JSON.stringify({
    class: kind,
    message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    ...(Number.isFinite(status) && status ? { status } : {}),
    ...(transportOf(error)?.serverNotBeforeMs !== undefined ? { serverNotBeforeMs: transportOf(error)!.serverNotBeforeMs } : {}),
  })
}
