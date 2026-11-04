/**
 * Opt-in, never-scheduled retention for old Triggers (Issue 19).
 *
 * Nothing here runs unless a caller invokes `Retention.run` or `Retention.restore`. A Trigger is pruned only after
 * (1) it is eligible by the reference rules below, (2) its rows are copied into a separate archive database that is committed
 * and read back and compared, and (3) the delete and a durable tombstone commit in ONE transaction, so a process crash cannot
 * leave a Trigger deleted without both its archive row and its tombstone (not a power-loss guarantee). Tombstoned ids stay "known" to Intake, so a Source
 * that replays or reconciles an old event still gets `duplicate` instead of new work.
 *
 * Eligible = older than `olderThanMs` (hard floor `MIN_AGE_MS`) AND none of:
 *  - the newest Trigger of its Source (keeps all-time `lastAt` in triggerStats exact);
 *  - the first, or first human, Trigger of any of its Threads (they title and link the Thread in views);
 *  - queued or evaluating on a Thread;
 *  - any string containing its id inside any Ticket, Thread, outbox, effect or kv record, including object and record keys
 *    (conservative substring matching can retain extra data).
 * Decisions, Tickets and Threads are never deleted. Decisions keep their `triggerIds`; those ids resolve through the archive.
 */
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
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
  INSERT OR IGNORE INTO archive_meta VALUES ('format', '2')`
const digest = (value: string, disposition: string | null, threads: string, decisions: string, at: string) => createHash('sha256').update(JSON.stringify([value, disposition, threads, decisions, at])).digest('hex')
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',')

/** Archives, prunes and restores old Triggers for one Store on explicit request; see the file header for the eligibility and crash-safety rules. */
export class Retention {
  constructor(private readonly store: Store) {}

  private get db() { return this.store.db }
  private mainFile(): string { return String(this.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file ?? '') }

  /** Stable lineage copied by a normal database backup. No pathname binding, so moving a backup is supported. */
  private identity(create: boolean): string | undefined {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_identity'").get()
    if (!exists && !create) return undefined
    if (create) this.store.atomic(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS retention_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL)')
      this.db.prepare('INSERT OR IGNORE INTO retention_identity VALUES (1,?)').run(randomUUID())
    })
    return this.db.prepare('SELECT id FROM retention_identity WHERE singleton=1').get()?.id as string | undefined
  }
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
      // Conservatively retain embedded IDs as well as JSON object keys and record keys. False positives only keep data.
      const hit = new Set<string>()
      for (const table of ['ticket', 'thread', 'outbox', 'effect', 'kv']) {
        const key = table === 'ticket' || table === 'outbox' ? 'id' : 'key'
        for (const record of this.db.prepare(`SELECT ${key} AS k, value FROM ${table}`).all()) {
          const strings: string[] = [String(record.k)]
          const visit = (value: unknown): void => {
            if (typeof value === 'string') strings.push(value)
            else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { strings.push(k); visit(v) }
          }
          visit(JSON.parse(String(record.value)))
          for (const id of open) if (strings.some(text => text.includes(id))) hit.add(id)
        }
      }
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
      if (!options.archivePath || options.archivePath === ':memory:' || (live && (resolve(options.archivePath) === resolve(live) || (existsSync(options.archivePath) && (realpathSync(options.archivePath) === realpathSync(live) || (statSync(options.archivePath).dev === statSync(live).dev && statSync(options.archivePath).ino === statSync(live).ino)))))) throw new Error('archivePath must be a separate file from the live database')
    }
    const archive = options.dryRun ? undefined : new DatabaseSync(options.archivePath)
    try {
      if (archive) {
        chmodSync(options.archivePath, 0o600)
        if (archive.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trigger'").get()) throw new Error('archivePath must not be a live Store database')
        archive.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL'); archive.exec(SCHEMA)
        if (archive.prepare("SELECT value FROM archive_meta WHERE key='format'").get()?.value !== '2') throw new Error('Unsupported archive format; nothing was deleted')
        const owner = this.identity(true)!
        archive.prepare("INSERT OR IGNORE INTO archive_meta VALUES ('owner',?)").run(owner)
        if (archive.prepare("SELECT value FROM archive_meta WHERE key='owner'").get()?.value !== owner) throw new Error('Archive belongs to another Store; nothing was deleted')
      }
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
    const expected = new Map(rows.map(row => [row.id, digest(row.value, dispositions.get(row.id) ?? null, threads.get(row.id) ?? '[]', decisions.get(row.id) ?? '[]', row.at)]))
    // 1. Archive durably and verify by reading it back before anything is deleted from the live database.
    archive.exec('BEGIN IMMEDIATE')
    try {
      const put = archive.prepare('INSERT OR IGNORE INTO archived_trigger VALUES (?,?,?,?,?,?,?,?)')
      for (const row of rows) put.run(row.id, row.at, row.value, dispositions.get(row.id) ?? null, threads.get(row.id) ?? '[]', decisions.get(row.id) ?? '[]', expected.get(row.id)!, archivedAt)
      archive.exec('COMMIT')
    } catch (error) { archive.exec('ROLLBACK'); throw error }
    for (const row of archive.prepare(`SELECT id, at, value, disposition, threads, decisions, sha256 FROM archived_trigger WHERE id IN (${ph})`).all(...ids)) {
      const id = String(row.id)
      if (digest(String(row.value), row.disposition === null ? null : String(row.disposition), String(row.threads), String(row.decisions), String(row.at)) !== expected.get(id) || row.sha256 !== expected.get(id)) throw new Error(`Archive verification failed for ${id}; nothing was deleted`)
    }
    if (Number(archive.prepare(`SELECT COUNT(*) AS n FROM archived_trigger WHERE id IN (${ph})`).get(...ids)?.n) !== ids.length) throw new Error('Archive verification failed: missing rows; nothing was deleted')
    // 2. Delete and tombstone in one transaction, re-checking eligibility and that each row is unchanged since it was archived.
    return this.store.atomic(() => {
      const current = new Map(this.db.prepare(`SELECT id, at, value FROM trigger WHERE id IN (${ph})`).all(...ids).map(row => [String(row.id), { id: String(row.id), at: String(row.at), value: String(row.value) }]))
      const still = [...current.values()].filter(row => {
        const disposition = this.db.prepare('SELECT value FROM disposition WHERE id=?').get(row.id)?.value
        const links = this.db.prepare('SELECT thread, at, human FROM trigger_thread WHERE id=? ORDER BY thread').all(row.id)
        const decisionIds = this.db.prepare('SELECT decision FROM decision_trigger WHERE trigger=? ORDER BY decision').all(row.id).map(r => String(r.decision))
        return row.at < cutoff && digest(row.value, disposition === undefined ? null : String(disposition), JSON.stringify(links), JSON.stringify(decisionIds), row.at) === expected.get(row.id)
      })
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
      if (archive.prepare("SELECT value FROM archive_meta WHERE key='format'").get()?.value !== '2') throw new Error('Unsupported archive format')
      const owner = this.identity(false)
      if (!owner || archive.prepare("SELECT value FROM archive_meta WHERE key='owner'").get()?.value !== owner) throw new Error('Archive belongs to another Store')
      // Validate the complete selected archive before any batch mutates live rows or tombstones.
      for (const row of rows) {
        if (digest(String(row.value), row.disposition === null ? null : String(row.disposition), String(row.threads), String(row.decisions), String(row.at)) !== row.sha256) throw new Error(`Archive verification failed for ${String(row.id)}`)
        const trigger = JSON.parse(String(row.value)) as { id: string; at: string }
        if (trigger.id !== row.id || trigger.at !== row.at) throw new Error('Archive identity verification failed')
        JSON.parse(String(row.threads)); JSON.parse(String(row.decisions))
      }
      let restored = 0, alreadyPresent = 0
      for (let i = 0; i < rows.length; i += 500) this.store.atomic(() => {
        for (const row of rows.slice(i, i + 500)) {
          if (this.db.prepare('SELECT 1 FROM trigger WHERE id = ?').get(row.id as string)) { alreadyPresent++; continue }
          this.db.prepare('INSERT INTO trigger (id, value, at) VALUES (?,?,?)').run(row.id as string, row.value as string, row.at as string)
          if (row.disposition !== null) this.db.prepare('INSERT OR REPLACE INTO disposition VALUES (?,?)').run(row.id as string, row.disposition as string)
          for (const link of JSON.parse(String(row.threads)) as { thread: string; at: string; human: number }[])
            this.db.prepare('INSERT OR IGNORE INTO trigger_thread VALUES (?,?,?,?)').run(link.thread, row.id as string, link.at, link.human)
          for (const decision of JSON.parse(String(row.decisions)) as string[])
            if (this.db.prepare("SELECT 1 FROM decision d, json_each(d.value, '$.triggerIds') j WHERE d.id=? AND j.value=?").get(decision, row.id as string)) this.db.prepare('INSERT OR IGNORE INTO decision_trigger VALUES (?,?)').run(row.id as string, decision)
          this.db.prepare('DELETE FROM trigger_tombstone WHERE id = ?').run(row.id as string)
          restored++
        }
      })
      return { restored, alreadyPresent }
    } finally { archive.close() }
  }
}
