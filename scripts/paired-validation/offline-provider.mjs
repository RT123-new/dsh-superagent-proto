import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adapter, Budget, RESERVATION, usageCost } from './provider.mjs'
const dir = mkdtempSync(join(tmpdir(),'paired-provider-'))
let seen
const server = createServer(async(req,res)=>{
 let data=''; for await(const c of req) data+=c
 seen={url:req.url,headers:req.headers,body:JSON.parse(data)}
 res.writeHead(200,{'content-type':'text/event-stream'})
 const send=o=>res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`)
 send({type:'message_start',message:{id:'synthetic',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:10,output_tokens:0}}})
 send({type:'content_block_start',index:0,content_block:{type:'text',text:''}})
 send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"kind":"accept"}'}})
 send({type:'content_block_stop',index:0})
 send({type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:6}})
 send({type:'message_stop'});res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
try {
 const base=`http://127.0.0.1:${server.address().port}`
 const p=adapter(base,'synthetic-test-key')
 const chunks=[]
 for await(const c of p.stream({provider:'deepseek-official',model:'deepseek-flash',maxTokens:1024,messages:[{role:'user',content:[{type:'text',text:'Synthetic only'}]}],signal:AbortSignal.timeout(5000)})) chunks.push(c)
 assert.equal(seen.url,'/v1/messages'); assert.equal(seen.body.model,'deepseek-flash'); assert.equal(seen.body.max_tokens,1024)
 assert.equal(seen.body.thinking.type,'disabled'); assert.equal(seen.headers['x-api-key'],'synthetic-test-key')
 assert.equal(seen.body.tools,undefined)
 assert.equal(chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),'{"kind":"accept"}')
 assert.equal(chunks.findLast(c=>c.type==='finish').reason.kind,'stop')
 const usage=chunks.findLast(c=>c.type==='usage').usage
 assert.equal(usage.inputTokens,10); assert.equal(usage.outputTokens,6)
 const b=new Budget(join(dir,'budget.json')); b.reserve('one'); assert.throws(()=>b.reserve('two'))
 const paid=b.settle(usage);assert.equal(paid,usageCost(usage)); assert.equal(b.state.pending,null)
 b.reserve('unknown');b.stop();assert.throws(()=>b.reserve('retry'))
 const reloaded=new Budget(join(dir,'budget.json'));assert.throws(()=>reloaded.reserve('retry'))
 assert.equal(JSON.parse(readFileSync(join(dir,'budget.json'),'utf8')).pending.maximum,RESERVATION)
 assert.throws(()=>usageCost({inputTokens:1,outputTokens:1,cacheWriteTokens:2}))
 assert.throws(()=>usageCost({inputTokens:1}))
 assert.throws(()=>usageCost({inputTokens:1,outputTokens:1025}))
 console.log(JSON.stringify({passed:true,seam:'published DSH DeepSeekAdapter -> local SSE HTTP server',chunks:chunks.map(c=>c.type),usage,reservation:RESERVATION}))
} finally { await new Promise(r=>server.close(r)); rmSync(dir,{recursive:true,force:true}) }
