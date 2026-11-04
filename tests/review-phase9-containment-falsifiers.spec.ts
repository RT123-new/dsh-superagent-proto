// Final review phase 9 (independent adversary, committed as regression coverage): 12-case workspace containment
// falsifiers for the NF-2 symlink escape repair. 7 deny cases fail with the guard neutered; allow cases pin compatibility.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'
let f: ExecutorFixture
afterEach(() => f?.dispose())
const prompts = () => (f.sessions.prompt as unknown as { mock: { calls: unknown[] } }).mock.calls.length
const failed = () => (f.engine.report as unknown as { mock: { calls: any[][] } }).mock.calls.some(c => c[1]?.state === 'failed' && String(c[1]?.summary).includes('outside its execution root'))
async function run(prepare: string, plant: (dir: string, root: string, outside: string) => void) {
  f = new ExecutorFixture({ prepare })
  const { ticket, assignment } = f.mkTicket('adv')
  const dir = ticket.execution!.directory, root = dirname(dir)
  const outside = mkdtempSync(join(tmpdir(), 'outside-')); writeFileSync(join(outside, 's'), 'x')
  mkdirSync(root, { recursive: true }); plant(dir, root, outside)
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment).catch(() => {})
  return { dir, root, outside, ticket }
}
it('outside symlink denied', async () => { await run('', (d, r, o) => symlinkSync(o, d)); expect(failed()).toBe(true); expect(prompts()).toBe(0) })
it('outside symlink denied with a prepare command (nothing run)', async () => { await run('echo hi', (d, r, o) => symlinkSync(o, d)); expect(failed()).toBe(true); expect(f.prepareCommands().length).toBe(0); expect(prompts()).toBe(0) })
it('prefix-sibling dir symlink denied', async () => { await run('', (d, r) => { const sib = r + '-evil'; mkdirSync(sib, { recursive: true }); symlinkSync(sib, d) }); expect(failed()).toBe(true); expect(prompts()).toBe(0) })
it('symlink to the parent of the root denied', async () => { await run('', (d, r) => symlinkSync(dirname(r), d)); expect(failed()).toBe(true); expect(prompts()).toBe(0) })
it('symlink via ../ relative target denied', async () => { await run('', (d, r) => { const o = join(dirname(r), 'rel-out'); mkdirSync(o, { recursive: true }); symlinkSync('../rel-out', d) }); expect(failed()).toBe(true); expect(prompts()).toBe(0) })
it('chain: in-root symlink to outside denied', async () => { await run('', (d, r, o) => { symlinkSync(o, join(r, 'hop')); symlinkSync(join(r, 'hop'), d) }); expect(failed()).toBe(true); expect(prompts()).toBe(0) })
it('symlink to an in-root sibling dir allowed (characterize)', async () => { await run('', (d, r) => { const s = join(r, 'inside'); mkdirSync(s); symlinkSync(s, d) }); expect(failed()).toBe(false); expect(prompts()).toBeGreaterThan(0) })
it('root itself a symlink allowed', async () => {
  f = new ExecutorFixture({ prepare: '' }); const { ticket, assignment } = f.mkTicket('rootlink')
  const dir = ticket.execution!.directory, root = dirname(dir); const real = mkdtempSync(join(tmpdir(), 'realroot-'))
  mkdirSync(dirname(root), { recursive: true }); symlinkSync(real, root)
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment); expect(failed()).toBe(false); expect(prompts()).toBeGreaterThan(0)
})
it('dangling symlink pointing outside: no prompt, nothing created outside', async () => {
  const gone = join(tmpdir(), 'dangling-' + Date.now())
  await run('', (d) => symlinkSync(gone, d)); expect(prompts()).toBe(0); expect(existsSync(gone)).toBe(false)
})
it('dangling symlink with a prepare command: prepare must not run in/through it', async () => {
  const gone = join(tmpdir(), 'dangling2-' + Date.now())
  await run('mkdir -p "$PWD/x"', (d) => symlinkSync(gone, d)); expect(prompts()).toBe(0); expect(existsSync(gone)).toBe(false)
})
it('ordinary absent target launches', async () => { await run('', () => {}); expect(failed()).toBe(false); expect(prompts()).toBeGreaterThan(0) })
it('record reuse: prepared in root, then swapped for outside symlink before relaunch -> denied', async () => {
  f = new ExecutorFixture({ prepare: 'true' }); const { ticket, assignment } = f.mkTicket('reuse')
  const dir = ticket.execution!.directory
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment).catch(() => {})
  const before = prompts()
  const { rmSync } = await import('node:fs'); const o = mkdtempSync(join(tmpdir(), 'outside-')); rmSync(dir, { recursive: true, force: true }); symlinkSync(o, dir)
  await f.launch(ticket, assignment).catch(() => {})
  expect(failed()).toBe(true); expect(prompts()).toBe(before)
})
