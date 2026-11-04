/** Final review 3.1: the remaining event-count boundaries (49, 50, 10000) of the stream pagination matrix, with a recorded wall time. */
import { expect, it } from 'vitest'
import { key } from '../src/core/index.ts'
import { pollRound } from '../src/sources/github.ts'
import { closeHost, githubIssue, hostDir, sourceHost, streamServer } from './fixtures/source-host.ts'

const T0 = new Date(Date.now() - 24 * 3600_000).toISOString()
it.each([[49], [50], [10000]])('reads a stream of %i events completely, once each', async count => {
  const h = sourceHost(hostDir('final31-'))
  h.store.saveSettings({ ...h.store.settings(), sources: { ...h.store.settings().sources, github: { enabled: true, config: { observeIssues: true } } } })
  h.store.set('github-stream:issues', { since: T0, started: { issues: T0 } })
  streamServer(h, Array.from({ length: count }, (_, i) => githubIssue(i + 1, { created_at: new Date(Date.parse(T0) + i * 1000).toISOString(), updated_at: new Date(Date.parse(T0) + i * 1000).toISOString() })))
  const t = performance.now()
  await pollRound(h)
  console.log(`events=${count} wallMs=${Math.round(performance.now() - t)}`)
  expect(h.results.filter(result => result === 'stored')).toHaveLength(count)
  for (const n of [1, count]) expect(h.store.triggers.get(key('github-issue', String(n)))).toBeDefined()
  closeHost(h)
}, 120_000)
