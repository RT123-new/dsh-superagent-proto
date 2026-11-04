import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const N = Number(process.argv[2] ?? 10000)
const { Store: NewStore } = await import('/tmp/repo/src/app/store.ts')
const { Store: OldStore } = await import('/tmp/base/src/app/store.ts')
const dir = mkdtempSync(join(tmpdir(), 'rev-'))
function build(S: any, name: string) {
  const path = join(dir, name + '.sqlite'); const store = new S(path); const db = store.db
  const base = Date.parse('2026-01-01T00:00:00Z'); const iso = (i: number) => new Date(base + i * 60000).toISOString()
  const t0 = performance.now(); db.exec('BEGIN')
  const insT = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), insD = db.prepare('INSERT INTO disposition VALUES (?,?)'), insDec = db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
  const srcs = ['github','feishu','slack']
  for (let i = 0; i < N; i++) {
    const s = srcs[i % 3]!; insT.run('t'+i, JSON.stringify({ id:'t'+i, source:s, at:iso(i) }), iso(i))
    if (i % 5 === 0) insD.run('t'+i, JSON.stringify({ filtered: { code: 'x' } }))
    else if (i % 7 === 0) insD.run('t'+i, JSON.stringify({ decisionId: 'd'+i }))
    if (i % 2 === 0) {
      const ids = i % 6 === 0 ? ['t'+i, 't'+Math.max(0,i-1), 't'+i, 'missing'+i] : ['t'+i]
      insDec.run('d'+i, 'th'+(i%50), JSON.stringify({ id:'d'+i, kind:['ignore','accept','reopen','ask'][i%4], triggerIds: ids }))
    }
  }
  db.exec('COMMIT'); const load = performance.now() - t0
  // direct-SQL modification + deletion
  db.exec(`UPDATE decision SET value = json_set(value,'$.triggerIds',json('["t1","t3"]')) WHERE id IN ('d2','d4')`)
  db.exec(`DELETE FROM decision WHERE id='d8'`)
  db.exec(`UPDATE decision SET id='dX10' WHERE id='d10'`)
  db.exec(`INSERT OR REPLACE INTO decision (id,thread,value) VALUES ('d12','th2','{"id":"d12","kind":"accept","triggerIds":["t13"]}')`)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); ANALYZE'); db.exec('VACUUM')
  return { store, path, load, size: statSync(path).size }
}
const o = build(OldStore, 'old'), n = build(NewStore, 'new')
const since = new Date(Date.parse('2026-01-01T00:00:00Z') + (N*0.9) * 60000).toISOString()
const sinceAll = '2000-01-01'
let mism = 0
const cmp = (label: string, f: (s: any) => any) => { const a = JSON.stringify(f(o.store.read)), b = JSON.stringify(f(n.store.read)); if (a !== b) { mism++; console.log('MISMATCH', label, a, b) } }
for (const s of [since, sinceAll, '2999-01-01']) { cmp('triggerStats '+s, r => r.triggerStats(s)); cmp('flow '+s, r => r.flow(s)) }
const time = (s: any, f: (r:any)=>any) => { const xs: number[] = []; for (let i=0;i<15;i++){ const t=performance.now(); f(s.store.read); xs.push(performance.now()-t)}; xs.sort((a,b)=>a-b); return { p50: +xs[7]!.toFixed(2), p95: +xs[14]!.toFixed(2) } }
console.log(JSON.stringify({ N, mismatches: mism, oldSize: o.size, newSize: n.size, G_disk_pct: +(100*(n.size-o.size)/o.size).toFixed(2), loadOldMs: Math.round(o.load), loadNewMs: Math.round(n.load),
  stats_old: time(o, r=>r.triggerStats(since)), stats_new: time(n, r=>r.triggerStats(since)), flow_old: time(o, r=>r.flow(since)), flow_new: time(n, r=>r.flow(since)) }))
