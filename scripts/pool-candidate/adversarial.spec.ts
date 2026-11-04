import {it,expect,vi} from 'vitest'
import {GithubPollBudget} from '../../src/infra/github-poll-budget.ts'
import {githubNext,githubResponse} from '../../src/infra/github-response.ts'
const response=(headers:Record<string,string>,status=200)=>({status,headers,body:'[]'})
it('recomputes the next permit after learning a slower primary rate',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{
 const b=new GithubPollBudget();const signal=new AbortController().signal
 await b.before(signal)
 // reserve10, available1 over10seconds =>0.1rps, not10rps
 b.after(response({'x-ratelimit-remaining':'11','x-ratelimit-limit':'100','x-ratelimit-reset':'110'}))
 let granted=false;const next=b.before(signal).then(()=>{granted=true})
 await vi.advanceTimersByTimeAsync(100);expect(granted).toBe(false)
 await vi.advanceTimersByTimeAsync(9900);await next
 }finally{vi.useRealTimers()}
})
it('never silently treats valid next relation variants as pagination complete',()=>{
 for(const rel of ['rel=next','rel="prev next"','rel="next prev"']){
 expect(githubNext({link:`<https://api.github.com/repos/acme/widgets/issues/2/comments?page=2>; ${rel}`},'acme/widgets')).toBe('issues/2/comments?page=2')
 }
})
it('accepts repeated harmless HTTP headers without ignoring ambiguous rate headers',()=>{
 expect(githubResponse('HTTP/2.0 200 OK\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\n[]').body).toBe('[]')
 expect(()=>githubResponse('HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 1\r\nx-ratelimit-remaining: 2\r\n\r\n[]')).toThrow()
})
it('refuses malformed Link metadata rather than silently checkpointing an incomplete list',()=>{
 expect(()=>githubNext({link:'<https://api.github.com/repos/acme/widgets/issues/2/comments?page=2; rel="next"'},'acme/widgets')).toThrow()
})
it('honors a server poll interval when supplied on a response',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{const b=new GithubPollBudget(),s=new AbortController().signal;await b.before(s);b.after(response({'x-poll-interval':'2'}));let done=false;const p=b.before(s).then(()=>{done=true});await vi.advanceTimersByTimeAsync(100);expect(done).toBe(false);await vi.advanceTimersByTimeAsync(1900);await p}finally{vi.useRealTimers()}
})
it('does not replenish same-window reservations from an out-of-order response',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 try{const b=new GithubPollBudget(),s=new AbortController().signal
 b.after(response({'x-ratelimit-remaining':'10','x-ratelimit-limit':'100','x-ratelimit-reset':'110'}))
 b.after(response({'x-ratelimit-remaining':'99','x-ratelimit-limit':'100','x-ratelimit-reset':'110'}))
 let done=false;const p=b.before(s).then(()=>{done=true});await vi.advanceTimersByTimeAsync(9999);expect(done).toBe(false);await vi.advanceTimersByTimeAsync(1);await p
 }finally{vi.useRealTimers()}
})
it.each(['https://api.github.com.evil.test/repos/acme/widgets/x','https://u:p@api.github.com/repos/acme/widgets/x','https://api.github.com/repos/acme/widgets-evil/x','https://api.github.com/repos/acme/widgets/x#fragment','https://api.github.com/repos/acme/widgets/%2e%2e/other/x'])('rejects hostile next link %s',url=>{
 expect(()=>githubNext({link:`<${url}>; rel=next`},'acme/widgets')).toThrow()
})
