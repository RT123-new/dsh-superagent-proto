/** Guard every awaited creation boundary. The framework create RPC itself has no cancellation input. */
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
const gate = () => {
  let revoked = false
  return { revoke: () => { revoked = true }, check: () => { if (revoked) throw new Error('Assignment cancelled') } }
}
type GuardedEnsure = (id: string, cwd: string, title: string, role: 'worker' | 'orchestrator', check: () => void) => Promise<unknown>

it('cancellation during initial session resolution prevents workspace and session creation', async () => {
  h = await startRuntime()
  const check = gate(), wait = Promise.withResolvers<void>()
  h.controller.resolveAgent.mockImplementationOnce((async () => { await wait.promise; return { error: { code: 'session/not-found' } } }) as never)
  const create = h.controller.create.mock.calls.length
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as GuardedEnsure)('cancel-before-create', h.directory, 'test', 'worker', check.check)
  check.revoke(); wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(h.controller.create.mock.calls.length).toBe(create)
})

it('cancellation while workspace creation waits prevents the session create RPC', async () => {
  h = await startRuntime()
  const check = gate(), entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  vi.spyOn(h.ctx.workspaceRegistry, 'create').mockImplementationOnce(async () => {
    entered.resolve(); await wait.promise; return { id: h!.directory } as never
  })
  const create = h.controller.create.mock.calls.length
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as GuardedEnsure)('cancel-workspace', h.directory, 'test', 'worker', check.check)
  await entered.promise; check.revoke(); wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(h.controller.create.mock.calls.length).toBe(create)
})

it('an in-flight uncancellable create RPC settles but cancellation prevents resolve and later mutations', async () => {
  h = await startRuntime()
  const check = gate(), entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  h.controller.create.mockImplementationOnce(async () => { entered.resolve(); await wait.promise })
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as GuardedEnsure)('cancel-in-create', h.directory, 'test', 'worker', check.check)
  await entered.promise
  const resolves = h.controller.resolveAgent.mock.calls.length, renames = h.controller.rename.mock.calls.length
  check.revoke(); wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(h.controller.resolveAgent.mock.calls.length).toBe(resolves)
  expect(h.controller.rename.mock.calls.length).toBe(renames)
})

it('cancellation during model resolution prevents model selection append and rename', async () => {
  h = await startRuntime()
  const check = gate(), entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, model: { provider: 'test', model: 'test' } } })
  vi.spyOn(h.ctx.llm, 'resolveCallConfig').mockImplementationOnce(async () => {
    entered.resolve(); await wait.promise; return { provider: 'test', model: 'test' } as never
  })
  const pending = (h.runtime.sessions.ensure.bind(h.runtime.sessions) as GuardedEnsure)('cancel-model', h.directory, 'test', 'worker', check.check)
  await entered.promise
  const agent = h.agents.get('cancel-model')!
  check.revoke(); wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect((agent as unknown as { session: { append: ReturnType<typeof vi.fn> } }).session.append).not.toHaveBeenCalled()
  expect(h.controller.rename).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'cancel-model' }))
})
