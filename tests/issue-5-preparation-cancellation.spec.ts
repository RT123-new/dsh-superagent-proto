/**
 * Mandate Issue 5: cancellation does not reliably stop preparation.
 * Cancels an assignment at every asynchronous boundary of a launch and asserts the cancelled assignment neither
 * keeps mutating its workspace nor launches new work, and that a replacement assignment waits for it to settle.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlledSpawn, ExecutorFixture, deferred, immediate } from './fixtures/executor.ts'
import type { Assignment, Ticket } from '../src/core/index.ts'

const tick = (ms = 25): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('issue 5: cancellation stops preparation at every asynchronous boundary', () => {
  let fixture: ExecutorFixture
  afterEach(() => fixture?.dispose())

  it('cancelling an assignment aborts its running prepare command', async () => {
    fixture = new ExecutorFixture({ prepare: 'slow-command' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    let command: ControlledSpawn | undefined
    fixture.intercept = spec => spec.argv[0] === 'sh' ? (command = new ControlledSpawn(spec)).handle : undefined
    const launching = fixture.launch(ticket, assignment)
    await vi.waitFor(() => { expect(command).toBeDefined() })
    expect(command!.spec.signal?.aborted).toBe(false)

    fixture.cancelAssignment(ticket, assignment, 'stopped', true)
    // The cancellation must reach the prepare command itself, not only the code around it.
    await vi.waitFor(() => { expect(command!.spec.signal?.aborted).toBe(true) })
    command!.stop()
    await launching
    expect(fixture.sessions.ensure).not.toHaveBeenCalled()
    expect(fixture.sessions.prompt).not.toHaveBeenCalled()
    expect(fixture.engine.assignmentStarted).not.toHaveBeenCalled()
    const { readPreparation } = await import('../src/executor/workspace.ts')
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).toBe('cancelled')
  })

  it('a cancelled assignment whose command exits successfully anyway still does not launch', async () => {
    fixture = new ExecutorFixture({ prepare: 'slow-command' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    let command: ControlledSpawn | undefined
    fixture.intercept = spec => spec.argv[0] === 'sh' ? (command = new ControlledSpawn(spec, { ignoreAbort: true })).handle : undefined
    const launching = fixture.launch(ticket, assignment)
    await vi.waitFor(() => { expect(command).toBeDefined() })
    fixture.cancelAssignment(ticket, assignment, 'stopped', true)
    // The provider's termination raced the command's own exit and lost: it exited 0 after the cancellation.
    command!.finish(0)
    await launching
    expect(fixture.sessions.ensure).not.toHaveBeenCalled()
    expect(fixture.sessions.prompt).not.toHaveBeenCalled()
    expect(fixture.engine.assignmentStarted).not.toHaveBeenCalled()
    // And its result is not recorded as a prepared workspace.
    const { readPreparation } = await import('../src/executor/workspace.ts')
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).not.toBe('prepared')
  })

  it('a replacement assignment waits for the cancelled preparation to settle before reusing the workspace', async () => {
    fixture = new ExecutorFixture({ prepare: 'slow-command' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    const order: string[] = []
    const commands: ControlledSpawn[] = []
    // ignoreAbort: the cancelled command exits slowly, as a real process can within the provider's grace period.
    fixture.intercept = spec => {
      if (spec.argv[0] !== 'sh') return undefined
      const spawn = new ControlledSpawn(spec, { ignoreAbort: true })
      spawn.handle.done.then(() => { order.push(`settled:${commands.indexOf(spawn)}`) })
      commands.push(spawn)
      order.push(`spawned:${commands.indexOf(spawn)}`)
      return spawn.handle
    }
    const first = fixture.launch(ticket, assignment)
    await vi.waitFor(() => { expect(commands).toHaveLength(1) })

    // The assignment is cancelled and retried; the replacement launches immediately (tickets.ts: stop, then start).
    fixture.cancelAssignment(ticket, assignment, 'retried')
    // The cancellation reached the running command's signal...
    expect(commands[0]!.spec.signal?.aborted).toBe(true)
    const replacement = fixture.newAssignment(ticket)
    const second = fixture.launch(ticket, replacement)
    await tick()
    // ...but while the cancelled command still runs, the replacement must not start preparing the same workspace.
    expect(commands).toHaveLength(1)
    commands[0]!.stop()
    await first
    await vi.waitFor(() => { expect(commands).toHaveLength(2) })
    commands[1]!.finish(0)
    await second
    expect(order).toEqual(['spawned:0', 'settled:0', 'spawned:1', 'settled:1'])
    expect(fixture.engine.assignmentStarted).toHaveBeenCalledWith(ticket.id, replacement.id)
  })

  it('a ticket that ended before its launch ran does not prepare or launch', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    fixture.cancelAssignment(ticket, assignment, 'stopped', true)
    await fixture.launch(ticket, assignment)
    expect(fixture.spawns).toHaveLength(0)
    expect(existsSync(ticket.execution!.directory)).toBe(false)
    expect(fixture.sessions.prompt).not.toHaveBeenCalled()
  })

  it('cancellation during session creation prevents delivery', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    const creating = deferred<never>()
    fixture.sessions.ensure.mockImplementationOnce(async (id: string) => {
      await creating.promise
      return { id, status: 'idle', inbox: { remove: vi.fn() }, cancel: vi.fn(), whenIdle: async () => {},
        session: { snapshotEvents: () => [] } } as never
    })
    const launching = fixture.launch(ticket, assignment)
    await vi.waitFor(() => { expect(fixture.sessions.ensure).toHaveBeenCalled() })
    fixture.cancelAssignment(ticket, assignment, 'stopped', true)
    creating.reject(new Error('cancelled behind the scenes'))
    await launching
    expect(fixture.sessions.prompt).not.toHaveBeenCalled()
    expect(fixture.engine.assignmentStarted).not.toHaveBeenCalled()
  })

  it('cancellation immediately before worker delivery prevents the launch', async () => {
    fixture = new ExecutorFixture({ prepare: 'make-worktree' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    fixture.sessions.prompt.mockImplementationOnce(
      async (_id: string, _requestId: string, _text: string, _mode: unknown, authorize?: () => void) => {
        fixture.cancelAssignment(ticket, assignment, 'stopped', true)
        authorize?.()
      })
    await fixture.launch(ticket, assignment)
    expect(fixture.engine.assignmentStarted).not.toHaveBeenCalled()
  })

  it('a cancelled partial preparation is not silently accepted, and its retry prepares again', async () => {
    fixture = new ExecutorFixture({ prepare: 'slow-command' })
    const { ticket, assignment } = fixture.mkTicket('aaaa')
    let command: ControlledSpawn | undefined
    fixture.intercept = spec => {
      if (spec.argv[0] !== 'sh') return undefined
      mkdirSync(ticket.execution!.directory, { recursive: true })
      writeFileSync(join(ticket.execution!.directory, 'partial.txt'), 'half done')
      return (command = new ControlledSpawn(spec)).handle
    }
    const first = fixture.launch(ticket, assignment)
    await vi.waitFor(() => { expect(command).toBeDefined() })
    fixture.cancelAssignment(ticket, assignment, 'retried')
    await first
    // The partial work is kept (not deleted), but the workspace is not prepared.
    expect(existsSync(join(ticket.execution!.directory, 'partial.txt'))).toBe(true)
    const { readPreparation } = await import('../src/executor/workspace.ts')
    expect((await readPreparation(fixture.stateDir, ticket.execution!.name))?.state).toBe('cancelled')

    // The retry waits for nothing (the cancelled command settled) and prepares again.
    fixture.intercept = undefined
    const retry = fixture.newAssignment(ticket)
    await fixture.launch(ticket, retry)
    expect(fixture.prepareCommands()).toHaveLength(2)
    expect(fixture.sessions.prompt).toHaveBeenCalled()
  })
})
