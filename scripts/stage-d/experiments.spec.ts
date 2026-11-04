/** Offline candidate checks only; these do NOT certify a production pooled source or webhook service. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHmac } from 'node:crypto'
import { Inbox } from './issue-11-webhooks/intake.ts'
import { rate, deferUntil } from './issue-10-polling/rate.ts'
import { simulatePool, type RequestRecord } from './lib/timeline.ts'
import { percentileOf, pairedBootstrap } from './lib/stats.ts'
import { rng } from './lib/rng.ts'
const trace: RequestRecord[] = ['a','a','b','b','c'].map((conversation, seq) =>
  ({ seq, conversation, label: String(seq), serviceMs: 100, startedMs: 0, endedMs: 0, failed: seq === 2, phase: 'read' }))
describe('Stage D isolated candidates', () => {
  it.each([1,2,4,8])('keeps conversation order and bounded occupancy C=%s', c => {
    const { records } = simulatePool(trace, { concurrency: c })
    expect(records).toHaveLength(trace.length)
    for (const item of records) {
      const previous = records.filter(r => r.conversation === item.conversation && r.seq < item.seq)
      expect(previous.every(r => r.endedMs <= item.startedMs)).toBe(true)
      expect(records.filter(r => r.startedMs <= item.startedMs && r.endedMs > item.startedMs).length).toBeLessThanOrEqual(c)
    }
  })
  it('gates fractional rates and zero, not rounded-up window bursts', () => {
    const result = simulatePool(trace, { concurrency: 8, ratePerSecond: 0.25 })
    expect(result.records.map(r => r.startedMs)).toEqual([0,4000,8000,12000,16000])
    expect(simulatePool(trace, { concurrency: 8, ratePerSecond: 0 }).completionMs).toBe(Infinity)
  })
  it('implements reserve, reset and Retry-After rules', () => {
    expect(rate(5000,5000,1800,0)).toBe(2.5)
    expect(rate(500,5000,1800,0)).toBe(0)
    expect(rate(12,20,0,1)).toBe(2)
    expect(deferUntil({ 'retry-after': '120' }, 1000)).toBe(1120)
    expect(deferUntil({ 'x-ratelimit-remaining':'0','x-ratelimit-reset':'2000' },1000)).toBe(2000)
    expect(deferUntil({ 'retry-after':new Date(1500_000).toUTCString() },1000)).toBe(1500)
  })
  it('uses nearest-rank P95 and paired P95 resampling', () => {
    expect(percentileOf(Array.from({length:20},(_,i)=>i+1),0.95)).toBe(19)
    const result = pairedBootstrap([1,2,3,4],[0.5,1,1.5,2],rng(3),10_000,'p95')
    expect(result.ciLow).toBe(0.5); expect(result.ciHigh).toBe(0.5)
  })
  it('rejects invalid auth/repository, persists before ack, dedupes across restart, replays failed drain', async () => {
    const dir = mkdtempSync(join(tmpdir(),'webhook-study-')), path = join(dir,'inbox.db')
    const body = Buffer.from(JSON.stringify({ repository: { full_name:'acme/widgets' }, actor:'unauthorized' }))
    const sign = (b: Buffer) => 'sha256='+createHmac('sha256','fixture-only').update(b).digest('hex')
    let inbox = new Inbox(path,'fixture-only','acme/widgets')
    try {
      expect(inbox.accept('a','sha256='+ '0'.repeat(64),body)).toBe(401)
      const foreign = Buffer.from(JSON.stringify({repository:{full_name:'other/widgets'}}))
      expect(inbox.accept('f',sign(foreign),foreign)).toBe(403)
      expect(inbox.pending()).toBe(0)
      expect(inbox.accept('a',sign(body),body)).toBe(202)
      inbox.close(); inbox = new Inbox(path,'fixture-only','acme/widgets')
      expect(inbox.pending()).toBe(1)
      expect(inbox.accept('a',sign(body),body)).toBe(202)
      const changed = Buffer.from(JSON.stringify({repository:{full_name:'acme/widgets'},changed:true}))
      expect(inbox.accept('a',sign(changed),changed)).toBe(409)
      await expect(inbox.drain(async () => { throw new Error('API unavailable') })).rejects.toThrow()
      expect(inbox.pending()).toBe(1)
      let reads = 0
      await inbox.drain(async () => { reads++ })
      expect(reads).toBe(1); expect(inbox.pending()).toBe(0)
    } finally { inbox.close(); rmSync(dir,{recursive:true,force:true}) }
  })
})

it('pool stops dispatch after cancellation and waits for current readers to settle', async () => {
  const { boundedPool } = await import('./issue-10-polling/pool.ts')
  let stop=false,active=0,settled=0
  await boundedPool([1,2,3,4],2,()=>stop,async () => {
    active++;stop=true;await Promise.resolve();active--;settled++
  })
  expect(active).toBe(0);expect(settled).toBe(1)
})
it('actual pooled Source leaves failed cursor and deduplicates replay after SQLite reopen', async () => {
  const { pooledSubscriptions } = await import('./issue-10-polling/pool.ts')
  const { sourceHost,hostDir,closeHost } = await import('./lib/host.ts')
  const dir=hostDir('pool-restart-'), at=new Date(Date.now()-1000).toISOString()
  let h=sourceHost(dir),fail=true
  const setup=()=>{
    h.store.saveSettings({...h.store.settings(),sources:{github:{enabled:true,config:{reconcileMinutes:0}}}})
    h.commands.withSignal=()=>h.commands
    h.commands.run=async(_program,args)=>{
      const n=Number(/issues\/(\d+)/.exec(args[1]!)?.[1])
      if(n===1&&fail)throw new Error('mid-read failure')
      return JSON.stringify([[{id:n,body:'@agent-bot take this',user:{login:'alice',type:'User'},
        html_url:`https://github.com/acme/widgets/issues/${n}#issuecomment-${n}`,created_at:at,updated_at:at}]])
    }
  }
  try{
    setup()
    for(let n=1;n<=2;n++)h.store.threads.save({key:`github:${n}`,ref:{source:'github',id:String(n)},
      createdAt:new Date(Date.now()-60000).toISOString(),subscriptions:['ticket'],correlated:[],pending:[],meta:{isPr:false,title:'Test'}})
    await pooledSubscriptions(h,2,new AbortController().signal)
    expect(h.store.get('github-cursor:1')).toBeUndefined();expect(h.store.get('github-cursor:2')).toBeDefined()
    expect(h.results.filter(r=>r==='stored')).toHaveLength(1)
    h.store.close()
    // Rebuild full Source/Engine around same SQLite database; sourceHost saves settings, preserves data.
    h=sourceHost(dir);fail=false;setup()
    await pooledSubscriptions(h,2,new AbortController().signal)
    expect(h.results.filter(r=>r==='stored')).toHaveLength(1)
    expect(h.results.filter(r=>r==='duplicate')).toHaveLength(1)
    expect(h.store.get('github-cursor:1')).toBeDefined()
  }finally{closeHost(h)}
})
