/** Final review phase 2.4: a permanently blocked ordered head must be recoverable by an explicit operator action, never automatically. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'

const dirs: string[] = [], stores: Store[] = []
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const setup = (fail: { on: boolean }) => {
  const dir = mkdtempSync(join(tmpdir(), 'rearm-')); dirs.push(dir)
  const store = new Store(join(dir, 'o.sqlite'), () => {}); stores.push(store)
  let clock = 1_000_000
  const effects = new Effects(store, new HealthBoard(), () => clock)
  const ran: string[] = []
  effects.handle('relay', async (_p, key) => {
    if (key === 'head' && fail.on) throw Object.assign(new Error('bad request'), { status: 400 })
    ran.push(key)
  }, { ordered: true })
  const tick = async () => { clock += 5_000_000; effects.kick(); await new Promise(r => setTimeout(r, 40)) }
  return { store, effects, ran, tick }
}

it('a blocked ordered head stalls followers; blocked() lists it; rearm resumes it and then the followers', async () => {
  const fail = { on: true }; const { store, effects, ran, tick } = setup(fail)
  store.atomic(() => { effects.enqueue('relay', 'head', { text: 'a' }); effects.enqueue('relay', 'next', { text: 'b' }) })
  effects.start(); await tick(); await tick()
  expect(ran).toEqual([])                                           // follower stalled behind the parked head (confirmed behaviour)
  expect(effects.blocked('relay').map(row => row.key)).toEqual(['head'])
  expect(effects.blocked('relay')[0]!.error).toMatch(/^blocked:/)
  fail.on = false; await tick()
  expect(ran).toEqual([])                                           // nothing rearms automatically
  expect(effects.rearm('relay', 'head')).toBe(true)
  await tick(); await tick()
  expect(ran).toEqual(['head', 'next'])
  expect(effects.blocked('relay')).toEqual([])
})

it('rearm refuses a row that is not blocked; explicit cancel (discard) releases followers', async () => {
  const fail = { on: true }; const { store, effects, ran, tick } = setup(fail)
  store.atomic(() => { effects.enqueue('relay', 'head', { text: 'a' }); effects.enqueue('relay', 'next', { text: 'b' }) })
  expect(effects.rearm('relay', 'next')).toBe(false)
  effects.start(); await tick(); await tick()
  effects.cancel('relay', 'head'); await tick()
  expect(ran).toEqual(['next'])
})

it('rearm refuses a blocked row whose recheck attempt is in flight, keeping its started marker and generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rearm2-')); dirs.push(dir)
  const store = new Store(join(dir, 'o.sqlite'), () => {}); stores.push(store)
  let clock = 1_000_000
  const effects = new Effects(store, new HealthBoard(), () => clock)
  const hung: (() => void)[] = []; let n = 0
  effects.handle('relay', async () => { n++; if (n === 1) throw Object.assign(new Error('bad'), { status: 400 }); await new Promise<void>(r => hung.push(r)) }, { ordered: true, markAttempt: true })
  store.atomic(() => effects.enqueue('relay', 'head', { text: 'a' }))
  effects.start(); await new Promise(r => setTimeout(r, 40))
  expect(effects.blocked('relay')).toHaveLength(1)
  // Simulate an in-flight attempt on the parked row (as a recheck would be): marker present and a task running.
  store.db.prepare("UPDATE effect SET error = error || ' [attempt-started]' WHERE key = 'head'").run()
  const before = store.db.prepare("SELECT error, generation FROM effect WHERE key = 'head'").get()
  expect(effects.rearm('relay', 'head')).toBe(false)
  expect(store.db.prepare("SELECT error, generation FROM effect WHERE key = 'head'").get()).toEqual(before)
})
