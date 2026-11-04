import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mode = process.argv[2]
if (mode === 'child') { console.log('ready'); const { Store } = await import('/tmp/repo/src/app/store.ts'); const s = new Store(process.argv[3]!); s.close(); process.exit(0) }
const N = Number(process.argv[3] ?? 200000)
const { Store: Old } = await import('/tmp/base/src/app/store.ts')
const { Store: New } = await import('/tmp/repo/src/app/store.ts')
const dir = mkdtempSync(join(tmpdir(), 'kill-')); const seed = join(dir, 'seed.sqlite')
const o = new Old(seed); const db = o.db; db.exec('BEGIN')
const it = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), id = db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
for (let i = 0; i < N; i++) { it.run('t'+i, JSON.stringify({source:'g',id:'t'+i}), '2026-01-01T00:00:'+String(i%60).padStart(2,'0')); if (i%2===0) id.run('d'+i,'th',JSON.stringify({id:'d'+i,kind:'accept',triggerIds:['t'+i]})) }
id.run('dbad','th','{bad'); id.run('dnull','th','{"triggerIds":null}')
db.exec('COMMIT'); const ver = db.prepare("SELECT value FROM kv WHERE key LIKE '%schema%'").all(); o.close()
console.log('seed schema kv', JSON.stringify(ver))
const expectLinks = N/2
let ok = 0, bad = 0
for (const delay of [1, 10, 30, 60, 100, 200, 400, 700, 1000, 1500]) {
  const p = join(dir, `k${delay}.sqlite`); copyFileSync(seed, p)
  const c = spawn('node', ['--experimental-transform-types','--no-warnings', process.argv[1]!, 'child', p], { stdio: ['ignore','pipe','ignore'] })
  await new Promise(r => c.stdout!.once('data', r)); await new Promise(r => setTimeout(r, delay)); c.kill('SIGKILL'); await new Promise(r => c.on('exit', r))
  const pre = (() => { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(p); const n = d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='decision_trigger'").get().n; const l = n ? d.prepare('SELECT COUNT(*) n FROM decision_trigger').get().n : -1; d.close(); return l })()
  const s = new New(p) // reopen must succeed and be complete
  const links = Number(s.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get()!.n)
  const trg = Number(s.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'decision_link%_v2'").get()!.n)
  const integ = s.db.prepare('PRAGMA integrity_check').get()!.integrity_check
  const flow = s.read.flow('2000-01-01')
  const good = links === expectLinks && trg === 3 && integ === 'ok' && flow.judged === expectLinks
  good ? ok++ : bad++; console.log('delay', delay, 'killedBeforeMigrationDone?', pre, JSON.stringify({ links, trg, integ, flow, good }))
  s.close()
  // second reopen idempotent
  const s2 = new New(p); const l2 = Number(s2.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get()!.n); if (l2 !== links) { bad++; console.log('NOT idempotent') } s2.close()
}
console.log(JSON.stringify({ ok, bad })); rmSync(dir, { recursive: true, force: true })
