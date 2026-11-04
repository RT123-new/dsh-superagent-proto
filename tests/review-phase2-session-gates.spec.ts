/** Final review phase 2.2: after an uncancellable create completes, a cancelled assignment still cannot receive work. */
import { afterEach, expect, it } from 'vitest'
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
