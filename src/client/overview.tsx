import { MetricsPanel } from './metrics.tsx'
/** Overview page: pending Tickets requiring human action, active system problems, 24-hour flow counts, and Executor load. */
import type { ReactNode } from 'react'
import { usePoll, type Problem } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LoadState, Section, SetupMessage } from './widgets.tsx'

function problemKey(problem: Problem): string {
  switch (problem.kind) {
    case 'setup': return JSON.stringify([problem.kind, problem.place])
    case 'runtime-error': return JSON.stringify([problem.kind, problem.name])
    case 'source-error': return JSON.stringify([problem.kind, problem.source.id, problem.source.health.name])
    case 'eval-overdue': return JSON.stringify([problem.kind, problem.thread.key])
    case 'eval-unavailable': return JSON.stringify([problem.kind, problem.decisionId])
    case 'outgoing': return JSON.stringify([problem.kind, problem.outgoing.id])
    default: return problem.kind
  }
}

function ProblemLine({ problem, onChanged }: { problem: Problem; onChanged: () => Promise<void> }) {
  const { t, call, navigate } = usePanel()
  const post = useAction((request: () => Promise<unknown>) => request(), { reload: onChanged })
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
        message={t('resumeProcessingConfirm')}
        onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} />)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST triggers/:id/requeue', { id: problem.triggerId })) }}>{t('requeue')}</Button>
        <Button variant="outline" size="sm" icon={<Icon name="dismiss" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST decisions/:id/dismiss', { id: problem.decisionId })) }}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET overview'), [])
  if (!data) return <LoadState error={error} loading />
  const stat = (label: string, value: ReactNode, route?: Route) => <div className="dt-stat">
    <dt className="dt-stat-label">{label}</dt>
    <dd className="dt-stat-value">{route ? <button type="button" className="dt-textlink" onClick={() => navigate(route)}>{value}</button>
      : value}</dd>
  </div>
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  return <>
    {error && <><p className="dt-hint" role="status">{t('staleData')}</p><LoadState error={error} loading={false} /></>}
    <div className="dt-workspace-grid">
      <div className="dt-workspace-primary">
        <Section title={t('pendingTickets')} count={data.person.length}>
          {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
            onChanged={reload} />)}</ul>
            : <div className="dt-workspace-empty"><Icon name="decision" size={24} /><div>
              <Hint>{t('needsYouNone')}</Hint><Hint>{t('overviewEmptyHint')}</Hint>
            </div></div>}
        </Section>
        {data.problems.length > 0 && <Section title={t('problems')} count={data.problems.length}>
          <ul className="dt-list dt-cards">{data.problems.map(problem => <ProblemLine key={problemKey(problem)} problem={problem}
            onChanged={reload} />)}</ul>
        </Section>}
      </div>
      <aside className="dt-workspace-aside">
        <Section title={t('term.executor')} action={more({ page: 'execution' })}>
          {/* Pauses surface above. Preserve observed counts in either state; while setup waits, nothing runs. */}
          {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <>
            <dl className="dt-stats">
              {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
              {stat(t('queuedLabel'), data.executor.queued)}
              {stat(t('idleLabel'), data.executor.idle)}
            </dl>
            {Number.isFinite(data.executor.running) && data.executor.maxWorkers > 0 && Number.isFinite(data.executor.maxWorkers) &&
              <div className="dt-capacity">
                <span>{t('capacityLabel')}{data.executor.running > data.executor.maxWorkers ? ' · ' + t('capacityOver') : ''}</span>
                <div className="dt-capacity-track" aria-hidden="true"><span className="dt-capacity-fill" data-over={data.executor.running > data.executor.maxWorkers}
                  style={{ width: Math.min(100, Math.max(0, 100 * data.executor.running / data.executor.maxWorkers)) + '%' }} /></div>
              </div>}
          </>}
        </Section>
        <Section title={t('lastDay')} action={more({ page: 'trigger', query: { filter: 'recent' } })}>
          {/* These are independent observed counts, not a conversion funnel. Received and evaluated Triggers have no matching list to link. */}
          <dl className="dt-stats">
            {stat(t('flowReceivedLabel'), data.flow.received)}
            {stat(t('flowFilteredLabel'), data.flow.filtered, data.flow.filtered ? { page: 'source' } : undefined)}
            {stat(t('flowJudgedLabel'), data.flow.judged)}
            {stat(t('flowAcceptedLabel'), data.flow.accepted, { page: 'eval', query: { window: '24h' } })}
            {data.flow.dropped > 0 && stat(t('flowDroppedLabel'), data.flow.dropped, { page: 'source' })}
          </dl>
        </Section>
      </aside>
    </div>
    {data.metrics && <MetricsPanel metrics={data.metrics} t={t} />}
    {!data.metrics && data.metricsState === 'failed' && <Section title={t('metricsTitle')}><Hint>{t('metricsSnapshotFailed')}</Hint></Section>}
  </>
}
