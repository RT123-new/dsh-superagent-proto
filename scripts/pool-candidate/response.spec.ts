import {it,expect} from 'vitest'
import {githubResponse,githubNext} from '../../src/infra/github-response.ts'
it('parses actual included HTTP blocks without trusting JSON body headers',()=>{
  const r=githubResponse('HTTP/2.0 429 Too Many Requests\r\nRetry-After: 120\r\nX-RateLimit-Remaining: 0\r\n\r\n{"status":200}')
  expect(r.status).toBe(429);expect(r.headers['retry-after']).toBe('120');expect(r.body).toBe('{"status":200}')
})
it.each(['{"status":429}', 'HTTP/2.0 200 OK\nRetry-After: 2\nretry-after: 5\n\n[]', 'HTTP/2.0 200 OK\n invalid folded\n\n[]'])('rejects malformed or ambiguous header output',raw=>expect(()=>githubResponse(raw)).toThrow())
it('preserves exact body bytes and accepts LF header separators',()=>expect(githubResponse('HTTP/1.1 200 OK\nETag: x\n\n\n[]\n').body).toBe('\n[]\n'))
it('follows configured repository Link and rejects foreign destinations',()=>{
  expect(githubNext({link:'<https://api.github.com/repos/acme/widgets/issues/2/comments?page=2>; rel="next"'},'acme/widgets')).toBe('issues/2/comments?page=2')
  for(const u of ['https://evil.example/repos/acme/widgets/issues','https://api.github.com/repos/other/widgets/issues','https://api.github.com/repos/acme/widgets/../other/issues'])
    expect(()=>githubNext({link:`<${u}>; rel="next"`},'acme/widgets')).toThrow()
})
