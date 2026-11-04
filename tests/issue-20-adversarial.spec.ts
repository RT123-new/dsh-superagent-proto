import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import type { Decision, Trigger } from '../src/core/index.ts'
let root = '', store: Store | undefined
const since = '2026-01-01T00:00:00Z'
afterEach(() => { store?.close(); store = undefined; if(root)rmSync(root,{recursive:true,force:true}) })
const decision = (ids: string[], kind = 'accept') => ({ id:'d',threadKey:'github:1', triggerIds:ids,kind,at:since } as unknown as Decision)
function setup() {
 root=mkdtempSync(join(tmpdir(),'storage-review-'));store=new Store(join(root,'db'))
 for(const id of ['a','b'])store.triggers.save({id,source:'github',threads:[],actor:{source:'github',id:'u'},human:true,at:since,text:'x',meta:{}} as Trigger)
 return store
}
it('decision-link replacement deletes use an index keyed by decision, not a full history scan',()=>{
 const s=setup()
 const plan=s.db.prepare('EXPLAIN QUERY PLAN DELETE FROM decision_trigger WHERE decision=?').all('d').map(x=>x.detail).join('\n')
 expect(plan).toMatch(/SEARCH.*INDEX/)
})
it('direct insert/update/delete through the exposed database keep derived flow consistent',()=>{
 const s=setup()
 s.db.prepare('INSERT INTO decision(id,thread,value) VALUES(?,?,?)').run('d','github:1',JSON.stringify(decision(['a'])))
 expect(s.read.flow(since)).toEqual({judged:1,accepted:1})
 s.db.prepare('UPDATE decision SET value=? WHERE id=?').run(JSON.stringify(decision(['a','b'],'ignore')),'d')
 expect(s.read.flow(since)).toEqual({judged:2,accepted:0})
 s.db.prepare('DELETE FROM decision WHERE id=?').run('d')
 expect(s.read.flow(since)).toEqual({judged:0,accepted:0})
})
it('an outer rollback restores both decisions and link rows, including a failed nested save',()=>{
 const s=setup();s.decisions.save(decision(['a']))
 expect(()=>s.atomic(()=>{s.decisions.save(decision(['b']));throw Error('rollback')})).toThrow('rollback')
 expect(s.decisions.get('d')?.triggerIds).toEqual(['a'])
 expect(s.db.prepare('SELECT trigger FROM decision_trigger WHERE decision=?').all('d').map(x=>x.trigger)).toEqual(['a'])
 s.db.exec(`CREATE TRIGGER fail_link BEFORE INSERT ON decision_trigger WHEN new.trigger='b' BEGIN SELECT RAISE(ABORT,'link failure'); END`)
 expect(()=>s.decisions.save(decision(['b']))).toThrow('link failure')
 expect(s.decisions.get('d')?.triggerIds).toEqual(['a'])
 expect(s.read.flow(since)).toEqual({judged:1,accepted:1})
})
it('reopen keeps re-saved links and database integrity',()=>{
 let s=setup();s.decisions.save(decision(['a']));s.decisions.save(decision(['b','b','missing']))
 s.close();store=undefined;s=new Store(join(root,'db'));store=s
 expect(s.read.flow(since)).toEqual({judged:1,accepted:1})
 expect(s.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
})
