/** Typed retry metadata created only at an HTTP transport boundary, never by parsing response body instructions. */
export function serverNotBefore(header: unknown, now: number): number | undefined {
  if (!Number.isFinite(now)) return undefined
  const delta = typeof header === 'number' ? header : typeof header === 'string' && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined
  if (delta !== undefined) {
    const at = now + delta * 1000
    return Number.isSafeInteger(delta) && delta >= 0 && Number.isSafeInteger(at) ? at : undefined
  }
  if (typeof header !== 'string' || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return undefined
  const at = Date.parse(header)
  return Number.isFinite(at) && new Date(at).toUTCString() === header ? at : undefined
}
/** Only this typed boundary error may supply a server scheduling instruction to Effects. */
export class TransportFailure extends Error {
  readonly status?: number
  readonly serverNotBeforeMs?: number
  constructor(message: string, metadata: { status?: number; retryAfter?: string | number }, nowMs = Date.now()) {
    super(message)
    this.name = 'TransportFailure'
    this.status = Number.isInteger(metadata.status) && metadata.status! >= 100 && metadata.status! <= 599 ? metadata.status : undefined
    this.serverNotBeforeMs = serverNotBefore(metadata.retryAfter, nowMs)
  }
}
