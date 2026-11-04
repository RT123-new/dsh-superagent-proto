/**
 * Bounded, dependency-free metrics collector (Issue 9, Stage C instrumentation).
 *
 * Definitions (see reports/design/issue-9-metrics-definitions.md):
 * - Durations are LOCAL monotonic deltas from the injected `mono()` clock (default performance.now). Monotonic values are
 *   never persisted or compared across process restarts; `snapshot()` carries only durations, counts and wall-clock bounds.
 * - Wall-clock (`wall()`) is used only for snapshot bounds (`since`/`at`), never for durations.
 * - Labels are bounded: `stage` and `source` come from fixed allowlists; anything else maps to 'other'. Ids, text and
 *   ticket numbers are never labels.
 * - Quantiles are nearest-rank over a bounded window of the most recent samples per key (count/sum/max stay exact).
 * - Unknown token usage or billing is reported as null, never as zero.
 */

export const STAGES = [
  'source_to_eval_queue', 'eval_queue_wait', 'eval_run', 'decision_to_assignment', 'slot_wait', 'workspace_prepare',
  'delivery_to_worker', 'worker_turn', 'tool_run', 'report_to_response', 'effect_queue_wait', 'effect_run',
] as const
export type Stage = (typeof STAGES)[number]
export const SOURCES = ['github', 'feishu', 'internal', 'other'] as const
export type Source = (typeof SOURCES)[number]
export type MonoClock = () => number
export type WallClock = () => number

const stageSet: ReadonlySet<string> = new Set(STAGES)
const sourceSet: ReadonlySet<string> = new Set(SOURCES)

/** Nearest-rank quantile (p in (0,100]) of an ascending-sorted array; undefined when empty. */
export function nearestRank(sorted: readonly number[], p: number): number | undefined {
  if (!sorted.length) return undefined
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return sorted[rank - 1]
}

export interface DurationSummary { count: number; sumMs: number; maxMs: number; windowSize: number; p50Ms: number | null; p95Ms: number | null }

/** Bounded ring of recent samples plus exact count, sum and max for one stage and source key. */
class Series {
  private readonly ring: number[] = []
  private next = 0
  count = 0
  sum = 0
  max = 0
  constructor(private readonly window: number) {}
  add(ms: number): void {
    this.count++; this.sum += ms; if (ms > this.max) this.max = ms
    if (this.ring.length < this.window) this.ring.push(ms)
    else { this.ring[this.next] = ms; this.next = (this.next + 1) % this.window }
  }
  summary(): DurationSummary {
    const sorted = [...this.ring].sort((a, b) => a - b)
    return { count: this.count, sumMs: this.sum, maxMs: this.max, windowSize: this.ring.length, p50Ms: nearestRank(sorted, 50) ?? null, p95Ms: nearestRank(sorted, 95) ?? null }
  }
}

/**
 * Exact worker-slot occupancy integrals over the observation interval, which starts when the integrator is created.
 * Slots are counted, not identified (WorkerSlots tracks ticket ids against a configured maximum that can change at runtime).
 * utilization = integral(active slots) / integral(configured capacity); never-used capacity counts as idle from the start.
 * Active reservations above a lowered capacity are NOT hidden: they stay in the numerator (utilization may exceed 1) and
 * the excess is integrated separately as `overLimitSlotMs`.
 */
export class SlotIntegrator {
  private readonly states: string[]
  private readonly counts = new Map<string, number>()
  private readonly activeSlotMs = new Map<string, number>()
  private capacitySlotMs = 0
  private idleSlotMs = 0
  private overLimitSlotMs = 0
  private capacityChanges = 0
  private last: number
  private readonly begin: number
  private cap: number
  constructor(private readonly mono: MonoClock, capacity: number, states: readonly string[] = ['preparing', 'busy']) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError(`capacity ${capacity} must be a non-negative integer`)
    this.states = [...states]; this.cap = capacity
    for (const s of this.states) { this.counts.set(s, 0); this.activeSlotMs.set(s, 0) }
    this.begin = this.last = mono()
  }
  get capacity(): number { return this.cap }
  private active(): number { let n = 0; for (const c of this.counts.values()) n += c; return n }
  private advance(): void {
    const now = this.mono(), dt = Math.max(0, now - this.last); this.last = Math.max(this.last, now)
    if (dt === 0) return
    const active = this.active()
    this.capacitySlotMs += this.cap * dt
    this.idleSlotMs += Math.max(0, this.cap - active) * dt
    this.overLimitSlotMs += Math.max(0, active - this.cap) * dt
    for (const [s, c] of this.counts) this.activeSlotMs.set(s, this.activeSlotMs.get(s)! + c * dt)
  }
  /** Set the configured capacity from now on (the new value applies to time after this call). */
  setCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError(`capacity ${capacity} must be a non-negative integer`)
    this.advance(); if (capacity !== this.cap) this.capacityChanges++; this.cap = capacity
  }
  /** Set how many slots are in a state from now on. */
  setCount(state: string, count: number): void {
    if (!this.counts.has(state)) throw new RangeError(`unknown slot state ${state}`)
    if (!Number.isInteger(count) || count < 0) throw new RangeError(`count ${count} must be a non-negative integer`)
    this.advance(); this.counts.set(state, count)
  }
  /** Per-state and capacity integrals in slot-milliseconds, including the open interval up to now. */
  integrals(): { observedMs: number; capacitySlotMs: number; idleSlotMs: number; overLimitSlotMs: number; activeSlotMs: Record<string, number>; capacityChanges: number } {
    this.advance()
    return { observedMs: this.last - this.begin, capacitySlotMs: this.capacitySlotMs, idleSlotMs: this.idleSlotMs, overLimitSlotMs: this.overLimitSlotMs, activeSlotMs: Object.fromEntries(this.activeSlotMs), capacityChanges: this.capacityChanges }
  }
  /** Active slot-time over configured-capacity slot-time; null when capacity time is zero. May exceed 1 while over the limit. */
  utilization(): number | null {
    this.advance()
    if (this.capacitySlotMs <= 0) return null
    let a = 0; for (const v of this.activeSlotMs.values()) a += v
    return a / this.capacitySlotMs
  }
}

/**
 * Queue gauge keyed by opaque id with bounded memory (at most `cap` tracked ids).
 * Depth is exact only while every enqueued id is tracked. Once an enqueue is dropped for lack of room, ids that are not
 * tracked cannot be deduplicated or dequeued, so the gauge becomes `incomplete`: `trackedDepth` and `oldestAgeMs` (over tracked
 * ids) are lower bounds / partial. A hook can restore exactness by passing the authoritative queue length to
 * `reconcile(n)`: if n equals the tracked count no untracked ids exist and the gauge is complete again; otherwise `depth` reports n
 * and stays incomplete. `dropped` counts dropped enqueue attempts (informational only, never added to depth).
 */
export class QueueGauge {
  private readonly live = new Map<string, number>()
  private dropped_ = 0
  private incomplete_ = false
  private authoritative: number | undefined
  constructor(private readonly mono: MonoClock, private readonly cap = 10_000) {}
  enqueue(id: string): void {
    if (this.live.has(id)) return
    if (this.live.size >= this.cap) { this.dropped_++; this.incomplete_ = true; return }
    this.live.set(id, this.mono())
  }
  /** Returns the wait in ms, or undefined if id is not tracked (never seen, dropped, or already dequeued). */
  dequeue(id: string): number | undefined {
    const at = this.live.get(id)
    if (at === undefined) return undefined
    this.live.delete(id)
    return Math.max(0, this.mono() - at)
  }
  /** Supply the authoritative current queue length from the owning queue (read time). */
  reconcile(authoritativeLength: number): void {
    if (!Number.isInteger(authoritativeLength) || authoritativeLength < 0) throw new RangeError('authoritative length must be a non-negative integer')
    if (authoritativeLength === this.live.size) { this.incomplete_ = false; this.authoritative = undefined } else if (this.incomplete_ || authoritativeLength > this.live.size) { this.incomplete_ = true; this.authoritative = authoritativeLength } else { this.authoritative = authoritativeLength }
  }
  get trackedDepth(): number { return this.live.size }
  /** Exact only when `complete` or after reconcile(n); otherwise a lower bound equal to the tracked count. */
  get depth(): number { return this.authoritative !== undefined ? Math.max(this.authoritative, this.live.size) : this.live.size }
  get complete(): boolean { return !this.incomplete_ && this.authoritative === undefined }
  get dropped(): number { return this.dropped_ }
  /** Oldest tracked age; null when nothing tracked. When not complete this is only the oldest TRACKED item. */
  oldestAgeMs(): number | null {
    for (const at of this.live.values()) return Math.max(0, this.mono() - at)
    return null
  }
}

/** Token usage categories. Any field the provider did not report is null (unknown), not 0. */
/**
 * Maps from DSH TokenUsage: inputTokens -> inputCacheMiss, cacheReadTokens -> inputCacheHit, outputTokens -> output,
 * cacheWriteTokens -> cacheWrite, reasoningTokens -> reasoning. Reasoning is reported separately and is NEVER added to
 * output or cost (whether it is already inside outputTokens is unverified).
 */
export interface TokenUsage { inputCacheHit?: number | null; inputCacheMiss?: number | null; output?: number | null; cacheWrite?: number | null; reasoning?: number | null }
/** Per-million prices. `cacheWritePerM` undefined means the cache-write rate is unresolved. */
export interface Pricing { inputCacheHitPerM: number; inputCacheMissPerM: number; outputPerM: number; cacheWritePerM?: number }
const CATS = ['inputCacheHit', 'inputCacheMiss', 'output'] as const
const EXTRA = ['cacheWrite', 'reasoning'] as const
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export interface MetricsOptions { mono?: MonoClock; wall?: WallClock; window?: number }

/** The collector: bounded stage series, counters, queue gauges, slot pools and token accounting behind one snapshot. */
export class Metrics {
  readonly mono: MonoClock
  readonly wall: WallClock
  private readonly window: number
  private readonly series = new Map<string, Series>()
  private readonly started: number
  private readonly counters = new Map<string, number>()
  private readonly tokens = { sums: { inputCacheHit: 0, inputCacheMiss: 0, output: 0 }, known: { inputCacheHit: 0, inputCacheMiss: 0, output: 0 }, unknown: { inputCacheHit: 0, inputCacheMiss: 0, output: 0 }, reports: 0, costUsd: 0, costKnown: 0, costUnknown: 0, extra: { cacheWrite: 0, reasoning: 0 }, extraKnown: { cacheWrite: 0, reasoning: 0 } }
  readonly queues = new Map<string, QueueGauge>()
  readonly slots = new Map<string, SlotIntegrator>()

  constructor(opts: MetricsOptions = {}) {
    this.mono = opts.mono ?? (() => performance.now())
    this.wall = opts.wall ?? (() => Date.now())
    this.window = Math.max(1, opts.window ?? 1024)
    this.started = this.wall()
  }

  static stage(s: string): Stage | 'other' { return stageSet.has(s) ? (s as Stage) : 'other' }
  static source(s: string | undefined): Source { return s !== undefined && sourceSet.has(s) ? (s as Source) : 'other' }

  /** Record a measured local duration (ms). Negative/NaN values are rejected and counted as `invalid_duration`. */
  observe(stage: string, source: string | undefined, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) { this.count('invalid_duration'); return }
    const key = `${Metrics.stage(stage)}|${Metrics.source(source)}`
    let s = this.series.get(key)
    if (!s) { s = new Series(this.window); this.series.set(key, s) }
    s.add(ms)
  }

  /** Start a timer; the returned function stops it, records, and returns the duration. Idempotent: second call returns the first result. */
  timer(stage: string, source?: string): () => number {
    const t0 = this.mono()
    let done: number | undefined
    return () => { if (done === undefined) { done = Math.max(0, this.mono() - t0); this.observe(stage, source, done) } return done }
  }

  count(name: string, by = 1): void {
    const key = /^[a-z][a-z0-9_]{0,47}$/.test(name) ? name : 'other'
    if (!this.counters.has(key) && this.counters.size >= 64) { this.counters.set('other', (this.counters.get('other') ?? 0) + by); return }
    this.counters.set(key, (this.counters.get(key) ?? 0) + by)
  }

  queue(name: 'eval' | 'assignment' | 'effect' | string, cap?: number): QueueGauge {
    const key = ['eval', 'assignment', 'effect'].includes(name) ? name : 'other'
    let q = this.queues.get(key); if (!q) { q = new QueueGauge(this.mono, cap); this.queues.set(key, q) }
    return q
  }

  slotPool(name: string, capacity: number, states?: readonly string[]): SlotIntegrator {
    let p = this.slots.get(name); if (!p) { if (this.slots.size >= 8) throw new RangeError('too many slot pools'); p = new SlotIntegrator(this.mono, capacity, states); this.slots.set(name, p) }
    return p
  }

  /**
   * Record one model usage report. Cost is computed only when pricing is given, input hit/miss/output are all known, and
   * any cache-write tokens reported (> 0) have a resolved rate; otherwise the report's cost is unknown and the running
   * total excludes it (counted in costUnknownReports) so a partial sum is never presented as complete.
   */
  recordUsage(usage: TokenUsage, pricing?: Pricing): { costUsd: number | null } {
    const t = this.tokens; t.reports++
    let allKnown = true
    for (const c of CATS) {
      const v = usage[c]
      if (valid(v)) { t.sums[c] += v; t.known[c]++ } else { t.unknown[c]++; allKnown = false }
    }
    for (const c of EXTRA) { const v = usage[c]; if (valid(v)) { t.extra[c] += v; t.extraKnown[c]++ } }
    const writes = usage.cacheWrite
    const writeOk = valid(writes) ? (writes === 0 || pricing?.cacheWritePerM !== undefined) : writes === undefined || writes === null ? true : false
    // A report that says nothing about cache writes is treated as billed-unknown only when the caller set cacheWrite to null explicitly.
    const writeUnknown = writes === null
    if (!pricing || !allKnown || !writeOk || writeUnknown) { t.costUnknown++; return { costUsd: null } }
    const cost = (usage.inputCacheHit! * pricing.inputCacheHitPerM + usage.inputCacheMiss! * pricing.inputCacheMissPerM + usage.output! * pricing.outputPerM + (valid(writes) ? writes * (pricing.cacheWritePerM ?? 0) : 0)) / 1e6
    t.costUsd += cost; t.costKnown++
    return { costUsd: cost }
  }

  snapshot(): MetricsSnapshot {
    const durations: Record<string, DurationSummary> = {}
    for (const [k, s] of [...this.series].sort(([a], [b]) => (a < b ? -1 : 1))) durations[k] = s.summary()
    const queues: MetricsSnapshot['queues'] = {}
    for (const [k, q] of this.queues) queues[k] = { depth: q.depth, trackedDepth: q.trackedDepth, depthComplete: q.complete, oldestAgeMs: q.oldestAgeMs(), oldestAgeIsLowerBound: !q.complete, dropped: q.dropped }
    const slots: MetricsSnapshot['slots'] = {}
    for (const [k, p] of this.slots) slots[k] = { capacity: p.capacity, integrals: p.integrals(), utilization: p.utilization() }
    const t = this.tokens, anyKnown = CATS.map((c) => t.known[c])
    return {
      version: 1, sinceWallMs: this.started, atWallMs: this.wall(), window: this.window, durations, queues, slots,
      counters: Object.fromEntries([...this.counters].sort(([a], [b]) => (a < b ? -1 : 1))),
      tokens: {
        reports: t.reports,
        inputCacheHit: anyKnown[0] ? t.sums.inputCacheHit : null, inputCacheMiss: anyKnown[1] ? t.sums.inputCacheMiss : null, output: anyKnown[2] ? t.sums.output : null,
        cacheWrite: t.extraKnown.cacheWrite ? t.extra.cacheWrite : null, reasoning: t.extraKnown.reasoning ? t.extra.reasoning : null, unknownReports: { ...t.unknown }, costUsd: t.costKnown ? t.costUsd : null, costKnownReports: t.costKnown, costUnknownReports: t.costUnknown,
      },
    }
  }

  /** Serialize the snapshot; returns the JSON text and how long serialization took (local monotonic ms). */
  serialize(): { json: string; bytes: number; ms: number } {
    const t0 = this.mono(), json = JSON.stringify(this.snapshot()), ms = Math.max(0, this.mono() - t0)
    return { json, bytes: Buffer.byteLength(json), ms }
  }
}

export interface MetricsSnapshot {
  version: 1; sinceWallMs: number; atWallMs: number; window: number
  durations: Record<string, DurationSummary>
  queues: Record<string, { depth: number; trackedDepth: number; depthComplete: boolean; oldestAgeMs: number | null; oldestAgeIsLowerBound: boolean; dropped: number }>
  slots: Record<string, { capacity: number; integrals: ReturnType<SlotIntegrator['integrals']>; utilization: number | null }>
  counters: Record<string, number>
  tokens: { reports: number; inputCacheHit: number | null; inputCacheMiss: number | null; output: number | null; cacheWrite: number | null; reasoning: number | null; unknownReports: Record<string, number>; costUsd: number | null; costKnownReports: number; costUnknownReports: number }
}
