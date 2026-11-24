import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliError } from '../src/infra/commands.ts'
import { TransportFailure, serverNotBeforeOf } from '../src/app/retry-policy.ts'
import { pollPauseSeconds, pollRound, pollThreads } from '../src/sources/github.ts'
import { KV } from '../src/kv.ts'
import { closeHost, hostDir, pinCommands, sourceHost, type SourceHost } from './fixtures/source-host.ts'

const hosts: SourceHost[] = []
afterEach(() => { for (const host of hosts.splice(0)) closeHost(host); vi.restoreAllMocks() })
function setup() {
  const h = sourceHost(hostDir('second-pass-embargo-')); hosts.push(h); pinCommands(h)
  h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources,
    github: { enabled: true, config: { observeIssues: true, observeComments: true } } } })
  return h
}
function limited(status = 429) {
  const error = new CliError('provider limit', status)
  error.transportFailure = new TransportFailure('provider limit', { status, retryAfter: '7200' })
  return error
}
const empty = 'HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\n\r\n[]'

describe('second pass: stop every GitHub polling lane at a trusted embargo', () => {
  it('does not start repository streams after the notifications request is rate limited', async () => {
    const h = setup(), error = limited()
    const run = vi.spyOn(h.commands, 'run').mockRejectedValueOnce(error).mockResolvedValue(empty)
    await expect(pollRound(h)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([429, 503])('preserves typed retry metadata from a repository stream (HTTP %i)', async status => {
    const h = setup(), error = limited(status)
    const run = vi.spyOn(h.commands, 'run').mockResolvedValueOnce(empty).mockRejectedValueOnce(error).mockResolvedValue(empty)
    const received = await pollRound(h).catch((value: unknown) => value)
    expect(serverNotBeforeOf(received)).toBe(serverNotBeforeOf(error))
    expect(pollPauseSeconds(60, 1, received, () => 1)).toBeGreaterThanOrEqual(7199)
    expect(run).toHaveBeenCalledTimes(2)
    expect(h.state.get(KV.github.stream('issues'))).toBeUndefined()
  })

  it('retains a failed notification item without advancing its scan or requesting further items', async () => {
    const h = setup(), error = limited()
    const since = new Date(Date.now() - 60_000).toISOString()
    h.state.set(KV.github.since, since)
    const list = [1, 2].map(number => ({ repository: { full_name: 'acme/widgets' },
      subject: { url: `https://api.github.com/repos/acme/widgets/issues/${number}` } }))
    const run = vi.spyOn(h.commands, 'run').mockResolvedValueOnce(empty.replace('[]', JSON.stringify(list)))
      .mockRejectedValueOnce(error).mockResolvedValue(empty)
    await expect(pollRound(h)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(2)
    expect(h.state.get(KV.github.since)).toBe(since)
    expect(Object.values(h.state.get(KV.github.retries) ?? {})).toHaveLength(1)
  })

  it('propagates a subscribed-thread embargo instead of swallowing it and reading the next thread', async () => {
    const h = setup(), error = limited()
    for (const number of [1, 2]) h.store.threads.save({ key: `github:${number}`, ref: { source: 'github', id: String(number) },
      createdAt: new Date().toISOString(), subscriptions: ['ticket'], correlated: [], pending: [], meta: { isPr: false, title: `Issue ${number}` } })
    const run = vi.spyOn(h.commands, 'run').mockRejectedValueOnce(error).mockResolvedValue('[[]]')
    await expect(pollThreads(h)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
    expect(h.state.get(KV.github.cursor(1))).toBeUndefined()
    expect(h.state.get(KV.github.cursor(2))).toBeUndefined()
  })

  it('continues independent repository streams after an ordinary transient failure', async () => {
    const h = setup()
    const run = vi.spyOn(h.commands, 'run').mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('temporary disconnect')).mockResolvedValue(empty)
    await expect(pollRound(h)).rejects.toThrow('GitHub reads failed')
    expect(run).toHaveBeenCalledTimes(4)
  })
})
