/**
 * Mandate section 8 measurement: the blocked-effects endpoint at 100 / 1,000 / 10,000 blocked rows.
 * Real Store + Effects, realistic error rows; measures SQL+materialization time, endpoint handler latency,
 * response size and heap growth. Excluded from `pnpm test`; run with `pnpm bench`. Writes reports/evidence/.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { blockedItem } from '../src/app/http.ts'

const KINDS = ['assessment', 'launch', 'delivery', 'relay', 'notice', 'reply'] as const

function seed(store: Store, n: number): void {
  const insert = store.db.prepare("INSERT INTO effect (kind, key, value, seq, generation, attempts, due, since, error) VALUES ('reply', ?, '{}', ?, 1, ?, 0, ?, ?)")
  const error = `blocked:permanent: validation failed: ${'x'.repeat(240)}`
  store.db.exec('BEGIN')
  for (let i = 0; i < n; i++) insert.run(`key-${i.toString().padStart(8, '0')}`, i, i % 7, new Date(Date.now() - i * 1000).toISOString(), error)
  store.db.exec('COMMIT')
}
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!

it('measures the blocked-effects endpoint at growing history sizes', { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'blocked-bench-'))
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString(), sizes: {} }
  try {
    for (const n of [100, 1000, 10_000]) {
      const store = new Store(join(dir, `s-${n}.sqlite`), () => {})
      const effects = new Effects(store, new HealthBoard())
      seed(store, n)
      // SQL + row materialization (the unbounded .all()), median of 5
      const sqlMs: number[] = []
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); effects.blocked('reply'); sqlMs.push(performance.now() - t0) }
      // Endpoint handler: all kinds, item mapping, JSON serialization
      const heapBefore = process.memoryUsage().heapUsed
      const t0 = performance.now()
      const body = JSON.stringify({ items: KINDS.flatMap(kind => effects.blocked(kind).map(row => blockedItem(kind, row))) })
      const endpointMs = performance.now() - t0
      const heapAfter = process.memoryUsage().heapUsed
      ;(evidence.sizes as Record<string, unknown>)[`n-${n}`] = {
        rows: n, sqlMedianMs: Math.round(median(sqlMs) * 100) / 100, endpointMs: Math.round(endpointMs * 100) / 100,
        responseBytes: Buffer.byteLength(body), heapGrowthBytes: heapAfter - heapBefore,
      }
      expect(effects.blocked('reply').length).toBe(n)
    }
    mkdirSync('reports/evidence', { recursive: true })
    writeFileSync('reports/evidence/blocked-effects-measurement.json', JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence.sizes, null, 2))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
