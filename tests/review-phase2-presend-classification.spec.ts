import { it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/app/store.ts'
import { Effects } from '../src/app/effects.ts'
import { Outbox } from '../src/app/outbox.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { CliError } from '../src/infra/commands.ts'
import { sendGithub } from '../src/sources/github-channel.ts'
import { TransportFailure } from '../src/infra/transport-failure.ts'

it.each([401,429])('pre-POST GitHub read HTTP %i retains permanent/embargo policy', async status => {
 const dir=mkdtempSync(join(tmpdir(),'presend-')); const store=new Store(join(dir,'db.sqlite'))
 let now=1_000_000, reads=0
 const error=new CliError(status===401?'Bad credentials':'Too Many Requests',status)
 if(status===429) Object.assign(error,{transportFailure:new TransportFailure('rate limited',{status:429,retryAfter:'120'},now)})
 const commands={deployment:{repository:'acme/widgets',github:{login:'agent-bot'}},pages:async()=>{reads++;throw error}}
 const effects=new Effects(store,new HealthBoard(),()=>now)
 const sources={instance:()=>({enabled:true}),channelAllowed:()=>true,channelIdempotency:()=>undefined,channelIdempotencyWindow:()=>undefined,send:(message:any)=>sendGithub({commands} as never,message)}
 const outbox=new Outbox({store,effects,sources:sources as never,commands:commands as never,paused:()=>false})
 outbox.send({id:'pre-read',channel:{source:'github',thread:'github:1',address:{number:'1'}},text:'hello',kind:'reply'})
 effects.start();await effects.idle()
 const row=store.db.prepare("SELECT due,error,attempts FROM effect WHERE key='pre-read'").get() as {due:number,error:string,attempts:number}
 console.log(JSON.stringify({status,reads,...row}))
 try {
 if(status===401) expect(row.error).toContain('blocked:unauthorized')
 else expect(row.due).toBeGreaterThanOrEqual(now+120_000)
 } finally {await effects.drain();store.close();rmSync(dir,{recursive:true,force:true})}
})
