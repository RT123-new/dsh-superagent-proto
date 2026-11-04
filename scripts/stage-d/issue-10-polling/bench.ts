/**
 * Issue 10 — sequential polling: offline workload benchmark.
 * Runs the REAL pollRound (reviewed/correctness-stage-b) once per (workload, seed) against an instrumented mock
 * transport that records each request's conversation, phase and seeded service time without sleeping. The recorded
 * trace gives the synthetic sequential service-time sum (not measured network time); bounded-pool projections for C=2/4/8 come
 * from replaying that exact trace with per-conversation order preserved and phase barriers kept (lib/timeline.ts).
 * Projections are labelled simulated; adoption needs a real pooled implementation measured the same way.
 * Rate-gated projections apply the mandate's reserve formula: R_reserve = max(10, ceil(0.10 L)),
 * r = max(0, (R - R_reserve) / max(1, t_reset - t_now)) requests/second.
 * Usage: node --experimental-transform-types bench.ts [seeds]
 */
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { pollRound } from '../../../src/sources/github.ts'
import { sourceHost, closeHost, hostDir, type BenchHost as SourceHost } from '../lib/host.ts'
import { createRequire } from 'node:module'
const { issue, comment } = createRequire(import.meta.url)('../issue-12-transport/fixture.cjs')
const githubIssue = (n: number, fields: Record<string, unknown> = {}) => ({ ...issue(n), ...fields })
const githubComment = (id: number, number: number, at: string) => ({ ...comment(id, number), created_at: at, updated_at: at })
import { rng, latencyMs, simulatePool, pairedBootstrap, percentileOf, type RequestRecord } from '../lib/index.ts'

const SEEDS = Number(process.argv[2] ?? 200)
const LATENCY_BASE_MS = 60
const LATENCY_SPREAD_MS = 40

interface Workload { notifications: number; subscribedThreads: number; streamItems: number; failConversation?: number }
const WORKLOADS: Workload[] = [
  { notifications: 10, subscribedThreads: 0, streamItems: 3 },
  { notifications: 25, subscribedThreads: 0, streamItems: 3 },
  { notifications: 50, subscribedThreads: 0, streamItems: 3 },
  { notifications: 10, subscribedThreads: 10, streamItems: 3 },
  { notifications: 25, subscribedThreads: 25, streamItems: 3 },
  // Failure injection: conversation 107's issue read fails once; unrelated conversations must still complete.
  { notifications: 25, subscribedThreads: 0, streamItems: 3, failConversation: 107 },
]

function instrument(h: SourceHost, workload: Workload, random: () => number): RequestRecord[] {
  h.commands.withSignal = () => h.commands
  h.store.set('github-since', new Date(Date.now() - 60_000).toISOString())
  const now = Date.now() + 1000 // after the first-observation boundary; fixture-only event time
  const notifications = Array.from({ length: workload.notifications }, (_, index) => {
    const number = 100 + index
    return { id: `n${number}`, updated_at: new Date(now).toISOString(), number }
  })
  const issues: Record<number, Record<string, unknown>> = {}
  const comments: Record<number, Record<string, unknown>[]> = {}
  for (const { number } of notifications) {
    issues[number] = githubIssue(number, { created_at: new Date(now).toISOString() })
    comments[number] = [githubComment(number * 10 + 1, number, new Date(now).toISOString()),
      githubComment(number * 10 + 2, number, new Date(now).toISOString())]
  }
  for (let index = 0; index < workload.subscribedThreads; index++) {
    const number = 500 + index
    issues[number] = githubIssue(number)
    comments[number] = [githubComment(number * 10 + 1, number, new Date(now).toISOString())]
    h.store.threads.save({ key: `github:${number}`, ref: { source: 'github', id: String(number) },
      createdAt: new Date(now).toISOString(), subscriptions: ['ticket'], correlated: [], pending: [],
      meta: { isPr: false, title: `Issue ${number}` } })
  }
  const stream = Array.from({ length: workload.streamItems }, (_, index) =>
    githubIssue(900 + index, { created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }))
  const trace: RequestRecord[] = []
  let seq = 0
  h.commands.run = async (_program: string, argv: string[]) => {
    const raw = argv[1]!
    const serviceMs = latencyMs(random, LATENCY_BASE_MS, LATENCY_SPREAD_MS)
    const bare = raw.replace(/^repos\/acme\/widgets\//, '').split('?')[0]!
    const threadMatch = /^issues\/(\d+)/.exec(bare)
    const conversation = bare === 'notifications' ? 'shared:notifications'
      : bare === 'issues' ? 'stream:issues'
      : bare === 'issues/comments' ? 'stream:comments'
      : bare === 'pulls/comments' ? 'stream:review-comments'
      : threadMatch ? `thread:${threadMatch[1]}`
      : `other:${bare}`
    const phase = bare === 'notifications' ? 'notifications:scan'
      : conversation.startsWith('thread:') && trace.some(r => r.phase === 'notifications:scan') && !trace.some(r => r.phase.startsWith('repository')) && !trace.some(r => r.phase === 'threads')
        ? (bare === 'notifications' ? 'notifications:scan' : 'notifications:read')
      : conversation.startsWith('stream:') ? 'repository:streams'
      : conversation.startsWith('thread:') ? 'threads'
      : 'other'
    trace.push({ seq: seq++, label: raw, conversation, serviceMs, startedMs: 0, endedMs: 0,
      failed: false, phase })
    // Response fixtures, mirroring tests/fixtures/source-host.ts githubServer with seeded latency recorded.
    if (bare === 'notifications') {
      const since = decodeURIComponent(/[?&]since=([^&]+)/.exec(raw)?.[1] ?? '')
      const visible = notifications.map(item => ({ id: item.id, updated_at: item.updated_at, reason: 'mention',
        repository: { full_name: 'acme/widgets' },
        subject: { url: `https://api.github.com/repos/acme/widgets/issues/${item.number}`, type: 'Issue', title: `Issue ${item.number}` } }))
        .filter(item => !since || item.updated_at > since)
      return `HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\n\r\n${JSON.stringify(visible)}`
    }
    const issueMatch = /^issues\/(\d+)$/.exec(bare)
    if (issueMatch) {
      const number = Number(issueMatch[1])
      if (workload.failConversation === number) { trace.at(-1)!.failed = true; throw new Error('gh: HTTP 502') }
      return JSON.stringify(issues[number])
    }
    const commentsMatch = /^issues\/(\d+)\/comments$/.exec(bare)
    if (commentsMatch) {
      const list = comments[Number(commentsMatch[1])] ?? []
      return JSON.stringify(argv.includes('--slurp') ? [list] : list)
    }
    if (bare === 'issues/comments' || bare === 'pulls/comments') return 'HTTP/2.0 200 OK\r\n\r\n[]'
    if (bare === 'issues') return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(stream)}`
    return JSON.stringify(argv.includes('--slurp') ? [[]] : [])
  }
  return trace
}

interface RunResult { workload: Workload; seed: number; requests: number; sequentialMs: number; wallMs: number;
  triggers: number; failedRound: boolean; projections: Record<string, number>; gatedMs?: number }

async function run(workload: Workload, seed: number): Promise<RunResult> {
  const random = rng(seed)
  const h = sourceHost(hostDir('issue10-'))
  h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources,
    github: { enabled: true, config: { observeIssues: true, observeComments: true, reconcileMinutes: 0 } } } })
  const trace = instrument(h, workload, random)
  const start = performance.now()
  let failedRound = false
  try { await pollRound(h) } catch { failedRound = true }
  const wallMs = performance.now() - start
  const sequentialMs = trace.reduce((sum, record) => sum + record.serviceMs, 0)
  const phases = [...new Set(trace.map(record => record.phase))]
  const projections: Record<string, number> = {}
  for (const c of [1, 2, 4, 8]) {
    let completion = 0
    for (const phase of phases) {
      const slice = trace.filter(record => record.phase === phase)
      completion += simulatePool(slice, { concurrency: c }).completionMs
    }
    projections[`C${c}`] = completion
  }
  // Rate-gated C=8: mandate reserve formula with L=5000, R drawn in [2000, 5000], 1800s left in the window.
  const L = 5000
  const R = 2000 + Math.floor(random() * 3000)
  const reserve = Math.max(10, Math.ceil(0.10 * L))
  const rate = Math.max(0, (R - reserve) / 1800)
  let gated = 0
  for (const phase of phases)
    gated += simulatePool(trace.filter(record => record.phase === phase), { concurrency: 8, ratePerSecond: rate }).completionMs
  const result: RunResult = { workload, seed, requests: trace.length, sequentialMs, wallMs,
    triggers: h.results.filter(result => result === 'stored').length, failedRound, projections, gatedMs: gated }
  closeHost(h)
  return result
}

const results: RunResult[] = []
for (const workload of WORKLOADS)
  for (let seed = 1; seed <= SEEDS; seed++) results.push(await run(workload, seed))

if (process.env.RAW_OUT) writeFileSync(process.env.RAW_OUT, JSON.stringify(results, null, 2))
const baseline = results.map(result => result.sequentialMs)
for (const c of [1, 2, 4, 8]) {
  const variant = results.map(result => result.projections[`C${c}`]!)
  const paired = pairedBootstrap(baseline, variant, rng(7000 + c), 10_000, 'p95')
  console.log(JSON.stringify({ issue: 10, comparison: `sequential vs pool C=${c}`, pairs: paired.pairs,
    baselineMeanMs: paired.baselineMean, variantMeanMs: paired.variantMean,
    relativeImprovement: paired.relativeImprovement, ci: [paired.ciLow, paired.ciHigh], bootstrap: paired.bootstrapSamples,
    statistic: 'p95', simulatedBaselineServiceTimes: true, simulatedVariant: true }))
}
{
  const variant = results.map(result => result.gatedMs!)
  const paired = pairedBootstrap(baseline, variant, rng(7999), 10_000, 'p95')
  console.log(JSON.stringify({ issue: 10, comparison: 'UNGATED baseline vs GATED C=8 sensitivity ONLY (not fair adoption comparison)',
    pairs: paired.pairs, baselineMeanMs: paired.baselineMean, variantMeanMs: paired.variantMean,
    relativeImprovement: paired.relativeImprovement, ci: [paired.ciLow, paired.ciHigh], bootstrap: paired.bootstrapSamples,
    statistic: 'p95', simulatedBaselineServiceTimes: true, simulatedVariant: true }))
}
// Correctness instrumentation on the real runs.
const failed = results.filter(result => result.workload.failConversation !== undefined)
const intact = results.filter(result => result.workload.failConversation === undefined)
console.log(JSON.stringify({ issue: 10, correctness: {
  roundsRun: results.length, requestsTotal: results.reduce((sum, result) => sum + result.requests, 0),
  triggersPerIntactRun: percentileOf(intact.map(result => result.triggers), 0.5),
  failedRunsReportFailure: failed.every(result => result.failedRound),
  failedRunsStillIngest: failed.every(result => result.triggers === 3 * (result.workload.notifications - 1) + result.workload.streamItems + result.workload.subscribedThreads),
  intactExactDenominator: intact.every(result => result.triggers === 3 * result.workload.notifications + result.workload.streamItems + result.workload.subscribedThreads),
  failedRunTriggersMedian: percentileOf(failed.map(result => result.triggers), 0.5),
  c1SimulationEqualsSequential: results.every(result => Math.abs(result.projections.C1! - result.sequentialMs) < 1e-6) } }))
