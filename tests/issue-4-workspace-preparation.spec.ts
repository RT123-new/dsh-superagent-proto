/**
 * Mandate Issue 4: workspace preparation can be incorrectly considered successful.
 * The defect-reproduction tests here use only the original public surface (DshExecutor plus a mock host) and fail
 * against the unrepaired implementation; the state-machine mechanism tests dynamically import the repair module.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlledSpawn, ExecutorFixture, immediate } from './fixtures/executor.ts'
import { SettingsSchema } from '../src/policy.ts'

describe('issue 4: workspace preparation is durable state, not directory presence', () => {
  let fixture: ExecutorFixture
  afterEach(() => fixture?.dispose())

  it('tries preparation again on retry after a failed prepare command left a partial directory', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    fixture.intercept = spec => {
      if (spec.argv[0] !== 'sh') return undefined
      // The command creates part of the workspace, then fails: the classic partial-preparation leftover.
      mkdirSync(ticket.execution!.directory, { recursive: true })
      writeFileSync(join(ticket.execution!.directory, 'partial.txt'), 'half done')
      return immediate(1, 'boom')
    }
    await fixture.launch(ticket, assignment)
    expect(fixture.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ state: 'failed' }))

    // A retry starts a new assignment, which must try preparation again (docs/003-execution.md):
    // a partially prepared workspace must never be silently accepted as complete.
    fixture.spawns.length = 0
    fixture.intercept = undefined
    const retry = fixture.newAssignment(ticket)
    await fixture.launch(ticket, retry)
    expect(fixture.prepareCommands()).toHaveLength(1)
    expect(fixture.sessions.prompt).toHaveBeenCalled()
  })

  it('a changed prepare command invalidates a previously prepared workspace', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-v1' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    await fixture.launch(ticket, assignment)
    expect(fixture.prepareCommands()).toHaveLength(1)
    expect(fixture.sessions.prompt).toHaveBeenCalledTimes(1)

    // The operator changes the prepare command; the next assignment must not treat the old result as prepared.
    fixture.settings = SettingsSchema.parse({ executor: { prepare: 'make-v2', directory: fixture.work } })
    fixture.spawns.length = 0
    const next = fixture.newAssignment(ticket)
    await fixture.launch(ticket, next)
    expect(fixture.prepareCommands().map(spec => spec.argv[2])).toEqual(['make-v2'])
  })

  it('does not re-run the prepare command for a workspace already prepared under the same configuration', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    await fixture.launch(ticket, assignment)
    expect(fixture.prepareCommands()).toHaveLength(1)

    fixture.spawns.length = 0
    const next = fixture.newAssignment(ticket)
    await fixture.launch(ticket, next)
    expect(fixture.prepareCommands()).toHaveLength(0)
    expect(fixture.sessions.prompt).toHaveBeenCalledTimes(2)
  })

  it('removes an empty directory left by a failed prepare command', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    fixture.intercept = spec => {
      if (spec.argv[0] !== 'sh') return undefined
      mkdirSync(ticket.execution!.directory, { recursive: true })
      return immediate(1, 'boom')
    }
    await fixture.launch(ticket, assignment)
    expect(existsSync(ticket.execution!.directory)).toBe(false)
    expect(fixture.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ state: 'failed' }))
  })

  it('blocks an unrecorded non-empty legacy workspace without deleting work or rerunning generic preparation', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    // A workspace created before preparation state existed: it holds worker output that must not be deleted.
    mkdirSync(ticket.execution!.directory, { recursive: true })
    writeFileSync(join(ticket.execution!.directory, 'work.txt'), 'existing work')
    await fixture.launch(ticket, assignment)
    expect(fixture.prepareCommands()).toHaveLength(0)
    expect(existsSync(join(ticket.execution!.directory, 'work.txt'))).toBe(true)
    expect(fixture.sessions.prompt).not.toHaveBeenCalled()
    expect(fixture.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ summary: expect.stringContaining('Files were preserved') }))
  })

  it('records a durable prepared state that survives a restart, with no temporary files left behind', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    await fixture.launch(ticket, assignment)
    const { readPreparation } = await import('../src/executor/workspace.ts')
    const record = await readPreparation(fixture.stateDir, ticket.execution!.name)
    expect(record?.state).toBe('prepared')
    expect(record?.directory).toBe(ticket.execution!.directory)
    expect(readdirSync(join(fixture.stateDir, 'workspaces')).filter(name => name.endsWith('.tmp'))).toEqual([])

    // A new Executor after a restart reads the record instead of re-running the command.
    const after = new ExecutorFixture({ prepare: 'make-worktree', paths: { stateDir: fixture.stateDir, work: fixture.work } })
    after.tickets.set(ticket.id, ticket)
    const again = after.newAssignment(ticket)
    await after.launch(ticket, again)
    expect(after.prepareCommands()).toHaveLength(0)
    after.dispose()
  })

  it('treats a workspace left mid-preparation by a crash as not prepared', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    // A crash during preparation leaves the partial directory and a `preparing` record behind.
    mkdirSync(ticket.execution!.directory, { recursive: true })
    writeFileSync(join(ticket.execution!.directory, 'partial.txt'), 'half done')
    const { writePreparation } = await import('../src/executor/workspace.ts')
    await writePreparation(fixture.stateDir, ticket.execution!.name,
      { state: 'preparing', identity: 'whatever', directory: ticket.execution!.directory, at: new Date().toISOString(),
        // Written by this process: an in-process leftover is still retried.
        // MIGRATION (final review): a record from ANOTHER process, dead or alive, now blocks (descendants may survive);
        // see tests/review-phase2-workspace.spec.ts. The prior contract retried any crash leftover.
        owner: (await import('../src/executor/workspace.ts')).currentOwner() })
    await fixture.launch(ticket, assignment)
    expect(fixture.prepareCommands()).toHaveLength(1)
    const { readPreparation } = await import('../src/executor/workspace.ts')
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).toBe('prepared')
  })

  it('a preparation record for other configuration does not count as prepared', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    const { writePreparation, readPreparation } = await import('../src/executor/workspace.ts')
    await writePreparation(fixture.stateDir, ticket.execution!.name,
      { state: 'prepared', identity: 'some-other-configuration', directory: ticket.execution!.directory, at: new Date().toISOString() })
    await fixture.launch(ticket, assignment)
    expect(fixture.prepareCommands()).toHaveLength(1)
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).toBe('prepared')
  })

  it('fails a preparation whose command runs past its timeout', async () => {
    fixture = new ExecutorFixture({ prepare: 'hangs-forever', prepareTimeoutMs: 50 })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    fixture.intercept = spec => spec.argv[0] === 'sh' ? new ControlledSpawn(spec).handle : undefined
    await fixture.launch(ticket, assignment)
    expect(fixture.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ state: 'failed' }))
    const { readPreparation } = await import('../src/executor/workspace.ts')
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).toBe('failed')
  }, 10_000)

  it('the preparation identity is stable, covers repository and command, and excludes credential-shaped values', async () => {
    const { preparationIdentity } = await import('../src/executor/workspace.ts')
    const base = preparationIdentity({ repository: 'acme/widgets', prepareCommand: 'make-worktree' })
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(preparationIdentity({ repository: 'acme/widgets', prepareCommand: 'make-worktree' })).toBe(base)
    expect(preparationIdentity({ repository: 'acme/other', prepareCommand: 'make-worktree' })).not.toBe(base)
    expect(preparationIdentity({ repository: 'acme/widgets', prepareCommand: 'make-other' })).not.toBe(base)
  })
})
