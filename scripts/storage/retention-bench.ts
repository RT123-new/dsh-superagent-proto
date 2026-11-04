/** Retention timing on a synthetic store: node scripts/storage/retention-bench.ts <triggers> [batch]. Reports wall time, per-batch cost and invariants. */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/app/store.ts'
const N = Number(process.argv[2] ?? 100000), batch = Number(process.argv[3] ?? 500)
const dir = mkdtempSync(join(tmpdir(), 'ret-')), s = new Store(join(dir, 'o.sqlite')), db = s.db
const NOW = Date.parse('2026-06-01T00:00:00Z'), iso = (i: number) => new Date(NOW - 400 * 86400000 + i * (390 * 86400000 / N)).toISOString()
db.exec('BEGIN')
const T = Math.ceil(N / 10)
for (let i = 0; i < N; i++) {
  const src = i % 2 ? 'github' : 'feishu', th = `${src}:${i % T}`, at = iso(i)
  db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)').run(`t${i}`, JSON.stringify({ id: `t${i}`, source: src, threads: [{ source: src, id: String(i % T) }], actor: { source: src, id: 'u' }, human: i % 3 === 0, at, text: 'body '.repeat(50), meta: {} }), at)
  db.prepare('INSERT INTO trigger_thread VALUES (?,?,?,?)').run(th, `t${i}`, at, i % 3 === 0 ? 1 : 0)
  db.prepare('INSERT INTO disposition VALUES (?,?)').run(`t${i}`, '{}')
  if (i % 20 === 0) db.prepare('INSERT INTO ticket (id,value) VALUES (?,?)').run(`k${i}`, JSON.stringify({ id: `k${i}`, assignments: [], inputs: [{ kind: 'trigger', triggerId: `t${i}` }], undelivered: [], origin: { triggerId: `t${i}`, triggerIds: [`t${i}`] } }))
  if (i % 2 === 0) db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)').run(`d${i}`, th, JSON.stringify({ id: `d${i}`, threadKey: th, kind: 'ignore', triggerIds: [`t${i}`] }))
}
db.exec('COMMIT; ANALYZE')
const before = Number(db.prepare('SELECT COUNT(*) n FROM trigger').get()!.n)
const t0 = performance.now()
const report = s.retention.run({ archivePath: join(dir, 'a.sqlite'), olderThanMs: 60 * 86400000, now: NOW, batchSize: batch })
const ms = performance.now() - t0
const after = Number(db.prepare('SELECT COUNT(*) n FROM trigger').get()!.n), tomb = Number(db.prepare('SELECT COUNT(*) n FROM trigger_tombstone').get()!.n)
console.log(JSON.stringify({ N, batch, before, after, pruned: report.pruned, tombstones: tomb, kept: report.kept, batches: report.batches, totalMs: Math.round(ms), msPerBatch: +(ms / report.batches).toFixed(1), msPer1kPruned: +(ms / (report.pruned / 1000)).toFixed(1), liveMB: +(statSync(join(dir, 'o.sqlite')).size / 1e6).toFixed(1), archiveMB: +(statSync(join(dir, 'a.sqlite')).size / 1e6).toFixed(1), invariant: before - after === tomb && tomb === report.pruned }))
s.close(); rmSync(dir, { recursive: true, force: true })
