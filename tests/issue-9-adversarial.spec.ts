import { describe, expect, it } from 'vitest'
import { Metrics, QueueGauge, SlotIntegrator } from '../src/infra/metrics.ts'

const pricing = {inputCacheHitPerM: 0.006, inputCacheMissPerM: 0.3, outputPerM: 1.2}
const usage = {inputCacheHit: 0, inputCacheMiss: 100, output: 10,cacheWrite:0}
describe('independent collector review', () => {
  it('invalidates reconciled depth after tracked or untracked queue changes', () => {
    const q = new QueueGauge(() => 0,1)
    q.enqueue('a'); q.enqueue('b'); q.reconcile(2)
    q.dequeue('a')
    expect(q.depth).toBe(0) // identity-incomplete: current tracked lower bound, not stale authoritative value
    q.reconcile(1); q.dequeue('b')
    expect(q.depth).toBe(0)
    q.reconcile(0); expect(q.complete).toBe(true)
  })
  it('authoritative zero drains stale tracked IDs and ages', () => {
    const q = new QueueGauge(() => 100,2)
    q.enqueue('a'); q.reconcile(0)
    expect([q.depth,q.trackedDepth,q.oldestAgeMs(),q.complete]).toEqual([0,0,null,true])
  })
  it('authoritative smaller depth never reports stale tracked ages as a lower bound', () => {
    let now=0
    const q = new QueueGauge(() => now,3)
    q.enqueue('stale'); now=100; q.enqueue('current'); q.reconcile(1)
    expect(q.depth).toBe(1)
    expect(q.oldestAgeMs()).toBeNull() // length alone cannot identify which tracked id disappeared
  })
  it('takes slot integrals and utilization at one observation boundary', () => {
    let now=0
    const m = new Metrics({mono: () => now++,wall:()=>0})
    const p=m.slotPool('worker',2)
    p.setCount('busy',1)
    const slot=m.snapshot().slots.worker!
    expect(slot.utilization).toBe(Object.values(slot.integrals.activeSlotMs).reduce((a,b)=>a+b,0)/slot.integrals.capacitySlotMs)
  })
  it('rejects invalid or unbounded sample windows and queue capacities', () => {
    for(const window of [NaN,Infinity,0,-1,1.5,1e9]) expect(()=>new Metrics({window})).toThrow()
    for(const cap of [NaN,Infinity,0,-1,1.5,1e9]) expect(()=>new QueueGauge(()=>0,cap)).toThrow()
  })
  it('rejects duplicate or unbounded custom slot states', () => {
    expect(()=>new SlotIntegrator(()=>0,2,['busy','busy'])).toThrow()
    expect(()=>new SlotIntegrator(()=>0,2,Array.from({length:1000},(_,i)=>String(i)))).toThrow()
  })
  it.each([NaN,Infinity,-1])('invalid pricing %s does not become a known cost', invalid => {
    const m=new Metrics()
    expect(m.recordUsage(usage,{...pricing,outputPerM:invalid}).costUsd).toBeNull()
    expect(m.snapshot().tokens.costUnknownReports).toBe(1)
    expect(m.snapshot().tokens.costUsd).toBeNull()
  })
  it('rejects malformed counter increments without poisoning the snapshot', () => {
    const m=new Metrics()
    for (const n of [NaN,Infinity,-1,1.5]) expect(()=>m.count('requests',n)).toThrow()
    expect(m.snapshot().counters.requests).toBeUndefined()
  })
  it('separates failed timers from success quantiles and keeps completion idempotent', () => {
    let now=0; const m=new Metrics({mono:()=>now})
    const stop=m.timer('tool_run','github'); now=100; stop('failure'); now=200; stop('success')
    m.observe('tool_run','github',10)
    expect(m.snapshot().durations['tool_run|github']?.p95Ms).toBe(10)
    expect(m.snapshot().failedDurations['tool_run|github']?.p95Ms).toBe(100)
    expect(m.snapshot().failedDurations['tool_run|github']?.count).toBe(1)
  })
  it('treats absent cache-write usage as unknown instead of inventing zero', () => {
    const m=new Metrics()
    expect(m.recordUsage({inputCacheHit:0,inputCacheMiss:100,output:1},pricing).costUsd).toBeNull()
  })
  it('bounds pool label length', () => {
    expect(()=>new Metrics().slotPool('x'.repeat(100000),1)).toThrow()
  })

})
