import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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

it('upgrades an existing stale link table once and catches direct REPLACE and id changes',()=>{
 let s=setup();s.decisions.save(decision(['a']))
 s.db.exec('DROP TRIGGER decision_link_insert_v2; DROP TRIGGER decision_link_update_v2; DROP TRIGGER decision_link_delete_v2; DELETE FROM decision_trigger')
 s.close();store=undefined;s=new Store(join(root,'db'));store=s
 expect(s.read.flow(since)).toEqual({judged:1,accepted:1})
 s.db.prepare('INSERT OR REPLACE INTO decision(id,thread,value) VALUES(?,?,?)').run('d','github:1',JSON.stringify(decision(['b','b'])))
 expect(s.db.prepare('SELECT trigger FROM decision_trigger').all().map(x=>x.trigger)).toEqual(['b'])
 s.db.exec("UPDATE decision SET id='new-d' WHERE id='d'")
 expect(s.db.prepare('SELECT decision FROM decision_trigger').all().map(x=>x.decision)).toEqual(['new-d'])
})

for(const mode of ['uncommitted','committed'])it(`SIGKILL after ${mode} save preserves decision/link atomicity`,()=>{
 let s=setup();s.decisions.save(decision(['a']));s.close();store=undefined
 const tsx=realpathSync(spawnSync('pnpm',['exec','which','tsx'],{cwd:process.cwd(),encoding:'utf8'}).stdout.trim())
 const killed=spawnSync(process.execPath,['--import',tsx.replace(/cli\.mjs$/, 'loader.mjs'),'scripts/storage/review-crash.ts',join(root,'db'),mode],{cwd:process.cwd(),encoding:'utf8'})
 expect(killed.stdout).toContain(`SAVE_BOUNDARY:${mode}\n`)
 expect(killed.signal).toBe('SIGKILL')
 s=new Store(join(root,'db'));store=s
 const expected=mode==='committed'?'b':'a'
 expect(s.decisions.get('d')?.triggerIds).toEqual([expected])
 expect(s.db.prepare('SELECT trigger FROM decision_trigger WHERE decision=?').all('d').map(x=>x.trigger)).toEqual([expected])
 expect(s.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
},15000)

it('flow forces the time-window index even after adding a decision-side maintenance index',()=>{
 const s=setup(), captured:string[]=[]
 const original=s.db.prepare.bind(s.db)
 s.db.prepare=((sql:string)=>{if(sql.includes('COUNT(DISTINCT'))captured.push(sql);return original(sql)}) as typeof s.db.prepare
 s.read.flow(since)
 for(const sql of captured){
  const plan=original('EXPLAIN QUERY PLAN '+sql).all(since).map(x=>x.detail).join('\n')
  expect(plan).toMatch(/SEARCH t USING INDEX trigger_at/)
  expect(plan).not.toMatch(/SCAN d/)
 }
})

it('helper setup failure cannot satisfy the SIGKILL boundary evidence',()=>{
 const s=setup();s.close();store=undefined
 const tsx=realpathSync(spawnSync('pnpm',['exec','which','tsx'],{cwd:process.cwd(),encoding:'utf8'}).stdout.trim())
 const failed=spawnSync(process.execPath,['--import',tsx.replace(/cli\.mjs$/, 'loader.mjs'),'scripts/storage/review-crash.ts',join(root,'db'),'helper-failure'],{cwd:process.cwd(),encoding:'utf8'})
 expect(failed.status).not.toBe(0)
 expect(failed.signal).not.toBe('SIGKILL')
 expect(failed.stdout).not.toContain('SAVE_BOUNDARY:')
 expect(failed.stderr).toContain('Deliberate helper failure')
})
