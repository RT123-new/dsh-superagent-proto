/** Review phase 3 (mandate §10): operator-facing health details carry a stable typed class and whitelisted status only - never arbitrary error prose. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { Passes } from '../src/app/passes.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { CliError } from '../src/infra/commands.ts'

const MARKER = 'SECRET-MARKER-7f3a9c2e'

it('effect-queue failure health detail carries the typed class and whitelisted status, never provider prose', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-redact-'))
  const store = new Store(join(dir, 'db.sqlite'))
  const board = new HealthBoard()
  const effects = new Effects(store, board, () => Date.parse('2026-09-09T00:00:00Z'))
  effects.start()
  effects.handle('relay', async () => {}, { limit: () => { throw new CliError(`provider exploded: token=${MARKER}`, 503) } })
  effects.enqueue('relay', 'k', { text: 'a' })
  await effects.idle()
  const detail = (board.all as Record<string, { detail?: string }>).relay?.detail ?? ''
  expect(detail).not.toContain(MARKER)
  expect(detail).toContain('provider_temporary')
  expect(detail).toContain('503')
  await effects.drain()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

it('pass failure health detail carries the typed class, never error prose', async () => {
  const health = new HealthBoard().claim('runtime', { state: 'starting', detail: '' })
  const engine = { receive: vi.fn(() => 'stored' as const), evaluateDue: vi.fn(() => { throw new Error(`database is locked: ${MARKER}`) }) }
  const effects = { kick: vi.fn(), idle: vi.fn(async () => {}) }
  const passes = new Passes({ engine, effects, health, lifetime: new AbortController().signal, configured: () => true, closing: () => false } as never)
  passes.request()
  await passes.idle()
  const detail = health.get()?.detail ?? ''
  expect(detail).not.toContain(MARKER)
  expect(detail).toContain('transient')
})

it('failing effect rows surface the stored failure in health as typed class and status only, never stored provider prose', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-redact-report-'))
  const store = new Store(join(dir, 'db.sqlite'))
  let clock = Date.parse('2026-09-09T00:00:00Z')
  const board = new HealthBoard()
  const effects = new Effects(store, board, () => clock)
  effects.start()
  const run = vi.fn(async () => { throw new CliError(`rate limited: retry token=${MARKER}`, 503) })
  effects.handle('notice', run, { retry: [1000, 3000] })
  effects.enqueue('notice', 'k', { value: { prompt_config_saved: 2 }, summary: 'Prompt configuration saved' })
  const due = () => (store.db.prepare("SELECT due FROM effect WHERE kind = 'notice'").get() as { due: number }).due
  for (let attempt = 0; attempt < 3; attempt++) {
    clock = due()
    await effects.idle()
  }
  const entry = (board.all as Record<string, { state?: string, detail?: string }>).notice
  expect(entry?.state).toBe('error')
  expect(entry?.detail ?? '').not.toContain(MARKER)
  expect(entry?.detail ?? '').toContain('provider_temporary')
  expect(entry?.detail ?? '').toContain('503')
  await effects.drain()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})
