import {expect,it,vi} from 'vitest'
import {Metrics} from '../src/infra/metrics.ts'
import {Probe} from '../src/infra/metrics-probe.ts'
import {DomainTimeline,SessionTimeline} from '../src/infra/metrics-lifecycle.ts'
import {Outbox} from '../src/app/outbox.ts'
import type {DomainEvent} from '../src/core/ports.ts'
const event=(type:string,data:unknown)=>({type,data,at:'2026-11-04T00:00:00Z'}) as DomainEvent
it('an interrupted assistant surface is a failed interval, not a successful model call',()=>{
 let mono=0;const metrics=new Metrics({mono:()=>mono}), timeline=new SessionTimeline(new Probe(metrics),()=>mono)
 timeline.observe('worker',{type:'step/start',data:{turn:1,step:1}});mono=100
 timeline.observe('worker',{type:'assistant/message',data:{turn:1,step:1,interrupted:true}})
 expect(metrics.snapshot().durations['model_call|internal']).toBeUndefined()
 expect(metrics.snapshot().failedDurations['model_call|internal']?.count).toBe(1)
})
it('duplicate sent receipts and withdrawn receipts create no pending response timer',()=>{
 const metrics=new Metrics(), receipts={add:vi.fn(()=>false),withdraw:vi.fn(()=>true)}
 const outbox=new Outbox({store:{atomic:(f:()=>void)=>f(),receipts},effects:{handle:()=>{},enqueue:()=>{},cancel:()=>{}},probe:new Probe(metrics)} as never)
 const message={id:'sent',kind:'acknowledgement',channel:{source:'github'},text:'ok'}
 outbox.send(message as never)
 expect((outbox as unknown as {queued:Map<string,number>}).queued.size).toBe(0)
 receipts.add.mockReturnValue(true);outbox.send({...message,id:'withdrawn'} as never);outbox.withdraw('withdrawn')
 expect((outbox as unknown as {queued:Map<string,number>}).queued.size).toBe(0)
})
it('gate-only decisions on a thread cannot steal its active evaluation timer',()=>{
 let mono=0;const metrics=new Metrics({mono:()=>mono}), timeline=new DomainTimeline(new Probe(metrics),()=>mono)
 timeline.observe(event('eval.started',{evalId:'active',threadKey:'thread',triggerIds:[]}));mono=10
 timeline.observe(event('decision.recorded',{decisionId:'direct',kind:'ignore',threadKey:'thread'}));mono=50
 timeline.observe(event('decision.recorded',{decisionId:'actual',kind:'accept',threadKey:'thread'}))
 expect(metrics.snapshot().durations['eval_run|internal']).toBeUndefined() // no eval identity supplied: refuse unsafe attribution
})
