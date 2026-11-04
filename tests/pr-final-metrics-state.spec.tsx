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
