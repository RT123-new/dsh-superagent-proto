/**
 * Failure-isolated, optional access to the metrics collector for production hooks (Issue 9).
 * Every call is a no-op without a collector and swallows any collector error (counted once as `metrics_error` when possible),
 * so instrumentation can never change effect control flow, retries, or results. Timers are local monotonic only.
 */
import type { MetricsSnapshot, Pricing, TokenUsage } from './metrics.ts'

/** The slice of `Metrics` the hooks use; the recording fake in tests implements the same shape. */
export interface MetricsLike {
  observe(stage: string, source: string | undefined, ms: number, outcome?: 'success' | 'failure'): void
  count(name: string, by?: number): void
  queue(name: string): { reconcile(n: number): void }
  slotPool(name: string, capacity: number): { setCapacity(n: number): void; setCount(state: string, n: number): void }
  recordUsage(usage: TokenUsage, pricing?: Pricing, component?: string): unknown
  snapshot(): MetricsSnapshot
  readonly mono: () => number
}

/** Optional, failure-isolated handle that production code uses to record metrics; every method is a no-op without a collector and never throws. */
export class Probe {
  constructor(private readonly metrics: MetricsLike | undefined) {}
  now(): number | undefined { try { return this.metrics?.mono() } catch { this.count('metrics_error'); return undefined } }
  get enabled(): boolean { return this.metrics !== undefined }
  /** Run a collector call; never throws. */
  private safe(run: (metrics: MetricsLike) => void): void {
    const metrics = this.metrics
    if (!metrics) return
    try { run(metrics) } catch { try { metrics.count('metrics_error') } catch { /* nothing more can be done */ } }
  }
  /** Local monotonic start; the returned function records `stage` once, as a failure-outcome sample when called with 'failed' (never in the success quantiles). */
  timer(stage: string, source?: string): (outcome?: 'ok' | 'failed') => void {
    const metrics = this.metrics
    if (!metrics) return () => {}
    let t0: number | undefined, done = false
    try { t0 = metrics.mono() } catch { /* leave unset */ }
    return outcome => {
      if (done || t0 === undefined) return
      done = true
      this.safe(m => m.observe(stage, source, m.mono() - t0!, outcome === 'failed' ? 'failure' : undefined))
    }
  }
  observe(stage: string, source: string | undefined, ms: number, outcome?: 'success' | 'failure'): void { this.safe(m => m.observe(stage, source, ms, outcome)) }
  count(name: string, by = 1): void { this.safe(m => m.count(name, by)) }
  /** Authoritative length of a durable queue, read at hook time from its owning query. */
  queueLength(name: string, length: number): void { this.safe(m => m.queue(name).reconcile(length)) }
  slots(pool: string, capacity: number, counts: Readonly<Record<string, number>>): void {
    this.safe(m => { const p = m.slotPool(pool, capacity); p.setCapacity(capacity); for (const [state, n] of Object.entries(counts)) p.setCount(state, n) })
  }
  usage(component: string, usage: TokenUsage | undefined): void { this.safe(m => m.recordUsage(usage ?? {}, undefined, component)) }
}
