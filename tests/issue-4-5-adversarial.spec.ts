import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlledSpawn, ExecutorFixture, deferred, immediate, type SpawnHandle } from './fixtures/executor.ts'
import { SettingsSchema } from '../src/policy.ts'
import { readPreparation } from '../src/executor/workspace.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 25))
describe('independent adversarial review: Issues 4-5', () => {
  let f: ExecutorFixture
  afterEach(() => f?.dispose())

  it('does not promote an unrecorded partial legacy directory on credential-config verification alone', async () => {
    f = new ExecutorFixture({ prepare: 'complete-required-setup' })
    const { ticket, assignment } = f.mkTicket('legacy')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    writeFileSync(join(ticket.execution!.directory, 'partial'), 'not ready')
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(1, 'setup still incomplete') : undefined
    await f.launch(ticket, assignment)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
    expect((await readPreparation(f.stateDir, ticket.execution!.name))?.state).not.toBe('prepared')
  })

  it('does not promote a partial workspace when the atomic marker is corrupted', async () => {
    f = new ExecutorFixture({ prepare: 'complete-required-setup' })
    const { ticket, assignment } = f.mkTicket('corrupt')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`), '{truncated')
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(1) : undefined
    await f.launch(ticket, assignment)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('propagates assignment cancellation into post-command directory verification', async () => {
    f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('verify')
    let verification: ControlledSpawn | undefined
    f.intercept = spec => spec.argv[0] === 'git' ? (verification = new ControlledSpawn(spec)).handle : undefined
    const launch = f.launch(ticket, assignment)
    await vi.waitFor(() => expect(verification).toBeDefined())
    f.cancelAssignment(ticket, assignment, 'stopped', true)
    const aborted = verification!.spec.signal!.aborted
    verification!.finish(1)
    await launch
    expect(aborted).toBe(true)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('revalidates preparation configuration after asynchronous session creation', async () => {
    f = new ExecutorFixture({ prepare: 'setup-v1' })
    const { ticket, assignment } = f.mkTicket('config')
    const creating = deferred<void>()
    f.sessions.ensure.mockImplementationOnce(async () => {
      await creating.promise
      return { inbox: { remove: vi.fn() }, session: { snapshotEvents: () => [] } }
    })
    const launch = f.launch(ticket, assignment)
    await vi.waitFor(() => expect(f.sessions.ensure).toHaveBeenCalled())
    f.settings = SettingsSchema.parse({ executor: { prepare: 'setup-v2', directory: f.work } })
    creating.resolve()
    await launch.catch(() => {})
    expect(f.sessions.prompt).not.toHaveBeenCalled()
  })

  it('waits for managed-range quiescence, not only direct shell exit, before replacement reuse', async () => {
    f = new ExecutorFixture({ prepare: 'shell-with-descendant' })
    const { ticket, assignment } = f.mkTicket('range')
    const direct = deferred<{ exitCode: number | null; signal: string | null }>()
    const range = deferred<void>()
    const waitForExit = vi.fn(() => range.promise)
    let first = true
    f.intercept = spec => {
      if (spec.argv[0] !== 'sh' || !first) return undefined
      first = false
      return { ...immediate(0), done: direct.promise, waitForExit, terminate: vi.fn() } as SpawnHandle
    }
    const old = f.launch(ticket, assignment)
    await vi.waitFor(() => expect(f.prepareCommands()).toHaveLength(1))
    f.cancelAssignment(ticket, assignment, 'retried')
    const replacement = f.newAssignment(ticket)
    const next = f.launch(ticket, replacement)
    direct.resolve({ exitCode: null, signal: 'SIGTERM' })
    await tick()
    const countWhileDescendantAlive = f.prepareCommands().length
    range.resolve()
    await Promise.all([old, next])
    expect(waitForExit).toHaveBeenCalled()
    expect(countWhileDescendantAlive).toBe(1)
    expect(f.engine.assignmentStarted).toHaveBeenCalledWith(ticket.id, replacement.id)
  })
})
