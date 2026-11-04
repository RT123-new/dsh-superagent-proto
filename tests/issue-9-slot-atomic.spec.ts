import {expect,it} from 'vitest'
import {SlotIntegrator,Metrics} from '../src/infra/metrics.ts'
import {Probe} from '../src/infra/metrics-probe.ts'
it('a disjoint slot transition integrates at one clock boundary without phantom idle or excess',()=>{
 let t=0, reads=0
 const m=new Metrics({mono:()=>{reads++;return t++}}), probe=new Probe(m)
 probe.slots('worker',1,{preparing:1,busy:0})
 const before=reads
 probe.slots('worker',1,{preparing:0,busy:1})
 expect(reads-before).toBe(1)
 const i=m.snapshot().slots.worker!.integrals
 expect(i.overLimitSlotMs).toBe(0)
 expect(Object.values(i.activeSlotMs).reduce((a,b)=>a+b,0)+i.idleSlotMs).toBe(i.capacitySlotMs)
})

it('atomic validation precedes the clock read and preserves the previous state on failure',()=>{
 let time=0,reads=0; const pool=new SlotIntegrator(()=>{reads++;return time},2)
 pool.transition(2,{preparing:1,busy:1});time=10;const before=reads
 for(const [capacity,counts] of [[1,{busy:0}],[-1,{busy:0,preparing:0}],[1,{busy:NaN,preparing:0}],[1,{busy:0,preparing:0,other:0}]] as const) expect(()=>pool.transition(capacity,counts)).toThrow()
 expect(reads).toBe(before)
 const i=pool.integrals()
 expect(i.activeSlotMs).toEqual({preparing:10,busy:10});expect(pool.capacity).toBe(2)
})
it('simultaneous capacity reduction exposes only actual excess occupancy',()=>{
 let time=0;const pool=new SlotIntegrator(()=>time,3)
 pool.transition(3,{preparing:1,busy:2});time=10
 pool.transition(1,{preparing:0,busy:2});time=20
 const i=pool.integrals()
 expect(i.capacitySlotMs).toBe(40);expect(i.overLimitSlotMs).toBe(10)
 expect(i.activeSlotMs).toEqual({preparing:10,busy:40})
 expect(pool.utilization()).toBe(50/40)
})
