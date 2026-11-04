import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'
describe('adv', () => {
  it('stale "preparing" record (crash mid-prepare) + empty dir must not silently re-run prepare', async () => {
    const f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('stale')
    mkdirSync(ticket.execution!.directory, { recursive: true })
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`), JSON.stringify({ version: 1, state: 'preparing', identity: 'x', directory: ticket.execution!.directory, at: 'now' }))
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    expect(f.prepareCommands()).toHaveLength(0)
    f.dispose()
  })
  it('corrupt record with directory absent must not silently prepare', async () => {
    const f = new ExecutorFixture({ prepare: 'setup' })
    const { ticket, assignment } = f.mkTicket('corrupt-nodir')
    mkdirSync(join(f.stateDir, 'workspaces'), { recursive: true })
    writeFileSync(join(f.stateDir, 'workspaces', `${ticket.execution!.name}.json`), '{not json')
    f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
    await f.launch(ticket, assignment)
    expect(f.prepareCommands()).toHaveLength(0)
    f.dispose()
  })
})
