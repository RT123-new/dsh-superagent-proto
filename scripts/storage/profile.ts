/**
 * Issue 19/20 read-only profiling harness. Builds synthetic SQLite stores of N triggers through the REAL Store schema,
 * then runs the real store.read.* / repository queries, timing each and capturing EXPLAIN QUERY PLAN for the exact SQL.
 * Usage: node scripts/storage/profile.ts <triggers> [outfile.json]   (no production code is modified)
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/app/store.ts'

const N = Number(process.argv[2] ?? 10000)
const out = process.argv[3]
const dir = mkdtempSync(join(tmpdir(), 'storage-profile-'))
const path = join(dir, 'o.sqlite')
const store = new Store(path)
const db = store.db
const sources = ['github', 'feishu']
const perThread = 10
const T = Math.ceil(N / perThread)
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (i: number) => new Date(base + i * 60_000).toISOString()
const t0 = performance.now()
db.exec('BEGIN')
const insT = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)')
const insX = db.prepare('INSERT INTO trigger_thread VALUES (?,?,?,?)')
const insD = db.prepare('INSERT INTO disposition VALUES (?,?)')
const insDec = db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
const insTh = db.prepare('INSERT INTO thread (key,value) VALUES (?,?)')
const insTk = db.prepare('INSERT INTO ticket (id,value) VALUES (?,?)')
const insO = db.prepare('INSERT INTO outbox (id,value) VALUES (?,?)')
const insE = db.prepare('INSERT INTO effect (kind,key,value,seq,due,since) VALUES (?,?,?,?,?,?)')
const insL = (() => { try { return db.prepare('INSERT OR IGNORE INTO decision_trigger VALUES (?,?)') } catch { return undefined } })() // baseline schema has no link table
const insK = db.prepare('INSERT INTO kv VALUES (?,?)')
for (let th = 0; th < T; th++) {
  const source = sources[th % 2]!, tk = `${source}:${th}`
  const thread = { key: tk, ref: { source, id: String(th) }, createdAt: iso(th), subscriptions: th % 50 === 0 ? [{ id: 's' }] : [], correlated: [], pending: [], meta: {} }
  insTh.run(tk, JSON.stringify(thread))
}
let seq = 0
for (let i = 0; i < N; i++) {
  const th = i % T, source = sources[th % 2]!, tk = `${source}:${th}`, id = `t${i}`, at = iso(i)
  const trig = { id, source, threads: [{ source, id: String(th) }], actor: { source, id: 'u' + (i % 97) }, human: i % 3 === 0, at,
    text: `message ${i} about deployment ${i % 1013} with some typical body text `.repeat(4), url: `https://github.com/o/r/issues/${th}#c${i}`, meta: { messageId: `m${i}` } }
  insT.run(id, JSON.stringify(trig), at); insX.run(tk, id, at, trig.human ? 1 : 0)
  insD.run(id, JSON.stringify(i % 4 === 0 ? { filtered: { code: 'scope' } } : { decisionId: `d${i}` }))
  if (i % 2 === 0) { insDec.run(`d${i}`, tk, JSON.stringify({ id: `d${i}`, thread: tk, kind: ['ignore', 'accept', 'reopen', 'ask'][i % 4], triggerIds: [id], at })); insL?.run(id, `d${i}`) }
  if (i % 20 === 0) {
    insTk.run(`k${i}`, JSON.stringify({ id: `k${i}`, title: 'x', assignments: [{ id: 'a', state: i % 400 === 0 ? 'running' : 'done' }], undelivered: [], ...i % 200 === 0 ? {} : { ended: { at, by: 'executor' } } }))
    insO.run(`o${i}`, JSON.stringify({ id: `o${i}`, status: i % 40 === 0 ? 'dropped' : 'sent', ticketId: `k${i}`, channel: { thread: tk }, ...i % 40 === 0 ? { dropped: { at, reason: 'channelGone' } } : {} }))
    insE.run('reply', `o${i}`, '{}', ++seq, i, at)
    insK.run(`cursor:${i}`, '{"a":1}')
  }
  if (i % 100000 === 99999) { db.exec('COMMIT'); db.exec('BEGIN') }
}
db.exec('COMMIT')
db.exec('PRAGMA wal_checkpoint(TRUNCATE); ANALYZE')
const loadMs = performance.now() - t0
const size = statSync(path).size

type Row = { name: string; ms: number; rows: number; plan: string[] }
const results: Row[] = []
function measure(name: string, fn: () => unknown, reps = 5) {
  const captured: { sql: string; params: unknown[] }[] = []
  const orig = db.prepare.bind(db)
  ;(db as any).prepare = (sql: string) => {
    const s = orig(sql)
    for (const m of ['all', 'get', 'run'] as const) { const f = (s as any)[m].bind(s); (s as any)[m] = (...p: unknown[]) => { captured.push({ sql, params: p }); return f(...p) } }
    return s
  }
  let res: unknown, best = Infinity
  const times: number[] = []
  for (let r = 0; r < reps; r++) { captured.length = 0; const a = performance.now(); res = fn(); times.push(performance.now() - a) }
  best = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!
  ;(db as any).prepare = orig
  const plan: string[] = []
  for (const c of captured) {
    if (!/^\s*select/i.test(c.sql)) continue
    try { for (const row of orig('EXPLAIN QUERY PLAN ' + c.sql).all(...(c.params as any[]))) plan.push(String(row.detail)) } catch (e) { plan.push('explain failed: ' + (e as Error).message) }
  }
  const n = Array.isArray(res) ? res.length : (res as any)?.items?.length ?? 1
  results.push({ name, ms: Math.round(best * 100) / 100, rows: n, plan })
}
const since = iso(Math.floor(N * 0.9)), early = iso(0)
const midThread = `${sources[0]}:${Math.floor(T / 2) - (Math.floor(T / 2) % 2)}`
measure('recentTriggers(0,50)', () => store.read.recentTriggers(0, 50))
measure('recentTriggers(offset=N/2,50)', () => store.read.recentTriggers(Math.floor(N / 2), 50))
measure('triggerStats(since 90%)', () => store.read.triggerStats(since), 3)
measure('triggerStats(since all)', () => store.read.triggerStats(early), 3)
measure('flow(since 90%)', () => store.read.flow(since), 3)
measure('triggers(source=github)', () => store.read.triggers({ source: 'github' }, 0, 50))
measure('triggers(filtered)', () => store.read.triggers({ filtered: true }, 0, 50))
measure('triggers(filtered, offset N/8)', () => store.read.triggers({ filtered: true }, Math.floor(N / 8), 50))
measure('threadTriggers(mid)', () => store.read.threadTriggers(midThread, 50))
measure('threadPage(mid, 5, 5)', () => store.read.threadPage(midThread, 5, 5))
measure('neighbours(mid)', () => store.read.neighbours(midThread, iso(Math.floor(N / 2)), 'x'))
measure('firstTrigger(mid)', () => store.read.firstTrigger(midThread))
measure('search(text LIKE miss)', () => store.read.search('zzzznotfound', 20), 3)
measure('search(text LIKE hit rare)', () => store.read.search('deployment 1012 with', 20), 3)
measure('recentDecisions(0,50)', () => store.read.recentDecisions(0, 50))
measure('decisions(kinds,since 90%)', () => store.read.decisions({ kinds: ['accept', 'reopen'], since }, 0, 50), 3)
measure('decisionsOfKinds', () => store.read.decisionsOfKinds(['accept'], 30))
measure('failingReplies', () => store.read.failingReplies())
measure('droppedReplies', () => store.read.droppedReplies(20))
measure('droppedSince', () => store.read.droppedSince(since))
measure('subscribedThreads()', () => store.read.subscribedThreads())
measure('threads.list()', () => store.threads.list(), 2)
measure('threads.active()', () => store.threads.active())
measure('tickets.list()', () => store.tickets.list(), 2)
measure('tickets.open()', () => store.tickets.open())
measure('tickets.active()', () => store.tickets.active())
measure('decisions.byThread(mid)', () => store.decisions.byThread(midThread))
measure('triggers.get(id)', () => store.triggers.get(`t${Math.floor(N / 2)}`))
measure('triggers.save(1)', () => store.triggers.save(store.triggers.get(`t${Math.floor(N / 2)}`)!))
const report = { N, threads: T, loadMs: Math.round(loadMs), dbBytes: size, node: process.version, sqlite: String(db.prepare('select sqlite_version() v').get()!.v), results }
if (out) writeFileSync(out, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ N, dbMB: (size / 1e6).toFixed(1), loadMs: report.loadMs }))
for (const r of results) console.log(r.name.padEnd(36), String(r.ms).padStart(9), 'ms', r.plan.some(p => /^SCAN (?!.*(json_each|USING))/.test(p)) ? 'SCAN' : '', r.plan.some(p => /TEMP B-TREE/.test(p)) ? 'SORT' : '')
store.close(); rmSync(dir, { recursive: true, force: true })
