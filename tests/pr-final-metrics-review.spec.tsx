// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Metrics, nearestRank } from '../src/infra/metrics.ts'
import { Probe } from '../src/infra/metrics-probe.ts'
import { SessionTimeline, DomainTimeline } from '../src/infra/metrics-lifecycle.ts'
import { MetricsPanel } from '../src/client/metrics.tsx'
import { en } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
// PR_FINAL_REVIEW findings M1 (counter overflow), M2 (clock anomaly zero-fill), M3 (dashboard crash on invalid wall bounds), M4 (percentile oracle).
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const translate = (dict: typeof en): T => ((key: keyof typeof en) => dict[key] ?? key) as T
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount() }); document.body.innerHTML = '' })

it('M4: nearest-rank P50/P95 equal the exact integer ceil(p*n/100) for every window size', () => {
  const bad: string[] = []
  for (const p of [50, 95]) for (let n = 1; n <= 10_000; n++) {
    const sorted = Array.from({ length: n }, (_, i) => i + 1)
    const expected = Math.max(1, Math.floor((p * n + 99) / 100))
    if (nearestRank(sorted, p) !== expected) bad.push(`p${p} n${n}`)
  }
  expect(bad).toEqual([])
})
it('M1: counters saturate at MAX_SAFE_INTEGER instead of silently losing precision', () => {
  const m = new Metrics()
  m.count('events', Number.MAX_SAFE_INTEGER); m.count('events', 5); m.count('events', 1)
  expect(m.snapshot().counters.events).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
  expect(Number.isSafeInteger(m.snapshot().counters.events)).toBe(true)
})
it('M2: a backwards clock never becomes a zero-millisecond success sample in worker or domain timelines', () => {
  let now = 100
  const metrics = new Metrics({ mono: () => now }); const probe = new Probe(metrics)
  const session = new SessionTimeline(probe, () => now)
  session.observe('s', { type: 'turn/start', data: { turn: 1 } }); now = 50
  session.observe('s', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  const domain = new DomainTimeline(probe, () => now)
  now = 100; domain.observe({ type: 'ticket.created', data: { decisionId: 'd', ticketId: 't' } } as never)
  domain.observe({ type: 'decision.recorded', data: { decisionId: 'd', kind: 'x' } } as never)
  const snap = metrics.snapshot()
  expect(snap.durations['worker_turn|internal']).toBeUndefined()
  expect(snap.counters.invalid_duration).toBeGreaterThanOrEqual(1)
})
it('M3: the dashboard panel renders (does not throw) when wall-clock bounds are missing or invalid', () => {
  const snap = { ...new Metrics().snapshot(), sinceWallMs: Number.NaN, atWallMs: Number.NaN }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); roots.push(root)
  expect(() => act(() => { root.render(<MetricsPanel metrics={snap} t={translate(en)} />) })).not.toThrow()
  expect(node.textContent).toContain(en.metricsTitle)
})
it('M8: utilization above 100% is shown with an explicit over-capacity marker, not clipped or left unexplained', () => {
  let mono = 0
  const m = new Metrics({ mono: () => mono }); const p = m.slotPool('workers', 2, ['running']); p.setCount('running', 3); mono = 1000
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); roots.push(root)
  act(() => { root.render(<MetricsPanel metrics={m.snapshot()} t={translate(en)} />) })
  expect(node.textContent).toContain('150%')
  expect(node.textContent).toContain('over capacity')
})
