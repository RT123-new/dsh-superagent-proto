import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
const root = mkdtempSync(join(tmpdir(),'provider45-'))
const runtime = new LocalSubprocessRuntime(new Context())
const controller = new AbortController()
const unrelated = spawn('sleep',['30'])
const childScript = `process.on('SIGTERM',()=>{});require('fs').writeFileSync('${root}/child',String(process.pid));setInterval(()=>require('fs').appendFileSync('${root}/beats','.'),20)`
const shell = `node -e ${JSON.stringify(childScript)} & wait`
const handle = runtime.spawn({argv:['sh','-c',shell],cwd:root,signal:controller.signal,graceMs:100,
 stdio:{stdin:'ignore',stdout:{maxBytes:4096},stderr:{maxBytes:4096}}})
try {
 for(let i=0;i<100&&!existsSync(join(root,'child'));i++)await new Promise(r=>setTimeout(r,20))
 if(!existsSync(join(root,'child')))throw Error('child never started')
 const child=Number(readFileSync(join(root,'child'),'utf8'))
 controller.abort()
 const outcome=await handle.done
 const empty=await handle.waitForExit(AbortSignal.timeout(5000))
 const before=readFileSync(join(root,'beats'),'utf8').length
 await new Promise(r=>setTimeout(r,150))
 const after=readFileSync(join(root,'beats'),'utf8').length
 let alive=true;try{process.kill(child,0)}catch{alive=false}
 process.kill(unrelated.pid,0)
 console.log(JSON.stringify({outcome,empty,childAlive:alive,heartbeatStopped:before===after,unrelatedAlive:true}))
 if(!empty||alive||before!==after)throw Error('range invariant failed')
}finally{handle.terminate();await handle.waitForExit(AbortSignal.timeout(5000));unrelated.kill();rmSync(root,{recursive:true,force:true})}
