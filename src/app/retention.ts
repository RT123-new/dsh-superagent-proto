/**
 * Opt-in, never-scheduled retention for old Triggers (Issue 19).
 *
 * Nothing here runs unless a caller invokes `Retention.run` or `Retention.restore`. A Trigger is pruned only after
 * (1) it is eligible by the reference rules below, (2) its rows are copied into a separate archive database that is committed
 * and read back and compared, and (3) the delete and a durable tombstone commit in ONE transaction, so a crash can never
 * leave a Trigger deleted without both its archive row and its tombstone. Tombstoned ids stay "known" to Intake, so a Source
 * that replays or reconciles an old event still gets `duplicate` instead of new work.
 *
 * Eligible = older than `olderThanMs` (hard floor `MIN_AGE_MS`) AND none of:
 *  - the newest Trigger of its Source (keeps all-time `lastAt` in triggerStats exact);
 *  - the first, or first human, Trigger of any of its Threads (they title and link the Thread in views);
 *  - queued or evaluating on a Thread;
 *  - any string value equal to its id inside any Ticket, Thread, outbox row or effect payload, any effect/outbox key
 *    that equals its id, or any kv value (conservative: exact-string reference found anywhere in live work or settings).
 * Decisions, Tickets and Threads are never deleted. Decisions keep their `triggerIds`; those ids resolve through the archive.
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Store } from './store.ts'

export const MIN_AGE_MS = 48 * 3600_000
export const MAX_BATCH = 5000
export interface RetentionOptions {
  /** Separate SQLite file that receives the archive; must not be the live database. */
  archivePath: string
  /** Prune Triggers whose `at` is older than now minus this; not below `MIN_AGE_MS`. */
  olderThanMs: number
  /** Rows per transaction (default 500, max `MAX_BATCH`). */
  batchSize?: number
  /** Stop after this many batches so a caller can interleave other work (default: until done). */
  maxBatches?: number
  /** Count what would be pruned and why others are kept; writes nothing. */
  dryRun?: boolean
  now?: number
}
export interface RetentionReport {
  cutoff: string; dryRun: boolean; examined: number; pruned: number; batches: number; done: boolean
  kept: Record<'newestOfSource' | 'firstOfThread' | 'queuedOnThread' | 'referenced', number>
}
interface Row { id: string; at: string; value: string }
const SCHEMA = `CREATE TABLE IF NOT EXISTS archived_trigger (id TEXT PRIMARY KEY, at TEXT NOT NULL, value TEXT NOT NULL, disposition TEXT,
  threads TEXT NOT NULL, decisions TEXT NOT NULL, sha256 TEXT NOT NULL, archived_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS archived_trigger_at ON archived_trigger(at);
  CREATE TABLE IF NOT EXISTS archive_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO archive_meta VALUES ('format', '1')`
const digest = (value: string, disposition: string | null, threads: string) => createHash('sha256').update(value).update('\0').update(disposition ?? '').update('\0').update(threads).digest('hex')
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',')

/** Archives, prunes and restores old Triggers for one Store on explicit request; see the file header for the eligibility and crash-safety rules. */
export class Retention {
  constructor(private readonly store: Store) {}

  private get db() { return this.store.db }
  private mainFile(): string { return String(this.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file ?? '') }

  /** Returns, for `rows`, the ids that must be kept and the reason, evaluated against current state. */
  private keep(rows: Row[], cutoff: string): Map<string, keyof RetentionReport['kept']> {
    const kept = new Map<string, keyof RetentionReport['kept']>()
    const ids = rows.map(row => row.id)
    const queued = new Set<string>()
    for (const thread of this.store.threads.active()) {
      for (const id of thread.pending) queued.add(id)
      for (const id of thread.evaluating?.triggerIds ?? []) queued.add(id)
    }
    const newest = this.db.prepare('SELECT id FROM trigger WHERE source = ? ORDER BY at DESC, id DESC LIMIT 1')
    const earlier = this.db.prepare('SELECT 1 FROM trigger_thread y WHERE y.thread = ? AND (y.at < ? OR (y.at = ? AND y.id < ?)) LIMIT 1')
    const earlierHuman = this.db.prepare('SELECT 1 FROM trigger_thread y WHERE y.thread = ? AND y.human = 1 AND (y.at < ? OR (y.at = ? AND y.id < ?)) LIMIT 1')
    const threadsOf = this.db.prepare('SELECT thread, human FROM trigger_thread WHERE id = ?')
    for (const row of rows) {
      if (queued.has(row.id)) { kept.set(row.id, 'queuedOnThread'); continue }
      const source = (JSON.parse(row.value) as { source?: string }).source
      if (source !== undefined && newest.get(source)?.id === row.id) { kept.set(row.id, 'newestOfSource'); continue }
      for (const link of threadsOf.all(row.id)) {
        const thread = String(link.thread)
        if (!earlier.get(thread, row.at, row.at, row.id) || (link.human === 1 && !earlierHuman.get(thread, row.at, row.at, row.id))) { kept.set(row.id, 'firstOfThread'); break }
      }
    }
    const open = ids.filter(id => !kept.has(id))
    if (open.length) {
      const ph = marks(open.length)
      const hit = new Set<string>()
      const scans = [
        `SELECT DISTINCT j.value AS v FROM ticket t, json_tree(t.value) j WHERE j.type = 'text' AND j.value IN (${ph})`,
        `SELECT DISTINCT j.value AS v FROM thread t, json_tree(t.value) j WHERE j.type = 'text' AND j.value IN (${ph})`,
        `SELECT DISTINCT j.value AS v FROM outbox t, json_tree(t.value) j WHERE j.type = 'text' AND j.value IN (${ph})`,
        `SELECT DISTINCT j.value AS v FROM effect t, json_tree(t.value) j WHERE j.type = 'text' AND j.value IN (${ph})`,
        `SELECT DISTINCT j.value AS v FROM kv t, json_tree(t.value) j WHERE j.type = 'text' AND j.value IN (${ph})`,
        `SELECT key AS v FROM effect WHERE key IN (${ph})`, `SELECT id AS v FROM outbox WHERE id IN (${ph})`,
      ]
      for (const sql of scans) for (const row of this.db.prepare(sql).all(...open)) hit.add(String(row.v))
      for (const id of open) if (hit.has(id)) kept.set(id, 'referenced')
    }
    void cutoff
    return kept
  }

  /** Prunes eligible old Triggers in bounded, individually atomic batches, archiving before deleting. */
  run(options: RetentionOptions): RetentionReport {
    const now = options.now ?? Date.now()
    if (!Number.isFinite(options.olderThanMs) || options.olderThanMs < MIN_AGE_MS) throw new Error(`olderThanMs must be at least ${MIN_AGE_MS} (48 hours)`)
    const batchSize = Math.min(Math.max(1, Math.floor(options.batchSize ?? 500)), MAX_BATCH)
    const cutoff = new Date(now - options.olderThanMs).toISOString()
    const report: RetentionReport = { cutoff, dryRun: !!options.dryRun, examined: 0, pruned: 0, batches: 0, done: false,
      kept: { newestOfSource: 0, firstOfThread: 0, queuedOnThread: 0, referenced: 0 } }
    if (!options.dryRun) {
      const live = this.mainFile()
      if (!options.archivePath || (live && options.archivePath === live)) throw new Error('archivePath must be a separate file from the live database')
    }
    const archive = options.dryRun ? undefined : new DatabaseSync(options.archivePath)
    try {
      if (archive) { archive.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL'); archive.exec(SCHEMA) }
      let after: { at: string; id: string } = { at: '', id: '' }
      const next = this.db.prepare('SELECT id, at, value FROM trigger WHERE at < ? AND (at > ? OR (at = ? AND id > ?)) ORDER BY at, id LIMIT ?')
      for (;;) {
        if (options.maxBatches !== undefined && report.batches >= options.maxBatches) return report
        const rows = next.all(cutoff, after.at, after.at, after.id, batchSize).map(row => ({ id: String(row.id), at: String(row.at), value: String(row.value) }))
        if (!rows.length) { report.done = true; return report }
        const last = rows[rows.length - 1]!; after = { at: last.at, id: last.id }
        report.examined += rows.length; report.batches++
        const kept = this.keep(rows, cutoff)
        for (const reason of kept.values()) report.kept[reason]++
        const eligible = rows.filter(row => !kept.has(row.id))
        if (options.dryRun || !eligible.length) continue
        const pruned = this.archiveAndDelete(archive!, eligible, cutoff)
        report.pruned += pruned
      }
    } finally { archive?.close() }
  }

  private archiveAndDelete(archive: DatabaseSync, rows: Row[], cutoff: string): number {
    const ph = marks(rows.length), ids = rows.map(row => row.id)
    const dispositions = new Map(this.db.prepare(`SELECT id, value FROM disposition WHERE id IN (${ph})`).all(...ids).map(row => [String(row.id), String(row.value)]))
    const threads = new Map<string, string>()
    for (const row of this.db.prepare(`SELECT id, thread, at, human FROM trigger_thread WHERE id IN (${ph}) ORDER BY thread`).all(...ids)) {
      const list = JSON.parse(threads.get(String(row.id)) ?? '[]') as unknown[]
      list.push({ thread: row.thread, at: row.at, human: row.human }); threads.set(String(row.id), JSON.stringify(list))
    }
    const decisions = new Map<string, string>()
    for (const row of this.db.prepare(`SELECT trigger, decision FROM decision_trigger WHERE trigger IN (${ph}) ORDER BY decision`).all(...ids)) {
      const list = JSON.parse(decisions.get(String(row.trigger)) ?? '[]') as string[]; list.push(String(row.decision)); decisions.set(String(row.trigger), JSON.stringify(list))
    }
    const archivedAt = new Date().toISOString()
    const expected = new Map(rows.map(row => [row.id, digest(row.value, dispositions.get(row.id) ?? null, threads.get(row.id) ?? '[]')]))
    // 1. Archive durably and verify by reading it back before anything is deleted from the live database.
    archive.exec('BEGIN IMMEDIATE')
    try {
      const put = archive.prepare('INSERT OR REPLACE INTO archived_trigger VALUES (?,?,?,?,?,?,?,?)')
      for (const row of rows) put.run(row.id, row.at, row.value, dispositions.get(row.id) ?? null, threads.get(row.id) ?? '[]', decisions.get(row.id) ?? '[]', expected.get(row.id)!, archivedAt)
      archive.exec('COMMIT')
    } catch (error) { archive.exec('ROLLBACK'); throw error }
    for (const row of archive.prepare(`SELECT id, value, disposition, threads, sha256 FROM archived_trigger WHERE id IN (${ph})`).all(...ids)) {
      const id = String(row.id)
      if (digest(String(row.value), row.disposition === null ? null : String(row.disposition), String(row.threads)) !== expected.get(id) || row.sha256 !== expected.get(id)) throw new Error(`Archive verification failed for ${id}; nothing was deleted`)
    }
    if (Number(archive.prepare(`SELECT COUNT(*) AS n FROM archived_trigger WHERE id IN (${ph})`).get(...ids)?.n) !== ids.length) throw new Error('Archive verification failed: missing rows; nothing was deleted')
    // 2. Delete and tombstone in one transaction, re-checking eligibility and that each row is unchanged since it was archived.
    return this.store.atomic(() => {
      const current = new Map(this.db.prepare(`SELECT id, at, value FROM trigger WHERE id IN (${ph})`).all(...ids).map(row => [String(row.id), { id: String(row.id), at: String(row.at), value: String(row.value) }]))
      const still = [...current.values()].filter(row => row.value === rows.find(r => r.id === row.id)!.value && row.at < cutoff)
      const kept = this.keep(still, cutoff)
      const doomed = still.filter(row => !kept.has(row.id))
      if (!doomed.length) return 0
      const dph = marks(doomed.length), dids = doomed.map(row => row.id)
      this.db.prepare(`INSERT OR IGNORE INTO trigger_tombstone (id, at, source, archived_at) SELECT id, at, source, ? FROM trigger WHERE id IN (${dph})`).run(archivedAt, ...dids)
      this.db.prepare(`DELETE FROM trigger_thread WHERE id IN (${dph})`).run(...dids)
      this.db.prepare(`DELETE FROM disposition WHERE id IN (${dph})`).run(...dids)
      this.db.prepare(`DELETE FROM decision_trigger WHERE trigger IN (${dph})`).run(...dids)
      this.db.prepare(`DELETE FROM trigger WHERE id IN (${dph})`).run(...dids)
      return doomed.length
    })
  }

  /** Puts archived Triggers back (all, or just `ids`), removes their tombstones, and rebuilds their thread and decision indexes. Idempotent. */
  restore(archivePath: string, ids?: string[]): { restored: number; alreadyPresent: number } {
    const archive = new DatabaseSync(archivePath, { readOnly: true })
    try {
      const rows = (ids?.length ? archive.prepare(`SELECT * FROM archived_trigger WHERE id IN (${marks(ids.length)}) ORDER BY at, id`).all(...ids) : archive.prepare('SELECT * FROM archived_trigger ORDER BY at, id').all())
      let restored = 0, alreadyPresent = 0
      for (let i = 0; i < rows.length; i += 500) this.store.atomic(() => {
        for (const row of rows.slice(i, i + 500)) {
          if (this.db.prepare('SELECT 1 FROM trigger WHERE id = ?').get(row.id as string)) { alreadyPresent++; continue }
          this.db.prepare('INSERT INTO trigger (id, value, at) VALUES (?,?,?)').run(row.id as string, row.value as string, row.at as string)
          if (row.disposition !== null) this.db.prepare('INSERT OR REPLACE INTO disposition VALUES (?,?)').run(row.id as string, row.disposition as string)
          for (const link of JSON.parse(String(row.threads)) as { thread: string; at: string; human: number }[])
            this.db.prepare('INSERT OR IGNORE INTO trigger_thread VALUES (?,?,?,?)').run(link.thread, row.id as string, link.at, link.human)
          for (const decision of JSON.parse(String(row.decisions)) as string[])
            if (this.db.prepare('SELECT 1 FROM decision WHERE id = ?').get(decision)) this.db.prepare('INSERT OR IGNORE INTO decision_trigger VALUES (?,?)').run(row.id as string, decision)
          this.db.prepare('DELETE FROM trigger_tombstone WHERE id = ?').run(row.id as string)
          restored++
        }
      })
      return { restored, alreadyPresent }
    } finally { archive.close() }
  }
}
