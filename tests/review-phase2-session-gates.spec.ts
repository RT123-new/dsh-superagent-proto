/** Final review phase 2.2: after an uncancellable create completes, a cancelled assignment still cannot receive work. */
import { afterEach, expect, it, vi } from 'vitest'
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
