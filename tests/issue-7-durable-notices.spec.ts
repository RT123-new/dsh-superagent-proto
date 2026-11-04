/** Independent queue-level notice proofs using real SQLite close/reopen and session history replay. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Store } from '../src/app/store.ts'
import { Effects } from '../src/app/effects.ts'
import { Sessions } from '../src/app/sessions.ts'

const cleanup: (() => void)[] = []
afterEach(() => { for (const clean of cleanup.splice(0).reverse()) clean() })
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'notice-review-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const history: unknown[] = [], observed: number[] = []
  const ctx = new Context(), agents = new Map()
  let available = true, failure = false, barrier: Promise<void> | undefined
  const agent = { id: 'master', session: {}, inbox: { nextTurn: [], nextStep: [] }, inject: (message: any) => {
    if (failure) throw new Error('injection failed')
    history.push({ type: 'user/message', data: message }); observed.push(JSON.parse(message.content[0].text).revision)
  } }
  agents.set('master', agent)
  ctx.reflect.provide('agents', agents)
  ctx.reflect.provide('sessionController', { resolveAgent: async () => available ? { agent } : { error: { code: 'session/not-found' } } })
  ctx.reflect.provide('sessionPersistence', { flush: async () => { await barrier }, open: async () => ({
    read: async (offset: number) => ({ events: history.slice(offset) }), [Symbol.asyncDispose]: async () => {},
  }) })
  const open = () => {
    const store = new Store(join(directory, 'store.sqlite')); cleanup.push(() => store.close())
    const effects = new Effects(store, { claim: () => ({ set: () => {} }) } as never)
    const sessions = new Sessions({ context: ctx, store, effects, masterId: 'master', lifetime: new AbortController().signal } as never)
    effects.start()
    return { store, effects, sessions }
  }
  const notify = (h: ReturnType<typeof open>, revision: number) => h.sessions.notify('settings:eval', { settings_saved: 'eval', revision }, 'saved')
  return { open, notify, observed, setAvailable: (value: boolean) => { available = value },
    setFailure: (value: boolean) => { failure = value }, setBarrier: (value?: Promise<void>) => { barrier = value } }
}
it('coalesces rapid waiting updates to the latest state and survives a real database reopen', async () => {
  const h = harness(); const first = h.open()
  h.setAvailable(false)
  h.notify(first, 1); h.notify(first, 2); h.notify(first, 3)
  await first.effects.idle()
  expect(first.effects.pending('notice')).toBe(true)
  await first.effects.drain(); cleanup.pop()!() // close real SQLite connection
  h.setAvailable(true)
  const second = h.open()
  second.store.db.prepare('UPDATE effect SET due = 0').run()
  await second.effects.idle()
  expect(h.observed).toEqual([3])
  h.notify(second, 3); await second.effects.idle()
  expect(h.observed).toEqual([3]) // history replay prevents redelivery after restart
})
it('does not delete newer revisions queued while an earlier generation runs', async () => {
  const h = harness(); const first = h.open()
  const gate = Promise.withResolvers<void>(); h.setBarrier(gate.promise)
  h.notify(first, 1); await Promise.resolve(); await Promise.resolve()
  h.notify(first, 2); h.notify(first, 3)
  gate.resolve(); h.setBarrier(); await first.effects.idle()
  expect(h.observed.at(-1)).toBe(3)
  expect(first.effects.pending('notice')).toBe(false)
})
it('retries failed injection and delivers a later revision instead of losing it', async () => {
  const h = harness(); const first = h.open()
  h.setFailure(true); h.notify(first, 1); await first.effects.idle()
  expect(first.effects.pending('notice')).toBe(true)
  h.notify(first, 2); h.setFailure(false); await first.effects.idle()
  expect(h.observed).toEqual([2])
  expect(first.effects.pending('notice')).toBe(false)
})
