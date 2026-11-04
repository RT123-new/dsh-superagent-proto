import { expect, it, vi } from 'vitest'
import { githubKind } from '../src/sources/github.ts'
import { githubAddress, issueTrigger } from '../src/sources/github-trigger.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { SettingsSchema } from '../src/policy.ts'
import { Commands } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { candidateCard, type LinkHost } from '../src/app/links.ts'
import type { Ticket, Trigger } from '../src/core/index.ts'
import { TextCache } from '../src/app/cache.ts'
import { preparationIdentity } from '../src/executor/workspace.ts'

function registry() {
  const settings = SettingsSchema.parse({ sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: '/bin/false' } } } })
  const sources = new SourceRegistry(() => settings)
  sources.register(githubKind)
  return sources
}

it('does not map a foreign fully qualified PR URL onto a local ticket with the same number', () => {
  const sources = registry()
  expect(sources.find('https://github.com/other/project/pull/12').threads).toEqual([])
  expect(sources.find('https://github.com/acme/widgets/pull/12').threads).toEqual(['github:12'])
  expect(sources.find('#12').threads).toEqual(['github:12'])
})

it('the existing address parser already rejects foreign repository identity', () => {
  expect(githubAddress('https://github.com/other/project/pull/12', 'acme/widgets')).toBeUndefined()
  expect(githubAddress('https://github.com/Acme/Widgets/pull/12', 'acme/widgets')).toEqual({ number: 12, pr: true })
})

it('relative API reads stay bound to their deployment and escaping URLs never execute', async () => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  const run = vi.spyOn(commands, 'run').mockResolvedValue('{}')
  await commands.api('pulls/12')
  expect(run).toHaveBeenCalledWith('/bin/false', ['api', 'repos/acme/widgets/pulls/12'])
  await expect(commands.api('https://api.github.com/repos/other/project/pulls/12')).rejects.toThrow('restricted')
  await expect(commands.api('../other/project/pulls/12')).rejects.toThrow('restricted')
  expect(run).toHaveBeenCalledTimes(1)
})

it('documents why one shared Store cannot host two repositories without namespacing', () => {
  const issue = { number: 12, title: 'Fix', body: 'Details', user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z' }
  const a = issueTrigger({ ...issue, html_url: 'https://github.com/acme/widgets/issues/12' }, 'agent')
  const b = issueTrigger({ ...issue, html_url: 'https://github.com/other/project/issues/12' }, 'agent')
  // This is an intentional characterization of the one-repository product boundary, not a multi-repo feature test.
  expect(a.id).toBe(b.id)
  expect(a.threads).toEqual(b.threads)
  expect(preparationIdentity({ repository: 'acme/widgets', prepareCommand: 'prepare' }))
    .not.toBe(preparationIdentity({ repository: 'other/project', prepareCommand: 'prepare' }))
})


it('actual candidateCard never recommends a local ticket for a foreign same-number PR', async () => {
  const ticket: Ticket = { id: 'local-ticket', title: 'Local request', decisionId: 'decision', channels: [], inputs: [], undelivered: [],
    mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed', sender: 'alice' }, actor: { source: 'github', id: 'alice' }, scope: 'local' },
    assignments: [], createdAt: '', updatedAt: '', origin: { triggerId: 'origin', triggerIds: ['origin'] } }
  const sources = registry()
  const host = { store: { settings: () => SettingsSchema.parse({}), triggers: { disposition: () => undefined },
    threads: { get: (key: string) => key === 'github:12' ? { subscriptions: [ticket.id] } : undefined },
    tickets: { get: (id: string) => id === ticket.id ? ticket : undefined } }, sources, links: new TextCache(1000),
    lifetime: new AbortController().signal } as unknown as LinkHost
  const trigger: Trigger = { id: 'new-request', source: 'github', threads: [{ source: 'github', id: '99' }],
    actor: { source: 'github', id: 'alice' }, human: true, at: '', text: '', meta: {}, url: 'https://github.com/acme/widgets/issues/99' }
  const card = (text: string) => candidateCard(host, { evalId: 'eval', policyVersion: 'v1', tickets: [], strength: 'explicit',
    thread: { key: 'github:99', ref: trigger.threads[0]!, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {} },
    triggers: [{ ...trigger, text }] })
  expect(await card('https://github.com/other/project/pull/12')).not.toHaveProperty('referenced_tickets')
  expect(await card('https://github.com/acme/widgets/pull/12')).toMatchObject({ referenced_tickets: [{ ticket_id: ticket.id }] })
  expect(await card('#12')).toMatchObject({ referenced_tickets: [{ ticket_id: ticket.id }] })
})
