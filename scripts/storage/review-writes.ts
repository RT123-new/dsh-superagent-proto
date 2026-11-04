/** Independent decision-write distributions. Compare identical fixtures and operations on named variants. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/app/store.ts'
const label=process.argv[2]??'review', n=Number(process.argv[3]??100000)
const root=mkdtempSync(join(tmpdir(),'write-cost-')),s=new Store(join(root,'db'))
s.db.exec('BEGIN');const insert=s.db.prepare('INSERT INTO decision_trigger VALUES(?,?)')
for(let i=0;i<n;i++)insert.run(`t${i}`,`d${i}`)
s.db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
const outputs=[]
for(const fanout of [1,10,100]){
 const samples=[]
 for(let i=0;i<60;i++){
  const t=performance.now();s.decisions.save({id:'test',threadKey:'github:1',kind:'ignore',triggerIds:Array.from({length:fanout},(_,k)=>`t${k}`),at:'2026-01-01'} as never)
  samples.push(performance.now()-t)
 }
 const sorted=[...samples].sort((a,b)=>a-b),mean=samples.reduce((a,b)=>a+b,0)/samples.length
 outputs.push({fanout,samplesMs:samples,meanMs:mean,p50Ms:sorted[Math.ceil(.5*sorted.length)-1],p95Ms:sorted[Math.ceil(.95*sorted.length)-1]})
}
console.log(JSON.stringify({label,n,outputs}))
s.close();rmSync(root,{recursive:true})
