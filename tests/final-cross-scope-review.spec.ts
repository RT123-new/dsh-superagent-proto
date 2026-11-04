import {afterEach,expect,it,vi} from 'vitest'
import {startRuntime,feishu,type Host} from './fixtures/host.ts'
let h:Host|undefined
afterEach(async()=>{await h?.stop();h=undefined})
it('pause engaged while ordinary delivery resolves the worker prevents inbox commit',async()=>{
 h=await startRuntime();const one=await h.acceptedTicket(feishu('1','@bot fix'))
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let held=false
 h.controller.resolveAgent.mockImplementation(async(id:string)=>{
  if(id===one.sessionId&&!held){held=true;entered.resolve();await release.promise}
  return h!.resolveDefault(id)
 })
 h.runtime.receive(feishu('2','follow-up',{mentions:[],root_id:'om_1',sender_id:'ou_guest'}))
 await entered.promise
 const current=h.runtime.store.settings();h.runtime.store.saveSettings({...current,paused:true})
 const before=h.deliveries.mock.calls.length
 release.resolve();await h.runtime.idle()
 expect(h.deliveries.mock.calls.slice(before).filter(([x])=>x.sessionId===one.sessionId)).toHaveLength(0)
 expect(h.runtime.store.tickets.get(one.ticket.id)!.undelivered.length).toBeGreaterThan(0)
})
it('recreation of an externally deleted worker uses assignment cancellation guard too',async()=>{
 h=await startRuntime();const one=await h.acceptedTicket(feishu('1','@bot fix'))
 h.agents.delete(one.sessionId)
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 const original=h.ctx.workspaceRegistry.create.bind(h.ctx.workspaceRegistry)
 vi.spyOn(h.ctx.workspaceRegistry,'create').mockImplementationOnce(async(cwd:string)=>{entered.resolve();await release.promise;return original(cwd)})
 h.runtime.receive(feishu('2','follow-up',{mentions:[],root_id:'om_1',sender_id:'ou_guest'}))
 await entered.promise
 await h.runtime.engine.stopTicket(one.ticket.id)
 const before=h.controller.create.mock.calls.length
 release.resolve();await h.runtime.idle()
 expect(h.controller.create.mock.calls.slice(before).filter(([x])=>x.sessionId===one.sessionId)).toHaveLength(0)
})
