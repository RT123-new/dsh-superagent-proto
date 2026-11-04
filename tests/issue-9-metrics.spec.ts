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
  it('are exact and sum to accounted time', () => {
    const c = clock(), p = new SlotIntegrator(c.now, 2)
    p.transition(0, 'idle'); p.transition(1, 'idle')
    c.adv(10); p.transition(0, 'preparing'); c.adv(5); p.transition(0, 'busy'); c.adv(20); p.transition(1, 'busy'); c.adv(5)
    // slot0: idle10 prep5 busy25 ; slot1: idle35 busy5 (open interval counted)
    expect(p.integrals()).toEqual({ idle: 45, preparing: 5, busy: 30 })
    expect(Object.values(p.integrals()).reduce((a, b) => a + b)).toBe(80)
    expect(p.utilization()).toBeCloseTo(35 / 80, 12)
  })
  it('null utilization before any time and rejects bad slots/states', () => {
    const c = clock(), p = new SlotIntegrator(c.now, 1)
    expect(p.utilization()).toBeNull(); expect(() => p.transition(1, 'idle')).toThrow(); expect(() => p.transition(0, 'nope')).toThrow()
  })
})

describe('queue gauge', () => {
  it('reports depth and oldest age; dequeue returns wait', () => {
    const c = clock(), q = new QueueGauge(c.now, 3)
    expect(q.oldestAgeMs()).toBeNull()
    q.enqueue('a'); c.adv(10); q.enqueue('b'); c.adv(5); q.enqueue('b')
    expect([q.depth, q.oldestAgeMs()]).toEqual([2, 15])
    expect(q.dequeue('a')).toBe(15); expect(q.oldestAgeMs()).toBe(5); expect(q.dequeue('zzz')).toBeUndefined()
  })
  it('is bounded: overflow still counts in depth but not stored', () => {
    const c = clock(), q = new QueueGauge(c.now, 2)
    for (const id of ['a', 'b', 'c', 'd']) q.enqueue(id)
    expect(q.depth).toBe(4); expect(q.overflow).toBe(2); expect(q.dequeue('c')).toBeUndefined()
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

describe('snapshot serialization', () => {
  it('round-trips JSON, carries no monotonic values, and stays small with bounded labels', () => {
    const m = new Metrics({ mono: () => 123456.789, wall: () => 1_700_000_000_000 })
    for (const s of STAGES) for (let i = 0; i < 2000; i++) m.observe(s, 'github', i)
    m.queue('eval').enqueue('x')
    const { json, bytes } = m.serialize()
    expect(JSON.parse(json).version).toBe(1); expect(json).not.toContain('123456'); expect(bytes).toBeLessThan(20_000)
  })
})
