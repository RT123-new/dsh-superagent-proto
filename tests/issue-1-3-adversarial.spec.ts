import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runFeishu } from '../src/sources/feishu-loops.ts'
import { feishuTriggerId } from '../src/sources/feishu.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { describe, expect, it, vi } from 'vitest'
import { key } from '../src/core/index.ts'
import { pollRound } from '../src/sources/github.ts'
import { feishuHistoryServer, feishuMessage, closeHost, githubComment, githubIssue, githubServer, hostDir, pinCommands, sourceHost } from './fixtures/source-host.ts'

const iso = (n: number) => new Date(n).toISOString()
const id = (at: string) => key('github-comment', 'https://github.com/acme/widgets/issues/12#issuecomment-12', '12', at)
describe('independent ingestion adversarial review', () => {
  it.each([false, true])('reconciliation widens a previously scanned thread, normal notification=%s', async normal => {
    const h = sourceHost(hostDir('review-ingest-'))
    const now = Date.now(), late = iso(now - 600_000)
    h.store.set('github-since', iso(now - 121_000))
    h.store.set('github-cursor:12', iso(now - 121_000))
    h.store.set('github-notification-scan', { lastCompletedScan: iso(now - 60_000) })
    const feed = { notifications: [{ id: 'n12', number: 12, updated_at: normal ? iso(now) : late }],
      issues: { 12: githubIssue(12) }, comments: { 12: [githubComment(12, 12, late)] } }
    githubServer(h, feed)
    await pollRound(h)
    expect(h.store.triggers.get(id(late))).toBeDefined()
    const candidate = h.engine.candidate(id(late))!
    expect(candidate).toBeDefined()
    h.engine.decide(id(late), { kind: 'accept', evalId: candidate.evalId, title: 'Fix', scope: 'small', reason: 'requested', acknowledgement: 'ok' })
    const ticket = h.store.tickets.list()[0]!
    expect(h.store.tickets.list()).toHaveLength(1)
    expect(ticket.assignments).toHaveLength(1)
    await pollRound(h)
    h.engine.evaluateDue()
    expect(h.store.tickets.list()).toHaveLength(1)
    expect(h.store.tickets.list()[0]!.assignments).toHaveLength(1)
    expect(h.store.decisions.byThread('github:12')).toHaveLength(1)
    closeHost(h)
  })

  it('widens retries without discarding retry age or attempts', async () => {
    const h = sourceHost(hostDir('review-ingest-')), now = Date.now(), late = iso(now - 600_000)
    h.store.set('github-since', iso(now - 121_000))
    h.store.set('github-notification-scan', { lastCompletedScan: iso(now - 60_000) })
    h.store.set('github-retry', { 12: { since: iso(now - 121_000), pr: false, failedAt: iso(now - 3600_000), attempts: 3 } })
    githubServer(h, { notifications: [{ id: 'n12', number: 12, updated_at: late }], issues: { 12: githubIssue(12) }, comments: { 12: [githubComment(12,12,late)] } })
    await pollRound(h)
    expect(h.store.triggers.get(id(late))).toBeDefined()
    closeHost(h)
  })

  it('reconciles repository comments without any notification', async () => {
    const h = sourceHost(hostDir('review-ingest-')), now = Date.now(), late = iso(now - 600_000)
    h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources, github: { enabled: true, config: { observeComments: true } } } })
    h.store.set('github-stream:comments', { since: iso(now - 121_000), started: { comments: iso(now - 3600_000) } })
    pinCommands(h)
    vi.spyOn(h.commands, 'run').mockImplementation(async (_program,args) => {
      const path = args[1]!
      if (path.includes('/notifications')) return 'HTTP/2 200 OK\r\n\r\n[]'
      if (path.includes('/issues/comments?')) {
        const since = decodeURIComponent(/[?&]since=([^&]+)/.exec(path)![1]!)
        const items = Date.parse(since) <= Date.parse(late) ? [{ ...githubComment(12,12,late), issue_url: 'https://api.github.com/repos/acme/widgets/issues/12' }] : []
        return `HTTP/2 200 OK\r\n\r\n${JSON.stringify(items)}`
      }
      return args.includes('--include') ? 'HTTP/2 200 OK\r\n\r\n[]' : JSON.stringify([[]])
    })
    await pollRound(h)
    expect(h.store.triggers.get(id(late))).toBeDefined()
    closeHost(h)
  })
  it('does not use a first-page ETag to hide changed later pages', async () => {
    const h = sourceHost(hostDir('review-ingest-')), at = iso(Date.now() - 60_000)
    h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources, github: { enabled: true, config: { observeIssues: true } } } })
    h.store.set('github-stream:issues', { since: at, started: { issues: at } })
    const issues = Array.from({length: 150}, (_, i) => githubIssue(i + 1, { created_at: at, updated_at: at }))
    pinCommands(h)
    vi.spyOn(h.commands, 'run').mockImplementation(async (_program,args) => {
      const path = args[1]!
      if (path.includes('/notifications')) return 'HTTP/2 200 OK\r\n\r\n[]'
      if (path.includes('/issues?')) {
        if (args.includes('--paginate')) return JSON.stringify([issues.slice(100)])
        if (args.includes('If-None-Match: "first"')) {
          const { CliError } = await import('../src/infra/commands.ts')
          throw new CliError('HTTP 304', 304)
        }
        return `HTTP/2 200 OK\r\nETag: "first"\r\nLink: <https://api.github.com/repos/acme/widgets/issues?page=2>; rel="next"\r\n\r\n${JSON.stringify(issues.slice(0,100))}`
      }
      return args.includes('--include') ? 'HTTP/2 200 OK\r\n\r\n[]' : JSON.stringify([[]])
    })
    await pollRound(h)
    issues.push(githubIssue(151, {created_at: at, updated_at: at}))
    await pollRound(h)
    expect(h.store.triggers.get(key('github-issue', '151'))).toBeDefined()
    closeHost(h)
  })

  it('does not turn first-seen Feishu history into older work on reconciliation', async () => {
    const dir = hostDir('review-ingest-'), cli = join(dir, 'lark-bot')
    writeFileSync(cli, '#!/bin/sh\nexec sleep 60\n', {mode: 0o755})
    const h = sourceHost(dir, { deployment: testDeployment({ feishu: {...testDeployment().feishu!, cli} }) })
    const now = Date.now()
    h.store.set('feishu-history:oc_team', iso(now))
    feishuHistoryServer(h, {items: [feishuMessage('om_old', 'oc_team', now - 600_000, {
      sender: { id: 'ou_alice', sender_type: 'user' }, mentions: [{id: 'ou_bot'}], body: {content: '{"text":"@bot old request"}'} })]})
    const stop = new AbortController(), running = runFeishu(h, stop.signal)
    await vi.waitFor(() => expect(['ready','error']).toContain(h.health.history?.state), {timeout: 5000})
    stop.abort(); await running
    expect(h.store.triggers.get(feishuTriggerId('om_old'))).toBeUndefined()
    expect(h.store.tickets.list()).toHaveLength(0)
    closeHost(h)
  })
})
