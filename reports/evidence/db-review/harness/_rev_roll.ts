import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const { Store: Old } = await import('/tmp/base/src/app/store.ts'); const { Store: New } = await import('/tmp/repo/src/app/store.ts')
const p=join(mkdtempSync(join(tmpdir(),'roll-')),'o.sqlite')
const a=new New(p); a.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02'),('t2','{"source":"g"}','2026-01-02'); INSERT INTO decision VALUES ('d1','th','{"kind":"accept","triggerIds":["t1"]}')`); a.close()
let o: any; try { o=new Old(p) } catch(e:any){ console.log('main store opens PR db: ERROR', e.message); process.exit() }
o.db.exec(`INSERT INTO decision VALUES ('d2','th','{"kind":"accept","triggerIds":["t2"]}')`)
console.log('main sees', JSON.stringify(o.read.flow('2000-01-01')), JSON.stringify(o.read.triggerStats('2000-01-01')))
console.log('trigger cols main', o.db.prepare("SELECT name FROM pragma_table_xinfo('trigger')").all().map((r:any)=>r.name).join(), 'links', o.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get().n); o.close()
const b=new New(p); console.log('PR reopen', JSON.stringify(b.read.flow('2000-01-01')), JSON.stringify(b.read.triggerStats('2000-01-01')), 'links', b.db.prepare('SELECT COUNT(*) n FROM decision_trigger').get().n)
