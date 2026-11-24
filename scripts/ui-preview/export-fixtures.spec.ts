// @vitest-environment jsdom
/** Export the real typed test-server response contracts for an isolated UI preview. */
import { it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Metrics } from '../../src/infra/metrics.ts'
import type { TicketPageView } from '../../src/client/api.ts'
import { server, ticketSummary, threadSummary, trigger, usePanelServer } from '../../tests/fixtures/panel-server.ts'

usePanelServer(() => {})
it('exports deterministic preview data from the panel contract fixture', async () => {
  const at = '2026-11-24T10:30:00.000Z'
  server.setup.accounts!.repository = 'RT123-new/dsh-superagent-proto'
  server.setup.accounts!.agent = 'superagent'
  server.settings.executor.maxWorkers = 4
  server.settings.policy.rules = [{ id: 'copy', name: 'Small, explicit fixes', enabled: true, instruction: 'Fix clearly reported regressions within the authorized scope.' }]
  server.health.github = { state: 'ready', detail: '' }
  server.health.feishu = { state: 'error', detail: 'Connection interrupted. Retrying the event stream.' }
  const review = ticketSummary({ id: 't-review', title: 'Confirm the release approach', updatedAt: at,
    createdAt: '2026-11-24T09:45:00.000Z', summary: 'The patch is ready for your decision.', sessionId: 'worker-review',
    attention: { id: 'q-release', question: 'Should the new recovery flow remain off by default for this release?' },
    note: { text: 'The patch and checks are complete. A release decision is needed before work can continue.', error: false },
    threads: [{ key: 'github:42', source: 'github', title: '#42 Recovery flow', url: 'https://example.invalid/pull/42',
      facts: { number: { value: '#42' }, ci: { label: { en: 'Checks passed', zh: '检查通过' }, value: '12' } } }],
    reply: { source: 'github', url: 'https://example.invalid/issues/42', label: { en: 'GitHub conversation', zh: 'GitHub 对话' } },
  }, { stage: 'person', action: 'answer' })
  const work = ticketSummary({ id: 't-ui', title: 'Improve keyboard navigation', summary: 'Checking focus order and dialog return targets.',
    updatedAt: at, createdAt: '2026-11-24T10:10:00.000Z', sessionId: 'worker-ui',
    threads: [{ key: 'github:51', source: 'github', title: '#51 Keyboard navigation', facts: { number: { value: '#51' } } }] })
  const checks = ticketSummary({ id: 't-checks', title: 'Verify receipt persistence', summary: 'Running the delivery regression suite.',
    updatedAt: at, createdAt: '2026-11-24T10:20:00.000Z', sessionId: 'worker-checks',
    threads: [{ key: 'github:53', source: 'github', title: '#53 Delivery checks', facts: { number: { value: '#53' } } }] })
  const waiting = ticketSummary({ id: 't-queue', title: 'Document the retry policy', summary: 'Waiting for the next available worker.',
    updatedAt: at, sessionId: '', threads: [], assignments: 1 }, { stage: 'working', action: 'queued' })
  const done = ticketSummary({ id: 't-done', title: 'Preserve cancelled report boundaries', state: 'ended',
    actions: { stop: false, retry: false }, summary: 'Cancellation regressions pass.', updatedAt: at,
    ended: { at, by: 'executor', outcome: 'completed' }, threads: [] }, { stage: 'ended' })
  server.person = [review]
  server.tickets = { open: [review, work, checks, waiting], ended: [done] }
  const original = server.ticketDetails.t1!
  server.ticketDetails = Object.fromEntries([...server.tickets.open, done].map(ticket => {
    const assignment: TicketPageView['assignments'][number] = ticket.stage === 'working' && ticket.action === 'queued'
      ? { id: 'assignment-' + ticket.id, state: 'pending', createdAt: ticket.createdAt }
      : { id: 'assignment-' + ticket.id, state: ticket.stage === 'ended' ? 'ended' : 'running',
        createdAt: ticket.createdAt, startedAt: ticket.createdAt,
        report: { state: ticket.stage === 'person' ? 'blocked' : 'progress', summary: ticket.summary, at } }
    return [ticket.id, {
      ...original, ...ticket, threads: [],
      mandate: { ...original.mandate, scope: ticket.summary },
      inputs: [], environment: [], channels: [], assignments: [assignment],
    } satisfies TicketPageView]
  }))
  server.threads = [threadSummary({ title: 'Recovery flow and release decision', key: 'github:42', source: 'github',
    url: 'https://example.invalid/issues/42', lastAt: at, createdAt: review.createdAt,
    facts: { number: { value: '#42' } }, tickets: [{ id: review.id, title: review.title, state: 'open' }] }),
    threadSummary({ title: 'Keyboard navigation in the workspace', key: 'github:51', source: 'github', lastAt: at,
      facts: { number: { value: '#51' } }, tickets: [{ id: work.id, title: work.title, state: 'open' }] })]
  const snapshots: Record<string, unknown> = {}
  const paths = ['state', 'overview', 'sources', 'settings', 'tickets', 'tickets?state=ended', 'threads', 'decisions',
    'effects/blocked', 'policy/history', 'models', 'prompts']
  for (const ticket of [...server.tickets.open, done]) paths.push('tickets/' + ticket.id)
  for (const path of paths) {
    const response = await fetch('/orchestrator/api/' + path)
    expect(response.status).toBe(200)
    snapshots[path] = JSON.parse(await response.text())
  }
  const overview = snapshots.overview as any
  overview.problems = overview.problems.filter((problem: any) => problem.kind === 'source-error')
  overview.executor = { running: 2, queued: 1, maxWorkers: 4, idle: 1 }
  overview.flow = { received: 128, filtered: 35, triggers: 93, judged: 84, accepted: 8, evaluating: 0, dropped: 0 }
  ;(snapshots.state as any).load = { running: 2, queued: 1, maxWorkers: 4 }
  let mono = 0
  const metrics = new Metrics({ mono: () => mono, wall: () => Date.parse(at) + mono, window: 128 })
  const durations = [['worker_turn', 'internal', 3840], ['eval_run', 'github', 1250], ['workspace_prepare', 'github', 680],
    ['tool_run', 'internal', 320], ['receipt_to_response', 'internal', 180], ['eval_queue_wait', 'github', 24]] as const
  for (const [stage, source, duration] of durations) for (let i = 0; i < 16; i++) metrics.observe(stage, source, duration * (0.65 + i / 30))
  metrics.observe('eval_run', 'feishu', 14_000, 'failure')
  metrics.recordUsage({ inputCacheHit: 12000, inputCacheMiss: 36000, output: 8100 })
  const queue = metrics.queue('assignment'); queue.enqueue('t-queue'); mono = 5000
  overview.metrics = metrics.snapshot(); overview.metricsState = 'ok'
  for (const source of snapshots.sources as any[]) source.stats.lastAt = at
  for (const decision of (snapshots.decisions as any).items) {
    decision.at = at; decision.preview = 'Please verify the recovery flow before release.'
  }
  for (const thread of server.threads) snapshots['threads/' + thread.key] = {
    ...thread, tickets: server.tickets.open.filter(ticket => ticket.threads.some(item => item.key === thread.key)),
    correlated: [], decisions: [], context: [], earlier: null,
    timeline: [trigger('preview-message', at, { source: 'github', text: 'Please check this change and report the result.',
      preview: 'Please check this change and report the result.', threads: [thread.key] })],
  }
  const dir = resolve('scripts/ui-preview')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'fixtures.json'), JSON.stringify(snapshots, null, 2) + '\n')
})
