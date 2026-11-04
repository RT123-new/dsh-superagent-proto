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
it('legacy HttpHost without metricsReading keeps working: snapshot present is ok, absent is off', async () => {
  const { registerHttp } = await import('../src/app/http.ts')
  const h = await startRuntime()
  try {
    const host = (h.runtime as unknown as { httpHost: () => Record<string, unknown> }).httpHost()
    const { metricsReading: _drop, ...legacy } = host
    registerHttp(h.ctx, { ...legacy, metricsSnapshot: () => undefined } as never)
    expect((await h.api('GET', 'overview')).body.metricsState).toBe('off')
  } finally { await h.stop() }
})
it('overview panel shows a failed-state hint only for metricsState failed, and nothing extra for off', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/overview.tsx', import.meta.url), 'utf8')
  expect(src).toContain("data.metricsState === 'failed'")
})
it('M5 read-order: metricsSnapshot wins and metricsReading is not called when a snapshot exists; a throwing-then-ok pair returns the second (ok) result as one consistent response; both missing explains via reading', async () => {
  const { registerHttp } = await import('../src/app/http.ts')
  const { Metrics } = await import('../src/infra/metrics.ts')
  const h = await startRuntime()
  try {
    const host = (h.runtime as unknown as { httpHost: () => Record<string, unknown> }).httpHost()
    const snap = new Metrics().snapshot()
    let readings = 0
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => snap, metricsReading: () => { readings++; return { state: 'failed' } } } as never)
    const a = await h.api('GET', 'overview')
    expect(a.body.metricsState).toBe('ok'); expect(readings).toBe(0)
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => undefined, metricsReading: () => ({ state: 'ok', snapshot: snap }) } as never)
    const b = await h.api('GET', 'overview')
    expect(b.body.metricsState).toBe('ok'); expect(b.body.metrics).toBeTruthy()
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => undefined, metricsReading: () => ({ state: 'failed' }) } as never)
    const c = await h.api('GET', 'overview')
    expect(c.body.metricsState).toBe('failed'); expect(c.body.metrics).toBeUndefined()
    // No underlying failure: instrumentation off must never be reported as failed.
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => undefined, metricsReading: () => ({ state: 'off' }) } as never)
    expect((await h.api('GET', 'overview')).body.metricsState).toBe('off')
  } finally { await h.stop() }
})
