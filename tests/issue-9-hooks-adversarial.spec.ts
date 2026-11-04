import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { Effects } from '../src/app/effects.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { Metrics } from '../src/infra/metrics.ts'
import { Probe } from '../src/infra/metrics-probe.ts'

let h:Host|undefined
afterEach(async()=>{await h?.stop();h=undefined})
it('observes never-used configured worker capacity from Runtime start',async()=>{
 h=await startRuntime()
 const slot=h.runtime.metricsSnapshot()!.slots.worker
 expect(slot).toBeDefined()
 expect(slot!.capacity).toBe(h.runtime.store.settings().executor.maxWorkers)
})
it('collector snapshot failure does not escape Runtime',async()=>{
 h=await startRuntime()
 const metrics=(h.runtime as unknown as {metrics: Metrics}).metrics
 metrics.snapshot=()=>{throw new Error('collector failed')}
 expect(()=>h!.runtime.metricsSnapshot()).not.toThrow()
 expect(h.runtime.metricsSnapshot()).toBeUndefined()
})
it('reconstructed terminal usage events are counted once per stable message identity',async()=>{
 h=await startRuntime()
 const session={id:h.runtime.masterId}
 const data={turn:1,step:1,message:{id:'stable-message',role:'assistant',content:[]},stream:[],usage:{inputTokens:10,outputTokens:2}}
 h.ctx.emit('session/event',session as never,{type:'assistant/message',data} as never)
 h.ctx.emit('session/event',session as never,{type:'assistant/message',data:structuredClone(data)} as never)
 expect(h.runtime.metricsSnapshot()!.tokens.reports).toBe(1)
})
it('effect waiting depth excludes an attempt actively running',async()=>{
 h=await startRuntime()
 const metrics=new Metrics(), effects=new Effects(h.runtime.store,new HealthBoard(),()=>Date.now(),new Probe(metrics))
 let release!:()=>void
 const barrier=new Promise<void>(resolve=>{release=resolve})
 effects.handle('relay',async()=>{await barrier})
 effects.enqueue('relay','waiting-vs-running',{text:'a'})
 effects.start()
 await Promise.resolve()
 effects.measure()
 const depth=metrics.snapshot().queues.effect!.depth
 release();await effects.drain()
 expect(depth).toBe(0)
})

it('unrelated sessions contribute no telemetry',async()=>{
 h=await startRuntime()
 h.ctx.emit('session/event',{id:'unrelated-session'} as never,{type:'assistant/message',data:{turn:1,step:1,message:{id:'unrelated',role:'assistant',content:[]},stream:[],usage:{inputTokens:100,outputTokens:2}}} as never)
 expect(h.runtime.metricsSnapshot()!.tokens.reports).toBe(0)
})
it('capacity transitions are sampled at executor settings commit, not later activity',async()=>{
 h=await startRuntime()
 const before=h.runtime.store.settings().executor
 await h.runtime.settings.save('executor',{...before,maxWorkers:5},h.runtime.store.blockRevision('executor'),'panel')
 expect(h.runtime.metricsSnapshot()!.slots.worker!.capacity).toBe(5)
 expect(h.runtime.metricsSnapshot()!.slots.worker!.integrals.capacityChanges).toBe(1)
})

it('a coalesced newer effect generation remains waiting while its old attempt runs',async()=>{
 h=await startRuntime()
 const metrics=new Metrics(), effects=new Effects(h.runtime.store,new HealthBoard(),()=>Date.now(),new Probe(metrics))
 let release!:()=>void
 const barrier=new Promise<void>(resolve=>{release=resolve})
 effects.handle('relay',async()=>{await barrier})
 effects.enqueue('relay','generation',{text:'old'});effects.start();await Promise.resolve()
 effects.enqueue('relay','generation',{text:'new'});effects.measure()
 const depth=metrics.snapshot().queues.effect!.depth
 release();await effects.drain()
 expect(depth).toBe(1)
})
