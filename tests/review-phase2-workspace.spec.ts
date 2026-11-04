import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
/** Final adversarial review, phase 2.1: preparation record durability and fail-closed reads. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accessSync, constants } from 'node:fs'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'
import { waitUntil } from './fixtures/async.ts'

/** Fails loudly (never silently passes) when the permission denial a test relies on is not enforced, e.g. when run as root. */
const requireDenied = (path: string, mode: number) => {
  let denied = false
  try { accessSync(path, mode) } catch { denied = true }
  if (!denied) throw new Error(`precondition: permission denial on ${path} is not enforced (running as uid ${process.getuid?.()}); this test would be vacuous`)
}
describe('review phase 2.1: workspace preparation record safety', () => {
  let f: ExecutorFixture
  afterEach(() => {
    try { chmodSync(join(f.stateDir, 'workspaces'), 0o755) } catch { /* absent */ }
    f?.dispose()
  })

  it('does not run the prepare command when the preparing record cannot be persisted', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('unwritable')
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    chmodSync(join(f.stateDir, 'workspaces'), 0o555)
    requireDenied(join(f.stateDir, 'workspaces'), constants.W_OK)
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('an unreadable (non-ENOENT) preparation record blocks reuse even for an empty directory', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('unreadable')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    const record = join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`)
    writeFileSync(record, JSON.stringify({ state: 'failed', identity: 'x', directory: ticket.execution!.directory, at: 'now', quiescence: 'unknown' }))
    chmodSync(record, 0o000)
    requireDenied(record, constants.R_OK)
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    try { await f.launch(ticket, assignment) } finally { chmodSync(record, 0o644) }
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
    expect(existsSync(ticket.execution!.directory)).toBe(true)
  })

  it('a corrupt record blocks even when the workspace directory is absent', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('corrupt-absent')
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`), '{truncated')
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    expect(existsSync(ticket.execution!.directory)).toBe(false)
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('a corrupt record blocks even an empty directory instead of silently re-preparing', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('corrupt-empty')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`), '{truncated')
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })
})

describe('review phase 2.1: preparing-record process ownership across restart', () => {
  let f: ExecutorFixture
  afterEach(() => f?.dispose())
  const stale = (ticketDir: string, name: string, owner: unknown, stateDir: string, identity: string) => {
    mkdirSync(join(stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(stateDir, 'workspaces', `${name}.json`), JSON.stringify({ state: 'preparing', identity, directory: ticketDir, at: 'then', owner }))
  }
  const withRecord = async (owner: unknown) => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('restart')
    const { preparationIdentity } = await import('../src/executor/workspace.ts')
    stale(ticket.execution!.directory, ticket.execution!.name, owner, f.stateDir, preparationIdentity({ repository: 'acme/widgets', prepareCommand: 'setup' }))
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    return ticket
  }

  it('a preparing record owned by a still-running other host process blocks automatic re-preparation', async () => {
    const child = spawn('sleep', ['30'])
    try { await withRecord({ pid: child.pid, host: hostname() }) } finally { child.kill('SIGKILL') }
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('a preparing record from another machine cannot be verified and blocks', async () => {
    await withRecord({ pid: 1, host: 'some-other-host' })
    expect(f.prepareCommands()).toHaveLength(0)
  })

  it('MIGRATION: a preparing record whose owner process is dead still blocks, because dead parents do not prove descendants stopped', async () => {
    const child = spawn('true'); await new Promise(resolve => child.on('exit', resolve))
    await withRecord({ pid: child.pid, host: hostname() })
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })
  it('a legacy preparing record without an owner cannot prove its range stopped and blocks (migration: delete the record after inspection)', async () => {
    await withRecord(undefined)
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })
})

describe('review phase 2.1: descendants and same-process concurrency', () => {
  let f: ExecutorFixture
  afterEach(() => f?.dispose())
  it('PROOF: a spawned descendant survives SIGKILL of its parent, so a dead owner pid cannot prove the range stopped', async () => {
    const parent = spawn('sh', ['-c', 'sleep 30 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const childPid = await new Promise<number>(resolve => parent.stdout.once('data', data => resolve(Number(String(data).trim()))))
    parent.kill('SIGKILL'); await new Promise(resolve => parent.on('exit', resolve))
    let alive = false
    try { process.kill(childPid, 0); alive = true } catch { /* gone */ }
    try { process.kill(childPid, 'SIGKILL') } catch { /* gone */ }
    expect(alive).toBe(true)
  })
  it('two concurrent launches of one ticket run the prepare command once while the first is running', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('concurrent')
    const { ControlledSpawn } = await import('./fixtures/executor.ts')
    let controlled: InstanceType<typeof ControlledSpawn> | undefined
    f.intercept = spec => { if (spec.argv[0] !== 'sh') return undefined; controlled = new ControlledSpawn(spec); return controlled.handle }
    const first = f.launch(ticket, assignment)
    // Condition wait instead of a fixed 50ms sleep: the async launch->prepare chain raced the sleep under
    // shared-runner load (CI run 41855657606: prepare had not spawned within 100ms, assertion saw 0).
    const t0 = Date.now()
    await waitUntil(() => f.prepareCommands().length === 1, 10_000)
    const chainMs = Date.now() - t0
    const second = f.launch(ticket, f.newAssignment(ticket))
    // Observation window for a wrongly re-run second prepare: the same chain the first launch took, doubled,
    // so the window scales with runner load instead of assuming 50ms.
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(chainMs * 2, 200), 5_000)))
    expect(f.prepareCommands()).toHaveLength(1)
    controlled!.finish(0)
    await Promise.all([first, second])
  })
  it('a lost failed+quiescence:unknown record write still blocks in-process retry; a restart (new nonce) blocks on the stale preparing record', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('lost-unknown')
    const records = join(f.stateDir, 'workspaces')
    f.intercept = spec => {
      if (spec.argv[0] !== 'sh') return undefined
      chmodSync(records, 0o555)   // the preparing record is already written; later record writes now fail
      requireDenied(records, constants.W_OK)
      return { ...immediate(0), waitForExit: async () => { throw new Error('provider lost range') } }
    }
    try { await f.launch(ticket, assignment) } finally { chmodSync(records, 0o755) }
    const file = join(records, `${ticket.execution!.name}.json`)
    expect(JSON.parse(readFileSync(file, 'utf8')).state).toBe('preparing')   // the unknown marker was lost
    f.intercept = undefined
    await f.launch(ticket, f.newAssignment(ticket))
    expect(f.prepareCommands()).toHaveLength(1)               // in-process: blocked by the in-memory unresolved set
    expect(f.sessions.prompt).not.toHaveBeenCalled()
    // Simulated restart: a new process incarnation has a different nonce.
    const record = JSON.parse(readFileSync(file, 'utf8')); record.owner = { ...record.owner, nonce: 'dead-incarnation' }
    writeFileSync(file, JSON.stringify(record))
    const restarted = new ExecutorFixture({ prepare: 'setup', paths: { stateDir: f.stateDir, work: f.work } })
    restarted.tickets.set(ticket.id, ticket)
    try {
      await restarted.launch(ticket, restarted.newAssignment(ticket))
      expect(restarted.prepareCommands()).toHaveLength(0)
      expect(restarted.sessions.prompt).not.toHaveBeenCalled()
    } finally { restarted.dispose() }
  })
})
