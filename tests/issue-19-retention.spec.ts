import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MIN_AGE_MS } from '../src/app/retention.ts'
import { Store } from '../src/app/store.ts'
import { Engine, type Decision, type EngineOptions, type Thread, type Ticket, type Trigger } from '../src/core/index.ts'

let dir: string, store: Store
const NOW = Date.parse('2026-06-01T00:00:00.000Z'), DAY = 86_400_000
const at = (daysAgo: number, offsetMs = 0) => new Date(NOW - daysAgo * DAY + offsetMs).toISOString()
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'retention-')); store = new Store(join(dir, 'live.sqlite')) })
afterEach(() => { try { store.close() } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }) })

const trig = (id: string, source: string, thread: string, days: number, human = false, offset = 0): Trigger =>
  ({ id, source, threads: [{ source, id: thread }], actor: { source, id: 'u' }, human, at: at(days, offset), text: `text ${id}`, meta: {} })
const put = (t: Trigger, filtered = false) => { store.triggers.save(t); store.triggers.saveDisposition(t.id, (filtered ? { filtered: { code: 'scope' }, fanout: [], at: t.at } : { fanout: [], at: t.at }) as never) }
const thread = (key: string, fields: Partial<Thread> = {}): Thread => ({ key, ref: { source: key.split(':')[0]!, id: key.split(':')[1]! }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {}, ...fields })
const ids = () => (store.db.prepare('SELECT id FROM trigger ORDER BY id').all().map(r => String(r.id)))
const run = (extra: Record<string, unknown> = {}) => store.retention.run({ archivePath: join(dir, 'archive.sqlite'), olderThanMs: 30 * DAY, now: NOW, batchSize: 7, ...extra } as never)

/** Old, unreferenced filler plus a first and a newest anchor on each thread/source, so only the filler is eligible. */
function seed() {
  put(trig('anchor-first', 'github', 'r1', 200, false)); put(trig('anchor-first-human', 'github', 'r1', 199, true))
  for (let i = 0; i < 40; i++) put(trig(`old${i}`, 'github', 'r1', 100 - i, i % 2 === 0), i % 3 === 0)
  put(trig('young', 'github', 'r1', 5)); put(trig('newest', 'github', 'r1', 1))
}

it('refuses windows below the floor, the live database as archive, and dry runs write nothing', () => {
  seed(); const before = ids()
  expect(() => run({ olderThanMs: MIN_AGE_MS - 1 })).toThrow('48')
  expect(() => run({ archivePath: store.db.prepare('PRAGMA database_list').all()[0]!.file as string })).toThrow('separate')
  const report = run({ dryRun: true })
  expect(report.pruned).toBe(0); expect(report.dryRun).toBe(true); expect(report.examined).toBeGreaterThan(30)
  expect(ids()).toEqual(before)
  expect(store.db.prepare('SELECT COUNT(*) n FROM trigger_tombstone').get()!.n).toBe(0)
})
it('prunes only eligible old Triggers, keeps anchors, archives byte-equal rows and tombstones every id', () => {
  seed()
  const snapshot = new Map(store.db.prepare('SELECT id, value FROM trigger').all().map(r => [String(r.id), String(r.value)]))
  const report = run()
  expect(report.done).toBe(true); expect(report.pruned).toBe(40); expect(report.batches).toBeGreaterThan(4)
  expect(ids()).toEqual(['anchor-first', 'anchor-first-human', 'newest', 'young'])
  expect(report.kept.firstOfThread).toBe(2)
  const archive = new DatabaseSync(join(dir, 'archive.sqlite'), { readOnly: true })
  const rows = archive.prepare('SELECT id, value, disposition FROM archived_trigger').all()
  expect(rows).toHaveLength(40)
  for (const row of rows) { expect(row.value).toBe(snapshot.get(String(row.id))); expect(row.disposition).not.toBeNull() }
  archive.close()
  expect(store.db.prepare('SELECT COUNT(*) n FROM trigger_tombstone').get()!.n).toBe(40)
  expect(store.triggers.retired('old3')).toBe(true); expect(store.triggers.retired('young')).toBe(false)
  expect(store.db.prepare("SELECT COUNT(*) n FROM trigger_thread WHERE id LIKE 'old%'").get()!.n).toBe(0)
  expect(run().pruned).toBe(0) // idempotent
})
it('never prunes the newest Trigger of a Source, even when it is old', () => {
  put(trig('gh-a', 'github', 'r1', 300)); put(trig('gh-b', 'github', 'r1', 290)); put(trig('fs-a', 'feishu', 'c1', 280)); put(trig('fs-b', 'feishu', 'c1', 270)); put(trig('fs-c', 'feishu', 'c1', 260))
  const before = store.read.triggerStats(at(0))
  run()
  expect(ids()).toEqual(['fs-a', 'fs-c', 'gh-a', 'gh-b']) // first-of-thread and newest-of-source stay; middle ones are the only candidates
  expect(store.read.triggerStats(at(0))).toEqual(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, { ...v }]))) // lastAt and window counts equal
})
it('keeps Triggers that are queued, evaluating, or referenced by any ticket, thread, outbox row or effect', () => {
  put(trig('first', 'github', 'r1', 200, true))
  for (const id of ['q-pending', 'q-eval', 'r-origin', 'r-input', 'r-attention', 'r-outbox', 'r-effect', 'r-effect-key', 'r-kv', 'free']) put(trig(id, 'github', 'r1', 100))
  put(trig('newest', 'github', 'r1', 1))
  store.threads.save(thread('github:r1', { pending: ['q-pending'], evaluating: { triggerIds: ['q-eval'] } as never }))
  store.tickets.save({ id: 'k1', title: 't', assignments: [], inputs: [{ id: 'i', kind: 'trigger', triggerId: 'r-input', at: '' }], undelivered: [], origin: { triggerId: 'r-origin', triggerIds: ['r-origin'] }, attention: { id: 'a', question: '?', triggerId: 'r-attention' } } as unknown as Ticket)
  store.db.prepare('INSERT INTO outbox (id, value) VALUES (?,?)').run('o1', JSON.stringify({ id: 'o1', triggerId: 'r-outbox', status: 'sent' }))
  store.db.prepare('INSERT INTO effect (kind,key,value,seq,due,since) VALUES (?,?,?,?,?,?)').run('reply', 'e1', JSON.stringify({ triggerId: 'r-effect' }), 1, 0, '')
  store.db.prepare('INSERT INTO effect (kind,key,value,seq,due,since) VALUES (?,?,?,?,?,?)').run('reply', 'r-effect-key', '{}', 2, 0, '')
  store.db.prepare('INSERT INTO kv VALUES (?,?)').run('some-cursor', JSON.stringify({ last: 'r-kv' }))
  const report = run({ batchSize: 3 })
  expect(report.pruned).toBe(1); expect(report.kept.queuedOnThread).toBe(2); expect(report.kept.referenced).toBe(7)
  expect(ids()).toEqual(['first', 'newest', 'q-eval', 'q-pending', 'r-attention', 'r-effect', 'r-effect-key', 'r-input', 'r-kv', 'r-origin', 'r-outbox'].sort())
})
it('keeps a pruned Trigger known: Intake reports a replay as duplicate and creates no work', () => {
  put(trig('first', 'github', 'r1', 200, true)); put(trig('replayed', 'github', 'r1', 100)); put(trig('newest', 'github', 'r1', 1))
  run(); expect(store.triggers.get('replayed')).toBeUndefined()
  const executor = { start: vi.fn(), deliver: vi.fn(), stop: vi.fn() }
  const engine = new Engine({ repo: store, policy: () => ({ version: 'v', paused: false, evalTimeoutMs: 1, gate: () => ({ admissible: false, reason: 'x' }), revalidate: () => true, admitsInferred: () => false }) as never,
    scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: vi.fn(), release: vi.fn() }, executor, outbox: { send: vi.fn(), status: () => undefined } as never } as EngineOptions)
  expect(engine.receive(trig('replayed', 'github', 'r1', 100))).toBe('duplicate')
  expect(store.triggers.get('replayed')).toBeUndefined(); expect(store.db.prepare('SELECT COUNT(*) n FROM thread').get()!.n).toBe(0)
  expect(engine.receive(trig('brand-new', 'github', 'r1', 0))).not.toBe('duplicate')
})
it('keeps windowed stats equal for windows inside retention, and Decisions with their id references', () => {
  seed()
  store.decisions.save({ id: 'dec', threadKey: 'github:r1', kind: 'accept', triggerIds: ['old5', 'young'], at: at(0) } as unknown as Decision)
  const win = at(20)
  const before = { stats: store.read.triggerStats(win), flow: store.read.flow(win) }
  run()
  expect({ stats: store.read.triggerStats(win), flow: store.read.flow(win) }).toEqual(before)
  expect(store.decisions.get('dec')!.triggerIds).toEqual(['old5', 'young']) // audit reference retained; resolves through the archive
  const archive = new DatabaseSync(join(dir, 'archive.sqlite'), { readOnly: true })
  expect(JSON.parse(String(archive.prepare("SELECT decisions FROM archived_trigger WHERE id = 'old5'").get()!.decisions))).toEqual(['dec']); archive.close()
})
it('restore puts every row back with indexes and decision links and removes tombstones; idempotent', () => {
  seed(); store.decisions.save({ id: 'dec', threadKey: 'github:r1', kind: 'accept', triggerIds: ['old5'], at: at(0) } as unknown as Decision)
  const dump = () => ({ t: store.db.prepare('SELECT * FROM trigger ORDER BY id').all(), x: store.db.prepare('SELECT * FROM trigger_thread ORDER BY id, thread').all(), d: store.db.prepare('SELECT * FROM disposition ORDER BY id').all(), l: store.db.prepare('SELECT * FROM decision_trigger ORDER BY trigger, decision').all() })
  const before = JSON.parse(JSON.stringify(dump()))
  run(); expect(ids().length).toBe(4)
  expect(store.retention.restore(join(dir, 'archive.sqlite'))).toEqual({ restored: 40, alreadyPresent: 0 })
  expect(JSON.parse(JSON.stringify(dump()))).toEqual(before)
  expect(store.db.prepare('SELECT COUNT(*) n FROM trigger_tombstone').get()!.n).toBe(0)
  expect(store.retention.restore(join(dir, 'archive.sqlite'))).toEqual({ restored: 0, alreadyPresent: 40 })
})
it('an archive failure leaves the live database untouched', () => {
  seed(); const before = ids()
  expect(() => run({ archivePath: join(dir, 'missing-dir', 'a.sqlite') })).toThrow()
  expect(ids()).toEqual(before); expect(store.db.prepare('SELECT COUNT(*) n FROM trigger_tombstone').get()!.n).toBe(0)
})
it('a backup taken after pruning keeps the tombstones, so dedupe survives restoring that backup', () => {
  seed(); run()
  store.db.exec(`VACUUM INTO '${join(dir, 'backup.sqlite')}'`)
  const copy = new Store(join(dir, 'backup.sqlite'))
  expect(copy.triggers.retired('old7')).toBe(true); expect(copy.db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok'); copy.close()
})
it('survives SIGKILL mid-run: no Trigger is ever deleted without both archive row and tombstone, and a rerun finishes', async () => {
  const path = join(dir, 'crash.sqlite'); const s = new Store(path)
  s.db.exec('BEGIN')
  for (let i = 0; i < 6000; i++) { const t = trig(`c${i}`, 'github', `r${i % 20}`, 150 - i / 100, false, i); s.triggers.save(t); s.triggers.saveDisposition(t.id, { fanout: [], at: t.at } as never) }
  s.triggers.save(trig('c-newest', 'github', 'r0', 0)); s.db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)'); s.close()
  const script = `import { Store } from '${join(process.cwd(), 'src/app/store.ts')}'
    const s = new Store(process.argv[2]); const stop = Number(process.argv[4]); s.retention.run({ archivePath: process.argv[3], olderThanMs: 30*86400000, now: ${NOW}, batchSize: 25, ...stop ? { maxBatches: stop } : {} })
    if (stop) process.kill(process.pid, 'SIGKILL')`
  const file = join(dir, 'child.ts'); (await import('node:fs')).writeFileSync(file, script)
  let partial = 0
  for (let k = 0; k < 5; k++) {
    const arch = join(dir, `arch${k}.sqlite`); const live = join(dir, `live${k}.sqlite`); (await import('node:fs')).copyFileSync(path, live)
    // Trials 0-1 kill the process itself after a fixed number of batches; the rest are killed by a timer, possibly inside a transaction.
    const child = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', file, live, arch, k === 0 ? '3' : k === 1 ? '60' : '0'], { stdio: 'ignore' })
    const closed = new Promise(r => child.on('close', r))
    if (k >= 2) { await new Promise(r => setTimeout(r, 150 + k * 150)); if (child.exitCode === null) child.kill('SIGKILL') }
    await closed
    const db = new DatabaseSync(live); expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok')
    const gone = db.prepare("SELECT id FROM trigger_tombstone").all().map(r => String(r.id))
    const present = new Set(db.prepare('SELECT id FROM trigger').all().map(r => String(r.id)))
    expect(gone.some(id => present.has(id))).toBe(false)
    if (gone.length > 0 && gone.length < 4500) partial++
    expect(db.prepare("SELECT COUNT(*) n FROM trigger").get()!.n).toBe(6001 - gone.length) // every missing Trigger has a tombstone, none vanished
    expect(db.prepare("SELECT COUNT(*) n FROM trigger_thread WHERE id IN (SELECT id FROM trigger_tombstone)").get()!.n).toBe(0)
    db.close()
    const a = new DatabaseSync(arch); const archived = new Set(a.prepare('SELECT id FROM archived_trigger').all().map(r => String(r.id))); a.close()
    expect(gone.every(id => archived.has(id))).toBe(true)
    const s2 = new Store(live); s2.retention.run({ archivePath: arch, olderThanMs: 30 * DAY, now: NOW, batchSize: 500 })
    expect(s2.db.prepare('SELECT COUNT(*) n FROM trigger').get()!.n).toBeLessThan(3000); s2.close()
  }
  expect(partial).toBeGreaterThanOrEqual(2) // the fixed-batch trials always stop part-way
}, 60_000)
it('looks up and deletes a Trigger\'s thread rows by index instead of scanning every row', () => {
  seed(); store.db.exec('ANALYZE')
  for (const sql of ['DELETE FROM trigger_thread WHERE id = ?', 'SELECT thread, human FROM trigger_thread WHERE id = ?'])
    expect(store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('old1').map(r => String(r.detail)).join('\n')).toMatch(/USING (COVERING )?INDEX trigger_thread_id/)
})
