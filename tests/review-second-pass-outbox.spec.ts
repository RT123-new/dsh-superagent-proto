/** Second-pass regressions: withdrawal must stop retries without erasing evidence of a possible send. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Outbox } from '../src/app/outbox.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { OutboundMessage } from '../src/core/index.ts'

const stores: Store[] = [], dirs: string[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const message: OutboundMessage = { id: 'withdraw-race', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Original', kind: 'reply' }
function harness(send: (message: OutboundMessage) => Promise<'sent' | 'gone'>, idempotent = false) {
  const dir = mkdtempSync(join(tmpdir(), 'second-outbox-')); dirs.push(dir)
  const store = new Store(join(dir, 'state.sqlite')); stores.push(store)
  const effects = new Effects(store, new HealthBoard())
  const sources = {
    instance: () => ({ enabled: true }), channelAllowed: () => true,
    channelIdempotency: () => idempotent ? 'provider' as const : undefined,
    channelIdempotencyWindow: () => idempotent ? 3_600_000 : undefined,
    send,
  }
  const outbox = new Outbox({ store, effects, sources: sources as never, commands: {} as Commands, paused: () => false })
  return { store, effects, outbox }
}
function barrier() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

it('still removes a never-dispatched withdrawal without contacting the provider', async () => {
  let calls = 0
  const { effects, outbox } = harness(async () => { calls++; return 'sent' })
  outbox.send(message)
  outbox.withdraw(message.id)
  effects.start(); await effects.idle()
  expect(outbox.status(message.id)).toBeUndefined()
  expect(calls).toBe(0)
})

it('keeps uncertain delivery evidence when withdrawal races an accepted send whose acknowledgement is lost', async () => {
  const entered = barrier(), finish = barrier()
  const accepted: string[] = []
  const { store, effects, outbox } = harness(async item => {
    accepted.push(item.text); entered.release(); await finish.wait
    throw new Error('acknowledgement lost after acceptance')
  })
  outbox.send(message); effects.start(); await entered.wait
  outbox.withdraw(message.id)
  finish.release(); await effects.idle()
  expect(store.receipts.get(message.id)).toMatchObject({ text: 'Original', status: 'dropped', dropped: { reason: 'withdrawnUnknown' } })
  expect(outbox.outcome(message.id)).toBe('attempted-unknown')
  expect(effects.pending('reply', message.id)).toBe(false)
  outbox.send({ ...message, text: 'Replacement' }); await effects.idle()
  expect(accepted).toEqual(['Original'])
})

it('keeps the original receipt when withdrawal and requeue happen before an in-flight acknowledgement', async () => {
  const entered = barrier(), finish = barrier()
  const accepted: string[] = []
  const { store, effects, outbox } = harness(async item => {
    accepted.push(item.text); entered.release(); await finish.wait; return 'sent'
  })
  outbox.send(message); effects.start(); await entered.wait
  outbox.withdraw(message.id)
  outbox.send({ ...message, text: 'Replacement never delivered' })
  finish.release(); await effects.idle()
  expect(store.receipts.get(message.id)).toMatchObject({ text: 'Original', status: 'sent' })
  expect(outbox.outcome(message.id)).toBe('sent')
  expect(accepted).toEqual(['Original'])
})

it.each([false, true])('withdrawal retains a possibly accepted receipt before requeue (provider idempotency: %s)', async idempotent => {
  let calls = 0
  const { store, effects, outbox } = harness(async () => { calls++; throw new Error('accepted but no acknowledgement') }, idempotent)
  outbox.send(message); effects.start(); await effects.idle()
  expect(store.receipts.get(message.id)?.providerContact).toBe(true)
  outbox.withdraw(message.id)
  expect(outbox.outcome(message.id)).toBe('attempted-unknown')
  expect(effects.pending('reply', message.id)).toBe(false)
  outbox.send(message); await effects.idle()
  expect(calls).toBe(1)
})

it.each(['not-a-date', '2999-01-01T00:00:00.000Z'])('refuses a possibly accepted retry with an untrustworthy queuedAt (%s)', async queuedAt => {
  let calls = 0
  const { store, effects, outbox } = harness(async () => { calls++; return 'sent' }, true)
  outbox.send(message)
  store.db.prepare('UPDATE outbox SET value = json_patch(value, ?) WHERE id = ?')
    .run(JSON.stringify({ queuedAt, providerContact: true }), message.id)
  effects.start(); await effects.idle()
  expect(calls).toBe(0)
  expect(outbox.outcome(message.id)).toBe('attempted-unknown')
  expect(effects.blocked('reply')).toHaveLength(1)
})
