/** Cross-review: local diagnostic persistence must not replace a provider's trusted retry embargo. */
import { afterEach, expect, it, vi } from 'vitest'
import { CliError } from '../src/infra/commands.ts'
import { TransportFailure } from '../src/app/retry-policy.ts'
import { pollRound, pollThreads } from '../src/sources/github.ts'
import { KV } from '../src/kv.ts'
import { closeHost, hostDir, pinCommands, sourceHost, type SourceHost } from './fixtures/source-host.ts'

const hosts: SourceHost[] = []
afterEach(() => { for (const host of hosts.splice(0)) closeHost(host); vi.restoreAllMocks() })
function setup() {
  const h = sourceHost(hostDir('embargo-write-')); hosts.push(h); pinCommands(h)
  h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources,
    github: { enabled: true, config: { observeIssues: true, observeComments: true } } } })
  return h
}
function limited() {
  const error = new CliError('provider limit', 429)
  error.transportFailure = new TransportFailure('provider limit', { status: 429, retryAfter: '7200' })
  return error
}
const empty = 'HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\n\r\n[]'

it.each(['retry map', 'thread diagnostic'])('preserves the notification embargo when the %s write fails', async location => {
  const h = setup(), error = limited()
  const since = new Date(Date.now() - 60_000).toISOString()
  h.state.set(KV.github.since, since)
  const set = h.state.set.bind(h.state)
  if (location === 'retry map') vi.spyOn(h.state, 'set').mockImplementation((key, value) => {
    if (key === KV.github.retries) throw new Error('local write failed')
    set(key, value)
  })
  else vi.spyOn(h.threads, 'patch').mockImplementation(() => { throw new Error('local write failed') })
  const list = [1, 2].map(number => ({ repository: { full_name: 'acme/widgets' },
    subject: { url: `https://api.github.com/repos/acme/widgets/issues/${number}` } }))
  const run = vi.spyOn(h.commands, 'run').mockResolvedValueOnce(empty.replace('[]', JSON.stringify(list)))
    .mockRejectedValueOnce(error).mockResolvedValue(empty)
  await expect(pollRound(h)).rejects.toBe(error)
  expect(run).toHaveBeenCalledTimes(2)
  expect(h.state.get(KV.github.since)).toBe(since)
})

it('preserves a subscribed-thread embargo when its error diagnostic cannot be saved', async () => {
  const h = setup(), error = limited()
  for (const number of [1, 2]) h.store.threads.save({ key: `github:${number}`, ref: { source: 'github', id: String(number) },
    createdAt: new Date().toISOString(), subscriptions: ['ticket'], correlated: [], pending: [], meta: { isPr: false, title: `Issue ${number}` } })
  vi.spyOn(h.threads, 'patch').mockImplementation(() => { throw new Error('local write failed') })
  const run = vi.spyOn(h.commands, 'run').mockRejectedValueOnce(error).mockResolvedValue('[[]]')
  await expect(pollThreads(h)).rejects.toBe(error)
  expect(run).toHaveBeenCalledTimes(1)
})
