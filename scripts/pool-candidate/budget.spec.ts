import {it,expect,vi} from 'vitest'
import {GithubPollBudget} from '../../src/infra/github-poll-budget.ts'
const response=(headers:Record<string,string>,status=200)=>({status,headers,body:'[]'})
it('serializes concurrent fallback permits and honors late Retry-After without a release burst',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{
  const b=new GithubPollBudget(),s=new AbortController().signal,times:number[]=[]
  await b.before(s)
  const pending=Promise.all([1,2,3].map(async()=>{await b.before(s);times.push(Date.now())}))
  await vi.advanceTimersByTimeAsync(50)
  b.after(response({'retry-after':'2'},429))
  await vi.runAllTimersAsync();await pending
  expect(times).toEqual([102050,102150,102250])
 }finally{vi.useRealTimers()}
})
it('uses primary reserve and seconds, and waits until reset at reserve',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{
  const b=new GithubPollBudget(),s=new AbortController().signal
  b.after(response({'x-ratelimit-remaining':'500','x-ratelimit-limit':'5000','x-ratelimit-reset':'110'}))
  let done=false;const p=b.before(s).then(()=>{done=true})
  await vi.advanceTimersByTimeAsync(9999);expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(1);await p;expect(done).toBe(true)
 }finally{vi.useRealTimers()}
})
it('abort never dispatches queued reservations and does not poison future permits',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{
  const b=new GithubPollBudget(),a=new AbortController()
  await b.before(a.signal)
  const p=b.before(a.signal).then(()=>false,()=>true)
  await vi.advanceTimersByTimeAsync(10);a.abort();expect(await p).toBe(true)
  const q=b.before(new AbortController().signal);await vi.runAllTimersAsync();await q
 }finally{vi.useRealTimers()}
})
