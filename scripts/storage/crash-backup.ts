/**
 * Isolated experiment (no production code changes): bounded-batch retention DELETE under SIGKILL, backup (VACUUM INTO / sqlite backup API), restore + integrity.
 * Usage: node scripts/storage/crash-backup.ts <triggers> [outfile.json]
 * child mode: node scripts/storage/crash-backup.ts child <dbpath> <batch>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { Store } from '../../src/app/store.ts'

const CUT = '2026-01-01T00:00:00.000Z'
const eligible = `at < ? AND NOT EXISTS (SELECT 1 FROM trigger_thread x WHERE 0)` // placeholder predicate: pure age; real eligibility audited separately
if (process.argv[2] === 'child') {
  const db = new DatabaseSync(process.argv[3]!); db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
  const batch = Number(process.argv[4]); const cut = process.argv[5]!
  for (;;) {
    db.exec('BEGIN IMMEDIATE')
    const ids = db.prepare('SELECT id FROM trigger WHERE at < ? ORDER BY at LIMIT ?').all(cut, batch).map(r => String(r.id))
    if (!ids.length) { db.exec('COMMIT'); break }
    const ph = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM trigger_thread WHERE id IN (${ph})`).run(...ids)
    db.prepare(`DELETE FROM disposition WHERE id IN (${ph})`).run(...ids)
    db.prepare(`DELETE FROM trigger WHERE id IN (${ph})`).run(...ids)
    db.exec('COMMIT'); console.log('batch', ids.length)
  }
  process.exit(0)
}
const N = Number(process.argv[2] ?? 100000), out = process.argv[3]
const dir = mkdtempSync(join(tmpdir(), 'crash-')); const path = join(dir, 'o.sqlite')
const store = new Store(path); const db = store.db
db.exec('BEGIN')
const a = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), b = db.prepare('INSERT INTO trigger_thread VALUES (?,?,?,?)'), c = db.prepare('INSERT INTO disposition VALUES (?,?)')
const base = Date.parse('2025-06-01T00:00:00Z')
for (let i = 0; i < N; i++) { const at = new Date(base + i * 60_000).toISOString(); a.run('t' + i, JSON.stringify({ id: 't' + i, at, text: 'x'.repeat(250) }), at); b.run('github:' + (i % 1000), 't' + i, at, 0); c.run('t' + i, '{}') }
db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
const cut = new Date(base + Math.floor(N * 0.6) * 60_000).toISOString()
const count = (d: DatabaseSync, t: string) => Number(d.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n)
const res: Record<string, unknown> = { N, cut }
// backup methods
let t = performance.now(); const vac = join(dir, 'vac.sqlite'); db.exec(`VACUUM INTO '${vac}'`); res.vacuumIntoMs = Math.round(performance.now() - t)
t = performance.now(); const bk = join(dir, 'bk.sqlite'); await backup(db, bk, { rate: 1000 }); res.backupApiMs = Math.round(performance.now() - t)
for (const [k, p] of [['vacuumInto', vac], ['backupApi', bk]] as const) {
  const r = new DatabaseSync(p); res[k] = { integrity: r.prepare('PRAGMA integrity_check').get()!.integrity_check, triggers: count(r, 'trigger'), thread: count(r, 'trigger_thread'), disp: count(r, 'disposition'), bytes: statSync(p).size }; r.close()
}
const before = { trigger: count(db, 'trigger'), tt: count(db, 'trigger_thread'), d: count(db, 'disposition') }
const expectedGone = Number(db.prepare('SELECT COUNT(*) n FROM trigger WHERE at < ?').get(cut)!.n)
store.close()
// crash trials: SIGKILL child at random times during batched delete, check atomic batches + integrity, then resume to completion
const trials: unknown[] = []
for (let k = 0; k < 8; k++) {
  const p = join(dir, `trial${k}.sqlite`); const { copyFileSync } = await import('node:fs'); copyFileSync(path, p)
  const ch = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', process.argv[1]!, 'child', p, '500', cut], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise(r => setTimeout(r, 30 + Math.random() * 400)); ch.kill('SIGKILL'); await new Promise(r => ch.on('close', r))
  const d = new DatabaseSync(p); const o = { trigger: count(d, 'trigger'), tt: count(d, 'trigger_thread'), d: count(d, 'disposition') }
  const consistent = (before.trigger - o.trigger) === (before.tt - o.tt) && (before.trigger - o.trigger) === (before.d - o.d) && (before.trigger - o.trigger) % 500 === 0
  const integ = d.prepare('PRAGMA integrity_check').get()!.integrity_check; d.close()
  const ch2 = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', process.argv[1]!, 'child', p, '500', cut], { stdio: 'ignore' }); await new Promise(r => ch2.on('close', r))
  const d2 = new DatabaseSync(p); const fin = count(d2, 'trigger'); d2.close()
  trials.push({ k, deletedAtKill: before.trigger - o.trigger, batchAtomic: consistent, integrity: integ, resumedFinalTriggers: fin, expectedFinal: before.trigger - expectedGone })
}
res.crashTrials = trials
if (out) writeFileSync(out, JSON.stringify(res, null, 1))
console.log(JSON.stringify(res, null, 1)); rmSync(dir, { recursive: true, force: true })
