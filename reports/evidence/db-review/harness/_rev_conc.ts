import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
if (process.argv[2]==='writer') { const db = new DatabaseSync(process.argv[3]!); db.exec('PRAGMA busy_timeout=5000'); let busy=0
  for (let i=0;i<20000;i++){ try { db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO trigger VALUES (?,?,?)').run('w'+i,'{"source":"g"}','2026-02-01'); db.prepare('INSERT INTO decision VALUES (?,?,?)').run('wd'+i,'th','{"kind":"accept","triggerIds":["w'+i+'"]}'); db.exec('COMMIT') } catch(e){ busy++; try{db.exec('ROLLBACK')}catch{} } }
  console.log('writer busy',busy); process.exit(0) }
const { Store } = await import('/tmp/repo/src/app/store.ts')
const p = join(mkdtempSync(join(tmpdir(),'conc-')),'o.sqlite'); const s = new Store(p); s.db.exec('PRAGMA busy_timeout=5000')
const w = spawn('node',['--experimental-transform-types','--no-warnings',process.argv[1]!,'writer',p],{stdio:'inherit'})
let done=false; w.on('exit',()=>done=true); let reads=0, errs=0, bad=0
while(!done){ try { const f = s.read.flow('2026-01-01'); reads++; if (f.judged!==f.accepted) bad++ } catch(e){ errs++ } await new Promise(r=>setTimeout(r,2)) }
const final = s.read.flow('2026-01-01'); const links = s.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get()!.n
console.log(JSON.stringify({reads,readErrors:errs,inconsistentSnapshots:bad,final,links}))
