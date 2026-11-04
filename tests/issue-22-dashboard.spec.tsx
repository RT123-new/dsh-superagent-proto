// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Metrics } from '../src/infra/metrics.ts'
import { MetricsPanel } from '../src/client/metrics.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
const translate = (dict: typeof en): T => ((key: keyof typeof en, values?: Record<string, unknown>) =>
  Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] ?? key)) as T
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount() }); document.body.innerHTML = '' })
function render(metrics: Metrics, dict = en) {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); roots.push(root)
  act(() => { root.render(<MetricsPanel metrics={metrics.snapshot()} t={translate(dict)} />) })
  return node
}
it('shows unavailable telemetry as unknown, including all unobserved mandated stages, without a zero-cost success claim', () => {
  const node = render(new Metrics())
  expect(node.textContent).toContain('Not observed')
  expect(node.querySelectorAll('tbody tr')).toHaveLength(12)
  expect(node.textContent).toContain('not total usage')
  expect(node.textContent).toContain('resets on restart')
  expect(node.textContent).toContain('not lifetime')
  expect(node.textContent).not.toContain('0.000000')
})
it('labels partial queues and component tokens honestly, with nearest-rank recent-window durations', () => {
  let mono = 0
  const metrics = new Metrics({ mono: () => mono, window: 3 })
  for (const ms of [1, 10, 100]) metrics.observe('eval_queue_wait', 'github', ms)
  const queue = metrics.queue('eval', 1); queue.enqueue('tracked'); queue.enqueue('dropped'); mono = 200
  metrics.recordUsage({ inputCacheMiss: 20, output: 10 })
  const node = render(metrics)
  expect(node.textContent).toContain('Incomplete; age covers tracked items only')
  expect(node.textContent).toContain('latest 3 samples')
  expect(node.querySelector('tbody tr:nth-child(2)')?.textContent).toContain('Eval queue wait / github310100')
  expect(node.textContent).toContain('Reports with unknown cost1')
  expect(node.textContent).toContain('Cache read')
})
it('supports the existing Chinese locale without raw translation keys', () => {
  const node = render(new Metrics(), zh)
  expect(node.textContent).toContain(zh.metricsTitle)
  expect(node.textContent).not.toContain('metricsStage.')
  expect(node.textContent).not.toContain('Not observed')
})

it('separates failed attempts from success quantiles', () => {
  const metrics = new Metrics()
  metrics.observe('workspace_prepare', 'internal', 500, 'failure')
  const node = render(metrics)
  expect(node.textContent).toContain('Failed attempt durations (separate from success samples)')
  expect(node.querySelectorAll('table')).toHaveLength(2)
  expect(node.querySelector('table')?.textContent).not.toContain('500')
  expect(node.querySelectorAll('table')[1]?.textContent).toContain('500')
})
