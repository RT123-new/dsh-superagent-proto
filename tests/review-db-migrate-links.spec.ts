import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SCHEMA_VERSION, Store } from '../src/app/store.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'review-db-migrate-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** A schema 10 file as the build before the link table left it: no decision_trigger table, no link triggers, plus awkward decision rows. */
function legacy(path: string, settings?: unknown, malformed = false): void {
  new Store(path).close()
  const db = new DatabaseSync(path)
  db.exec(`DROP TRIGGER decision_link_insert_v2; DROP TRIGGER decision_link_update_v2; DROP TRIGGER decision_link_delete_v2; DROP TABLE decision_trigger;
    DROP TABLE outbox; CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0); CREATE TABLE inbox (id TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  db.prepare("INSERT INTO kv VALUES ('schema','10') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  if (settings !== undefined) db.prepare("INSERT INTO kv VALUES ('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings))
  db.exec(`INSERT INTO trigger VALUES ('t1','{"id":"t1","source":"g","at":"2026-01-02","threads":[],"actor":{"source":"g","id":"u"},"human":true,"text":"x","url":"u","meta":{}}','2026-01-02'),('t2','{"id":"t2","source":"g","at":"2026-01-02","threads":[],"actor":{"source":"g","id":"u"},"human":true,"text":"x","url":"u","meta":{}}','2026-01-02');
    INSERT INTO decision VALUES ('ok','th','{"id":"ok","threadKey":"th","kind":"accept","triggerIds":["t1","t1","t2"]}'),('nul','th','{"id":"nul","threadKey":"th","triggerIds":null}'),('int','th','{"id":"int","threadKey":"th","triggerIds":[1]}')`)
  if (malformed) db.exec(`INSERT INTO decision VALUES ('bad','th','{bad')`)
  db.close()
}
const names = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'decision_link%' OR name = 'decision_trigger' ORDER BY name").all().map(r => r.name)

it('a failed schema 10 migration rolls back the link table and triggers with it, and a later successful open links every valid row once', () => {
  const path = join(directory, 'o.sqlite')
  legacy(path, { executor: { maxWorkers: 'many' } })
  expect(() => new Store(path)).toThrow(/unchanged at schema 10/)
  const raw = new DatabaseSync(path)
  expect(names(raw)).toEqual([])
  expect(raw.prepare("SELECT value FROM kv WHERE key='schema'").get()).toEqual({ value: '10' })
  expect(raw.prepare('SELECT COUNT(*) AS n FROM decision').get()).toEqual({ n: 3 })
  raw.prepare("DELETE FROM kv WHERE key='settings'").run(); raw.close()
  const store = new Store(path)
  expect(store.get('schema' as never)).toBeDefined()
  expect(store.db.prepare('SELECT trigger, decision FROM decision_trigger ORDER BY 1, 2').all()).toEqual([{ trigger: 't1', decision: 'ok' }, { trigger: 't2', decision: 'ok' }])
  expect(store.read.flow('2026-01-01')).toEqual({ judged: 2, accepted: 1 })
  expect(String(store.db.prepare("SELECT value FROM kv WHERE key='schema'").get()!.value)).toBe(String(SCHEMA_VERSION))
  store.close()
  const again = new Store(path)
  expect(again.db.prepare('SELECT COUNT(*) AS n FROM decision_trigger').get()).toEqual({ n: 2 })
  expect(names(again.db)).toHaveLength(4)
  again.close()
})

// Characterisation of unchanged baseline behaviour (migration.ts is not modified by this PR): a malformed decision row blocks the schema 10 upgrade, fail closed.
it('a schema 10 database holding a malformed decision row is refused with the file unchanged (baseline behaviour, message does not name the row)', () => {
  const path = join(directory, 'o.sqlite')
  legacy(path, undefined, true)
  expect(() => new Store(path)).toThrow(/unchanged at schema 10: its migration to schema 11 failed: malformed JSON/)
  const raw = new DatabaseSync(path)
  expect(names(raw)).toEqual([])
  expect(raw.prepare("SELECT value FROM kv WHERE key='schema'").get()).toEqual({ value: '10' })
  expect(raw.prepare('SELECT COUNT(*) AS n FROM decision').get()).toEqual({ n: 4 })
  raw.close()
})
