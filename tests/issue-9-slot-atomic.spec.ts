import {expect,it} from 'vitest'
import {Metrics} from '../src/infra/metrics.ts'
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
