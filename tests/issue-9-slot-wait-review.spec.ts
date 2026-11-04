import {expect,it} from 'vitest'
import {startRuntime,feishu} from './fixtures/host.ts'
import {Metrics} from '../src/infra/metrics.ts'
it('rollback cannot leave a slot-wait stamp on an assignment',async()=>{
 const h=await startRuntime()
 try {
  const executor=(h.runtime as unknown as {executor:{start(t:unknown,a:unknown):void;launchStamps:Map<string,number>}}).executor
  expect(()=>h.runtime.store.atomic(()=>{executor.start({id:'rolled-back'},{id:'assignment-rollback'});throw new Error('rollback')})).toThrow('rollback')
  expect(executor.launchStamps.has('assignment-rollback')).toBe(false)
 } finally {await h.stop()}
})
it('a fully successful Runtime launch measures scheduling wait with the injected clock and clears on dispose',async()=>{
 const h=await startRuntime()
 try {
  let clock=100
  const metrics=(h.runtime as unknown as {metrics:Metrics}).metrics
  ;(metrics as unknown as {mono:()=>number}).mono=()=>clock++
  const {ticket}=await h.acceptedTicket(feishu('987','fix it'))
  expect(ticket.assignments[0]!.state).toBe('running')
  expect(h.runtime.metricsSnapshot()!.durations['launch_slot_wait|internal']?.count).toBe(1)
  expect(h.runtime.metricsSnapshot()!.durations['launch_slot_wait|internal']!.maxMs).toBeGreaterThanOrEqual(0)
  expect(h.runtime.metricsSnapshot()!.durations['launch_slot_wait|internal']!.maxMs).toBeLessThan(100)
  const executor=(h.runtime as unknown as {executor:{dispose():void;launchStamps:Map<string,number>}}).executor
  executor.launchStamps.set('stale',1);executor.dispose();expect(executor.launchStamps.size).toBe(0)
 } finally {await h.stop()}
})

it('a rolled-back stop preserves the committed pending launch stamp',async()=>{
 const h=await startRuntime()
 try {
  const executor=(h.runtime as unknown as {executor:{stop(t:unknown,a:unknown,r:string):void;launchStamps:Map<string,number>}}).executor
  executor.launchStamps.set('pending',12)
  expect(()=>h.runtime.store.atomic(()=>{executor.stop({id:'ticket'},{id:'pending'},'test');throw new Error('rollback')})).toThrow('rollback')
  expect(executor.launchStamps.get('pending')).toBe(12)
 } finally {await h.stop()}
})
