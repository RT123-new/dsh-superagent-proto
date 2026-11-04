import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { storeReads } from '../src/app/store-read.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'review-db-flow-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** A second connection commits right after the reader's first statement finishes: the reader must still return one consistent snapshot. */
it('flow returns judged and accepted from one snapshot when another connection commits between statements', () => {
  const path = join(directory, 'o.sqlite')
  const store = new Store(path)
  store.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02')`)
  const other = new DatabaseSync(path)
  let fired = false
  const hooked = new Proxy(store.db, { get(target, prop) {
    if (prop !== 'prepare') return (target as any)[prop].bind?.(target) ?? (target as any)[prop]
    return (sql: string) => {
      const statement = target.prepare(sql)
      return new Proxy(statement, { get(s, p) {
        if (p !== 'get') return (s as any)[p].bind(s)
        return (...args: any[]) => { const row = (s as any).get(...args); if (!fired) { fired = true; other.exec(`INSERT INTO decision VALUES ('d','th','{"kind":"accept","triggerIds":["t1"]}')`) } return row }
      } })
    }
  } })
  const flow = storeReads(hooked as DatabaseSync).flow('2026-01-01')
  other.close(); store.close()
  expect([JSON.stringify({ judged: 0, accepted: 0 }), JSON.stringify({ judged: 1, accepted: 1 })]).toContain(JSON.stringify(flow))
})
