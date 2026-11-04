import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const N=Number(process.argv[2]), seeds=Number(process.argv[3]); const out=process.argv[4]!
const { Store: Old } = await import('/tmp/prhead/src/app/store.ts'); const { Store: New } = await import('/tmp/repo/src/app/store.ts')
let rng=0; const rand=()=>{ rng=(rng*1664525+1013904223)>>>0; return rng/2**32 }
const rows:any[]=[]
for(let seed=1;seed<=seeds;seed++){ rng=seed*7919
  const dir=mkdtempSync(join(tmpdir(),'pr-')); const mk=(S:any,n:string)=>{ const s=new S(join(dir,n)); const db=s.db; const r0=rng; db.exec('BEGIN')
    const it=db.prepare('INSERT INTO trigger (id,value,at) VALUES (?,?,?)'), dd=db.prepare('INSERT INTO disposition VALUES (?,?)'), id=db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)')
    const srcs=['github','feishu','slack','cli']; const base=Date.parse('2026-01-01')
    for(let i=0;i<N;i++){ const at=new Date(base+i*30000).toISOString(); it.run('t'+i,JSON.stringify({id:'t'+i,source:srcs[Math.floor(rand()*srcs.length)],at}),at)
      const u=rand(); if(u<0.25) dd.run('t'+i,'{"filtered":{"code":"x"}}'); else if(u<0.9&&rand()<0.7){ const k=1+Math.floor(rand()*3); const ids=['t'+i]; for(let j=1;j<k;j++) ids.push('t'+Math.max(0,i-j)); id.run('d'+i,'th'+(i%97),JSON.stringify({id:'d'+i,kind:['ignore','accept','reopen','ask'][Math.floor(rand()*4)],triggerIds:ids})) } }
    db.exec('COMMIT; ANALYZE'); rng=r0; return s }
  const a=mk(Old,'o'), b=mk(New,'n')
  const base=Date.parse('2026-01-01'); const T=(s:any,f:any)=>{ const t=performance.now(); const r=f(s.read); return [performance.now()-t, JSON.stringify(r)] as const }
  for(let k=0;k<40;k++){ const frac=rand(); const since=new Date(base+Math.floor(frac*N)*30000).toISOString(); const flip=k%2===0
    const run=(s:any)=>({st:T(s,(r:any)=>r.triggerStats(since)),fl:T(s,(r:any)=>r.flow(since))})
    let x:any,y:any; if(flip){x=run(a);y=run(b)}else{y=run(b);x=run(a)}
    rows.push({seed,k,frac,order:flip?'base-first':'rep-first',stats:x.st[0],statsRep:y.st[0],flow:x.fl[0],flowRep:y.fl[0],match:x.st[1]===y.st[1]&&x.fl[1]===y.fl[1]}) } }
writeFileSync(out,JSON.stringify(rows)); console.log('pairs',rows.length,'mismatch',rows.filter(r=>!r.match).length)
