import { spawn } from 'node:child_process'; import { copyFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
if (process.argv[2]==='child') { const { Store } = await import('/tmp/repo/src/app/store.ts'); const s = new Store(process.argv[3]!); s.db.exec(`INSERT INTO trigger VALUES ('tz','{"source":"g"}','2026-03-01'); INSERT INTO decision VALUES ('dz','th','{"kind":"accept","triggerIds":["tz"]}')`); console.log('COMMITTED'); setInterval(()=>{},1000) } else {
const { Store: Old } = await import('/tmp/base/src/app/store.ts'); const { Store: New } = await import('/tmp/repo/src/app/store.ts')
const dir = mkdtempSync(join(tmpdir(),'pk-')); const seed = join(dir,'s.sqlite'); const o = new Old(seed)
o.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02'); INSERT INTO decision VALUES ('d1','th','{"kind":"accept","triggerIds":["t1"]}')`); o.close()
const c = spawn('node',['--experimental-transform-types','--no-warnings',process.argv[1]!,'child',seed],{stdio:['ignore','pipe','inherit']})
await new Promise(r=>c.stdout!.on('data',d=>String(d).includes('COMMITTED')&&r(0))); c.kill('SIGKILL'); await new Promise(r=>c.on('exit',r))
const s = new New(seed); const links = s.db.prepare('SELECT trigger,decision FROM decision_trigger ORDER BY 1').all().map(r=>r.trigger+'>'+r.decision)
console.log(JSON.stringify({ links, flow: s.read.flow('2000-01-01'), integrity: s.db.prepare('PRAGMA integrity_check').get()!.integrity_check })) }
