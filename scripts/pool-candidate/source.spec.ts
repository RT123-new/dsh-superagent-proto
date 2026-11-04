import {it,expect,vi} from 'vitest'
import {pollThreads} from '../../src/sources/github.ts'
import {Commands} from '../../src/infra/commands.ts'
import {sourceHost,hostDir,closeHost} from '../../tests/fixtures/source-host.ts'
// Actual private exec seam mocked as a transport, so apiResponse, headers, schema, pool, Source, Engine and SQLite run.
it.each([1,2,4,8])('production optional pool C=%s keeps page order/checkpoint/dedupe',async c=>{
 vi.useFakeTimers();vi.setSystemTime('2026-11-04T00:00:00Z')
 const h=sourceHost(hostDir('prod-pool-')), at=new Date(Date.now()-1000).toISOString()
 h.store.saveSettings({...h.store.settings(),sources:{github:{enabled:true,config:{subscriptionConcurrency:c}}}})
 const reads:string[]=[],active=new Map<number,number>()
 let inFlight=0,max=0
 const transport=async(_program:string,args:string[])=>{
   const path=args[1]!,n=Number(/issues\/(\d+)/.exec(path)?.[1]),page=Number(/[?&]page=(\d+)/.exec(path)?.[1]??1)
   reads.push(path);inFlight++;max=Math.max(max,inFlight)
   expect(active.get(n)??0).toBe(0);active.set(n,1)
   await new Promise(r=>setTimeout(r,300))
   inFlight--;active.set(n,0)
   expect(h.store.get(`github-cursor:${n}`)).toBeUndefined()
   if(n===3)throw new Error('failed read')
   const value={id:n*10+page,body:'@agent-bot take this',user:{login:'alice',type:'User'},
    html_url:`https://github.com/acme/widgets/issues/${n}#issuecomment-${n*10+page}`,created_at:at,updated_at:at}
   if(!args.includes('--include'))return JSON.stringify([[value]])
   return `HTTP/2.0 200 OK\r\n${page===1?`Link: <https://api.github.com/repos/acme/widgets/issues/${n}/comments?page=2>; rel="next"\r\n`:''}\r\n${JSON.stringify([value])}`
 }
 vi.spyOn(Commands.prototype as unknown as { execute: (p: string, args: string[]) => Promise<string> },'execute').mockImplementation(transport as never)
 for(let n=1;n<=10;n++)h.store.threads.save({key:`github:${n}`,ref:{source:'github',id:String(n)},
  createdAt:new Date(Date.now()-60000).toISOString(),subscriptions:['ticket'],correlated:[],pending:[],meta:{isPr:false,title:'Issue'}})
 try{
  const pending=pollThreads(h,new AbortController().signal)
  await vi.runAllTimersAsync();await pending
  expect(max).toBeLessThanOrEqual(c)
  expect(h.results.filter(r=>r==='stored')).toHaveLength(18)
  expect(h.store.get('github-cursor:3')).toBeUndefined()
  for(let n=1;n<=10;n++)if(n!==3)expect(h.store.get(`github-cursor:${n}`)).toBeDefined()
  expect(reads.filter(r=>r.includes('page=2'))).toHaveLength(9)
 }finally{closeHost(h);vi.restoreAllMocks();vi.useRealTimers()}
})
it('controlled Source cancels an empty-page read before cursor commit and drains started readers',async()=>{
 vi.useFakeTimers();vi.setSystemTime('2026-11-04T00:00:00Z')
 const h=sourceHost(hostDir('cancel-empty-')),controller=new AbortController()
 h.store.saveSettings({...h.store.settings(),sources:{github:{enabled:true,config:{subscriptionConcurrency:2}}}})
 let started=0,finished=0
 vi.spyOn(Commands.prototype as unknown as {execute:(p:string,args:string[])=>Promise<string>},'execute').mockImplementation(async()=>{
  started++;await new Promise(r=>setTimeout(r,300));finished++;return 'HTTP/2.0 200 OK\r\n\r\n[]'
 })
 for(let n=1;n<=10;n++)h.store.threads.save({key:`github:${n}`,ref:{source:'github',id:String(n)},createdAt:new Date(Date.now()-1000).toISOString(),
   subscriptions:['ticket'],correlated:[],pending:[],meta:{isPr:false,title:'Issue'}})
 try{
  const pending=pollThreads(h,controller.signal)
  await vi.advanceTimersByTimeAsync(150);controller.abort()
  await vi.runAllTimersAsync();await pending
  expect(started).toBe(2);expect(finished).toBe(2)
  for(let n=1;n<=10;n++)expect(h.store.get(`github-cursor:${n}`)).toBeUndefined()
 }finally{closeHost(h);vi.restoreAllMocks();vi.useRealTimers()}
})
it('controlled Source recovers failed cursor after SQLite reopen and dedupes successful replay',async()=>{
 vi.useFakeTimers();vi.setSystemTime('2026-11-04T00:00:00Z')
 const dir=hostDir('controlled-restart-'),at=new Date(Date.now()-1000).toISOString()
 let h=sourceHost(dir),fail=true
 const setup=()=>h.store.saveSettings({...h.store.settings(),sources:{github:{enabled:true,config:{subscriptionConcurrency:2}}}})
 vi.spyOn(Commands.prototype as unknown as {execute:(p:string,args:string[])=>Promise<string>},'execute').mockImplementation(async(_p,args)=>{
  const n=Number(/issues\/(\d+)/.exec(args[1]!)?.[1])
  if(n===1&&fail)throw new Error('failed before response')
  const body=JSON.stringify([{id:n,body:'@agent-bot take this',user:{login:'alice',type:'User'},
   html_url:`https://github.com/acme/widgets/issues/${n}#issuecomment-${n}`,created_at:at,updated_at:at}])
  return `HTTP/2.0 200 OK\r\n\r\n${body}`
 })
 try{
  setup()
  for(let n=1;n<=2;n++)h.store.threads.save({key:`github:${n}`,ref:{source:'github',id:String(n)},createdAt:new Date(Date.now()-60000).toISOString(),
   subscriptions:['ticket'],correlated:[],pending:[],meta:{isPr:false,title:'Issue'}})
  let pending=pollThreads(h,new AbortController().signal);await vi.runAllTimersAsync();await pending
  expect(h.results.filter(r=>r==='stored')).toHaveLength(1);expect(h.store.get('github-cursor:1')).toBeUndefined()
  h.store.close();h=sourceHost(dir);setup();fail=false
  pending=pollThreads(h,new AbortController().signal);await vi.runAllTimersAsync();await pending
  expect(h.results.filter(r=>r==='stored')).toHaveLength(1);expect(h.results.filter(r=>r==='duplicate')).toHaveLength(1)
  expect(h.store.get('github-cursor:1')).toBeDefined()
 }finally{closeHost(h);vi.restoreAllMocks();vi.useRealTimers()}
})
