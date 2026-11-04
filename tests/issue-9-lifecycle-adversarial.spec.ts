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
 expect(metrics.snapshot().durations['step_to_settlement|internal']).toBeUndefined()
 expect(metrics.snapshot().failedDurations['step_to_settlement|internal']?.count).toBe(1)
})
it('duplicate sent receipts and withdrawn receipts create no pending response timer',()=>{
 const metrics=new Metrics(), receipts={add:vi.fn(()=>false),withdraw:vi.fn(()=>true)}
 const outbox=new Outbox({store:{atomic:(f:()=>void)=>f(),afterCommit:(f:()=>void)=>f(),receipts},effects:{handle:()=>{},enqueue:()=>{},cancel:()=>{}},sources:{instance:()=>undefined,channelAllowed:()=>false,channelIdempotency:()=>undefined,channelIdempotencyWindow:()=>undefined,send:async()=>'sent'},probe:new Probe(metrics)} as never)
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

it('evaluation correlation uses persisted decision evalId, not thread coincidence',()=>{
 let mono=0; const metrics=new Metrics({mono:()=>mono})
 const timeline=new DomainTimeline(new Probe(metrics),()=>mono,5000,id=>id==='actual'?'active':'direct')
 timeline.observe(event('eval.started',{evalId:'active',threadKey:'thread',triggerIds:[]}));mono=10
 timeline.observe(event('decision.recorded',{decisionId:'gate',kind:'ignore',threadKey:'thread'}));mono=50
 timeline.observe(event('decision.recorded',{decisionId:'actual',kind:'accept',threadKey:'thread'}))
 expect(metrics.snapshot().durations['eval_run|internal']?.maxMs).toBe(50)
})
it('timeline capacities cannot disable bounded state',()=>{
 for(const cap of [NaN,Infinity,0,-1,1.5,10001]) {
  expect(()=>new SessionTimeline(new Probe(new Metrics()),()=>0,cap)).toThrow()
  expect(()=>new DomainTimeline(new Probe(new Metrics()),()=>0,cap)).toThrow()
 }
})
it('receipt timing uses injected clock and does not label acknowledgements as report latency',async()=>{
 let mono=0, run!:(p:unknown,id:string)=>Promise<void>
 const metrics=new Metrics({mono:()=>mono})
 const receipt={id:'ack',status:'pending',channel:{source:'github'}}
 const host={store:{atomic:(f:()=>void)=>f(),afterCommit:(f:()=>void)=>f(),receipts:{add:()=>true,get:()=>receipt,behind:()=>false,settle:()=>{}}},
 effects:{enqueue:()=>{},handle:(_kind:unknown,handler:typeof run)=>{run=handler}}, sources:{instance:()=>({enabled:true}),channelAllowed:()=>true,channelIdempotency:()=>undefined,channelIdempotencyWindow:()=>undefined,send:async()=>{mono=75;return 'sent'}},probe:new Probe(metrics)}
 const outbox=new Outbox(host as never)
 outbox.send({id:'ack',kind:'acknowledgement',channel:{source:'github'},text:'ok'} as never);mono=50
 await run({},'ack')
 expect(metrics.snapshot().durations['receipt_to_response|internal']?.maxMs).toBe(75)
 expect(metrics.snapshot().durations['report_to_response|internal']).toBeUndefined()
})
it('real Runtime records worker history receipt once from a positively correlated prompt',async()=>{
 const {startRuntime,feishu}=await import('./fixtures/host.ts')
 const h=await startRuntime()
 try {
  const {sessionId}=await h.acceptedTicket(feishu('703','fix it'))
  const messages=h.agents.get(sessionId)!.inbox.nextTurn
  expect(messages.length).toBeGreaterThan(0)
  const message=messages[0]!
  const session={id:sessionId}
  h.ctx.emit('session/event',session as never,{type:'user/message',data:message} as never)
  h.ctx.emit('session/event',session as never,{type:'user/message',data:structuredClone(message)} as never)
  expect(h.runtime.metricsSnapshot()!.durations['worker_history_receipt|internal']?.count).toBe(1)
 } finally {await h.stop()}
})
