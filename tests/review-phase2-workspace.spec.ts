/** Final adversarial review, phase 2.1: preparation record durability and fail-closed reads. */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'

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
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    try { await f.launch(ticket, assignment) } finally { chmodSync(record, 0o644) }
    expect(f.prepareCommands()).toHaveLength(0)
    expect(f.sessions.prompt).not.toHaveBeenCalled()
    expect(existsSync(ticket.execution!.directory)).toBe(true)
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
