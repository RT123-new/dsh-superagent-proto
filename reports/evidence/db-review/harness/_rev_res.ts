import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const N = Number(process.argv[2] ?? 100000); const which = process.argv[3]!
const { Store } = await import(which === 'old' ? '/tmp/base/src/app/store.ts' : '/tmp/repo/src/app/store.ts')
const p = join(mkdtempSync(join(tmpdir(),'res-')),'o.sqlite'); let s = new Store(p); const db = s.db; db.exec('BEGIN')
const it = db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), id = db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
for (let i=0;i<N;i++){ it.run('t'+i,JSON.stringify({source:'g',id:'t'+i}),'2026-01-01T00:00:00.'+String(i%1000).padStart(3,'0')); if(i%2===0) id.run('d'+i,'th',JSON.stringify({id:'d'+i,kind:'accept',triggerIds:['t'+i]})) }
db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)'); s.close()
const t0=performance.now(); s = new Store(p); const startup = performance.now()-t0
const xs:number[]=[]; for(let i=0;i<2000;i++){ const t=performance.now(); s.db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)').run('w'+i,'th',JSON.stringify({kind:'accept',triggerIds:['t'+(i*2+1)]})); xs.push(performance.now()-t) }
xs.sort((a,b)=>a-b); const q=(f:number)=>+xs[Math.floor(f*(xs.length-1))]!.toFixed(3)
console.log(JSON.stringify({ which, N, startupMs:+startup.toFixed(1), writeP50:q(.5), writeP95:q(.95), rssMB:Math.round(process.memoryUsage().rss/1048576) }))
