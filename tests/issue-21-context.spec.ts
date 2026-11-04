import { expect, it } from 'vitest'
import { correction, contextFixture, fullRead, runContextWorkload } from '../scripts/context-workload.ts'
import { readResource } from '../src/app/resources.ts'
import { TextCache } from '../src/app/cache.ts'
import { textPage } from '../src/app/cards.ts'
import { composePrompt, defaultPrompts, policySection } from '../src/app/prompts.ts'
import { SettingsSchema } from '../src/policy.ts'

it('reconstructs exact UTF-16 context including an older correction and Unicode across small pages', async () => {
  const fixture = contextFixture()
  const result = await fullRead(fixture.host, 'github/issues/1/comments/1', 'a', 17)
  expect(result.pages).toBeGreaterThan(100)
  expect(JSON.parse(result.body).messages[0].text).toContain(correction)
  expect(result.body).toContain('🚦')
  expect(fixture.calls).toBe(1)
  const next = await fullRead(fixture.host, JSON.parse(result.body).next_resource, 'a', 31)
  expect(JSON.parse(next.body).messages).toHaveLength(3)
  expect(fixture.calls).toBe(2)
})

it('offset0 refreshes mutable context while later offsets retain their original snapshot', async () => {
  const fixture = contextFixture(), resource = 'github/issues/1/comments/1'
  const original = await fullRead(fixture.host, resource, 'a')
  fixture.advance()
  const continuation = await readResource(fixture.host, resource, 10, 100, 'a') as { text: string }
  expect(continuation.text).toBe(original.body.slice(10, 110))
  expect(fixture.calls).toBe(1)
  const fresh = await fullRead(fixture.host, resource, 'a')
  expect(fresh.body).toContain('Revision 2')
  expect(fresh.body).not.toBe(original.body)
  expect(fixture.calls).toBe(2)
})

it('never lends another session a snapshot and requires refetch after eviction/restart', async () => {
  const fixture = contextFixture(), resource = 'github/issues/1/comments/1'
  await fullRead(fixture.host, resource, 'a')
  await expect(readResource(fixture.host, resource, 1, 10, 'b')).rejects.toThrow('from offset 0')
  fixture.host.pages.set('large', 'x'.repeat(4_000_001))
  await expect(readResource(fixture.host, resource, 1, 10, 'a')).rejects.toThrow('from offset 0')
  const restarted = { ...fixture.host, pages: new TextCache(4_000_000) }
  await expect(readResource(restarted, resource, 1, 10, 'a')).rejects.toThrow('from offset 0')
  expect((await fullRead(restarted, resource, 'a')).body).toContain(correction)
})

it('tail-only reduction demonstrably drops an older correction and is rejected', async () => {
  const fixture = contextFixture()
  const full = await fullRead(fixture.host, 'github/issues/1/comments/1')
  const messages = JSON.parse(full.body).messages as { text: string }[]
  expect(messages.some(message => message.text.includes(correction))).toBe(true)
  expect(messages.slice(-5).some(message => message.text.includes(correction))).toBe(false)
  // Exact paging is lossless; previews/tail-only context cannot stand in for original evidence.
  let rebuilt = ''
  for (let offset = 0; offset < full.body.length; offset += 13) rebuilt += textPage('fixture', full.body, offset, 13).text
  expect(rebuilt).toBe(full.body)
})

it('keeps the common prompt prefix exact while current policy remains a changing suffix', () => {
  const first = SettingsSchema.parse({}), second = structuredClone(first)
  second.eval.mode = 'auto'
  const a = composePrompt(defaultPrompts(), 'orchestrator', 'repository fixture/a', policySection(first))
  const b = composePrompt(defaultPrompts(), 'orchestrator', 'repository fixture/a', policySection(second))
  expect(a.slice(0, a.lastIndexOf('## Policy'))).toBe(b.slice(0, b.lastIndexOf('## Policy')))
  expect(a).not.toBe(b)
  expect(b.endsWith(policySection(second).text)).toBe(true)
})

it('reports measured read volume separately from unavailable tokens, billing and task success', async () => {
  const result = await runContextWorkload(5, 3, 1, 10)
  expect(result.source_api_calls).toBe(40)
  expect(result.retrieval_oracle_success).toBe(10)
  expect(result.repeated_utf8_bytes).toBeGreaterThan(0)
  expect(result).toMatchObject({ raw_input_tokens: null, cached_input_tokens: null, output_tokens: null, task_success: null })
})
