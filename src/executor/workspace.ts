/**
 * Durable workspace preparation state (mandate Issue 4). A workspace counts as prepared only when an atomic
 * preparation record says the configured command exited successfully, directory verification passed, and the
 * preparation configuration still matches; anything else is prepared (again) before the workspace is used.
 * Records live outside the workspace (under the state directory) so they never pollute the worker's git tree,
 * and each write is a temporary file atomically renamed over the record, so a crash cannot leave half a record.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

/**
 * Preparation lifecycle: `unprepared` (no usable record), `preparing` (command running or interrupted by a crash),
 * `prepared` (command succeeded, directory verified, configuration current), `failed`, `cancelled`.
 */
export type PreparationState = 'unprepared' | 'preparing' | 'prepared' | 'failed' | 'cancelled'

export interface PreparationRecord {
  state: Exclude<PreparationState, 'unprepared'>
  /** The preparation configuration identity this record belongs to (see `preparationIdentity`). */
  identity: string
  /** The workspace directory the record describes. */
  directory: string
  at: string
  /** What happened, for `failed` and `cancelled` records and adopted legacy workspaces. */
  detail?: string
  /** A provider could not prove all owned processes stopped. Automatic workspace reuse is forbidden. */
  quiescence?: 'unknown'
  /** Host process that wrote a `preparing` record. A live or unverifiable foreign owner blocks reuse (see `foreignOwnerMayBeLive`). */
  owner?: { pid: number; host: string; nonce?: string }
}

/** Identity of this host process, stamped into `preparing` records. */
const PROCESS_NONCE = randomUUID()
export const currentOwner = (): { pid: number; host: string; nonce: string } => ({ pid: process.pid, host: hostname(), nonce: PROCESS_NONCE })

/**
 * True when a `preparing` record was not written by this very process. A dead owner pid does NOT prove the spawned
 * descendants stopped (children survive parent death; see tests/review-phase2-descendants.spec.ts), so any other
 * owner, dead, alive, remote or unrecorded, blocks automatic reuse until an operator confirms the range stopped and
 * clears the record. Same-process records are handled by the executor's in-memory active-preparation set.
 */
export function foreignOwnerMayBeLive(record: PreparationRecord): boolean {
  if (record.state !== 'preparing') return false
  const owner = record.owner
  // A per-process random nonce distinguishes a previous incarnation that reused the same pid and hostname (container restart).
  return !(owner && owner.pid === process.pid && owner.host === hostname() && owner.nonce === PROCESS_NONCE)
}

/** Directory fsync is unsupported on some platforms; only these platform-specific codes are tolerated (on POSIX EPERM/EBADF/EISDIR are real failures), any other failure is a durability failure. */
const DIR_SYNC_UNSUPPORTED = new Set(process.platform === 'win32' ? ['EPERM', 'EISDIR', 'EBADF', 'EINVAL', 'ENOTSUP'] : ['EINVAL', 'ENOTSUP', 'ENOSYS'])

/** Bumped when what "prepared" means changes, so records written under other semantics never count. */
export const PREPARATION_CONFIG_VERSION = 1

/**
 * SHA-256 of the canonical preparation configuration: repository, prepare command and preparation version.
 * A configuration change invalidates earlier success records. Never includes credentials or secret values.
 */
export function preparationIdentity(input: { repository: string; prepareCommand: string }): string {
  const canonical = JSON.stringify({
    preparation_config_version: PREPARATION_CONFIG_VERSION,
    prepare_command: input.prepareCommand,
    repository: input.repository,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

const recordPath = (stateDir: string, name: string): string =>
  join(stateDir, 'workspaces', `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)

/** Reads the workspace's preparation record; a missing or unreadable record counts as no record (unprepared). */
export async function readPreparation(stateDir: string, name: string): Promise<PreparationRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(recordPath(stateDir, name), 'utf8')) as PreparationRecord
    const states: PreparationState[] = ['preparing', 'prepared', 'failed', 'cancelled']
    return states.includes(record.state) && typeof record.identity === 'string' && typeof record.directory === 'string'
      ? record : undefined
  } catch { return undefined }
}

/**
 * Like `readPreparation`, but distinguishes "no record" (ENOENT) from an unreadable, corrupt or malformed record.
 * Callers that gate reuse must fail closed on `unreadable`: the record may have said `quiescence: unknown`.
 */
export async function inspectPreparation(stateDir: string, name: string):
  Promise<{ kind: 'absent' } | { kind: 'unreadable'; reason: string } | { kind: 'record'; record: PreparationRecord }> {
  let text: string
  try { text = await readFile(recordPath(stateDir, name), 'utf8') }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', reason: String(error) }
  }
  const record = await readPreparation(stateDir, name)
  return record ? { kind: 'record', record } : { kind: 'unreadable', reason: `malformed record (${text.length} bytes)` }
}

/** Persists preparation state atomically: a temporary file renamed over the record. */
export async function writePreparation(stateDir: string, name: string, record: PreparationRecord, options: { directorySync?: boolean } = {}): Promise<void> {
  const file = recordPath(stateDir, name)
  await mkdir(join(stateDir, 'workspaces'), { recursive: true })
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  // Flush file contents before the rename so a crash cannot expose an empty or partial authoritative record.
  const handle = await open(temporary, 'w')
  try { await handle.writeFile(JSON.stringify({ version: 1, ...record }, null, 2) + '\n'); await handle.sync() }
  finally { await handle.close() }
  await rename(temporary, file)
  if (options.directorySync === false) return
  // Synchronise the directory entry. Only "unsupported" errors are tolerated; a real failure means durability was not
  // established, so a `prepared` record must not stand: replace it with a `failed` one (without another sync) and throw.
  try { const dir = await open(join(stateDir, 'workspaces'), 'r'); try { await dir.sync() } finally { await dir.close() } }
  catch (error) {
    if (DIR_SYNC_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? '')) return
    await writePreparation(stateDir, name, { ...record, state: 'failed', detail: `Record durability was not established: ${String(error)}` },
      { directorySync: false }).catch(() => {})
    throw error
  }
}
