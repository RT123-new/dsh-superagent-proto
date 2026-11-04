import { expect, it } from 'vitest'
import { startRuntime } from './fixtures/host.ts'
import { registerHttp } from '../src/app/http.ts'
import type { HttpHost } from '../src/app/http.ts'
import { Metrics, STAGES, SOURCES } from '../src/infra/metrics.ts'

it('composes an optional HttpHost snapshot in overview and keeps a legacy adapter compatible', async () => {
  const h = await startRuntime()
  try {
    const before = await h.api('GET', 'overview')
    expect(before.status).toBe(200)
    expect(before.body.metrics).toBeUndefined()
    const collector = new Metrics()
    collector.observe('workspace_prepare', 'github', 42, 'failure')
    collector.recordUsage({ output: 3 })
    // Runtime.httpHost must supply this callback separately; adding only a Runtime method is insufficient.
    const host = (h.runtime as unknown as { httpHost: () => HttpHost }).httpHost()
    registerHttp(h.ctx, { ...host, metricsSnapshot: () => collector.snapshot() })
    const after = await h.api('GET', 'overview')
    expect(after.status).toBe(200)
    expect(after.body.metrics).toMatchObject({ version: 1, failedDurations: { 'workspace_prepare|github': { count: 1, p95Ms: 42 } }, tokens: { output: 3, costUsd: null } })
  } finally { await h.stop() }
})
it('records bounded populated snapshot payload size and serialization overhead without raw queue IDs', () => {
  let mono = 0
  const metrics = new Metrics({ mono: () => mono, window: 1024 })
  for (const stage of STAGES) for (const source of SOURCES) for (let i = 0; i < 1024; i++) {
    metrics.observe(stage, source, i); metrics.observe(stage, source, i, 'failure')
  }
  for (const kind of ['eval', 'assignment', 'effect']) for (let i = 0; i < 1000; i++) metrics.queue(kind).enqueue(`private-id-${i}`)
  mono = 100
  const start = performance.now(); let json = ''
  for (let i = 0; i < 100; i++) json = metrics.serialize().json
  const averageMs = (performance.now() - start) / 100
  console.log(JSON.stringify({ scenario: '48 successful + 48 failed stage/source series, 1024 samples each, 3000 tracked queue IDs', bytes: Buffer.byteLength(json), averageSerializationMs: averageMs, visiblePayloadBytesPerSecondAt5s: Buffer.byteLength(json) / 5 }))
  expect(Buffer.byteLength(json)).toBeLessThan(50000)
  expect(json).not.toContain('private-id-')
})
