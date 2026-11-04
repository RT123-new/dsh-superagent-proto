/** Final review 3.1: edits to earlier comments, cursor persistence failure, revoked credentials and an extended outage, through the real pollRound. */
import { describe, expect, it, vi } from 'vitest'
import { key } from '../src/core/index.ts'
import { commandError } from '../src/infra/commands.ts'
import { pollThreads as pollEach } from '../src/sources/poll.ts'
import { pollRound, rearmParked } from '../src/sources/github.ts'
import { closeHost, githubComment, githubIssue, githubServer, hostDir, sourceHost, type GithubServer, type MockNotification } from './fixtures/source-host.ts'

const notified = (number: number, updatedAt: string): MockNotification => ({ id: `n${number}`, updated_at: updatedAt, number })
const commentId = (number: number, id: number, at: string) =>
  key('github-comment', `https://github.com/acme/widgets/issues/${number}#issuecomment-${id}`, String(id), at)
const feedOf = (at: string, number = 12): GithubServer => ({ notifications: [notified(number, at)], issues: { [number]: githubIssue(number) }, comments: { [number]: [githubComment(number, number, at)] } })
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('3.1 remaining faults', () => {
  it('an edit to an earlier comment becomes a new versioned trigger and does not erase the first', async () => {
    const h = sourceHost(hostDir('f31-'))
    const t0 = ago(30_000), t1 = ago(5_000)
    h.store.set('github-since', ago(3_600_000))
    const feed = feedOf(t0)
    githubServer(h, feed)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, t0))).toBeDefined()
    feed.notifications = [notified(12, t1)]
    feed.comments[12] = [githubComment(12, 12, t1)]
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, t1))).toBeDefined()
    expect(h.store.triggers.get(commentId(12, 12, t0))).toBeDefined()
    closeHost(h)
  })

  it('revoked credentials park the failed read in the durable retry record with its original boundary, and it recovers when access returns', async () => {
    const h = sourceHost(hostDir('f31-'))
    const at = ago(10_000)
    h.store.set('github-since', ago(3_600_000))
    const before = h.store.get<string>('github-since')
    const feed = feedOf(at)
    feed.issues[12] = commandError({ stderr: 'gh: Bad credentials (HTTP 401)', code: 1 }) as unknown as Record<string, unknown>
    githubServer(h, feed)
    await expect(pollRound(h)).rejects.toThrow('Bad credentials')
    // The checkpoint may advance because the failed item itself is carried, with its own `since`, in the durable retry record.
    const retry = h.store.get<Record<string, { since: string; attempts?: number; failedAt?: string }>>('github-retry')!
    expect(Date.parse(retry['12']!.since)).toBeLessThanOrEqual(Date.parse(before!))
    expect(retry['12']!.attempts).toBe(1)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeUndefined()
    feed.issues[12] = githubIssue(12)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeDefined()
    closeHost(h)
  })

  it('a checkpoint write failure rejects the round, and the replay stores the event exactly once', async () => {
    const h = sourceHost(hostDir('f31-'))
    const at = ago(10_000)
    h.store.set('github-since', ago(3_600_000))
    const before = h.store.get<string>('github-since')
    githubServer(h, feedOf(at))
    const set = h.store.set.bind(h.store)
    let failed = false
    vi.spyOn(h.store, 'set').mockImplementation(((name: string, value: unknown) => {
      if (name === 'github-since' && !failed) { failed = true; throw new Error('disk full') }
      return set(name, value as never)
    }) as typeof h.store.set)
    await expect(pollRound(h)).rejects.toThrow('disk full')
    expect(h.store.get<string>('github-since')).toBe(before)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeDefined()
    expect(h.results.filter(result => result === 'stored')).toHaveLength(1)
    closeHost(h)
  })

  it('an outage of two days loses nothing: the unadvanced checkpoint still reaches the events from before it', async () => {
    const h = sourceHost(hostDir('f31-'))
    const at = ago(47 * 3_600_000)
    h.store.set('github-since', ago(48 * 3_600_000))
    githubServer(h, feedOf(at))
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeDefined()
    closeHost(h)
  })

  it('after 24h of 401 the read is parked durably with its boundary, health stays error, nothing loops, and an explicit rearm stores it', async () => {
    const h = sourceHost(hostDir('f31-'))
    const at = ago(26 * 3_600_000)
    h.store.set('github-since', ago(60_000))
    h.store.set('github-retry', { '12': { since: ago(27 * 3_600_000), pr: false, failedAt: ago(25 * 3_600_000), attempts: 50 } })
    const feed: GithubServer = { notifications: [], issues: { 12: commandError({ stderr: 'gh: Bad credentials (HTTP 401)', code: 1 }) as unknown as Record<string, unknown> }, comments: { 12: [githubComment(12, 12, at)] } }
    githubServer(h, feed)
    await pollRound(h)
    const parked = h.store.get<Record<string, { parked?: boolean; since: string }>>('github-retry')!['12']
    expect(parked?.parked).toBe(true)
    expect(Date.parse(parked!.since)).toBeLessThan(Date.parse(at))
    expect(h.health.github?.detail).toContain('parked')
    expect(h.health.github?.detail).toContain('#12')
    expect(h.health.github?.state).toBe('error')
    // Parked reads are not retried, even once credentials return, until an explicit rearm.
    feed.issues[12] = githubIssue(12)
    await pollRound(h)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeUndefined()
    expect(h.health.github?.state).toBe('error')
    expect(h.store.get<Record<string, { parked?: boolean }>>('github-retry')!['12']?.parked).toBe(true)
    expect(rearmParked(h)).toBe(1)
    await pollRound(h)
    expect(h.store.triggers.get(commentId(12, 12, at))).toBeDefined()
    expect(h.store.get<Record<string, unknown>>('github-retry')).toEqual({})
    expect(h.health.github?.state).toBe('ready')
    closeHost(h)
  })

  it('CHARACTERIZATION: a subscribed thread whose poll keeps failing stops being polled at the 14-day horizon, with only pollError left on the Thread', async () => {
    const h = sourceHost(hostDir('f31-'))
    const lastAt = ago(13 * 86_400_000)
    h.store.threads.save({ key: 'github:77', ref: { source: 'github', id: '77' }, createdAt: lastAt, lastAt, subscriptions: ['t'], correlated: [], pending: [], meta: {} })
    const poll = vi.fn(async () => { throw new Error('gh: Bad credentials (HTTP 401)') })
    await pollEach(h, 'github', () => false, poll)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(h.store.threads.get('github:77')?.meta.pollError).toContain('Bad credentials')
    // Once the thread's last activity is older than the horizon it is no longer read, and no health entry names it.
    h.store.threads.save({ ...h.store.threads.get('github:77')!, lastAt: ago(15 * 86_400_000) })
    await pollEach(h, 'github', () => false, poll)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(h.store.threads.get('github:77')?.meta.pollError).toContain('Bad credentials')
    closeHost(h)
  })
})
