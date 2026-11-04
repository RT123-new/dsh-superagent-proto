import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { Effects } from '../src/app/effects.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { CliError } from '../src/infra/commands.ts'
import { TransportFailure, classifyError, retryDecision, errorRecord, serverNotBefore } from '../src/app/retry-policy.ts'
const cleanup: (() => void)[] = []
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn() })
function harness() {
 const dir = mkdtempSync(join(tmpdir(),'retry-review-')); cleanup.push(()=>rmSync(dir,{recursive:true,force:true}))
 const path=join(dir,'db.sqlite'); let store=new Store(path); cleanup.push(()=>store.close())
 let now=1000; let calls=0
 let board=new HealthBoard(); let fx=new Effects(store,board,()=>now,undefined,()=>0.5)
 const handler=async()=>{calls++;throw Object.assign(new Error('forbidden'),{status:403})}
 fx.handle('relay',handler,{ordered:true});fx.start()
 return {get store(){return store},get fx(){return fx},get board(){return board},get calls(){return calls},
 advance:()=>{now+=10*3600_000},reopen:async()=>{await fx.drain();store.close();store=new Store(path);board=new HealthBoard();fx=new Effects(store,board,()=>now,undefined,()=>0.5);fx.handle('relay',handler,{ordered:true});fx.start()} }
}
it('never executes a blocked unauthorized operation again merely because time passed or host restarted', async()=>{
 const h=harness();h.fx.enqueue('relay','x',{text:'policy transition'});await h.fx.idle();expect(h.calls).toBe(1)
 h.advance();await h.fx.idle();expect(h.calls).toBe(1)
 await h.reopen();await h.fx.idle();expect(h.calls).toBe(1)
 expect(h.fx.pending('relay','x')).toBe(true);expect(h.board.all.relay?.state).toBe('error')
})
it('does not hide an older blocked row behind a newer transient error',async()=>{
 const h=harness();h.fx.enqueue('relay','old',{text:'a'});await h.fx.idle()
 h.store.db.prepare("INSERT INTO effect(kind,key,value,seq,generation,attempts,error,due,since) VALUES('relay','new','{}',100,0,1,'transient',999999999,'x')").run()
 await h.reopen();expect(h.board.all.relay?.state).toBe('error');expect(h.board.all.relay?.detail).toContain('blocked')
})
it.each([[401,'unauthorized'],[403,'unauthorized'],[404,'permanent'],[429,'rate_limited'],[503,'provider_temporary']])('uses actual CLI structured code %s', (code,kind)=>{
 expect(classifyError(new CliError('transport diagnostic',Number(code)))).toBe(kind)
})
it('does not permanently park an unqualified fetch TypeError',()=>{expect(classifyError(new TypeError('fetch failed'))).toBe('transient')})
it('ignores an arbitrary thrown object claiming a server schedule',()=>{
 const decision=retryDecision({status:429,retryAfter:99999999},0,2000,60000,()=>0,1000)
 expect(decision.retry && decision.delay).toBe(1000)
})
it('normalizes Retry-After only as HTTP delta seconds or valid HTTP date, not epoch guesses/negative/empty',()=>{
 expect(serverNotBefore('',1000)).toBeUndefined();expect(serverNotBefore(-1,1000)).toBeUndefined()
 expect(serverNotBefore('1.5',1000)).toBeUndefined()
})
it('keeps structured persisted error JSON valid under long diagnostics',()=>{
 expect(()=>JSON.parse(errorRecord(new Error('x'.repeat(5000)),'transient'))).not.toThrow()
})

it('accepts explicit transport metadata on the existing CLI error without reinterpreting lark codes',()=>{
 const failure = new CliError('rate limit', 123456)
 Object.assign(failure,{transportFailure:new TransportFailure('HTTP response',{status:429,retryAfter:'45'},1000)})
 expect(classifyError(failure)).toBe('rate_limited')
 const decision=retryDecision(failure,0,2000,60000,()=>0,1000)
 expect(decision.retry && decision.delay).toBe(45000)
 expect(classifyError(new CliError('unknown feishu code',123456))).toBe('transient')
})
it('parses exact valid HTTP dates and rejects impossible dates and unsafe deltas',()=>{
 const at=Date.parse('Wed, 04 Nov 2026 08:00:00 GMT')
 expect(serverNotBefore('Wed, 04 Nov 2026 08:00:00 GMT',1000)).toBe(at)
 expect(serverNotBefore('Wed, 31 Feb 2026 08:00:00 GMT',1000)).toBeUndefined()
 expect(serverNotBefore(Number.MAX_SAFE_INTEGER,1000)).toBeUndefined()
 expect(serverNotBefore(45,1000)).toBe(46000)
})
it('preserves the blocked ordered head and later policy transitions until explicit rearm',async()=>{
 const h=harness();h.fx.enqueue('relay','head',{text:'policy A-B'});h.fx.enqueue('relay','later',{text:'policy B-A'})
 await h.fx.idle();h.advance();await h.fx.idle()
 expect(h.calls).toBe(1);expect(h.fx.pending('relay','head')).toBe(true);expect(h.fx.pending('relay','later')).toBe(true)
 h.fx.enqueue('relay','head',{text:'explicit retry A-B'});await h.fx.idle();expect(h.calls).toBe(2)
 expect(h.fx.pending('relay','later')).toBe(true)
})

it('reports blocked failures immediately even for quiet effect handlers',async()=>{
 const h=harness();const board=new HealthBoard();const fx=new Effects(h.store,board,()=>1000)
 fx.handle('notice',async()=>{throw new SyntaxError('bad payload')},{quiet:true});fx.start()
 fx.enqueue('notice','settings:policy',{value:{revision:1},summary:'saved'});await fx.idle()
 expect(board.all.notice?.state).toBe('error');await fx.drain()
})
it('does not let an old failed generation park a newly rearmed payload',async()=>{
 const h=harness();const board=new HealthBoard();const fx=new Effects(h.store,board,()=>1000)
 const gate=Promise.withResolvers<void>();let calls=0
 fx.handle('notice',async()=>{if(++calls===1){await gate.promise;throw Object.assign(new Error('old denied'),{status:403})}});fx.start()
 fx.enqueue('notice','settings:policy',{value:{revision:1},summary:'saved'})
 await Promise.resolve();await Promise.resolve()
 fx.enqueue('notice','settings:policy',{value:{revision:2},summary:'new save'})
 gate.resolve();await fx.idle();expect(calls).toBe(2);expect(fx.pending('notice')).toBe(false);await fx.drain()
})
