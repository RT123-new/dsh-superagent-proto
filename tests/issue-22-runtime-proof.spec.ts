import { expect, it } from 'vitest'
import { startRuntime } from './fixtures/host.ts'
import { Metrics, STAGES, SOURCES } from '../src/infra/metrics.ts'

it('requires Runtime.metricsSnapshot to reach the HTTP adapter', async () => {
  const h = await startRuntime()
  try {
    const before = await h.api('GET', 'overview')
    expect(before.status).toBe(200)
    expect(before.body.metrics).toMatchObject({ version: 1, durations: {}, tokens: { reports: 0 } })
    const collector = new Metrics()
    collector.observe('workspace_prepare', 'github', 42, 'failure')
    collector.recordUsage({ output: 3 })
    ;(h.runtime as unknown as { metricsSnapshot: () => unknown }).metricsSnapshot = () => collector.snapshot()
    const after = await h.api('GET', 'overview')
    expect(after.status).toBe(200)
    expect(after.body.metrics).toMatchObject({ version: 1, failedDurations: { 'workspace_prepare|github': { count: 1, p95Ms: 42 } }, tokens: { output: 3, costUsd: null } })
  } finally { await h.stop() }
})
