/**
 * In-memory Source host for the ingestion reliability regression tests (Issues 1-3), with scripted GitHub and Feishu API
 * servers that honor `since` filters and pagination so late delivery, bursts and failures are simulated faithfully.
 * Unlike tests/fixtures/host.ts (full Runtime), this builds the lighter SourceContext the polling loops run against.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Engine, type Assessor, type Executor, type Trigger } from '../../src/core/index.ts'
import { Store } from '../../src/app/store.ts'
import { SettingsSchema, settingsPolicy } from '../../src/policy.ts'
import { SourceRegistry } from '../../src/sources/registry.ts'
import { feishuKind } from '../../src/sources/feishu.ts'
import { githubKind } from '../../src/sources/github.ts'
import { Commands } from '../../src/infra/commands.ts'

/** Pins `withSignal` to the instance whose transport is mocked, so loops given an AbortSignal still hit the mock. */
export function pinCommands(h: SourceHost): void {
  vi.spyOn(h.commands, 'withSignal').mockReturnValue(h.commands as Commands)
}
import { HealthBoard } from '../../src/infra/health.ts'
import { sourceContextOf, type SourceContextDeps } from '../../src/app/source-context.ts'
import { testDeployment } from './deployment.ts'
import type { ReceiveResult } from '../../src/core/index.ts'

/** Builds a SourceContext on a real SQLite store under `dir`, registering both Source kinds, and records ingest results. */
export function sourceHost(dir: string, overrides: Partial<SourceContextDeps> = {}) {
  const store = new Store(join(dir, 'db.sqlite'))
  const settings = SettingsSchema.parse({ policy: { sources: { feishu: { allowed: [{ id: 'ou_alice', name: 'Alice' }] },
      github: { allowed: [{ id: 'alice' }] } } }, eval: { mode: 'auto' },
    sources: { feishu: { enabled: true, config: { chats: [{ chatId: 'oc_team', listen: 'mentions' },
      { chatId: 'oc_observed', listen: 'all' }], directMessages: true } } } })
  store.saveSettings(settings)
  const board = new HealthBoard()
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(feishuKind)
  sources.register(githubKind)
  const deployment = overrides.deployment ?? testDeployment()
  const assessor: Assessor = { request: vi.fn(async () => {}) }
  const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const results: ReceiveResult[] = []
  const receive = vi.fn(async (trigger: Trigger) => {
    const result = engine.receive(trigger)
    results.push(result)
    engine.evaluateDue()
    return result
  })
  const parts: SourceContextDeps = { store, engine, outbox: { send: () => {} }, commands, sources, deployment,
    ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  const context = sourceContextOf(parts, { kind: 'github', health: ['github', 'feishu', 'history'] })
  return { dir, ...parts, ...context, health: board.all, store, engine, commands, receive, results }
}
export type SourceHost = ReturnType<typeof sourceHost>

export function hostDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function closeHost(h: SourceHost): void {
  h.store.close()
  rmSync(h.dir, { recursive: true, force: true })
}

/** A GitHub notification as the API lists it, naming the Issue or PR its subject addresses. */
export interface MockNotification { id: string; updated_at: string; number: number; pr?: boolean }

export interface GithubServer {
  notifications: MockNotification[]
  issues: Record<number, Record<string, unknown>>
  comments: Record<number, Record<string, unknown>[]>
  failPaginateOnce?: boolean
}

export const githubIssue = (number: number, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1000 + number, number, title: `Issue ${number}`, body: 'details', state: 'open',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  html_url: `https://github.com/acme/widgets/issues/${number}`, user: { login: 'carol', type: 'User' }, ...fields })

export const githubComment = (id: number, number: number, at: string, body = '@agent-bot take this'): Record<string, unknown> =>
  ({ id, body, user: { login: 'alice', type: 'User' },
    html_url: `https://github.com/acme/widgets/issues/${number}#issuecomment-${id}`, created_at: at, updated_at: at })

/**
 * Stubs `gh api` against acme/widgets, filtering notifications by `since` (strictly after, as GitHub documents) and
 * paginating notifications at 50 per page. `failPaginateOnce` makes the first `--paginate` call fail once.
 */
export function githubServer(h: SourceHost, server: GithubServer): string[] {
  pinCommands(h)
  const reads: string[] = []
  let paginateFailures = server.failPaginateOnce ? 1 : 0
  const toNotification = (item: MockNotification) => ({ id: item.id, updated_at: item.updated_at, reason: 'mention',
    repository: { full_name: 'acme/widgets' },
    subject: { url: `https://api.github.com/repos/acme/widgets/${item.pr ? 'pulls' : 'issues'}/${item.number}`,
      type: item.pr ? 'PullRequest' : 'Issue', title: `Issue ${item.number}` } })
  vi.spyOn(h.commands, 'run').mockImplementation(async (_program, args) => {
    const raw = args[1]!
    reads.push(raw)
    const bare = raw.replace(/^repos\/acme\/widgets\//, '').split('?')[0]!
    if (bare === 'notifications') {
      const since = decodeURIComponent(/[?&]since=([^&]+)/.exec(raw)?.[1] ?? '')
      const visible = server.notifications.map(toNotification).filter(item => !since || item.updated_at > since)
      if (args.includes('--paginate')) {
        if (paginateFailures-- > 0) throw new Error('gh: HTTP 502')
        const page = Number(/[?&]page=(\d+)/.exec(raw)?.[1] ?? '1')
        const chunks: unknown[][] = []
        for (let index = (page - 1) * 50; index < visible.length; index += 50) chunks.push(visible.slice(index, index + 50))
        return JSON.stringify(chunks.length ? chunks : [[]])
      }
      const first = visible.slice(0, 50)
      const link = visible.length > 50 ? '\r\nLink: <https://api.github.com/notifications?page=2>; rel="next"' : ''
      return `HTTP/2.0 200 OK\r\nX-Poll-Interval: 60${link}\r\n\r\n${JSON.stringify(first)}`
    }
    const issue = /^issues\/(\d+)$/.exec(bare)
    if (issue) {
      const value = server.issues[Number(issue[1])]
      if (value instanceof Error) throw value
      return JSON.stringify(value)
    }
    const comments = /^issues\/(\d+)\/comments$/.exec(bare)
    if (comments) {
      const list = server.comments[Number(comments[1])] ?? []
      return JSON.stringify(args.includes('--slurp') ? [list] : list)
    }
    return JSON.stringify(args.includes('--slurp') ? [[]] : [])
  })
  return reads
}

/** Stubs the repository-wide `issues` event stream, paginating at 100 per page with RFC-5988 Link headers. */
export function streamServer(h: SourceHost, items: Record<string, unknown>[], options: { failPaginateOnce?: boolean } = {}): string[][] {
  pinCommands(h)
  const reads: string[][] = []
  let paginateFailures = options.failPaginateOnce ? 1 : 0
  vi.spyOn(h.commands, 'run').mockImplementation(async (_program, args) => {
    const raw = args[1]!
    reads.push(args)
    const bare = raw.replace(/^repos\/acme\/widgets\//, '').split('?')[0]!
    if (bare === 'notifications') return 'HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\n\r\n[]'
    if (bare === 'issues') {
      const page = Number(/[?&]page=(\d+)/.exec(raw)?.[1] ?? '1')
      if (args.includes('--paginate')) {
        if (paginateFailures-- > 0) throw new Error('gh: HTTP 502')
        const chunks: Record<string, unknown>[][] = []
        for (let index = (page - 1) * 100; index < items.length; index += 100) chunks.push(items.slice(index, index + 100))
        return JSON.stringify(chunks.length ? chunks : [[]])
      }
      const first = items.slice(0, 100)
      const link = items.length > 100 ? '\r\nLink: <https://api.github.com/issues?page=2>; rel="next"' : ''
      return `HTTP/2.0 200 OK${link}\r\n\r\n${JSON.stringify(first)}`
    }
    if (bare.endsWith('/check-runs')) return JSON.stringify(args.includes('--slurp') ? [{ check_runs: [] }] : { check_runs: [] })
    return JSON.stringify(args.includes('--slurp') ? [[]] : [])
  })
  return reads
}

/** A Feishu history API message: epoch-millis create_time and a JSON text body, as `/open-apis/im/v1/messages` returns. */
export const feishuMessage = (id: string, chatId: string, createTimeMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ message_id: id, chat_id: chatId, create_time: String(createTimeMs), sender: { id: 'ou_bob', sender_type: 'user' },
    body: { content: '{"text":"hi"}' }, ...extra })

export interface FeishuHistoryServer {
  items: Record<string, unknown>[]
  failAtCall?: number[]
}

/**
 * Stubs the Feishu chat history API, honoring container, start/end time (whole seconds, inclusive) and page_token
 * pagination at 50 per page. Each request number in `failAtCall` throws once, simulating a failed page read.
 */
export function feishuHistoryServer(h: SourceHost, server: FeishuHistoryServer): { calls: Record<string, unknown>[] } {
  pinCommands(h)
  const calls: Record<string, unknown>[] = []
  const failures = new Set(server.failAtCall ?? [])
  vi.spyOn(h.commands, 'lark').mockImplementation(async (args) => {
    if (args[2] !== '/open-apis/im/v1/messages') throw new Error(`Unexpected lark call: ${args.join(' ')}`)
    const params = JSON.parse(args.at(-1)!) as { container_id: string; start_time: string; end_time: string; page_size: number;
      page_token?: string }
    calls.push(params)
    if (failures.delete(calls.length)) throw new Error('Feishu read failed (simulated)')
    const start = Number(params.start_time) * 1000, end = (Number(params.end_time) + 1) * 1000
    const visible = server.items
      .filter(item => item.chat_id === params.container_id)
      .filter(item => Number(item.create_time) >= start && Number(item.create_time) < end)
      .sort((a, b) => Number(a.create_time) - Number(b.create_time) || String(a.message_id).localeCompare(String(b.message_id)))
    const offset = params.page_token ? Number(params.page_token) : 0
    const pageItems = visible.slice(offset, offset + 50)
    const hasMore = offset + 50 < visible.length
    return { has_more: hasMore, ...(hasMore ? { page_token: String(offset + 50) } : {}), items: pageItems }
  })
  return { calls }
}
