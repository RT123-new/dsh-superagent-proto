// Final review Phase 9: a pre-existing symlink (or other alias) at the ticket workspace path must not redirect the
// worker outside its execution root. Failing-first proof for the confirmed escape in adv-symlink.spec.ts.
// Boundary: this is application-level path containment before launch, not an OS security boundary; a symlink swapped
// in after the check (TOCTOU) is not defended and is not claimed.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'

let f: ExecutorFixture
afterEach(() => f?.dispose())

it('denies a pre-existing symlink at <executionRoot>/<ticket name> pointing OUTSIDE the root (fail closed, files preserved)', async () => {
  f = new ExecutorFixture({ prepare: '' })
  const { ticket, assignment } = f.mkTicket('symlinked')
  const outside = mkdtempSync(join(tmpdir(), 'outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'x')
  mkdirSync(join(ticket.execution!.directory, '..'), { recursive: true })
  symlinkSync(outside, ticket.execution!.directory)
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment)
  // Fail closed: the ticket is marked failed (PrepareFailed is not auto-retried), nothing was prompted or run.
  expect(f.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ state: 'failed', summary: expect.stringContaining('outside its execution root') }))
  expect((f.sessions.prompt as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0)
  expect(existsSync(join(outside, 'secret.txt'))).toBe(true)
})

it('allows an ordinary in-root workspace (containment does not block the legitimate path)', async () => {
  f = new ExecutorFixture({ prepare: '' })
  const { ticket, assignment } = f.mkTicket('legit')
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment)
  expect((f.sessions.prompt as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1)
})

it('allows the workspace when the execution ROOT itself is a symlink (realpath on both sides)', async () => {
  f = new ExecutorFixture({ prepare: '' })
  const { ticket, assignment } = f.mkTicket('rootlink')
  const realRoot = mkdtempSync(join(tmpdir(), 'realroot-'))
  const linkRoot = join(tmpdir(), `linkroot-${Date.now()}`)
  symlinkSync(realRoot, linkRoot)
  const name = ticket.execution!.name
  ticket.execution = { ...ticket.execution!, name, directory: join(linkRoot, name) }
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment)
  expect((f.sessions.prompt as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1)
  expect(realpathSync(join(linkRoot, name)).startsWith(realpathSync(realRoot))).toBe(true)
})
