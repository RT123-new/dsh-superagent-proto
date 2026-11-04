import { afterEach, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => ({ onCompromised: undefined as undefined | ((error: Error) => void) }))
vi.mock('proper-lockfile', async importOriginal => {
  const real = await importOriginal<typeof import('proper-lockfile')>()
  return { ...real, default: real, lockSync: ((dir: string, options: { onCompromised?: (error: Error) => void }) => { lock.onCompromised = options.onCompromised; return real.lockSync(dir, options) }) as typeof real.lockSync }
})
const { feishu, startRuntime } = await import('./stage-d/host.ts')
type Host = Awaited<ReturnType<typeof startRuntime>>
let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

/**
 * Fail-closed contract: once the state lock is reported compromised another process may own the directory, so the runtime must stop accepting
 * runtime-authorised mutations (receive, dispatch, launch, outbox) rather than keep writing. Raw `Store` use by a caller who holds the
 * handle is outside this contract. Red on de50174: receive() still persisted the trigger. No distributed fence is claimed.
 */
it('after the state lock is reported compromised, receive refuses and stores nothing', async () => {
  host = await startRuntime()
  lock.onCompromised!(new Error('Unable to update lock within the stale threshold'))
  expect(host.runtime.lifetime.aborted).toBe(true)
  const trigger = feishu('990', '@bot something after the lock was lost')
  expect(() => host!.runtime.receive(trigger)).toThrow(/stopping/)
  expect(host.runtime.store.triggers.get(trigger.id)).toBeUndefined()
})
it('stop() still completes after the lock was reported compromised', async () => {
  host = await startRuntime()
  lock.onCompromised!(new Error('lock lost'))
  await host.runtime.stop()
})
