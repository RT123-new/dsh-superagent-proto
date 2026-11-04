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
 * CHARACTERISATION (de50174): the state directory lock is what keeps one process the only writer. When the lock library reports it compromised
 * (for example the lock was not refreshed within the 30 s stale window and another process may now hold it), the runtime marks health
 * as error and aborts its `lifetime` signal, but nothing fences its SQLite writes or its effect dispatch. This test records that it still accepts and
 * stores new work afterwards. It documents a single-writer gap; it does not claim another process was actually allowed in.
 */
it('after the state lock is reported compromised, the runtime keeps persisting new triggers', async () => {
  host = await startRuntime()
  expect(lock.onCompromised).toBeTypeOf('function')
  lock.onCompromised!(new Error('Unable to update lock within the stale threshold'))
  expect(host.runtime.lifetime.aborted).toBe(true)
  expect(host.runtime.health.runtime?.state).toBe('error')
  const trigger = feishu('990', '@bot something after the lock was lost')
  host.runtime.receive(trigger)
  await host.runtime.idle()
  expect(host.runtime.store.triggers.get(trigger.id)).toBeDefined()
})
