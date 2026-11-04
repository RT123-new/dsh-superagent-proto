/**
 * Issue 14 — ordered effect queues create head-of-line blocking.
 *
 * Fault proof (baseline @ reviewed/correctness-stage-b): `relay` and `notice` are registered `ordered: true`
 * (src/app/sessions.ts). Effects.dispatch considers only the single oldest row of an ordered kind and only runs it when
 * due, so one failing row holds back every later unrelated row of that kind for its whole backoff schedule
 * (src/app/effects.ts: "Ordered kinds block behind their oldest row even when it is not yet due").
 *
 * These tests reproduce the fault deterministically (injected clock, no real timers) and then verify a fixture-only
 * partition candidate: ordering preserved per partition (conversation), independent progress across partitions,
 * no duplicate effects, backoff per row, and crash-safe recovery. The candidate is NOT wired into production; it is
 * evidence for the smallest legitimate consistency boundary proposal in reports/issue-13-15-coordination-baseline.md.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { PartitionedQueue } from './fixtures/partitioned-queue.ts'

let directory: string
let store: Store
let clock: number
let board: HealthBoard
let effects: Effects
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const relays = () => store.db.prepare("SELECT key, attempts, due FROM effect WHERE kind = 'relay' ORDER BY seq").all() as { key: string; attempts: number; due: number }[]

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'issue14-'))
  store = new Store(join(directory, 'db.sqlite'))
  clock = Date.parse('2026-09-09T00:00:00Z')
  board = new HealthBoard()
  effects = new Effects(store, board, () => clock)
  effects.start()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

it('FAULT: one failing relay holds back every later unrelated relay for its whole backoff schedule', async () => {
  const ran: string[] = []
  let a1Failures = 0
  effects.handle('relay', async (_payload, key) => {
    ran.push(key)
    if (key === 'a1' && a1Failures++ < 6) throw new Error('session unavailable')
  }, { ordered: true })
  effects.enqueue('relay', 'a1', { text: 'report from ticket A (fails)' })
  effects.enqueue('relay', 'b1', { text: 'report from ticket B' })
  effects.enqueue('relay', 'b2', { text: 'report from ticket C' })
  await flush()
  expect(ran).toEqual(['a1']) // b1 and b2 never dispatched: the queue head is backed off, not just failing
  // Walk the deterministic backoff schedule: 2s, 4s, 8s, 16s, 32s, 60s (cap) — b1/b2 stay blocked throughout.
  const schedule: number[] = []
  for (let failure = 0; failure < 6; failure++) {
    const row = relays().find(r => r.key === 'a1')!
    schedule.push(row.due - clock)
    clock = row.due
    effects.kick()
    await flush()
    // Through five full backoff steps the unrelated b1/b2 have still never been dispatched.
    if (failure < 5) expect(ran.filter(key => key !== 'a1')).toEqual([])
  }
  expect(schedule).toEqual([2000, 4000, 8000, 16000, 32000, 60000])
  // The seventh attempt lets a1 through; only then do the unrelated b1/b2 run, 122 seconds after enqueue.
  await effects.idle()
  expect(ran).toEqual(['a1', 'a1', 'a1', 'a1', 'a1', 'a1', 'a1', 'b1', 'b2'])
  expect(clock - Date.parse('2026-09-09T00:00:00Z')).toBe(2000 + 4000 + 8000 + 16000 + 32000 + 60000)
  expect(effects.pending('relay')).toBe(false)
})

it('FAULT: a failing notice blocks unrelated notices behind it', async () => {
  const ran: string[] = []
  effects.handle('notice', async (_payload, name) => {
    ran.push(name)
    if (name === 'prompts') throw new Error('injection failed')
  }, { ordered: true })
  effects.enqueue('notice', 'prompts', { value: { revision: 2 }, summary: 'prompts changed' })
  effects.enqueue('notice', 'settings', { value: { revision: 5 }, summary: 'settings changed' })
  await flush()
  expect(ran).toEqual(['prompts'])
  clock += 60_000 // far beyond the first backoff step
  effects.kick(); await flush()
  effects.kick(); await flush()
  expect(ran).not.toContain('settings')
})

it('queued rows survive a restart with attempts and order intact (crash-safe recovery of the blocked queue)', async () => {
  effects.handle('relay', async () => { throw new Error('down') }, { ordered: true })
  effects.enqueue('relay', 'a1', { text: 'a' })
  effects.enqueue('relay', 'b1', { text: 'b' })
  await flush()
  const before = relays()
  expect(before.map(row => [row.key, row.attempts])).toEqual([['a1', 1], ['b1', 0]])
  await effects.drain() // stopped: running rows left for the next start
  const restarted = new Effects(store, new HealthBoard(), () => clock) // a restart rebuilds in-memory health
  const ran: string[] = []
  restarted.handle('relay', async (_p, key) => { ran.push(key) }, { ordered: true })
  restarted.start()
  clock += 2000
  restarted.kick(); await flush(); await flush()
  await restarted.idle()
  expect(ran).toEqual(['a1', 'b1'])
  await restarted.drain()
})

it('CANDIDATE: partitioned ordering keeps per-conversation order while unrelated conversations progress', async () => {
  const queue = new PartitionedQueue(store.db, 'relay', () => clock, key => key.slice(0, key.indexOf(':')))
  const ran: string[] = []
  let a1Failures = 0
  const run = async (text: string, key: string) => {
    ran.push(key)
    if (key === 'a:1' && a1Failures++ < 3) throw new Error('session unavailable')
  }
  queue.enqueue('a:1', 'report from ticket A (fails)')
  queue.enqueue('a:2', 'second report from ticket A')
  queue.enqueue('b:1', 'report from ticket B')
  await queue.dispatch(run); await flush()
  expect(ran).toEqual(['a:1', 'b:1']) // b:1 is not held behind a:1's backoff
  expect(queue.pending()).toEqual(['a:1', 'a:2'])
  clock += 2000
  await queue.dispatch(run); await flush() // a:1 retries (attempt 2, still failing); a:2 waits behind its own partition head
  expect(ran).toEqual(['a:1', 'b:1', 'a:1'])
  clock += 4000
  await queue.dispatch(run); await flush() // a:1 attempt 3 fails
  clock += 8000
  await queue.dispatch(run); await flush() // a:1 succeeds
  expect(ran.at(-1)).toBe('a:1')
  await queue.dispatch(run); await flush() // now a:2 runs, after a:1, preserving conversation order
  expect(ran.at(-1)).toBe('a:2')
  expect(queue.pending()).toEqual([])
  // No duplicates: b:1 ran exactly once.
  expect(ran.filter(key => key === 'b:1')).toHaveLength(1)
})

it('CANDIDATE: partitioned queue resumes after crash with no loss and no duplication', async () => {
  const queue = new PartitionedQueue(store.db, 'relay', () => clock, key => key.slice(0, key.indexOf(':')))
  let fail = true
  const ran: string[] = []
  queue.enqueue('a:1', 'a1'); queue.enqueue('b:1', 'b1')
  await queue.dispatch(async (_t, key) => { if (fail && key === 'a:1') throw new Error('down'); ran.push(key) }); await flush()
  // "Crash": new dispatcher instance over the same SQLite rows, a:1 mid-backoff.
  const recovered = new PartitionedQueue(store.db, 'relay', () => clock, key => key.slice(0, key.indexOf(':')))
  fail = false
  clock += 2000
  await recovered.dispatch(async (_t, key) => { ran.push(key) }); await flush()
  expect(ran).toEqual(['b:1', 'a:1'])
  expect(recovered.pending()).toEqual([])
})
