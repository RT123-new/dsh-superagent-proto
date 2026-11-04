import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const N=Number(process.argv[2]); const { Store: Old } = await import('/tmp/base/src/app/store.ts'); const { Store: New } = await import('/tmp/repo/src/app/store.ts')
const p=join(mkdtempSync(join(tmpdir(),'upg-')),'o.sqlite'); const o=new Old(p); const db=o.db; db.exec('BEGIN')
const it=db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), id=db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
for(let i=0;i<N;i++){ it.run('t'+i,JSON.stringify({source:'g'}),'2026-01-01'); if(i%2===0) id.run('d'+i,'th',JSON.stringify({kind:'accept',triggerIds:['t'+i]})) } db.exec('COMMIT'); o.close()
let t=performance.now(); const s=new New(p); const first=performance.now()-t; s.close(); t=performance.now(); const s2=new New(p); const second=performance.now()-t
console.log(JSON.stringify({N,firstOpenUpgradeMs:Math.round(first),repeatOpenMs:+second.toFixed(1),links:s2.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get()!.n,rssMB:Math.round(process.memoryUsage().rss/1048576)}))
