import {it,expect} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Commands,CliError} from '../../src/infra/commands.ts'
import {TransportFailure} from '../../src/infra/transport-failure.ts'
import {testDeployment} from '../../tests/fixtures/deployment.ts'
it('uses configured CLI and attaches typed metadata only from actual included HTTP stdout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'commands-response-')),cli=join(dir,'gh-stub')
 writeFileSync(cli,`#!/bin/sh\nprintf 'HTTP/2.0 429 Too Many Requests\\r\\nRetry-After: 120\\r\\nX-RateLimit-Remaining: 0\\r\\n\\r\\n{}'\necho 'gh: HTTP 429' >&2\nexit 1\n`,{mode:0o700})
 const cmd=new Commands(()=>testDeployment({github:{cli,login:'agent-bot',noreply:'x'}}),{},new AbortController().signal)
 try{
  const e=await cmd.apiResponse('issues/12').catch(e=>e)
  expect(e).toBeInstanceOf(CliError);expect(e.code).toBe(429);expect(e.transportFailure).toBeInstanceOf(TransportFailure)
  expect(e.transportFailure.status).toBe(429);expect(e.transportFailure.serverNotBeforeMs).toBeGreaterThan(Date.now()+119000)
  const legacy=await cmd.api('issues/12').catch(e=>e)
  expect(legacy).toBeInstanceOf(CliError);expect(legacy.transportFailure).toBeUndefined()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
