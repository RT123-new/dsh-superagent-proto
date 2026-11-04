import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import type { Decision, Trigger } from '../src/core/index.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'storage-19-20-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** The pre-Issue-20 queries, verbatim, as the semantic oracle. */
const legacyStats = (store: Store, since: string) => {
  const result: Record<string, { received: number; filtered: number; lastAt: string }> = {}
  for (const row of store.db.prepare("SELECT json_extract(t.value, '$.source') AS source, MAX(t.at) AS last, SUM(t.at >= ?) AS received, SUM(t.at >= ? AND json_extract(d.value, '$.filtered') IS NOT NULL) AS filtered FROM trigger t LEFT JOIN disposition d ON d.id = t.id GROUP BY source").all(since, since))
    result[String(row.source)] = { received: Number(row.received ?? 0), filtered: Number(row.filtered ?? 0), lastAt: String(row.last ?? '') }
  return result
}
const legacyFlow = (store: Store, since: string) => {
  const passed = "t.at >= ? AND NOT EXISTS (SELECT 1 FROM disposition s WHERE s.id = t.id AND json_extract(s.value, '$.filtered') IS NOT NULL)"
  const judged = store.db.prepare(`SELECT COUNT(DISTINCT t.id) AS n FROM decision d, json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value WHERE ${passed}`).get(since)
  const accepted = store.db.prepare(`SELECT COUNT(DISTINCT d.id) AS n FROM decision d, json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value WHERE json_extract(d.value, '$.kind') IN ('accept', 'reopen') AND t.at >= ?`).get(since)
  return { judged: Number(judged?.n), accepted: Number(accepted?.n) }
}
let seed = 12345
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const iso = (i: number) => new Date(Date.parse('2026-03-01T00:00:00Z') + i * 1000).toISOString()
function fill(store: Store, n: number) {
  const sources = ['github', 'feishu', 'cli']
  for (let i = 0; i < n; i++) {
    const source = sources[rnd(sources.length)]!
    const trigger: Trigger = { id: `t${i}`, source, threads: [{ source, id: String(i % 7) }], actor: { source, id: 'u' }, human: true, at: iso(i), text: 'x', meta: {} }
    store.triggers.save(trigger)
    if (rnd(3) === 0) store.triggers.saveDisposition(trigger.id, { filtered: { code: 'scope' } } as never)
    else if (rnd(2) === 0) store.triggers.saveDisposition(trigger.id, {} as never)
  }
  const kinds = ['accept', 'reopen', 'ignore', 'ask']
  for (let d = 0; d < n / 2; d++) {
    const ids = Array.from({ length: 1 + rnd(3) }, () => `t${rnd(n + 5)}`) // some ids reference triggers that do not exist
    store.decisions.save({ id: `d${d}`, threadKey: `github:${rnd(7)}`, kind: kinds[rnd(4)], triggerIds: ids, at: iso(d) } as unknown as Decision)
  }
}
const windows = (n: number) => [iso(0), iso(Math.floor(n / 3)), iso(Math.floor(n * 0.9)), iso(n + 100)]

it('windowed triggerStats and flow equal the previous full-scan queries, including re-saved Decisions', () => {
  const store = new Store(join(directory, 'o.sqlite')); const n = 400
  fill(store, n)
  // Re-save decisions with different triggers: the derived link table must follow.
  for (let d = 0; d < 40; d++) store.decisions.save({ id: `d${d}`, threadKey: 'github:1', kind: 'accept', triggerIds: [`t${rnd(n)}`], at: iso(d) } as unknown as Decision)
  for (const since of windows(n)) {
    expect(store.read.triggerStats(since)).toEqual(legacyStats(store, since))
    expect(store.read.flow(since)).toEqual(legacyFlow(store, since))
  }
  expect(Object.keys(store.read.triggerStats(iso(n + 100))).sort()).toEqual(['cli', 'feishu', 'github']) // sources with no window rows keep their lastAt
  store.close()
})
it('rebuilds the decision link from Decision records when opening a database that predates it', () => {
  const path = join(directory, 'o.sqlite'); const n = 200
  let store = new Store(path); fill(store, n)
  const expected = windows(n).map(since => store.read.flow(since))
  store.db.exec('DROP TABLE decision_trigger'); store.close()
  store = new Store(path)
  expect(windows(n).map(since => store.read.flow(since))).toEqual(expected)
  expect(windows(n).map(since => legacyFlow(store, since))).toEqual(expected)
  store.close()
})
it('reads arrival windows through indexes rather than scanning every Trigger', () => {
  const store = new Store(join(directory, 'o.sqlite')); fill(store, 300); store.db.exec('ANALYZE')
  const plan = (sql: string, ...p: (string | number)[]) => store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map(r => String(r.detail))
  expect(plan('SELECT COUNT(*) FROM trigger t WHERE t.source = ? AND t.at >= ?', 'github', iso(0)).join('\n')).toMatch(/USING (COVERING )?INDEX trigger_source_at/)
  expect(plan('SELECT MAX(at) FROM trigger WHERE source = ?', 'github').join('\n')).toMatch(/trigger_source_at/)
  expect(plan('SELECT 1 FROM decision_trigger WHERE trigger = ?', 't1').join('\n')).toMatch(/SEARCH/)
  store.close()
})
