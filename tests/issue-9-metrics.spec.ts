import { describe, expect, it } from 'vitest'
import { Metrics, nearestRank, QueueGauge, SlotIntegrator, STAGES } from '../src/infra/metrics.ts'

const clock = () => { let t = 0; return { now: () => t, adv: (n: number) => { t += n } } }

describe('nearest-rank quantiles', () => {
  it('matches the textbook definition', () => {
    const v = [15, 20, 35, 40, 50]
    expect(nearestRank(v, 30)).toBe(20); expect(nearestRank(v, 40)).toBe(20); expect(nearestRank(v, 50)).toBe(35)
    expect(nearestRank(v, 100)).toBe(50); expect(nearestRank([], 50)).toBeUndefined(); expect(nearestRank([7], 95)).toBe(7)
  })
  it('P95 of 1..100 is 95 and P50 is 50 (no interpolation)', () => {
    const m = new Metrics({ window: 1000 })
    for (let i = 1; i <= 100; i++) m.observe('eval_run', 'github', i)
    const s = m.snapshot().durations['eval_run|github']!
    expect([s.p50Ms, s.p95Ms, s.count, s.maxMs, s.sumMs]).toEqual([50, 95, 100, 100, 5050])
  })
  it('window bounds samples but count/sum/max stay exact', () => {
    const m = new Metrics({ window: 4 })
    for (let i = 1; i <= 10; i++) m.observe('eval_run', 'github', i)
    const s = m.snapshot().durations['eval_run|github']!
    expect(s.windowSize).toBe(4); expect(s.count).toBe(10); expect(s.sumMs).toBe(55); expect(s.p50Ms).toBe(8)
  })
})

describe('bounded labels', () => {
  it('maps unknown stage/source to other and never grows past the allowlist', () => {
    const m = new Metrics()
    for (let i = 0; i < 5000; i++) m.observe(`ticket-${i}`, `user${i}@x`, 1)
    expect(Object.keys(m.snapshot().durations)).toEqual(['other|other'])
    for (const s of STAGES) m.observe(s, 'github', 1)
    expect(Object.keys(m.snapshot().durations).length).toBeLessThanOrEqual((STAGES.length + 1) * 4)
    for (let i = 0; i < 500; i++) m.count(`c_${i}`)
    expect(Object.keys(m.snapshot().counters).length).toBeLessThanOrEqual(65)
  })
  it('rejects negative/NaN durations visibly', () => {
    const m = new Metrics(); m.observe('eval_run', 'github', -1); m.observe('eval_run', 'github', NaN)
    const s = m.snapshot(); expect(s.counters.invalid_duration).toBe(2); expect(s.durations).toEqual({})
  })
})

describe('timers use monotonic clock, not wall clock', () => {
  it('survives wall clock jumping backwards', () => {
    const c = clock(); let wall = 1_000_000
    const m = new Metrics({ mono: c.now, wall: () => wall })
    const stop = m.timer('worker_turn', 'github'); c.adv(250); wall -= 3_600_000
    expect(stop()).toBe(250); c.adv(100); expect(stop()).toBe(250)
    const s = m.snapshot(); expect(s.durations['worker_turn|github']?.count).toBe(1); expect(s.sinceWallMs).toBe(1_000_000)
  })
})

describe('slot integrals', () => {
  it('counts never-used capacity as idle from observation start (denominator = capacity x interval)', () => {
    const c = clock(), p = new SlotIntegrator(c.now, 4)
    c.adv(100)
    expect(p.utilization()).toBe(0); expect(p.integrals().idleSlotMs).toBe(400)
    p.setCount('busy', 1); c.adv(100); p.setCount('preparing', 1); c.adv(100)
    // active: 0*100 + 1*100 + 2*100 = 300 ; capacity: 4*300 = 1200
    const i = p.integrals()
    expect(i.observedMs).toBe(300); expect(i.capacitySlotMs).toBe(1200); expect(i.activeSlotMs).toEqual({ preparing: 100, busy: 200 })
    expect(i.idleSlotMs).toBe(900); expect(p.utilization()).toBe(300 / 1200)
  })
  it('integrates configured capacity over time and keeps over-limit reservations visible', () => {
    const c = clock(), p = new SlotIntegrator(c.now, 3)
    p.setCount('busy', 3); c.adv(10)
    p.setCapacity(1); c.adv(10)   // 3 active against capacity 1: over limit by 2
    p.setCount('busy', 1); c.adv(10)
    p.setCapacity(1)               // unchanged: not a change
    const i = p.integrals()
    expect(i.capacitySlotMs).toBe(3 * 10 + 1 * 10 + 1 * 10); expect(i.overLimitSlotMs).toBe(2 * 10)
    expect(i.activeSlotMs.busy).toBe(30 + 30 + 10); expect(i.capacityChanges).toBe(1)
    expect(p.utilization()).toBe(70 / 50)  // >1 is the honest signal of over-limit reservations
  })
  it('zero capacity gives null utilization; rejects bad input; clock going backwards never subtracts', () => {
    let t = 100; const p = new SlotIntegrator(() => t, 0)
    t += 50; expect(p.utilization()).toBeNull()
    expect(() => p.setCount('nope', 1)).toThrow(); expect(() => p.setCount('busy', -1)).toThrow(); expect(() => p.setCapacity(1.5)).toThrow()
    p.setCapacity(2); t -= 30; expect(p.integrals().capacitySlotMs).toBe(0)
  })
})

describe('queue gauge', () => {
  it('reports exact depth and oldest age while every id is tracked; dequeue returns wait', () => {
    const c = clock(), q = new QueueGauge(c.now, 3)
    expect(q.oldestAgeMs()).toBeNull()
    q.enqueue('a'); c.adv(10); q.enqueue('b'); c.adv(5); q.enqueue('b')
    expect([q.depth, q.oldestAgeMs(), q.complete]).toEqual([2, 15, true])
    expect(q.dequeue('a')).toBe(15); expect(q.oldestAgeMs()).toBe(5); expect(q.dequeue('zzz')).toBeUndefined(); expect(q.dequeue('a')).toBeUndefined()
    expect(q.depth).toBe(1)
  })
  it('duplicate untracked ids and unknown dequeues never inflate depth', () => {
    const c = clock(), q = new QueueGauge(c.now, 2)
    q.enqueue('a'); q.enqueue('b')
    for (let i = 0; i < 100; i++) q.enqueue('overflow-same-id')
    expect(q.depth).toBe(2); expect(q.trackedDepth).toBe(2); expect(q.complete).toBe(false); expect(q.dropped).toBe(100)
    expect(q.dequeue('overflow-same-id')).toBeUndefined(); expect(q.depth).toBe(2)
    q.dequeue('a'); q.dequeue('b'); expect(q.depth).toBe(0)
  })
  it('is flagged incomplete after drops and snapshot marks age as a lower bound', () => {
    const c = clock(), m = new Metrics({ mono: c.now }), q = m.queue('eval', 1)
    q.enqueue('a'); q.enqueue('b'); c.adv(7)
    expect(m.snapshot().queues.eval).toEqual({ depth: 1, trackedDepth: 1, depthComplete: false, oldestAgeMs: 7, oldestAgeIsLowerBound: true, dropped: 1 })
  })
  it('reconcile with authoritative length restores exactness or reports it, never adds to it', () => {
    const c = clock(), q = new QueueGauge(c.now, 1)
    q.enqueue('a'); q.enqueue('b'); q.enqueue('c')
    q.reconcile(3); expect(q.depth).toBe(3); expect(q.complete).toBe(false)
    q.reconcile(3); expect(q.depth).toBe(3)            // idempotent, not accumulated
    q.dequeue('a'); q.reconcile(0)                      // owner queue drained: nothing untracked remains
    expect([q.depth, q.complete]).toEqual([0, true])
    q.enqueue('d'); expect([q.depth, q.complete]).toEqual([1, true])
    expect(() => q.reconcile(-1)).toThrow()
  })
})

describe('tokens and cost: unknown stays unknown', () => {
  const pricing = { inputCacheHitPerM: 0.006, inputCacheMissPerM: 0.3, outputPerM: 1.2 }
  it('no reports -> nulls, not zeros', () => {
    const t = new Metrics().snapshot().tokens
    expect([t.inputCacheHit, t.inputCacheMiss, t.output, t.costUsd]).toEqual([null, null, null, null])
  })
  it('computes cost only for fully known usage with pricing', () => {
    const m = new Metrics()
    expect(m.recordUsage({ inputCacheHit: 1_000_000, inputCacheMiss: 1_000_000, output: 1_000_000 }, pricing).costUsd).toBeCloseTo(1.506, 9)
    expect(m.recordUsage({ inputCacheMiss: 10, output: 5 }, pricing).costUsd).toBeNull()
    expect(m.recordUsage({ inputCacheHit: 1, inputCacheMiss: 1, output: 1 }).costUsd).toBeNull()
    const t = m.snapshot().tokens
    expect(t.costKnownReports).toBe(1); expect(t.costUnknownReports).toBe(2); expect(t.costUsd).toBeCloseTo(1.506, 9)
    expect(t.unknownReports.inputCacheHit).toBe(1); expect(t.inputCacheMiss).toBe(1_000_000 + 10 + 1)
  })
  it('a never-reported category stays null even when others are known', () => {
    const m = new Metrics(); m.recordUsage({ output: 7 }); const t = m.snapshot().tokens
    expect([t.output, t.inputCacheHit, t.inputCacheMiss]).toEqual([7, null, null])
  })
})

describe('cache write and reasoning tokens', () => {
  const base = { inputCacheHit: 0, inputCacheMiss: 1_000_000, output: 0 }
  const pricing = { inputCacheHitPerM: 0.006, inputCacheMissPerM: 0.3, outputPerM: 1.2 }
  it('billed cache-write tokens with no rate make the cost unknown, not a complete-looking total', () => {
    const m = new Metrics()
    expect(m.recordUsage({ ...base, cacheWrite: 500 }, pricing).costUsd).toBeNull()
    expect(m.recordUsage({ ...base, cacheWrite: null }, pricing).costUsd).toBeNull()
    const t = m.snapshot().tokens
    expect(t.costUsd).toBeNull(); expect(t.costKnownReports).toBe(0); expect(t.costUnknownReports).toBe(2); expect(t.cacheWrite).toBe(500)
  })
  it('zero or absent cache-write needs no rate; a resolved rate is charged', () => {
    const m = new Metrics()
    expect(m.recordUsage({ ...base, cacheWrite: 0 }, pricing).costUsd).toBeCloseTo(0.3, 12)
    expect(m.recordUsage(base, pricing).costUsd).toBeCloseTo(0.3, 12)
    expect(m.recordUsage({ ...base, cacheWrite: 1_000_000 }, { ...pricing, cacheWritePerM: 0.5 }).costUsd).toBeCloseTo(0.8, 12)
  })
  it('reasoning is its own non-additive field: never added to output or cost', () => {
    const m = new Metrics()
    const r = m.recordUsage({ inputCacheHit: 0, inputCacheMiss: 0, output: 100, reasoning: 60 }, pricing)
    expect(r.costUsd).toBeCloseTo(100 * 1.2 / 1e6, 15)
    const t = m.snapshot().tokens; expect([t.output, t.reasoning]).toEqual([100, 60])
    expect(new Metrics().snapshot().tokens.reasoning).toBeNull()
  })
})

describe('snapshot serialization', () => {
  it('round-trips JSON, carries no monotonic values, and stays small with bounded labels', () => {
    const m = new Metrics({ mono: () => 123456.789, wall: () => 1_700_000_000_000 })
    for (const s of STAGES) for (let i = 0; i < 2000; i++) m.observe(s, 'github', i)
    m.queue('eval').enqueue('x')
    const { json, bytes } = m.serialize()
    expect(JSON.parse(json).version).toBe(1); expect(json).not.toContain('123456'); expect(bytes).toBeLessThan(20_000)
  })
})
