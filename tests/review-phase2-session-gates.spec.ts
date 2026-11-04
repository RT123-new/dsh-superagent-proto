/** Final review phase 2.2: after an uncancellable create completes, a cancelled assignment still cannot receive work. */
import { afterEach, expect, it, vi } from 'vitest'
import { workerSessionId } from '../src/executor/dsh.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
type Ensure = (id: string, cwd: string, title: string, role: 'worker' | 'orchestrator', check: () => void) => Promise<unknown>

it('a create that finishes after cancellation leaves a session that refuses delivery for the stale assignment', async () => {
  h = await startRuntime()
  let revoked = false
  const check = () => { if (revoked) throw new Error('Assignment cancelled') }
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  const original = h.controller.create.getMockImplementation()
  h.controller.create.mockImplementationOnce((async (...args: unknown[]) => { entered.resolve(); await wait.promise; await (original as ((...a: unknown[]) => unknown) | undefined)?.(...args) }) as never)
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('stale-after-create', h.directory, 'test', 'worker', check)
  await entered.promise; revoked = true; wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  // The session may now exist (framework create cannot be cancelled); delivery for the cancelled assignment must still fail closed.
  const prompted = h.runtime.sessions.prompt('stale-after-create', 'late', '{}', 'queue', check, () => { throw new Error('must not acknowledge') })
  await expect(prompted).rejects.toThrow()
  expect(await h.runtime.sessions.holds('stale-after-create', 'late')).toBe(false)
})

it('a revoke during the final rename does not leave a danger-full-access preset applied', async () => {
  h = await startRuntime()
  let revoked = false
  const check = () => { if (revoked) throw new Error('Assignment cancelled') }
  const presets = vi.spyOn(h.ctx.permissionPresets, 'set')
  vi.spyOn(h.runtime.sessions as unknown as { decorate: () => Promise<void> }, 'decorate').mockResolvedValue(undefined)
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  h.controller.rename.mockImplementationOnce((async () => { entered.resolve(); await wait.promise }) as never)
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('preset-window', h.directory, 'test', 'worker', check)
  await entered.promise; revoked = true; wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(presets.mock.calls.filter(call => call[1] === 'danger-full-access')).toHaveLength(0)
})

it('the session an uncancelled-create left behind is reused by the next authorized ensure, not duplicated or leaked', async () => {
  h = await startRuntime()
  let revoked = false
  const check = () => { if (revoked) throw new Error('Assignment cancelled') }
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  const created = new Set<string>()
  h.controller.resolveAgent.mockImplementation((async (id: string) => created.has(id) ? { agent: { id } } : { error: { code: 'session/not-found' } }) as never)
  h.controller.create.mockImplementationOnce((async (request: { sessionId: string }) => { entered.resolve(); await wait.promise; created.add(request.sessionId) }) as never)
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('orphan-reuse', h.directory, 'test', 'worker', check)
  await entered.promise; revoked = true; wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(created.has('orphan-reuse')).toBe(true)          // the session exists after cancellation
  expect([...h.runtime.sessions.unresolvedSessions().keys()]).toEqual(['orphan-reuse'])   // and is surfaced, not silent
  const creates = h.controller.create.mock.calls.length
  await h.runtime.sessions.ensure('orphan-reuse', h.directory, 'test', 'worker', () => {}).catch(() => {})
  expect(h.controller.create.mock.calls.length).toBe(creates)   // deterministic id: reused, not re-created
})

const stubDecorate = () => vi.spyOn(h!.runtime.sessions as unknown as { decorate: () => Promise<void> }, 'decorate').mockResolvedValue(undefined)
const ensure = (id: string, check: () => void) => (h!.runtime.sessions.ensure.bind(h!.runtime.sessions) as Ensure)(id, h!.directory, 't', 'worker', check)

it('an authorized ensure that adopts the leftover session clears its unresolved entry', async () => {
  h = await startRuntime(); stubDecorate()
  let revoked = false
  const check = () => { if (revoked) throw new Error('Assignment cancelled') }
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  const original = h.controller.create.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
  h.controller.create.mockImplementationOnce((async (...args: unknown[]) => { entered.resolve(); await wait.promise; await original(...args) }) as never)
  const pending = ensure('adopt-clear', check)
  await entered.promise; revoked = true; wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect([...h.runtime.sessions.unresolvedSessions().keys()]).toEqual(['adopt-clear'])
  await ensure('adopt-clear', () => {})
  expect(h.runtime.sessions.unresolvedSessions().size).toBe(0)
})

it('the unresolved map is bounded at 256 and evicts the oldest first', async () => {
  h = await startRuntime(); stubDecorate()
  let revoked = false
  const check = () => { if (revoked) throw new Error('Assignment cancelled') }
  const original = h.controller.create.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
  h.controller.create.mockImplementation((async (...args: unknown[]) => { await original(...args); revoked = true }) as never)
  for (let index = 0; index < 260; index++) { revoked = false; await ensure(`bound-${index}`, check).catch(() => {}) }
  const ids = [...h.runtime.sessions.unresolvedSessions().keys()]
  expect(ids).toHaveLength(256)
  expect(ids[0]).toBe('bound-4'); expect(ids.at(-1)).toBe('bound-259')
})

it('upstream error text is never logged or stored (class name only)', async () => {
  h = await startRuntime(); stubDecorate()
  const warn = vi.spyOn(h.ctx.logger, 'warn')
  const secret = 'sk-live-SECRET-TOKEN-123'
  let after = false
  const original = h.controller.create.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
  h.controller.create.mockImplementationOnce((async (...args: unknown[]) => { await original(...args); after = true }) as never)
  await expect(ensure('hostile', () => { if (after) throw new Error(`upstream said ${secret}`) })).rejects.toThrow()
  expect(JSON.stringify(warn.mock.calls)).not.toContain(secret)
  expect(JSON.stringify([...h.runtime.sessions.unresolvedSessions()])).not.toContain(secret)
  expect(warn.mock.calls.length).toBeGreaterThan(0)
})

it('a privilege already granted to a reused session is dropped when a later ensure fails and the ticket has ended', async () => {
  h = await startRuntime(); stubDecorate()
  const presets = h.ctx.permissionPresets as unknown as { set: (...a: unknown[]) => void; defaultPreset?: string }
  presets.defaultPreset = 'workspace-write'
  const set = vi.spyOn(presets, 'set')
  const id = workerSessionId('T-ended')                      // the store holds no live ticket with this id
  await ensure(id, () => {})
  expect(set.mock.calls.map(call => call[1])).toEqual(['danger-full-access'])
  set.mockClear()
  await expect(ensure(id, () => { throw new Error('Ticket ended') })).rejects.toThrow('Ticket ended')
  expect(set.mock.calls.map(call => call[1])).toEqual(['workspace-write'])
})
