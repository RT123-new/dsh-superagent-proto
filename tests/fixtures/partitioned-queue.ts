/**
 * Issue 14 fixture-only candidate: partition-aware dispatch for an ordered effect kind.
 * NOT wired into production. Mirrors Effects' row semantics (same `effect` table, seq order, generation match, exponential
 * backoff per row) but each partition keeps its own oldest-first stream: a backed-off head blocks only its own partition.
 * The production proposal would thread the legitimate consistency boundary (the conversation/ticket a message concerns)
 * into the effect key at enqueue time; the fixture takes it as an explicit function of the key.
 */
import type { Store } from '../../src/app/store.ts'

export interface CandidateRow { key: string; value: string; seq: number; generation: number; attempts: number; due: number }

export class PartitionedQueue<K extends string> {
  private seq: number
  private readonly running = new Set<string>()
  constructor(
    private readonly db: Store['db'],
    private readonly kind: K,
    private readonly now: () => number,
    private readonly partitionOf: (key: string) => string,
    private readonly retry: readonly [number, number] = [2000, 60_000],
  ) {
    this.seq = Number(db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM effect WHERE kind = ?').get(kind)?.seq ?? 0)
  }
  /** Same upsert as Effects.enqueue: coalesce a waiting row of the same key, keeping its queue position. */
  enqueue(key: string, payload: unknown): void {
    this.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE
      SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)
      .run(this.kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())
  }
  /**
   * Start the oldest due, not-running row of each partition; completions (delete or backoff update) land
   * asynchronously, matching Effects' fire-and-track model so virtual-time drivers can keep advancing.
   * Returns the keys it started.
   */
  async dispatch(run: (payload: never, key: string) => Promise<void>): Promise<string[]> {
    const rows = this.db.prepare('SELECT key, value, seq, generation, attempts, due FROM effect WHERE kind = ? ORDER BY seq').all(this.kind) as unknown as CandidateRow[]
    const heads = new Map<string, CandidateRow>()
    for (const row of rows) {
      const partition = this.partitionOf(row.key)
      if (!heads.has(partition)) heads.set(partition, row)
    }
    const attempted: string[] = []
    for (const row of heads.values()) {
      if (row.due > this.now() || this.running.has(row.key)) continue
      this.running.add(row.key)
      attempted.push(row.key)
      const own = 'kind = ? AND key = ? AND seq = ? AND generation = ?', args = [this.kind, row.key, row.seq, row.generation] as const
      void Promise.resolve()
        .then(() => run(JSON.parse(row.value) as never, row.key))
        .then(() => { this.db.prepare(`DELETE FROM effect WHERE ${own}`).run(...args) },
          (failure: unknown) => {
            const delay = Math.min(this.retry[1], this.retry[0] * 2 ** Math.min(row.attempts, 16))
            this.db.prepare(`UPDATE effect SET attempts = attempts + 1, error = ?, due = ? WHERE ${own}`).run(String(failure).slice(0, 1000), this.now() + delay, ...args)
          })
        .finally(() => { this.running.delete(row.key) })
    }
    return attempted
  }
  pending(): string[] {
    return (this.db.prepare('SELECT key FROM effect WHERE kind = ? ORDER BY seq').all(this.kind) as { key: string }[]).map(row => row.key)
  }
}
