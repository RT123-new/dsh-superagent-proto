/** Process-local telemetry view. No additional polling loop or inferred task-success metric. */
import type { DurationSummary, MetricsSnapshot } from '../infra/metrics.ts'
import type { DshSuperagentKey } from './locales.ts'
import type { T } from './text.ts'
import { Hint, Section } from './widgets.tsx'
const STAGES = ['source_to_eval_queue', 'eval_queue_wait', 'eval_run', 'decision_to_assignment', 'slot_wait', 'workspace_prepare',
  'delivery_to_worker', 'worker_turn', 'tool_run', 'report_to_response', 'effect_queue_wait', 'effect_run']
const number = (v: number | null | undefined, unknown: string, suffix = '') => v === null || v === undefined || !Number.isFinite(v)
  ? unknown : `${Number(v.toFixed(2))}${suffix}`
/** Wall-clock bounds are display-only; an invalid value renders as unknown instead of throwing and blanking the dashboard. */
const wall = (ms: number | null | undefined, unknown: string) => {
  const date = typeof ms === 'number' ? new Date(ms) : undefined
  return date && Number.isFinite(date.getTime()) ? <time dateTime={date.toISOString()}>{date.toISOString()}</time> : <span>{unknown}</span>
}
const slotState = (t: T, state: string) => { const key = `metricsSlotState.${state}` as DshSuperagentKey; const value = t(key); return value === key ? state : value }
export function MetricsPanel({ metrics: m, t }: { metrics: MetricsSnapshot; t: T }) {
  const unknown = t('metricsUnknown')
  const rowsFor = (durations: MetricsSnapshot['durations'], placeholders: boolean) => {
    const groups = new Map<string, [string, DurationSummary][]>();
    for (const [key, value] of Object.entries(durations)) {
      const stage = key.split('|')[0]!
      let group = groups.get(stage)
      if (!group) { group = []; groups.set(stage, group) }
      group.push([key, value])
    }
    const stages = [...STAGES, ...Array.from(groups.keys()).filter(stage => !STAGES.includes(stage))]
    return stages.flatMap<[string, DurationSummary | undefined]>(stage =>
      groups.get(stage) ?? (placeholders ? [[`${stage}|-`, undefined]] : []))
  }
  const label = (stage: string) => { const key = `metricsStage.${stage}` as DshSuperagentKey; const value = t(key); return value === key ? stage : value }
  const ranked = Object.entries(m.durations).filter(([, v]) => v.count > 0 && typeof v.p95Ms === 'number' && Number.isFinite(v.p95Ms) && v.p95Ms >= 0)
    .sort(([, a], [, b]) => b.p95Ms! - a.p95Ms!).slice(0, 5)
  const maximum = ranked[0]?.[1].p95Ms ?? 0
  return <Section title={t('metricsTitle')}>
    <Hint>{t('metricsScope', { window: m.window })}</Hint><Hint>{t('metricsPartialProgram')}</Hint>
    <p className="dt-hint">{wall(m.sinceWallMs, unknown)}{' → '}{wall(m.atWallMs, unknown)}</p>
    {ranked.length > 0 && <div className="dt-latency-rank"><h3>{t('metricsLatencyRank')}</h3>
      <Hint>{t('metricsLatencyRankHint')}</Hint>
      <ol>{ranked.map(([key, v]) => <li key={key} className="dt-latency-row">
        <div className="dt-latency-meta"><span>{label(key.split('|')[0]!)} / {key.split('|')[1]}</span>
          <strong>{number(v.p95Ms, unknown, ' ms')} <small>· {t('metricsSamples')}: {v.count}</small></strong></div>
        <div className="dt-latency-track" aria-hidden="true"><span className="dt-latency-fill" style={{ width: (maximum > 0 ? 100 * v.p95Ms! / maximum : 0) + '%' }} /></div>
      </li>)}</ol>
    </div>}
    {([[t('metricsSuccess'), rowsFor(m.durations, true)], [t('metricsFailure'), rowsFor(m.failedDurations ?? {}, false)]] as const).map(([title, rows]) => <div key={title}>
      <h3>{title}</h3>
      {rows.length ? <div className="dt-metrics-scroll" tabIndex={0} role="region" aria-label={`${title}: ${t('metricsStage')}`}><table className="dt-metrics-table">
        <thead><tr><th scope="col">{t('metricsStage')}</th><th scope="col">{t('metricsSamples')}</th><th scope="col">P50 (ms)</th><th scope="col">P95 (ms)</th></tr></thead>
        <tbody>{rows.map(([key, v]) => <tr key={key}><th scope="row">{label(key.split('|')[0]!)} / {key.split('|')[1]}</th>
          <td>{v ? v.count : unknown}</td><td>{number(v?.p50Ms, unknown)}</td><td>{number(v?.p95Ms, unknown)}</td></tr>)}</tbody>
      </table></div> : <Hint>{t('metricsNoSamples')}</Hint>}
    </div>)}
    <Hint>{t('metricsScroll')}</Hint><Hint>{t('metricsCoverage')}</Hint>
    <h3>{t('metricsQueues')}</h3>
    {Object.entries(m.queues).length ? <ul className="dt-metrics-list">{Object.entries(m.queues).map(([key, q]) => <li key={key}>
      {t(({ eval: 'metricsQueueEval', assignment: 'metricsQueueAssignment', effect: 'metricsQueueEffect' } as const)[key as 'eval'] ?? 'metricsQueueOther')}
      {': '}{q.depth} / {number(q.oldestAgeMs, unknown, ' ms')}{(!q.depthComplete || q.oldestAgeIsLowerBound) && ` (${t('metricsPartial')})`}</li>)}</ul> : <Hint>{t('metricsNoSamples')}</Hint>}
    <Hint>{t('metricsQueueCoverage')}</Hint><h3>{t('metricsSlots')}</h3>
    {Object.entries(m.slots).length ? <ul className="dt-metrics-list">{Object.entries(m.slots).map(([key, pool]) => <li key={key}>
      {key}: {number(pool.utilization === null ? null : pool.utilization * 100, unknown, '%')}
      {pool.counts && ` · ${t('metricsSlotNow')}: ${Object.entries(pool.counts).map(([state, n]) => `${slotState(t, state)} ${n}`).join(', ')}`}{pool.integrals.overLimitSlotMs > 0 && ` [${t('metricsOverLimit')}]`}{' ('}{pool.capacity}{' '}{t('metricsSlotsUnit')}{'; '}{number(pool.integrals.observedMs, unknown, ' ms')}{')'}</li>)}</ul> : <Hint>{t('metricsNoSamples')}</Hint>}
    <h3>{t('metricsUsage')}</h3><Hint>{t('metricsUsageNote')}</Hint>
    <dl className="dt-metrics-usage">{([
      ['metricsInputMiss', m.tokens.inputCacheMiss], ['metricsInputHit', m.tokens.inputCacheHit], ['metricsOutput', m.tokens.output],
      ['metricsCacheWrite', m.tokens.cacheWrite], ['metricsReasoning', m.tokens.reasoning], ['metricsCost', m.tokens.costUsd],
      ['metricsCostUnknown', m.tokens.costUnknownReports],
    ] as const).map(([key, v]) => <div key={key}><dt>{t(key)}</dt><dd>{key === 'metricsCost' && typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : number(v, unknown)}</dd></div>)}</dl>
    <p className="dt-hint">{t('metricsUsageUnknown')}: {m.tokens.unknownReports.inputCacheHit ?? 0} / {m.tokens.unknownReports.inputCacheMiss ?? 0} / {m.tokens.unknownReports.output ?? 0}</p>
    <p className="dt-hint">{t('metricsExtraCoverage')}</p>{m.process && <><h3>{t('metricsProcess')}</h3><dl className="dt-metrics-usage">{([
      ['metricsCpuUser', m.process.cpuUserMicros], ['metricsCpuSystem', m.process.cpuSystemMicros], ['metricsRss', m.process.rssBytes],
      ['metricsHeap', m.process.heapUsedBytes], ['metricsElu', m.process.eventLoopUtilization],
    ] as const).map(([key, v]) => <div key={key}><dt>{t(key)}</dt><dd>{number(v, unknown)}</dd></div>)}</dl></>}<h3>{t('metricsCounters')}</h3>{Object.entries(m.counters).length ? <ul className="dt-metrics-list">{Object.entries(m.counters).map(([key, v]) =>
      <li key={key}>{key}: {v}</li>)}</ul> : <Hint>{t('metricsNoSamples')}</Hint>}
  </Section>
}
