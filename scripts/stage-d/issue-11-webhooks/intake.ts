/** Offline design experiment only. Not mounted on a server or wired into production.
 * A signature authenticates a delivery, never a work author. Drain must re-read current API state and policy.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
export class Inbox {
  private db: DatabaseSync
  constructor(path: string, private secret: string, private repository: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS inbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
        digest TEXT NOT NULL,body TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0)`)
  }
  accept(id: string, signature: string, body: Buffer): number {
    if (body.length > 65536 || !/^[A-Za-z0-9-]{1,100}$/.test(id)) return 400
    if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return 401
    const expected = createHmac('sha256', this.secret).update(body).digest()
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return 401
    let payload: { repository?: { full_name?: string } }
    try { payload = JSON.parse(body.toString('utf8')) } catch { return 400 }
    if (payload?.repository?.full_name?.toLowerCase() !== this.repository.toLowerCase()) return 403
    const digest = createHash('sha256').update(body).digest('hex')
    const existing = this.db.prepare('SELECT digest FROM inbox WHERE id=?').get(id)
    if (existing) return existing.digest === digest ? 202 : 409
    // SQLite statement commits durably before 202. Disk failure throws, so never success-acknowledged.
    this.db.prepare('INSERT INTO inbox(id,digest,body) VALUES (?,?,?)').run(id, digest, body.toString('utf8'))
    return 202
  }
  async drain(reconcile: (payload: unknown) => Promise<void>): Promise<void> {
    for (const row of this.db.prepare('SELECT seq,body FROM inbox WHERE done=0 ORDER BY seq').all()) {
      // Receipt order is not remote event order. Reconciliation must fetch authoritative current state.
      // Crash after reconcile but before done replays: downstream logical identities must dedupe effects.
      await reconcile(JSON.parse(String(row.body)))
      this.db.prepare('UPDATE inbox SET done=1 WHERE seq=?').run(row.seq!)
    }
  }
  pending(): number { return Number(this.db.prepare('SELECT count(*) AS n FROM inbox WHERE done=0').get()!.n) }
  close(): void { this.db.close() }
}
