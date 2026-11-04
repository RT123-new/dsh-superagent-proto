/** Paired micro-benchmark: decisions.save cost (autocommit and inside one atomic batch) with an existing history of N decisions. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/app/store.ts'
const N = Number(process.argv[2] ?? 100000), dir = mkdtempSync(join(tmpdir(), 'dsb-'))
const s = new Store(join(dir, 'o.sqlite'))
const mk = (i: number, ids = 1) => ({ id: `d${i}`, threadKey: `github:${i % 100}`, kind: 'accept', triggerIds: Array.from({ length: ids }, (_, k) => `t${i}-${k}`), at: '2026-01-01T00:00:00.000Z' }) as never
s.db.exec('BEGIN'); for (let i = 0; i < N; i++) s.decisions.save(mk(i)); s.db.exec('COMMIT')
const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t }
const auto = time(() => { for (let i = N; i < N + 1000; i++) s.decisions.save(mk(i, 2)) }) / 1000
const resave = time(() => { for (let i = 0; i < 1000; i++) s.decisions.save(mk(i, 2)) }) / 1000
const batch = time(() => s.atomic(() => { for (let i = N + 1000; i < N + 6000; i++) s.decisions.save(mk(i, 2)) })) / 5000
console.log(JSON.stringify({ autocommitMs: auto, resaveMs: resave, batchedMs: batch }))
s.close(); rmSync(dir, { recursive: true, force: true })
