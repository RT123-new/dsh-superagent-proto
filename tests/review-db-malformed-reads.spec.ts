import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'review-db-malformed-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const seeded = () => {
  const s = new Store(join(directory, 'o.sqlite'))
  s.db.exec(`INSERT INTO trigger VALUES ('t1','{"source":"g"}','2026-01-02')`)
  s.db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d', 'th', '{bad')
  return s
}
// Scope of the tolerance: only the two metrics queries read the derived link table, so only they stop throwing on a malformed decision row.
it('metrics queries (flow, triggerStats) tolerate a malformed decision row and count no link for it', () => {
  const s = seeded()
  expect(s.read.flow('2026-01-01')).toEqual({ judged: 0, accepted: 0 })
  expect(s.read.triggerStats('2026-01-01')).toEqual({ g: { received: 1, filtered: 0, lastAt: '2026-01-02' } })
  s.close()
})
it('decision readers still reject a malformed decision row (unchanged baseline behaviour, not repaired)', () => {
  const s = seeded()
  expect(() => s.read.recentDecisions()).toThrow()
  expect(() => s.read.decisions({ kinds: [], since: '' }, 0, 10)).toThrow()
  expect(() => s.read.decisionsOfKinds(['accept'])).toThrow()
  s.close()
})
