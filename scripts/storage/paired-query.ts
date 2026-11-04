/**
 * Paired representative query sampling for Issue 20 (triggerStats + flow over selective arrival windows).
 * make <db> <N> <seed>      : build a deterministic synthetic store with the CURRENT source tree's schema (run with the base tree).
 * measure <db> <N> <seed> <out.json> : open (upgrading if needed) and time 40 window instances x 2 queries, median of 3 reps each, store results too.
 * The same (seed, instance) is one task pair across trees; windows are 1%-20% of the timeline.
 */
import { writeFileSync } from 'node:fs'
import { Store } from '../../src/app/store.ts'
const [mode, path, nArg, seedArg, out] = process.argv.slice(2)
const N = Number(nArg), seed0 = Number(seedArg)
let s = seed0 * 2654435761 % 2147483647 || 1
const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647
const base = Date.parse('2026-01-01T00:00:00.000Z'), iso = (i: number) => new Date(base + i * 60_000).toISOString()
const store = new Store(path!)
const db = store.db
if (mode === 'make') {
  const nSources = 2 + Math.floor(rnd() * 3), pFiltered = 0.1 + rnd() * 0.3, pDecided = 0.3 + rnd() * 0.5, T = Math.ceil(N / (5 + Math.floor(rnd() * 20)))
  db.exec('BEGIN')
  const insT = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), insX = db.prepare('INSERT INTO trigger_thread VALUES (?,?,?,?)')
  const insD = db.prepare('INSERT INTO disposition VALUES (?,?)'), insDec = db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
  for (let i = 0; i < N; i++) {
    const source = `src${Math.floor(rnd() ** 2 * nSources)}`, th = Math.floor(rnd() * T), tk = `${source}:${th}`, at = iso(i)
    insT.run(`t${i}`, JSON.stringify({ id: `t${i}`, source, threads: [{ source, id: String(th) }], actor: { source, id: 'u' }, human: rnd() < 0.5, at, text: 'message body '.repeat(10), meta: {} }), at)
    insX.run(tk, `t${i}`, at, 0)
    insD.run(`t${i}`, JSON.stringify(rnd() < pFiltered ? { filtered: { code: 'scope' } } : {}))
    if (rnd() < pDecided) insDec.run(`d${i}`, tk, JSON.stringify({ id: `d${i}`, threadKey: tk, kind: ['ignore', 'accept', 'reopen', 'ask'][Math.floor(rnd() * 4)], triggerIds: [`t${i}`, ...rnd() < 0.2 ? [`t${Math.max(0, i - 1 - Math.floor(rnd() * 50))}`] : []], at }))
  }
  db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE); ANALYZE')
  store.close()
} else {
  // Same window list for a seed regardless of tree: draw from an independent stream.
  let w = seed0 * 40503 % 2147483647 || 1
  const wr = () => (w = (w * 48271) % 2147483647) / 2147483647
  const rows: unknown[] = []
  db.exec('ANALYZE')
  for (let k = 0; k < 40; k++) {
    const frac = 0.01 + wr() * 0.19, since = iso(Math.floor(N * (1 - frac)))
    const run = (f: () => unknown) => { const ts: number[] = []; let r: unknown; for (let q = 0; q < 3; q++) { const a = performance.now(); r = f(); ts.push(performance.now() - a) } return { ms: ts.sort((a, b) => a - b)[1]!, r } }
    const a = run(() => store.read.triggerStats(since)), b = run(() => store.read.flow(since))
    rows.push({ seed: seed0, k, frac, stats: a.ms, flow: b.ms, statsResult: a.r, flowResult: b.r })
  }
  writeFileSync(out!, JSON.stringify(rows))
  store.close()
}
