const { Store: NewStore } = await import('/tmp/repo/src/app/store.ts')
const { Store: OldStore } = await import('/tmp/base/src/app/store.ts')
for (const [nm,S] of [['old',OldStore],['new',NewStore]] as const) {
  const s = new S('/tmp/rev/e_'+nm+'.sqlite'); const db = s.db
  db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02'),('5','{"source":"g"}','2026-01-02')`)
  for (const [lbl,v] of [['malformed','{bad'],['scalarIds','{"triggerIds":"t1","kind":"accept"}'],['noIds','{"kind":"accept"}'],['intIds','{"triggerIds":[5],"kind":"accept"}'],['objIds','{"triggerIds":[{"a":1}],"kind":"accept"}'],['nullIds','{"triggerIds":null}']]) {
    let ins='ok'; try { db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d_'+lbl,'th',v) } catch(e:any){ ins='INSERT ERR '+e.message }
    let rd='ok:'; try { rd += JSON.stringify(s.read.flow('2026-01-01')) } catch(e:any){ rd='READ ERR '+e.message }
    console.log(nm,lbl,ins,rd)
    try { db.prepare('DELETE FROM decision WHERE id=?').run('d_'+lbl) } catch {}
  }
}
