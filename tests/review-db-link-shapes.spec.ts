import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'review-db-link-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const legacyFlow = (store: Store, since: string) => {
  const passed = "t.at >= ? AND NOT EXISTS (SELECT 1 FROM disposition s WHERE s.id = t.id AND json_extract(s.value, '$.filtered') IS NOT NULL)"
  const judged = store.db.prepare(`SELECT COUNT(DISTINCT t.id) AS n FROM decision d, json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value WHERE ${passed}`).get(since)
  return Number(judged?.n)
}

// Valid JSON whose triggerIds is not an array of strings must not break the writer (legacy baseline accepted these writes and counted no link).
for (const [label, value] of [['null', '{"kind":"accept","triggerIds":null}'], ['absent', '{"kind":"accept"}'], ['null element', '{"kind":"accept","triggerIds":[null,"t1"]}'],
  ['integer ids', '{"kind":"accept","triggerIds":[5]}'], ['object ids', '{"kind":"accept","triggerIds":[{"a":1}]}']] as const) {
  it(`direct SQL write with triggerIds shape "${label}" is accepted and agrees with the legacy query`, () => {
    const store = new Store(join(directory, 'o.sqlite'))
    store.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02'),('5','{"source":"g"}','2026-01-02')`)
    expect(() => store.db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d', 'th', value)).not.toThrow()
    expect(() => store.db.prepare('UPDATE decision SET value = ? WHERE id = ?').run(value, 'd')).not.toThrow()
    const expected = label === 'null element' ? 1 : 0
    expect(legacyFlow(store, '2026-01-01')).toBe(expected)
    expect(store.read.flow('2026-01-01').judged).toBe(expected)
    store.close()
  })
}
it('a malformed decision write is not rejected by the link maintainer and leaves no links', () => {
  const store = new Store(join(directory, 'o.sqlite'))
  expect(() => store.db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d', 'th', '{bad')).not.toThrow()
  expect(store.db.prepare('SELECT COUNT(*) AS n FROM decision_trigger').get()?.n).toBe(0)
  store.close()
})
it('opening a database that has v1 link triggers replaces them and keeps links correct', () => {
  const path = join(directory, 'o.sqlite')
  const first = new Store(path)
  first.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02'); INSERT INTO decision VALUES ('d','th','{"kind":"accept","triggerIds":["t1"]}')`)
  first.db.exec('DROP TRIGGER decision_link_insert_v2; DROP TRIGGER decision_link_update_v2; DROP TRIGGER decision_link_delete_v2')
  first.db.exec(`CREATE TRIGGER decision_link_insert_v1 AFTER INSERT ON decision BEGIN INSERT INTO decision_trigger SELECT DISTINCT j.value, new.id FROM json_each(new.value, '$.triggerIds') j; END`)
  first.close()
  const second = new Store(path)
  const names = second.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'decision_link%' ORDER BY name").all().map(r => r.name)
  expect(names).toEqual(['decision_link_delete_v2', 'decision_link_insert_v2', 'decision_link_update_v2'])
  expect(() => second.db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d2', 'th', '{"triggerIds":null}')).not.toThrow()
  expect(second.read.flow('2026-01-01')).toEqual({ judged: 1, accepted: 1 })
  second.close()
})
