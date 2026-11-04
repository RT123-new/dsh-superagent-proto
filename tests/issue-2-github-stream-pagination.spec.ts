/**
 * Issue 2 — GitHub pagination can lose events.
 * Regression tests for complete pagination of the repository-wide event streams: every page is read, the checkpoint
 * never advances past unread pages, bursts sharing one timestamp cannot starve the stream, and a failed page neither
 * loses nor duplicates work.
 */
import { describe, expect, it } from 'vitest'
import { key } from '../src/core/index.ts'
import { pollRound } from '../src/sources/github.ts'
import { closeHost, githubIssue, hostDir, sourceHost, streamServer } from './fixtures/source-host.ts'

const T0 = new Date(Date.now() - 24 * 3600_000).toISOString()
const burst = (count: number, spread = true): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, index) => githubIssue(index + 1, {
    created_at: new Date(Date.parse(T0) + (spread ? index : 0) * 1000).toISOString(),
    updated_at: new Date(Date.parse(T0) + (spread ? index : 0) * 1000).toISOString() }))

function observe(h: ReturnType<typeof sourceHost>): void {
  h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources,
    github: { enabled: true, config: { observeIssues: true } } } })
  h.store.set('github-stream:issues', { since: T0, started: { issues: T0 } })
}

describe('issue 2 — GitHub stream pagination', () => {
  it.each([[0], [1], [99], [100], [101], [201], [1000]])('reads a stream of %i events completely', async count => {
    const h = sourceHost(hostDir('issue2-'))
    observe(h)
    streamServer(h, burst(count))
    await pollRound(h)
    expect(h.results.filter(result => result === 'stored')).toHaveLength(count)
    for (let number = 1; number <= count; number++) {
      expect(h.store.triggers.get(key('github-issue', String(number)))).toBeDefined()
    }
    closeHost(h)
  })

  it('reads more than a page of events sharing one timestamp, which a page-1-only read starves', async () => {
    const h = sourceHost(hostDir('issue2-'))
    observe(h)
    streamServer(h, burst(150, false))
    await pollRound(h)
    expect(h.results.filter(result => result === 'stored')).toHaveLength(150)
    // The cursor cannot advance past the shared timestamp, and a quiet round after it ingests nothing again.
    expect(h.store.get<{ since: string }>('github-stream:issues')!.since).toBe(T0)
    await pollRound(h)
    expect(h.results.filter(result => result === 'stored')).toHaveLength(150)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(150)
    closeHost(h)
  })

  it('never advances the checkpoint past unread pages when a later page fails', async () => {
    const h = sourceHost(hostDir('issue2-'))
    observe(h)
    streamServer(h, burst(201), { failPaginateOnce: true })
    await expect(pollRound(h)).rejects.toThrow(/issues: /)
    // Nothing was staged from the incomplete scan: no trigger, no cursor movement.
    expect(h.results).toHaveLength(0)
    expect(h.store.get<{ since: string }>('github-stream:issues')!.since).toBe(T0)
    await pollRound(h)
    expect(h.results.filter(result => result === 'stored')).toHaveLength(201)
    closeHost(h)
  })

  it('re-presents an interrupted burst exactly once logically', async () => {
    const h = sourceHost(hostDir('issue2-'))
    observe(h)
    streamServer(h, burst(250))
    await pollRound(h)
    await pollRound(h) // the burst is still listed: replay must deduplicate, not re-create work
    expect(h.results.filter(result => result === 'stored')).toHaveLength(250)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(250)
    closeHost(h)
  })

  it('follows pagination links instead of re-requesting the first page', async () => {
    const h = sourceHost(hostDir('issue2-'))
    observe(h)
    const calls = streamServer(h, burst(250))
    await pollRound(h)
    const stream = calls.filter(args => args[1]!.startsWith('repos/acme/widgets/issues?'))
    expect(stream.map(args => args.includes('--paginate'))).toEqual([false, true])
    expect(stream[1]![1]).toContain('page=2')
    closeHost(h)
  })
})
