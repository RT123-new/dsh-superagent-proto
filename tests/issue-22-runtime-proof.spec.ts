import { expect, it } from 'vitest'
import { startRuntime, feishu } from './fixtures/host.ts'
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

it('serves actual default collector intake and managed usage through GET, and survives collector failure', async () => {
  const h = await startRuntime()
  try {
    h.runtime.receive(feishu('metric-real-1', 'An informational update'))
    h.ctx.emit('session/event', { id: h.runtime.masterId } as never, { type: 'assistant/message', data: {
      turn: 1, step: 1, message: { id: 'metric-real-output', role: 'assistant', content: [] }, stream: [],
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    } } as never)
    const response = await h.api('GET', 'overview')
    expect(response.status).toBe(200)
    expect(response.body.metrics).toMatchObject({
      durations: { 'trigger_intake|internal': { count: 1 } },
      tokens: { reports: 1, inputCacheMiss: 10, output: 2, byComponent: { coordinator: { reports: 1 } } },
    })
    const metrics = (h.runtime as unknown as { metrics: Metrics }).metrics
    metrics.snapshot = () => { throw new Error('broken observer') }
    const after = await h.api('GET', 'overview')
    expect(after.status).toBe(200)
    expect(after.body.metrics).toBeUndefined()
    expect(after.body.flow).toBeDefined()
  } finally { await h.stop() }
})
