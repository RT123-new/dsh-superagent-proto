// @vitest-environment jsdom
/**
 * Mandate section 8 UI measurement: rendering the blocked-effects list at 100 / 1,000 / 10,000 rows in jsdom.
 * Excluded from `pnpm test`; run with `pnpm bench`. Appends to reports/evidence/blocked-effects-measurement.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, click } from '../tests/fixtures/panel.tsx'
import { server } from '../tests/fixtures/panel-server.ts'

usePanel()
it('measures blocked-effects list rendering at growing row counts', { timeout: 300_000 }, async () => {
  const evidence = JSON.parse(readFileSync('reports/evidence/blocked-effects-measurement.json', 'utf8')) as { sizes: Record<string, unknown> }
  for (const n of [100, 1000, 10_000]) {
    server.blockedEffects = Array.from({ length: n }, (_, i) => ({ kind: 'reply' as const, key: `key-${i.toString().padStart(8, '0')}`, class: 'permanent', attempts: i % 7,
      since: new Date(Date.now() - i * 1000).toISOString(), attemptUnknown: i % 11 === 0, generation: 1 }))
    if (n === 100) await mount(); else await remount()
    const t0 = performance.now()
    await click(zh['tab.execution'])
    const rows = document.querySelectorAll('.dt-blocked-effects li.dt-att-error').length
    const renderMs = performance.now() - t0
    evidence.sizes[`ui-n-${n}`] = { rows, renderMs: Math.round(renderMs) }
    expect(rows).toBe(n)
  }
  writeFileSync('reports/evidence/blocked-effects-measurement.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence.sizes).filter(([k]) => k.startsWith('ui-'))), null, 2))
})
