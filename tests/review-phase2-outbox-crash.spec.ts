/** Final review phase 2.4: remote acceptance followed by a local failure retransmits with the same stable id; failures never vanish. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}

it('a send the provider accepted but the host never saw confirmed parks without idempotency, then settles after an acknowledged rearm', async () => {
  const accepted: string[] = []
  let calls = 0
  const kind: SourceKind<Record<string, never>> = { kind: 'crashy', title: { zh: 'x', en: 'x' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async (_host, message: OutboundMessage) => {
      calls++; accepted.push(message.id)
      if (calls === 1) throw new Error('host lost the acknowledgement after the provider accepted')
      return 'sent'
    }, link: () => ({ url: '', label: { zh: 'x', en: 'x' } }) } }
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'dup-risk', channel: { source: 'crashy', thread: 'c:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('dup-risk')).toBe('pending')
  await at(5000); await at(300_000)
  // No proven idempotency: no automatic retransmission; the uncertain reply is parked for explicit recovery.
  expect(accepted).toEqual(['dup-risk'])
  expect(h.runtime.outbox.outcome('dup-risk')).toBe('attempted-unknown')
  expect(h.runtime.effects.rearm('reply', 'dup-risk')).toEqual({ rearmed: false, requiresAcknowledgement: true })
  expect(h.runtime.effects.rearm('reply', 'dup-risk', { acknowledgeUnknownOutcome: true })).toEqual({ rearmed: true })
  await at(10)
  expect(h.runtime.outbox.status('dup-risk')).toBe('sent')
  expect(accepted).toEqual(['dup-risk', 'dup-risk'])   // the second send was explicitly authorised by the operator
})

it('a permanently failing send stays pending (never silently dropped or marked sent)', async () => {
  const kind: SourceKind<Record<string, never>> = { kind: 'broken', title: { zh: 'x', en: 'x' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async () => { throw new Error('provider rejects') }, link: () => ({ url: '', label: { zh: 'x', en: 'x' } }) } }
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'rejected', channel: { source: 'broken', thread: 'b:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies(); await at(5000); await at(300_000)
  expect(h.runtime.outbox.status('rejected')).toBe('pending')
})

it('a failed attempt leaves a durable attempted-with-error marker on the effect row while the receipt stays pending', async () => {
  const kind: SourceKind<Record<string, never>> = { kind: 'marker', title: { zh: 'x', en: 'x' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async () => { throw new Error('connection reset after the request was written') }, link: () => ({ url: '', label: { zh: 'x', en: 'x' } }) } }
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'marked', channel: { source: 'marker', thread: 'm:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  const row = h.runtime.store.db.prepare("SELECT attempts, error FROM effect WHERE kind = 'reply' AND key = ?").get('marked') as { attempts: number; error: string } | undefined
  expect(h.runtime.outbox.status('marked')).toBe('pending')
  expect(row?.attempts).toBeGreaterThan(0)
  expect(row?.error).toContain('connection reset')
})

it('while a send is in flight the effect row durably carries an attempt-start marker', async () => {
  let inflight: { attempts: number; error: string } | undefined
  const kind: SourceKind<Record<string, never>> = { kind: 'inflight', title: { zh: 'x', en: 'x' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async () => {
      inflight = h.runtime.store.db.prepare("SELECT attempts, error FROM effect WHERE kind = 'reply' AND key = ?").get('inflight-1') as typeof inflight
      return 'sent'
    }, link: () => ({ url: '', label: { zh: 'x', en: 'x' } }) } }
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'inflight-1', channel: { source: 'inflight', thread: 'i:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect(inflight).toEqual({ attempts: 0, error: '[attempt-started]' })
  expect(h.runtime.outbox.outcome('inflight-1')).toBe('sent')
})
