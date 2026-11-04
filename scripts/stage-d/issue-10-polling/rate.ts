/** Pure offline scheduling proposal, not wired into Commands. Seconds consistently. */
export function rate(remaining: number, allowance: number, resetSeconds: number, nowSeconds: number): number {
  if (![remaining, allowance, resetSeconds, nowSeconds].every(Number.isFinite) || remaining < 0 || allowance < 0) return 0
  return Math.max(0, (remaining - Math.max(10, Math.ceil(0.1 * allowance))) / Math.max(1, resetSeconds - nowSeconds))
}
export function deferUntil(headers: Record<string, string>, nowSeconds: number): number {
  const retry = headers['retry-after']
  const retryAt = retry === undefined ? nowSeconds : /^\d+$/.test(retry) ? nowSeconds + Number(retry) : Date.parse(retry) / 1000
  const reset = headers['x-ratelimit-remaining'] === '0' ? Number(headers['x-ratelimit-reset']) : nowSeconds
  return Math.max(nowSeconds, Number.isFinite(retryAt) ? retryAt : nowSeconds,
    Number.isFinite(reset) ? reset : nowSeconds)
}
