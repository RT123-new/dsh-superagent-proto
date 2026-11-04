/**
 * Issue 1 — GitHub notifications can be missed.
 * Regression tests for the durable, replay-safe notification ingestion protocol: a configurable replay window (120s for
 * initial testing), a periodic reconciliation scan for events delayed beyond it, stable event identities for
 * at-most-once logical processing, and checkpoint progression only after durable handling.
 */
import { describe, expect, it } from 'vitest'
import { key } from '../src/core/index.ts'
import { commandError } from '../src/infra/commands.ts'
import { pollRound } from '../src/sources/github.ts'
import { closeHost, githubComment, githubIssue, githubServer, hostDir, sourceHost, type GithubServer, type MockNotification }
  from './fixtures/source-host.ts'

const notified = (number: number, updatedAt: string): MockNotification => ({ id: `n${number}`, updated_at: updatedAt, number })
const commentId = (number: number, id: number, at: string) =>
  key('github-comment', `https://github.com/acme/widgets/issues/${number}#issuecomment-${id}`, String(id), at)
const server = (notifications: MockNotification[], numbers: number[], commentsAt: Record<number, string>): GithubServer => ({
  notifications,
  issues: Object.fromEntries(numbers.map(number => [number, githubIssue(number)])),
  comments: Object.fromEntries(numbers.map(number => [number, [githubComment(number, number, commentsAt[number] ?? commentsAt[0] ?? '')]])),
})

describe('issue 1 — GitHub notification delivery', () => {
  it.each([['immediately', 0], ['5 seconds late', 5_000], ['30 seconds late', 30_000], ['120 seconds late', 120_000]])(
    'takes in a notification delivered %s', async (_label, lateness) => {
      const h = sourceHost(hostDir('issue1-'))
      const eventAt = new Date(Date.now() - lateness).toISOString()
      const feed = server([], [12], { 12: eventAt })
      githubServer(h, feed)
      // The event happens now, but GitHub delivers its notification only after this round's scan.
      await pollRound(h)
      feed.notifications = [notified(12, lateness === 0 ? new Date().toISOString() : eventAt)]
      await pollRound(h)
      expect(h.store.triggers.get(commentId(12, 12, eventAt))).toBeDefined()
      // A further round that still lists the notification re-reads the thread, but ingestion stays at most once.
      await pollRound(h)
      expect(h.results.filter(result => result === 'stored')).toHaveLength(1)
      expect(h.results.filter(result => result === 'duplicate').length).toBeGreaterThan(0)
      closeHost(h)
    })

  it('recovers a notification delivered beyond the replay window by periodic reconciliation', async () => {
    const h = sourceHost(hostDir('issue1-'))
    const eventAt = new Date(Date.now() - 600_000).toISOString() // ten minutes ago, beyond the 120-second replay window
    const feed = server([], [12], { 12: eventAt })
    githubServer(h, feed)
    await pollRound(h)
    feed.notifications = [notified(12, eventAt)]
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, eventAt))).toBeDefined()
    closeHost(h)
  })

  it('does not reconcile when reconciliation is switched off, and reports the uncovered event nowhere', async () => {
    const h = sourceHost(hostDir('issue1-'))
    h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources,
      github: { enabled: true, config: { reconcileMinutes: 0 } } } })
    const eventAt = new Date(Date.now() - 600_000).toISOString()
    const feed = server([], [12], { 12: eventAt })
    githubServer(h, feed)
    await pollRound(h)
    feed.notifications = [notified(12, eventAt)]
    await pollRound(h)
    // Documented residual risk: with reconciliation off, a notification delayed beyond the replay window is missed.
    expect(h.store.triggers.get(commentId(12, 12, eventAt))).toBeUndefined()
    closeHost(h)
  })

  it('reconciles no more often than its configured cadence', async () => {
    const h = sourceHost(hostDir('issue1-'))
    const feed = server([], [], {})
    const reads = githubServer(h, feed)
    const polls = () => reads.filter(raw => raw.includes('/notifications')).length
    const sinceOf = (raw: string) => decodeURIComponent(/[?&]since=([^&]+)/.exec(raw)?.[1] ?? '')
    await pollRound(h)
    await pollRound(h) // reconciliation is due on the round after the scan record appears
    expect(polls()).toBe(3) // round one scanned once; round two scanned ordinarily and reconciled
    const reconciled = reads.slice(polls() - 2, polls()).map(sinceOf)
    expect(Date.parse(reconciled.at(-1)!)).toBeLessThan(Date.parse(reconciled[0]!)) // the second scan read the wider window
    const checkpoint = h.store.get<string>('github-since')
    const before = polls()
    await pollRound(h) // not yet due again: one ordinary scan at the checkpoint cursor
    const round = reads.slice(before).filter(raw => raw.includes('/notifications'))
    expect(round).toHaveLength(1)
    expect(sinceOf(round[0]!)).toBe(checkpoint)
    closeHost(h)
  })

  it('takes in out-of-order notifications exactly once each', async () => {
    const h = sourceHost(hostDir('issue1-'))
    const at1 = new Date(Date.now() - 1000).toISOString()
    const at2 = new Date(Date.now() - 2000).toISOString()
    // GitHub lists newest first: the older event's notification follows the newer one's.
    h.store.set('github-since', new Date(Date.now() - 3_600_000).toISOString())
    const feed = server([notified(13, at1), notified(12, at2)], [12, 13], { 12: at2, 13: at1 })
    githubServer(h, feed)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at2))).toBeDefined()
    expect(h.store.triggers.get(commentId(13, 13, at1))).toBeDefined()
    expect(h.results.filter(result => result === 'stored')).toHaveLength(2)
    closeHost(h)
  })

  it('keeps the checkpoint when a later notifications page fails, then retries with neither loss nor duplication', async () => {
    const h = sourceHost(hostDir('issue1-'))
    const numbers = Array.from({ length: 51 }, (_, index) => index + 100)
    const at = new Date().toISOString()
    h.store.set('github-since', new Date(Date.now() - 3_600_000).toISOString())
    const feed = server(numbers.map(number => notified(number, at)), numbers, { 0: at })
    feed.failPaginateOnce = true
    githubServer(h, feed)
    await expect(pollRound(h)).rejects.toThrow()
    const checkpoint = h.store.get<string>('github-since')
    await pollRound(h)
    expect(h.results.filter(result => result === 'stored')).toHaveLength(51)
    for (const number of numbers) expect(h.store.triggers.get(commentId(number, number, at))).toBeDefined()
    expect(Date.parse(h.store.get<string>('github-since')!)).toBeGreaterThan(Date.parse(checkpoint!))
    closeHost(h)
  })

  it('recovers a failed notification read after a process restart, from the durable retry record', async () => {
    const dir = hostDir('issue1-')
    const h = sourceHost(dir)
    const at = new Date().toISOString()
    h.store.set('github-since', new Date(Date.now() - 3_600_000).toISOString())
    const feed = server([notified(12, at)], [12], { 12: at })
    feed.issues[12] = commandError({ stderr: 'gh: HTTP 502', code: 1 }) as unknown as Record<string, unknown>
    githubServer(h, feed)
    await expect(pollRound(h)).rejects.toThrow('HTTP 502')
    expect(h.store.get<Record<string, unknown>>('github-retry')).toHaveProperty('12')
    h.store.close()
    // Restart: a new process on the same database sees the durable cursor and retry record, and nothing else.
    const h2 = sourceHost(dir)
    feed.issues[12] = githubIssue(12)
    githubServer(h2, feed)
    await pollRound(h2)
    expect(h2.store.triggers.get(commentId(12, 12, at))).toBeDefined()
    expect(h2.results.filter(result => result === 'stored')).toHaveLength(1)
    expect(h2.store.get('github-retry')).toEqual({})
    closeHost(h2)
  })
})
