/** Independent noninterference and committed-source-boundary proofs. */
import {expect,it,vi} from 'vitest'
import {Passes} from '../src/app/passes.ts'
import {HealthBoard} from '../src/infra/health.ts'
import {Metrics} from '../src/infra/metrics.ts'
import {Probe} from '../src/infra/metrics-probe.ts'
import {DomainTimeline} from '../src/infra/metrics-lifecycle.ts'
import {startRuntime,feishu} from './fixtures/host.ts'
import type {Trigger} from '../src/core/index.ts'
import type {DomainEvent} from '../src/core/ports.ts'

it('throwing receipt instrumentation cannot suppress intake, change filtered/duplicate results or mask the engine error',()=>{
 const engine={receive:vi.fn(():'stored'|'filtered'|'duplicate'=>'stored'),evaluateDue:vi.fn()}
 const metrics=new Metrics()
 const passes=new Passes({engine,effects:{kick:()=>{},idle:async()=>{}},health:new HealthBoard().claim('x'),lifetime:new AbortController().signal,configured:()=>false,closing:()=>false,
 probe:new Probe(metrics),arrival:{note:()=>{throw new Error('note')},drop:()=>{throw new Error('drop')}}})
 expect(()=>passes.receive({id:'s'} as Trigger)).not.toThrow()
 expect(engine.receive).toHaveBeenCalledTimes(1)
 engine.receive.mockReturnValueOnce('filtered');expect(passes.receive({id:'f'} as Trigger)).toBe('filtered')
 engine.receive.mockReturnValueOnce('duplicate');expect(passes.receive({id:'d'} as Trigger)).toBe('duplicate')
 const failure=new Error('database');engine.receive.mockImplementationOnce(()=>{throw failure})
 expect(()=>passes.receive({id:'x'} as Trigger)).toThrow(failure)
 expect(metrics.snapshot().counters.metrics_error).toBe(7)
})
it('Runtime records only committed receipt-to-eval-queue, rolls back cleanly and retries the same ID with a fresh stamp',async()=>{
 const h=await startRuntime()
 try {
  let clock=0
  ;(h.runtime as unknown as {metrics:{mono:()=>number}}).metrics.mono=()=>clock++
  const samples=()=>h.runtime.metricsSnapshot()!.durations['source_to_eval_queue|internal']
  const trigger=feishu('883','fix it')
  expect(()=>h.runtime.store.atomic(()=>{h.runtime.receive(trigger);throw new Error('rollback')})).toThrow('rollback')
  expect(samples()).toBeUndefined();expect(h.runtime.store.triggers.get(trigger.id)).toBeUndefined()
  clock=1000
  expect(h.runtime.receive(trigger)).toBe('stored')
  expect(samples()).toMatchObject({count:1});expect(samples()!.maxMs).toBeLessThan(100)
  expect(h.runtime.receive(trigger)).toBe('duplicate');expect(samples()!.count).toBe(1)
  const {trigger: accepted}=await h.acceptedTicket(feishu('884','another task'))
  const count=samples()!.count
  expect(h.runtime.receive({...feishu('885','follow up'),threads:accepted.threads})).toBe('stored')
  expect(samples()!.count).toBe(count)
 } finally {await h.stop()}
})
it('restart/no receipt and non-intake requeue never invent a source receipt sample; next fresh ID uses a fresh stamp',()=>{
 let now=0;const metrics=new Metrics({mono:()=>now}),timeline=new DomainTimeline(new Probe(metrics),()=>now)
 const event=(id:string,queued:boolean)=>({type:'trigger.received',at:'2026-11-04T00:00:00Z',data:{triggerId:id,threads:[],queued}}) as DomainEvent
 timeline.observe(event('restart',true));expect(metrics.snapshot().durations['source_to_eval_queue|internal']).toBeUndefined()
 timeline.arrived('filtered');timeline.abandoned('filtered');now=99;timeline.observe(event('filtered',true))
 expect(metrics.snapshot().durations['source_to_eval_queue|internal']).toBeUndefined()
 timeline.arrived('owner');timeline.observe(event('owner',false));now=1000
 timeline.observe({type:'eval.started',at:'2026-11-04T00:00:00Z',data:{evalId:'requeue',threadKey:'t',triggerIds:['owner'],strength:'inferred'}})
 expect(metrics.snapshot().durations['source_to_eval_queue|internal']).toBeUndefined()
 timeline.arrived('fresh');now+=7;timeline.observe(event('fresh',true));expect(metrics.snapshot().durations['source_to_eval_queue|internal']).toMatchObject({count:1,maxMs:7})
})
