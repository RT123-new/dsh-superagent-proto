import {expect,it,vi} from 'vitest'
import {MasterAssessor} from '../src/app/assessment.ts'
import {Commands} from '../src/infra/commands.ts'
import {Metrics} from '../src/infra/metrics.ts'
import {Probe} from '../src/infra/metrics-probe.ts'

it('card delivery measures handler build+inbox acknowledgement, excludes prior queue time and separates failures',async()=>{
 let mono=0
 const metrics=new Metrics({mono:()=>mono}), probe=new Probe(metrics)
 let run!: (payload:{triggerId:string},id:string)=>Promise<void>
 const candidate={evalId:'eval1'}
 const engine={candidate:()=>candidate,candidateDelivered:vi.fn()}
 const host={engine,probe,effects:{handle:(_kind:string,handler:typeof run)=>{run=handler},enqueue:vi.fn()},paused:()=>false,
 candidateCard:vi.fn(async()=>{mono+=3;return {}}),deliver:vi.fn(async()=>{mono+=7})}
 new MasterAssessor(host as never)
 mono=1000 // prior queue wait is not part of this timer
 await run({triggerId:'t'},'eval1')
 expect(metrics.snapshot().durations['assessment_card_delivery|internal']?.maxMs).toBe(10)
 expect(engine.candidateDelivered).toHaveBeenCalledOnce()
 host.deliver.mockImplementationOnce(async()=>{mono+=11;throw new Error('inbox failure')})
 await expect(run({triggerId:'t'},'eval1')).rejects.toThrow('inbox failure')
 expect(engine.candidateDelivered).toHaveBeenCalledOnce()
 expect(metrics.snapshot().failedDurations['assessment_card_delivery|internal']?.maxMs).toBe(14)
 await run({triggerId:'t'},'stale')
 expect(metrics.snapshot().durations['assessment_card_delivery|internal']?.count).toBe(1)
})
it('withSignal retains command instrumentation and aborted command is failure, not success',async()=>{
 const metrics=new Metrics(), probe=new Probe(metrics), signal=new AbortController()
 const commands=new Commands(()=>({}) as never,{},new AbortController().signal,probe).withSignal(signal.signal)
 await commands.run('true',[])
 signal.abort()
 await expect(commands.run('true',[])).rejects.toBeDefined()
 expect(metrics.snapshot().durations['command_run|internal']?.count).toBe(1)
 expect(metrics.snapshot().failedDurations['command_run|internal']?.count).toBe(1)
})
