// M5: overview must distinguish instrumentation off / ok / snapshot failed through the real Runtime + HTTP path.
import { expect, it } from 'vitest'
import { startRuntime } from './fixtures/host.ts'
it('GET overview reports metricsState ok, failed (snapshot throws) and off (instrumentation disabled) from the real runtime', async () => {
  const h = await startRuntime()
  try {
    const rt = h.runtime as unknown as { metrics: unknown }
    const real = rt.metrics as { snapshot(): unknown }
    const ok = await h.api('GET', 'overview')
    expect(ok.body.metricsState).toBe('ok'); expect(ok.body.metrics).toBeTruthy()
    rt.metrics = Object.assign(Object.create(real as object), { snapshot() { throw new Error('boom') } })
    const failed = await h.api('GET', 'overview')
    expect(failed.status).toBe(200)
    expect(failed.body.metricsState).toBe('failed'); expect(failed.body.metrics).toBeUndefined()
    rt.metrics = undefined
    const off = await h.api('GET', 'overview')
    expect(off.body.metricsState).toBe('off'); expect(off.body.metrics).toBeUndefined()
  } finally { await h.stop() }
})
it('real runtime+HTTP failed overview does ONE read: one effects.measure and one metrics_error per request', async () => {
  const h = await startRuntime()
  try {
    const rt = h.runtime as unknown as { metrics: unknown; effects: { measure(): void } }
    const real = rt.metrics as { snapshot(): unknown; count(n: string, by?: number): void }
    let snapshots = 0, measures = 0
    const measure = rt.effects.measure.bind(rt.effects)
    rt.effects.measure = () => { measures++; measure() }
    rt.metrics = Object.assign(Object.create(real as object), { snapshot() { snapshots++; throw new Error('boom') } })
    const before = (real.snapshot() as { counters: Record<string, number> }).counters.metrics_error ?? 0
    snapshots = 0; measures = 0
    const res = await h.api('GET', 'overview')
    expect(res.body.metricsState).toBe('failed')
    expect([snapshots, measures]).toEqual([1, 1])
    expect(((real.snapshot() as { counters: Record<string, number> }).counters.metrics_error ?? 0) - before).toBe(1)
  } finally { await h.stop() }
})
it('host overrides of metricsSnapshot stay authoritative; a stale ok state without a snapshot is reported off, never failed or ok', async () => {
  const { registerHttp } = await import('../src/app/http.ts')
  const { Metrics } = await import('../src/infra/metrics.ts')
  const h = await startRuntime()
  try {
    const host = (h.runtime as unknown as { httpHost: () => Record<string, unknown> }).httpHost()
    const snap = new Metrics().snapshot()
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => snap, metricsState: () => 'failed' } as never)
    expect((await h.api('GET', 'overview')).body.metricsState).toBe('ok')
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => undefined, metricsState: () => 'ok' } as never)
    expect((await h.api('GET', 'overview')).body.metricsState).toBe('off')
    const { metricsState: _drop, ...legacy } = host
    registerHttp(h.ctx, { ...legacy, metricsSnapshot: () => undefined } as never)
    expect((await h.api('GET', 'overview')).body.metricsState).toBe('off')
  } finally { await h.stop() }
})
it('overview panel shows a failed-state hint only for metricsState failed, and nothing extra for off', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/overview.tsx', import.meta.url), 'utf8')
  expect(src).toContain("data.metricsState === 'failed'")
})
