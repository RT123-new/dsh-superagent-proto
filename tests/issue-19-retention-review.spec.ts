/** Synthetic destructive-boundary adversarial proofs. No user database access. */
import {mkdtempSync,rmSync,symlinkSync,linkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {Store} from '../src/app/store.ts'
import type {Trigger} from '../src/core/index.ts'
let dir:string,store:Store
const DAY=86400000,NOW=Date.parse('2026-06-01T00:00:00Z')
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'retention-review-'));store=new Store(join(dir,'live.sqlite'));seed(store)})
afterEach(()=>{vi.restoreAllMocks();store.close();rmSync(dir,{recursive:true,force:true})})
function seed(s:Store,label='original') {for(const [id,days] of [['first',200],['victim',100],['newest',1]] as const)s.triggers.save({id,at:new Date(NOW-days*DAY).toISOString(),source:'github',threads:[{source:'github',id:'r'}],actor:{source:'github',id:'u'},human:true,text:label,meta:{}} as Trigger)}
const run=(s=store,path=join(dir,'archive.sqlite'))=>s.retention.run({archivePath:path,olderThanMs:30*DAY,now:NOW})
it('embedded IDs, JSON keys and kv keys retain live references',()=>{
 store.db.prepare('INSERT INTO kv VALUES (?,?)').run('cursor:victim',JSON.stringify({url:'https://example.invalid/event/victim'}))
 run();expect(store.triggers.get('victim')).toBeDefined()
})
it('archive ownership cannot be silently overwritten by another store with colliding Trigger IDs',()=>{
 run();const other=new Store(join(dir,'other.sqlite'));seed(other,'other-content')
 try {expect(()=>run(other)).toThrow();expect(other.triggers.get('victim')).toBeDefined()}finally{other.close()}
 store.retention.restore(join(dir,'archive.sqlite'));expect(store.triggers.get('victim')!.text).toBe('original')
})
it('a symlink to live database is rejected before writing archive schema to live',()=>{
 const alias=join(dir,'alias.sqlite');symlinkSync(join(dir,'live.sqlite'),alias)
 expect(()=>run(store,alias)).toThrow(/separate|live/i)
 expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name='archived_trigger'").get()).toBeUndefined()
})
it('restore verifies archive bytes before importing anything or removing tombstones',()=>{
 run();const archive=new DatabaseSync(join(dir,'archive.sqlite'))
 archive.prepare("UPDATE archived_trigger SET value=json_set(value,'$.text','corrupt') WHERE id='victim'").run();archive.close()
 expect(()=>store.retention.restore(join(dir,'archive.sqlite'))).toThrow(/verif|corrupt|digest/i)
 expect(store.triggers.get('victim')).toBeUndefined();expect(store.triggers.retired('victim')).toBe(true)
})
it('concurrent disposition changes after archive commit prevent deleting an outdated archived snapshot',()=>{
 const exec=DatabaseSync.prototype.exec
 let injected=false
 vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
  const result=exec.call(this,sql)
  if(sql==='COMMIT'&&!injected){injected=true;store.triggers.saveDisposition('victim',{fanout:['new-owner'],at:new Date(NOW).toISOString()})}
  return result
 })
 run();expect(injected).toBe(true);expect(store.triggers.get('victim')).toBeDefined()
})

it.each(['kv-key','json-key','embedded-effect-key','embedded-value'])('retains reference represented only by %s',(kind)=>{
 if(kind==='kv-key')store.db.prepare('INSERT INTO kv VALUES (?,?)').run('prefix/victim/suffix','{}')
 if(kind==='json-key')store.db.prepare('INSERT INTO kv VALUES (?,?)').run('key',JSON.stringify({'victim':true}))
 if(kind==='embedded-value')store.db.prepare('INSERT INTO kv VALUES (?,?)').run('key',JSON.stringify({url:'x/victim/y'}))
 if(kind==='embedded-effect-key')store.db.prepare('INSERT INTO effect (kind,key,value,seq,due,since) VALUES (?,?,?,?,?,?)').run('reply','receipt:victim','{}',1,0,'')
 run();expect(store.triggers.get('victim')).toBeDefined()
})
it('hardlink live alias and an unrelated live Store file cannot be archives',()=>{
 const alias=join(dir,'hardlink.sqlite');linkSync(join(dir,'live.sqlite'),alias)
 expect(()=>run(store,alias)).toThrow(/separate|live/i)
 const other=new Store(join(dir,'other.sqlite'));other.close()
 expect(()=>run(store,join(dir,'other.sqlite'))).toThrow(/live/i)
 expect(store.triggers.get('victim')).toBeDefined()
})
it('changed decisions in archive fail verification before restore writes',()=>{
 run();const archive=new DatabaseSync(join(dir,'archive.sqlite'))
 archive.prepare("UPDATE archived_trigger SET decisions='[\"unrelated\"]' WHERE id='victim'").run();archive.close()
 expect(()=>store.retention.restore(join(dir,'archive.sqlite'))).toThrow(/verif/i)
 expect(store.triggers.retired('victim')).toBe(true)
})
it('restore does not overwrite a current Trigger or resurrect removed decision links',()=>{
 store.db.prepare('INSERT INTO decision (id,thread,value) VALUES (?,?,?)').run('d','github:r',JSON.stringify({id:'d',threadKey:'github:r',triggerIds:['victim']}))
 run()
 store.db.prepare('UPDATE decision SET value=? WHERE id=?').run(JSON.stringify({id:'d',threadKey:'github:r',triggerIds:[]}), 'd')
 store.retention.restore(join(dir,'archive.sqlite'))
 expect(store.db.prepare('SELECT * FROM decision_trigger WHERE trigger=?').all('victim')).toHaveLength(0)
 store.triggers.save({...store.triggers.get('victim')!,text:'newer'})
 expect(store.retention.restore(join(dir,'archive.sqlite')).alreadyPresent).toBe(1)
 expect(store.triggers.get('victim')!.text).toBe('newer')
})

it('foreign restore refuses even when its archive rows are internally valid',()=>{
 run();const other=new Store(join(dir,'other.sqlite'))
 try {expect(()=>other.retention.restore(join(dir,'archive.sqlite'))).toThrow(/another Store/);expect(other.triggers.get('victim')).toBeUndefined()}finally{other.close()}
})
