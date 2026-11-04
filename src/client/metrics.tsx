/** Process-local telemetry view. No additional polling loop or inferred task-success metric. */
import type { DurationSummary, MetricsSnapshot } from '../infra/metrics.ts'
import type { DshSuperagentKey } from './locales.ts'
import type { T } from './text.ts'
import { Hint, Section } from './widgets.tsx'
const STAGES = ['source_to_eval_queue', 'eval_queue_wait', 'eval_run', 'decision_to_assignment', 'slot_wait', 'workspace_prepare',
  'delivery_to_worker', 'worker_turn', 'tool_run', 'report_to_response', 'effect_queue_wait', 'effect_run']
const number = (v: number | null | undefined, unknown: string, suffix = '') => v === null || v === undefined || !Number.isFinite(v)
  ? unknown : `${Number(v.toFixed(2))}${suffix}`
export function MetricsPanel({ metrics: m, t }: { metrics: MetricsSnapshot; t: T }) {
  const unknown = t('metricsUnknown')
  const rowsFor = (durations: MetricsSnapshot['durations'], placeholders: boolean) => {
    const observed = Object.entries(durations)
    const stages = [...STAGES, ...new Set(observed.map(([key]) => key.split('|')[0]!).filter(stage => !STAGES.includes(stage)))]
    return stages.flatMap<[string, DurationSummary | undefined]>(stage => {
      const samples = observed.filter(([key]) => key.split('|')[0] === stage)
      return samples.length ? samples : placeholders ? [[`${stage}|-`, undefined]] : []
    })
  }
  const label = (stage: string) => t(`metricsStage.${stage}` as DshSuperagentKey)
  return <Section title={t('metricsTitle')}>
    <Hint>{t('metricsScope', { window: m.window })}</Hint>
    <p className="dt-hint"><time dateTime={new Date(m.sinceWallMs).toISOString()}>{new Date(m.sinceWallMs).toISOString()}</time>
      {' → '}<time dateTime={new Date(m.atWallMs).toISOString()}>{new Date(m.atWallMs).toISOString()}</time></p>
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
      {' ('}{pool.capacity}{' '}{t('metricsSlotsUnit')}{'; '}{number(pool.integrals.observedMs, unknown, ' ms')}{')'}</li>)}</ul> : <Hint>{t('metricsNoSamples')}</Hint>}
    <h3>{t('metricsUsage')}</h3><Hint>{t('metricsUsageNote')}</Hint>
    <dl className="dt-metrics-usage">{([
      ['metricsInputMiss', m.tokens.inputCacheMiss], ['metricsInputHit', m.tokens.inputCacheHit], ['metricsOutput', m.tokens.output],
      ['metricsCacheWrite', m.tokens.cacheWrite], ['metricsReasoning', m.tokens.reasoning], ['metricsCost', m.tokens.costUsd],
      ['metricsCostUnknown', m.tokens.costUnknownReports],
    ] as const).map(([key, v]) => <div key={key}><dt>{t(key)}</dt><dd>{key === 'metricsCost' && v !== null ? v.toFixed(6) : number(v, unknown)}</dd></div>)}</dl>
    <p className="dt-hint">{t('metricsUsageUnknown')}: {m.tokens.unknownReports.inputCacheHit ?? 0} / {m.tokens.unknownReports.inputCacheMiss ?? 0} / {m.tokens.unknownReports.output ?? 0}</p>
    <p className="dt-hint">{t('metricsExtraCoverage')}</p><h3>{t('metricsCounters')}</h3>{Object.entries(m.counters).length ? <ul className="dt-metrics-list">{Object.entries(m.counters).map(([key, v]) =>
      <li key={key}>{key}: {v}</li>)}</ul> : <Hint>{t('metricsNoSamples')}</Hint>}
  </Section>
}
