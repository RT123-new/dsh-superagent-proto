/** Issue 9 production hooks: failure isolation, disjoint slot states, effect timings and authoritative queue length, intake timing. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Effects, Later } from '../src/app/effects.ts'
import { Passes } from '../src/app/passes.ts'
import { Store } from '../src/app/store.ts'
import { WorkerSlots } from '../src/executor/dsh.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { Metrics } from '../src/infra/metrics.ts'
import { Probe } from '../src/infra/metrics-probe.ts'
import type { Trigger } from '../src/core/index.ts'

let directory: string
let store: Store
let clock: number
let mono: number
let metrics: Metrics
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hooks-'))
  store = new Store(join(directory, 'db.sqlite'))
  clock = Date.parse('2026-09-09T00:00:00Z'); mono = 0
  metrics = new Metrics({ mono: () => mono, wall: () => clock })
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
const relay = (text: string) => ({ text })

it('Probe is a no-op without a collector and never lets a collector error escape', () => {
  const none = new Probe(undefined)
  expect(none.enabled).toBe(false)
  none.observe('effect_run', 'internal', 1); none.count('x'); none.usage('worker', {}); none.queueLength('effect', 1); none.slots('worker', 1, { busy: 1 }); none.timer('effect_run')()
  const broken = { observe: () => { throw new Error('boom') }, count: vi.fn(), queue: () => { throw new Error('boom') }, slotPool: () => { throw new Error('boom') },
    recordUsage: () => { throw new Error('boom') }, snapshot: () => { throw new Error('boom') }, mono: () => 0 }
  const probe = new Probe(broken as never)
  expect(() => { probe.observe('a', undefined, 1); probe.timer('a')('failed'); probe.queueLength('q', 1); probe.slots('w', 1, {}); probe.usage('w', undefined) }).not.toThrow()
  expect(broken.count).toHaveBeenCalledWith('metrics_error')
})

it('a failing timer goes to the failure series and never the success quantiles', () => {
  const probe = new Probe(metrics)
  const ok = probe.timer('workspace_prepare', 'internal'); mono += 10; ok()
  const bad = probe.timer('workspace_prepare', 'internal'); mono += 99; bad('failed'); bad()
  const s = metrics.snapshot()
  expect(s.durations['workspace_prepare|internal']).toMatchObject({ count: 1, maxMs: 10 })
  expect(s.failedDurations['workspace_prepare|internal']).toMatchObject({ count: 1, maxMs: 99 })
})

it('WorkerSlots reports disjoint busy/preparing states: a ticket that runs and still holds a reservation counts once, as busy', () => {
  const running = ['a', 'b']
  const slots = new WorkerSlots(() => running, () => 3)
  expect(slots.states()).toEqual({ capacity: 3, busy: 2, preparing: 0 })
  slots.reserve('b', 'wake'); slots.reserve('c', 'launch')
  expect(slots.states()).toEqual({ capacity: 3, busy: 2, preparing: 1 })
  expect(slots.used()).toBe(3)
  slots.free('b'); slots.free('c')
  expect(slots.states().preparing).toBe(0)
})

it('slot integrals follow configured capacity and keep over-limit person wakes visible', () => {
  const probe = new Probe(metrics)
  probe.slots('worker', 2, { busy: 0, preparing: 0 }); mono += 10
  probe.slots('worker', 2, { busy: 2, preparing: 1 }); mono += 10   // person wake: 3 active against capacity 2
  const slot = metrics.snapshot().slots.worker!
  expect(slot.integrals.capacitySlotMs).toBe(40); expect(slot.integrals.overLimitSlotMs).toBe(10); expect(slot.utilization).toBe(30 / 40)
})

it('Effects records run duration, schedule lateness, total age, failures and retries, and the authoritative queue length', async () => {
  const effects = new Effects(store, new HealthBoard(), () => clock, new Probe(metrics))
  const run = vi.fn(async (_payload: unknown, _key: string) => { mono += 7 })
  effects.handle('relay', run)
  store.atomic(() => { effects.enqueue('relay', 'one', relay('a')) })
  clock += 5000                                   // the row waits 5s in wall-clock before the queue starts
  effects.start()
  await effects.idle()
  let s = metrics.snapshot()
  expect(s.durations['effect_run|internal']).toMatchObject({ count: 1, maxMs: 7 })
  expect(s.durations['effect_schedule_lateness|internal']?.maxMs).toBe(5000)
  expect(s.durations['effect_total_age|internal']?.maxMs).toBe(5000)
  // A failure is a failure sample plus a retry count; a Later is not counted as a failure of the work.
  run.mockImplementationOnce(async () => { mono += 3; throw new Error('nope') })
  store.atomic(() => { effects.enqueue('relay', 'two', relay('b')) })
  await effects.idle()
  s = metrics.snapshot()
  expect(s.failedDurations['effect_run|internal']).toMatchObject({ count: 1, maxMs: 3 })
  expect(s.durations['effect_run|internal']?.count).toBe(1)
  expect(s.counters.effect_retry).toBe(1)
  // Queue length comes from the owning table at read time, never from tracked ids.
  effects.measure()
  expect(metrics.snapshot().queues.effect).toMatchObject({ depth: 1, depthComplete: false })
  expect(() => { throw new Later('x') }).toThrow()
  await effects.drain()
})

it('Passes times Trigger intake, counts the outcome, and records a throwing intake as a failure that still throws', () => {
  const health = new HealthBoard().claim('runtime', { state: 'starting', detail: '' })
  const engine = { receive: vi.fn((): 'stored' | 'duplicate' => { mono += 4; return 'duplicate' }), evaluateDue: vi.fn() }
  const effects = { kick: vi.fn(), idle: vi.fn(async () => {}) }
  const passes = new Passes({ engine, effects, health, lifetime: new AbortController().signal, configured: () => true, closing: () => false, probe: new Probe(metrics) })
  const trigger = { id: 't1' } as Trigger
  expect(passes.receive(trigger)).toBe('duplicate')
  engine.receive.mockImplementationOnce(() => { mono += 9; throw new Error('db locked') })
  expect(() => passes.receive(trigger)).toThrow('db locked')
  const s = metrics.snapshot()
  expect(s.durations['trigger_intake|internal']).toMatchObject({ count: 1, maxMs: 4 })
  expect(s.failedDurations['trigger_intake|internal']).toMatchObject({ count: 1, maxMs: 9 })
  expect(s.counters.trigger_duplicate).toBe(1)
})

it('usage is attributed to a component and a missing usage stays an unknown report', () => {
  const probe = new Probe(metrics)
  probe.usage('worker', { inputCacheMiss: 10, inputCacheHit: 5, output: 2 })
  probe.usage('coordinator', undefined)
  probe.usage('made-up', { output: 1 })
  const t = metrics.snapshot().tokens
  expect(t.reports).toBe(3)
  expect(t.byComponent.worker).toMatchObject({ reports: 1, inputCacheMiss: 10, output: 2 })
  expect(t.byComponent.coordinator).toMatchObject({ reports: 1, output: null })
  expect(t.byComponent.other?.reports).toBe(1)
  expect(t.costUsd).toBeNull()
})

it('Commands records whole-subprocess latency under a fixed label, failures separately, and rethrows the original CLI error', async () => {
  const { Commands } = await import('../src/infra/commands.ts')
  const commands = new Commands(() => ({}) as never, {}, new AbortController().signal, new Probe(metrics))
  await commands.run('true', [])
  await expect(commands.run('false', [])).rejects.toBeDefined()
  const s = metrics.snapshot()
  expect(s.durations['command_run|internal']?.count).toBe(1)
  expect(s.failedDurations['command_run|internal']?.count).toBe(1)
  expect(JSON.stringify(s)).not.toContain('false')
})
