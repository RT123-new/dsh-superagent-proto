import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'

let directory: string, store: Store, clock: number, board: HealthBoard, effects: Effects
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'review-blocked-head-'))
  store = new Store(join(directory, 'db.sqlite')); clock = Date.parse('2026-11-04T00:00:00Z'); board = new HealthBoard()
  effects = new Effects(store, board, () => clock, undefined, () => 0.5); effects.start()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

/**
 * CHARACTERISATION of current behaviour (de50174), written to document a confirmed operational risk, not to bless it:
 * a permanent-class failure parks the head row as `blocked:`; an ordered kind only ever considers its oldest row, so every later row of that kind
 * waits behind the parked one. Nothing in src re-enqueues a relay or notice key or cancels one, so the stall outlasts time and restart.
 */
it('an ordered relay parked as blocked holds back every later relay, across days and a restart', async () => {
  const ran: string[] = []
  const run = async (_payload: unknown, key: string) => { ran.push(key); if (key === 'a1') throw Object.assign(new Error('session gone'), { status: 404 }) }
  effects.handle('relay', run, { ordered: true })
  effects.enqueue('relay', 'a1', { text: 'a' })
  effects.enqueue('relay', 'b1', { text: 'b' })
  await flush()
  const head = store.db.prepare("SELECT error FROM effect WHERE kind='relay' AND key='a1'").get()!
  expect(String(head.error)).toMatch(/^blocked:permanent/)
  clock += 7 * 24 * 3600_000; effects.kick(); await flush()
  expect(ran).toEqual(['a1'])                                  // b1 still not delivered after a week
  expect(effects.pending('relay', 'b1')).toBe(true)
  // Restart: a new Effects over the same store behaves the same.
  await effects.drain()
  const again = new Effects(store, new HealthBoard(), () => clock, undefined, () => 0.5)
  const ran2: string[] = []
  again.handle('relay', async (_payload, key) => { ran2.push(key); if (key === 'a1') throw Object.assign(new Error('session gone'), { status: 404 }) }, { ordered: true })
  again.start(); await flush()
  expect(ran2).toEqual([])                                     // not even the parked head retries without a re-enqueue
  expect(again.pending('relay', 'b1')).toBe(true)
  // Only an explicit re-enqueue of the head key frees the line.
  again.enqueue('relay', 'a1', { text: 'a again' }); await flush()
  expect(ran2).toEqual(['a1'])
})
