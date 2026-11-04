/**
 * Issue 12 — repeated CLI process launches: offline transport benchmark.
 * Part A (spawn): fixed process cost of the real gh binary (`gh --version`, no network, no credentials) versus a
 *   minimal native process and a node process, establishing the per-call CLI startup overhead that Commands pays on
 *   every API call.
 * Part B (paired): the production Commands transport driving the stub gh executable versus the candidate HttpClient
 *   driving a loopback stub server, both with identical fixed simulated server latency and identical canned payloads.
 *   Paired by iteration; 10,000-sample paired bootstrap per mandate 9.2. Latency is labelled simulated.
 * Part C (semantics): error mapping (404), ETag/304, repository scoping, and AbortSignal cancellation on both sides.
 * Usage: node bench.ts <spawn|pair|semantics> [iterations]
 */
import { writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { Commands, CliError } from '../../../src/infra/commands.ts'
import { testDeployment } from '../../../tests/fixtures/deployment.ts'
import { rng, pairedBootstrap, percentileOf } from '../lib/index.ts'
import { HttpClient } from './http-client.ts'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { notifications, issue, commentsPages, ETAG } = require('./fixture.cjs') as {
  notifications: unknown[]; issue: (n: number) => unknown; commentsPages: unknown[][]; ETAG: string }

const LATENCY_MS = Number(process.env.STUB_LATENCY_MS ?? 60)
const ITERATIONS = Number(process.argv[3] ?? 200)
const STUB_GH = new URL('./stub-gh.cjs', import.meta.url).pathname

const timed = async (work: () => Promise<unknown>): Promise<number> => {
  const start = performance.now()
  await work()
  return performance.now() - start
}

async function spawn(): Promise<void> {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  const rounds: Record<string, number[]> = { 'bin-true': [], 'node-version': [], 'gh-version': [] }
  for (let index = 0; index < ITERATIONS; index++) {
    rounds['bin-true']!.push(await timed(() => commands.run('/bin/true', [])))
    rounds['node-version']!.push(await timed(() => commands.run(process.execPath, ['--version'])))
    rounds['gh-version']!.push(await timed(() => commands.run('gh', ['--version'])))
  }
  for (const [label, values] of Object.entries(rounds))
    console.log(JSON.stringify({ part: 'spawn', workload: label, iterations: values.length,
      p50: percentileOf(values, 0.5), p95: percentileOf(values, 0.95), mean: values.reduce((a, b) => a + b) / values.length }))
}

function stubServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    setTimeout(() => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const bare = url.pathname.replace(/^\/repos\/acme\/widgets\/?/, '')
      if (bare === 'missing') { response.writeHead(404).end('Not Found'); return }
      if (bare === 'notifications' && request.headers['if-none-match'] === ETAG) { response.writeHead(304).end(); return }
      let body: unknown = []
      if (bare === 'notifications') body = notifications
      else if (/^issues\/\d+$/.test(bare)) body = issue(Number(bare.split('/')[1]))
      else if (/^issues\/\d+\/comments$/.test(bare)) {
        const page = Number(url.searchParams.get('page') ?? '1')
        body = commentsPages[page - 1] ?? []
        if (page < commentsPages.length)
          response.setHeader('link', `<http://localhost/comments?page=${page + 1}>; rel="next"`)
      }
      response.writeHead(200, { 'content-type': 'application/json', etag: ETAG, 'x-poll-interval': '60' })
        .end(JSON.stringify(body))
    }, LATENCY_MS)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
  }))
}

async function pair(): Promise<void> {
  const { server, port } = await stubServer()
  const deployment = testDeployment({ github: { cli: STUB_GH, login: 'agent-bot', noreply: 'x' } })
  const commands = new Commands(() => deployment, { STUB_LATENCY_MS: String(LATENCY_MS) }, new AbortController().signal)
  const client = new HttpClient(`http://127.0.0.1:${port}`, 'acme/widgets', 'stage-d-dummy-token')
  const CommentList = z.looseObject({ id: z.number() })
  const workloads: Record<string, { cli: () => Promise<unknown>; http: () => Promise<unknown> }> = {
    'notifications-include': {
      cli: () => commands.api('notifications?all=true&per_page=50', '--include'),
      http: () => client.apiRaw('notifications?all=true&per_page=50') },
    'issue-schema': {
      cli: () => commands.api(z.looseObject({ number: z.number() }), 'issues/12'),
      http: () => client.api(z.looseObject({ number: z.number() }), 'issues/12') },
    'comments-paginated': {
      cli: () => commands.pages(CommentList, 'issues/12/comments?per_page=100'),
      http: () => client.pages(CommentList, 'issues/12/comments?per_page=100') },
  }
  const only = process.argv[4]
  for (const [workload, pair] of Object.entries(workloads)) {
    if (only && workload !== only) continue
    const cliTimes: number[] = []
    const httpTimes: number[] = []
    for (let index = 0; index < ITERATIONS; index++) {
      if (index % 2 === 0) { cliTimes.push(await timed(pair.cli)); httpTimes.push(await timed(pair.http)) }
      else { httpTimes.push(await timed(pair.http)); cliTimes.push(await timed(pair.cli)) }
    }
    if (process.env.RAW_OUT) writeFileSync(process.env.RAW_OUT, JSON.stringify({workload, latencyMs: LATENCY_MS, cliTimes, httpTimes}, null, 2))
    const result = pairedBootstrap(cliTimes, httpTimes, rng(1000 + workload.length), 10_000, 'p95')
    console.log(JSON.stringify({ part: 'pair', workload, latencyMs: LATENCY_MS, iterations: ITERATIONS,
      cliP50: percentileOf(cliTimes, 0.5), httpP50: percentileOf(httpTimes, 0.5),
      cliP95: percentileOf(cliTimes, 0.95), httpP95: percentileOf(httpTimes, 0.95),
      statistic: 'p95', relativeImprovement: result.relativeImprovement, ci: [result.ciLow, result.ciHigh], bootstrap: result.bootstrapSamples }))
  }
  server.close()
}

async function semantics(): Promise<void> {
  const { server, port } = await stubServer()
  const deployment = testDeployment({ github: { cli: STUB_GH, login: 'agent-bot', noreply: 'x' } })
  const commands = new Commands(() => deployment, { STUB_LATENCY_MS: String(LATENCY_MS) }, new AbortController().signal)
  const client = new HttpClient(`http://127.0.0.1:${port}`, 'acme/widgets', 'stage-d-dummy-token')
  const checks: [string, () => Promise<boolean>][] = [
    ['404 -> CliError code 404 (cli)', async () => await commands.api('missing').then(() => false, e => e instanceof CliError && e.code === 404)],
    ['404 -> CliError code 404 (http)', async () => await client.apiRaw('missing').then(() => false, e => e instanceof CliError && e.code === 404)],
    ['ETag 304 -> CliError code 304 (cli)', async () => await commands.api('notifications', '--include', '-H', `If-None-Match: ${ETAG}`).then(() => false, e => e instanceof CliError && e.code === 304)],
    ['ETag 304 -> CliError code 304 (http)', async () => await client.apiRaw('notifications', ETAG).then(() => false, e => e instanceof CliError && e.code === 304)],
    ['scoping rejects absolute path (cli)', async () => await commands.api('/orgs/other').then(() => false, e => /restricted/.test(String(e)))],
    ['scoping rejects absolute path (http)', async () => await client.apiRaw('/orgs/other').then(() => false, e => /restricted/.test(String(e)))],
    ['scoping rejects traversal (http)', async () => await client.apiRaw('../../etc').then(() => false, e => /restricted/.test(String(e)))],
    ['cancellation aborts in-flight (cli)', async () => {
      const slow = new Commands(() => deployment, { STUB_LATENCY_MS: '2000' }, new AbortController().signal)
      const controller = new AbortController()
      const pending = slow.withSignal(controller.signal).api('issues/12')
      setTimeout(() => controller.abort(), 25)
      const start = performance.now()
      return pending.then(() => false, () => performance.now() - start < 1000) }],
    ['cancellation aborts in-flight (http)', async () => {
      const controller = new AbortController()
      const slowClient = new HttpClient(`http://127.0.0.1:${port}`, 'acme/widgets', 'stage-d-dummy-token', controller.signal)
      const pending = slowClient.apiRaw('notifications')
      setTimeout(() => controller.abort(), 25)
      const start = performance.now()
      return pending.then(() => false, () => performance.now() - start < 1000) }],
  ]
  let failed = 0
  for (const [name, check] of checks) {
    const ok = await check()
    if (!ok) failed += 1
    console.log(JSON.stringify({ part: 'semantics', check: name, ok }))
  }
  server.close()
  if (failed) process.exit(1)
}

const part = process.argv[2]
if (part === 'spawn') await spawn()
else if (part === 'pair') await pair()
else if (part === 'semantics') await semantics()
else throw new Error('usage: node bench.ts <spawn|pair|semantics> [iterations]')
