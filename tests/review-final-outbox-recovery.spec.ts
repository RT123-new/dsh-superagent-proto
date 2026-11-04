/** Final review Gate 1: ambiguous live sends, server-validated rearm, and the enqueue guard for crash-uncertain replies. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { ATTEMPT_STARTED, ATTEMPT_UNKNOWN, Effects } from '../src/app/effects.ts'
import { registerHttp, type HttpHost } from '../src/app/http.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}
/** A fake source kind whose channel records every invocation and acceptance, with a declared idempotency contract. */
function fakeKind(name: string, opts: { idempotency?: 'provider' | 'marker'; acceptThenThrow?: boolean; dedupe?: Set<string> }) {
  const calls: string[] = []
  const kind: SourceKind<Record<string, never>> = { kind: name, title: { zh: 'x', en: 'x' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: {
      send: async (_host: unknown, message: OutboundMessage) => {
        if (opts.dedupe?.has(message.id)) return 'sent'         // provider/marker idempotency: no second remote creation
        opts.dedupe?.add(message.id)
        calls.push(message.id)
        if (opts.acceptThenThrow && calls.length === 1) throw new Error('connection dropped after the provider accepted')
        return 'sent' as const
      },
      link: () => ({ url: '', label: { zh: 'x', en: 'x' } }),
      ...(opts.idempotency ? { idempotency: opts.idempotency } : {}),
    } as SourceKind<Record<string, never>>['channel'] }
  return { kind, calls }
}

it('an ambiguous live failure on a channel WITHOUT proven idempotency parks for operator recovery instead of resending', async () => {
  const { kind, calls } = fakeKind('noidem', { acceptThenThrow: true })
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'park-me', channel: { source: 'noidem', thread: 'c:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  await at(5000); await at(300_000)                               // every retry window passes: still no automatic second attempt
  expect(calls).toEqual(['park-me'])
  expect(h.runtime.outbox.status('park-me')).toBe('pending')
  expect(h.runtime.outbox.outcome('park-me')).toBe('attempted-unknown')
  const row = h.runtime.store.db.prepare("SELECT error FROM effect WHERE kind = 'reply' AND key = 'park-me'").get() as { error: string }
  expect(row.error).toContain('blocked:unknown_outcome')
  expect(row.error).toContain(ATTEMPT_UNKNOWN)
})

it('an ambiguous live failure on a channel WITH proven idempotency retries safely: one remote creation, settled once', async () => {
  const { kind, calls } = fakeKind('idem', { idempotency: 'provider', acceptThenThrow: true, dedupe: new Set() })
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'safe-retry', channel: { source: 'idem', thread: 'c:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('safe-retry')).toBe('pending')
  await at(5000)
  expect(h.runtime.outbox.status('safe-retry')).toBe('sent')
  expect(calls.length).toBe(1)                                     // the provider recorded exactly one creation
})

it('a validation failure before any provider invocation parks as permanent with zero provider calls', async () => {
  const { kind, calls } = fakeKind('badtarget', {})
  h.runtime.sources.register(kind)
  h.runtime.outbox.send({ id: 'bad key with spaces', channel: { source: 'badtarget', thread: 'c:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  await at(5000)
  expect(calls).toEqual([])
  const row = h.runtime.store.db.prepare("SELECT error FROM effect WHERE kind = 'reply' AND key = 'bad key with spaces'").get() as { error: string } | undefined
  expect(row?.error ?? '').toContain('blocked:')
})

// --- Store/Effects-level rearm acknowledgement and enqueue guard ---
const dirs: string[] = [], stores: Store[] = []
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function level() {
  const dir = mkdtempSync(join(tmpdir(), 'rearm-')); dirs.push(dir)
  const store = new Store(join(dir, 'o.sqlite'), () => {}); stores.push(store)
  let clock = 1_000_000
  const effects = new Effects(store, new HealthBoard(), () => clock)
  return { store, effects, tick: async () => { clock += 5_000_000; effects.kick(); await new Promise(r => setTimeout(r, 30)) } }
}
function parkUnknown(store: Store, effects: Effects, key = 'k') {
  store.db.prepare("INSERT INTO effect (kind, key, value, seq, due, since, attempts, error) VALUES ('reply', ?, '{}', 1, 0, ?, 0, ?)")
    .run(key, new Date(1_000_000).toISOString(), ATTEMPT_STARTED)
  effects.start()
  expect(effects.blocked('reply').map(row => row.key)).toEqual([key])
}

it('rearm of an unknown-outcome row requires an explicit acknowledgement; the row is unchanged without it', () => {
  const { store, effects } = level()
  parkUnknown(store, effects)
  const before = store.db.prepare("SELECT error, generation FROM effect WHERE key = 'k'").get() as { error: string; generation: number }
  expect(effects.rearm('reply', 'k')).toEqual({ rearmed: false, requiresAcknowledgement: true })
  expect(effects.rearm('reply', 'k', {})).toEqual({ rearmed: false, requiresAcknowledgement: true })
  expect(effects.rearm('reply', 'k', { acknowledgeUnknownOutcome: false })).toEqual({ rearmed: false, requiresAcknowledgement: true })
  const after = store.db.prepare("SELECT error, generation FROM effect WHERE key = 'k'").get() as { error: string; generation: number }
  expect(after).toEqual(before)
  expect(effects.rearm('reply', 'k', { acknowledgeUnknownOutcome: true })).toEqual({ rearmed: true })
  expect(effects.rearm('reply', 'k', { acknowledgeUnknownOutcome: true })).toEqual({ rearmed: false })   // nothing blocked anymore
})

it('an ordinary blocked row (not unknown) still rearms without an acknowledgement', () => {
  const { store, effects } = level()
  store.db.prepare("INSERT INTO effect (kind, key, value, seq, due, since, attempts, error) VALUES ('relay', 'r', '{\"text\":\"a\"}', 1, 0, ?, 1, 'blocked:permanent: nope')")
    .run(new Date(1_000_000).toISOString())
  effects.start()
  expect(effects.rearm('relay', 'r')).toEqual({ rearmed: true })
})

it('a plain enqueue never clears a crash-uncertain reply block; other kinds keep coalescing semantics', async () => {
  const { store, effects, tick } = level()
  parkUnknown(store, effects)
  const sent: string[] = []
  effects.handle('reply', async () => { sent.push('sent') }, { markAttempt: true })
  store.atomic(() => effects.enqueue('reply', 'k', {}))
  await tick()
  expect(sent).toEqual([])                                          // no silent un-block, no dispatch
  const row = store.db.prepare("SELECT error FROM effect WHERE kind = 'reply' AND key = 'k'").get() as { error: string }
  expect(row.error).toContain('blocked:unknown_outcome')
  // A relay row coalesces as before: a fresh enqueue rearms an ordinary blocked row.
  effects.handle('relay', async () => { throw Object.assign(new Error('nope'), { status: 400 }) }, { ordered: true })
  store.atomic(() => effects.enqueue('relay', 'r', { text: 'a' }))
  await tick(); await tick()
  expect(effects.blocked('relay')).toHaveLength(1)
  store.atomic(() => effects.enqueue('relay', 'r', { text: 'b' }))
  expect(effects.blocked('relay')).toHaveLength(0)                  // ordinary kinds unchanged
})

// --- HTTP route: the server independently validates the acknowledgement ---
type H = (req: unknown, res: unknown) => Promise<void>
function http(effects: Effects) {
  let handler: H = async () => {}
  registerHttp({ webServer: { host: '127.0.0.1', port: 3083, register: (r: { handler: H }) => { handler = r.handler; return () => {} } } } as never,
    { ready: Promise.resolve(), effects } as unknown as HttpHost)
  return async (method: string, path: string, body?: unknown) => {
    let status = 0, text = ''
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    await handler({ method, url: `/orchestrator/api/${path}`, headers: { host: '127.0.0.1:3083', 'x-orchestrator-request': '1' },
      async *[Symbol.asyncIterator]() { yield* chunks } }, { writeHead: (c: number) => { status = c }, end: (d: string) => { text = d } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
}

it('POST rearm: the server refuses an unknown-outcome row without acknowledgeUnknownOutcome, and honours it with one', async () => {
  const { store, effects } = level()
  parkUnknown(store, effects)
  const call = http(effects)
  expect(await call('POST', 'effects/reply/rearm', { key: 'k' }))
    .toMatchObject({ status: 200, body: { rearmed: false, requiresAcknowledgement: true } })
  expect(effects.blocked('reply')).toHaveLength(1)                  // the refused call changed nothing
  expect(await call('POST', 'effects/reply/rearm', { key: 'k', acknowledgeUnknownOutcome: true }))
    .toMatchObject({ status: 200, body: { rearmed: true } })
  expect(await call('POST', 'effects/reply/rearm', { key: 'k', acknowledgeUnknownOutcome: 'yes' })).toMatchObject({ status: 400 })
})
