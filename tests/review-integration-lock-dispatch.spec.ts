import { afterEach, expect, it, vi } from 'vitest'
import type { EffectKind } from '../src/app/effects.ts'

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
 * Fail-closed dispatch contract: once the state lock is reported compromised the runtime may no longer own its directory, so no
 * effect (including the outbox `reply` effect) may dispatch afterwards. Red before the guard: Effects has no closing/lifetime
 * input, so a queued effect still ran after compromise. Integration-owned companion to review-lock-compromised.spec.ts.
 */
it('after the state lock is reported compromised, queued effects do not dispatch', async () => {
  host = await startRuntime()
  await host.runtime.ready
  const ran: string[] = []
  host.runtime.effects.handle('integ-probe' as EffectKind, async () => { ran.push('x') }, { limit: () => 1 })
  lock.onCompromised!(new Error('Unable to update lock within the stale threshold'))
  expect(host.runtime.lifetime.aborted).toBe(true)
  host.runtime.effects.enqueue('integ-probe' as EffectKind, 'k-compromise', {})
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(ran).toEqual([])
  const row = host.runtime.store.db.prepare('SELECT error FROM effect WHERE kind = ? AND key = ?').get('integ-probe', 'k-compromise') as { error: string } | undefined
  expect(row).toBeDefined() // still queued, not dispatched
})

it('after the state lock is reported compromised, the real outbox reply effect does not send', async () => {
  host = await startRuntime()
  await host.runtime.ready
  lock.onCompromised!(new Error('Unable to update lock within the stale threshold'))
  expect(host.runtime.lifetime.aborted).toBe(true)
  const trigger = feishu('991', '@bot reply after lock loss')
  const id = 'lock-loss-reply'
  host.runtime.outbox.send({ id, channel: trigger.channel!, text: 'should not go out', kind: 'reply' })
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(host.runtime.outbox.status(id)).toBe('pending')
})
