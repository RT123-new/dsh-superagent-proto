import { it, expect, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { pollThreads } from '../../src/sources/github.ts'
import { sourceHost, hostDir, closeHost } from '../../tests/fixtures/source-host.ts'
import { Commands } from '../../src/infra/commands.ts'
import { rng } from './helpers/rng.ts'
import { pairedBootstrap, percentileOf } from './helpers/stats.ts'
interface Row {profile:string; seed:number;c:number;latency:number;requests:number;stored:number;failures:number;maxActive:number;wallMs:number}
const rows:Row[]=[]
const N=200, EPOCH=Date.parse('2026-11-04T00:00:00Z')
it('executes actual Source/Engine/SQLite subscriptions with identical latency/rate gates',async()=>{
  vi.useFakeTimers(); vi.setSystemTime(EPOCH)
  try {
    for (const profile of ['latency-bound','rate-bound','failure-burst','slow-network']) for(let seed=1;seed<=5;seed++) for(const c of [1,2,4,8]) {
      vi.setSystemTime(EPOCH)
      const h=sourceHost(hostDir('pool-actual-'))
      const random=rng(seed), delays=Array.from({length:N},()=>(profile==='slow-network'?300:60)+Math.floor(-(profile==='slow-network'?200:40)*Math.log(Math.max(random(),1e-9))))
      h.store.saveSettings({...h.store.settings(),sources:{github:{enabled:true,config:{reconcileMinutes:0,subscriptionConcurrency:c}}}})
      for(let number=1;number<=N;number++)h.store.threads.save({key:`github:${number}`,ref:{source:'github',id:String(number)},
        createdAt:new Date(EPOCH-60_000).toISOString(),subscriptions:['ticket'],correlated:[],pending:[],meta:{isPr:false,title:`Issue ${number}`}})
      const controller=new AbortController()
      // Same serialized gate in every arm. Missing-header fallback 10rps; reserve-rate profile 2.5rps.
      let requests=0,active=0,maxActive=0,failures=0
      const completed=new Set<number>()
      vi.spyOn(Commands.prototype as unknown as { execute: (p: string, args: string[]) => Promise<string> },'execute').mockImplementation((async(_program:string,args:string[])=>{
        const number=Number(/issues\/(\d+)/.exec(args[1]!)?.[1])
        active++;maxActive=Math.max(maxActive,active);requests++
        await new Promise(r=>setTimeout(r,delays[number-1]!))
        active--
        // Check checkpoint has not moved while the response was still unavailable.
        expect(h.store.get(`github-cursor:${number}`)).toBeUndefined()
        if(profile==='failure-burst'&&number%17===0){failures++;throw new Error('HTTP502 injected')}
        completed.add(number)
        const body=JSON.stringify([{id:number,body:'@agent-bot take this',user:{login:'alice',type:'User'},
          html_url:`https://github.com/acme/widgets/issues/${number}#issuecomment-${number}`,
          created_at:new Date(EPOCH-1000).toISOString(),updated_at:new Date(EPOCH-1000).toISOString()}])
        const rateHeaders=profile==='rate-bound'?'X-RateLimit-Remaining: 5000\r\nX-RateLimit-Limit: 5000\r\nX-RateLimit-Reset: '+String(EPOCH/1000+1800)+'\r\n':''
        return `HTTP/2.0 200 OK\r\n${rateHeaders}\r\n${body}`
      }) as never)
      const started=Date.now(),wall=performance.now()
      const pending=pollThreads(h,controller.signal)
      await vi.runAllTimersAsync();await pending
      const expected=N-(profile==='failure-burst'?Math.floor(N/17):0)
      expect(requests).toBe(N);expect(h.results.filter(r=>r==='stored')).toHaveLength(expected)
      expect(maxActive).toBeLessThanOrEqual(c)
      for(let n=1;n<=N;n++)expect(h.store.get(`github-cursor:${n}`)!==undefined).toBe(completed.has(n))
      rows.push({profile,seed,c,latency:Date.now()-started,requests,stored:expected,failures,maxActive,wallMs:performance.now()-wall})
      closeHost(h);vi.restoreAllMocks()
    }
    const summaries=[]
    for(const profile of ['latency-bound','rate-bound','failure-burst','slow-network'])for(const c of [1,2,4,8]){
      const b=rows.filter(r=>r.profile===profile&&r.c===1).map(r=>r.latency)
      const v=rows.filter(r=>r.profile===profile&&r.c===c).map(r=>r.latency)
      summaries.push({profile,c,baselineP95:percentileOf(b,.95),variantP95:percentileOf(v,.95),
        ...pairedBootstrap(b,v,rng(7),10000,'p95'),exploratoryFiveRoundPairs:true,eventsPerRound:N,actualSourceExecution:true,virtualTime:true})
    }
    writeFileSync('reports/evidence/subscription-pool/actual-pool-raw.json',JSON.stringify(rows,null,2))
    writeFileSync('reports/evidence/subscription-pool/actual-pool-summary.json',JSON.stringify(summaries,null,2))
  }finally{vi.useRealTimers()}
},120000)
