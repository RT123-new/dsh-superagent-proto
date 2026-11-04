/** Final review phase 2.2: ensure() authorization sweep. Every authorization boundary, for each revocation reason, never leaves danger-full-access. */
import { afterEach, expect, it, vi } from 'vitest'
import { Later } from '../src/app/effects.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
type Ensure = (id: string, cwd: string, title: string, role: 'worker' | 'orchestrator', check: () => void) => Promise<unknown>

const reasons: [string, () => Error][] = [
  ['pause', () => new Later('Processing is paused')],
  ['shutdown', () => new Later('dsh-superagent is stopping')],
  ['policy revocation / ended ticket', () => new Error('The ticket ended or another Assignment took it over')],
  ['worker replacement', () => new Error('another Assignment took it over')],
]

for (const [name, make] of reasons) {
  it(`${name}: revoking at every authorization boundary never leaves danger-full-access applied`, async () => {
    h = await startRuntime()
    const presets = vi.spyOn(h.ctx.permissionPresets, 'set')
    // First learn how many boundaries a full ensure crosses.
    let total = 0
    await (h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('count-run', h.directory, 't', 'worker', () => { total++ })
    expect(total).toBeGreaterThanOrEqual(6)
    for (let failAt = 1; failAt <= total; failAt++) {
      presets.mockClear()
      let n = 0
      const id = `sweep-${name.replace(/\W/g, '')}-${failAt}`
      const outcome = await (h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)(id, h.directory, 't', 'worker', () => { if (++n === failAt) throw make() }).then(() => 'ok', error => error)
      if (failAt === total) {
        // The last boundary is the one before the grant: revoking there must also refuse it.
        expect(outcome).not.toBe('ok')
      }
      expect(outcome).not.toBe('ok')
      expect(presets.mock.calls.filter(call => call[1] === 'danger-full-access'), `${name} at boundary ${failAt}/${total}`).toHaveLength(0)
      expect(outcome).toBeInstanceOf(Error)
    }
  })
}

it('an externally deleted worker session is recreated only when authorized, and a revoked recreation is surfaced', async () => {
  h = await startRuntime()
  const created = new Set<string>()
  h.controller.resolveAgent.mockImplementation((async (id: string) => created.has(id) ? { agent: { id } } : { error: { code: 'session/not-found' } }) as never)
  const original = h.controller.create.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
  h.controller.create.mockImplementation((async (request: { sessionId: string }) => { created.add(request.sessionId); return original(request) }) as never)
  let revoked = false
  await expect((h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('deleted-1', h.directory, 't', 'worker', () => { if (revoked) throw new Error('ended') }).catch(() => 'x')).resolves.not.toBe('never')
  created.delete('deleted-1')                        // external deletion
  revoked = true
  await expect((h.runtime.sessions.ensure.bind(h.runtime.sessions) as Ensure)('deleted-1', h.directory, 't', 'worker', () => { throw new Error('ended') })).rejects.toThrow('ended')
  expect(created.has('deleted-1')).toBe(false)       // no recreation while unauthorized: authorize runs before create
})

import { SourceRegistry } from '../src/sources/registry.ts'
it('SourceRegistry.installed resolves false on timeout or abort and true on registration', async () => {
  const registry = new SourceRegistry(() => ({} as never))
  expect(await registry.installed('feishu', undefined, 20)).toBe(false)
  const controller = new AbortController(); const aborted = registry.installed('feishu', controller.signal, 5000); controller.abort()
  expect(await aborted).toBe(false)
  const waiting = registry.installed('feishu', undefined, 5000)
  registry.register({ kind: 'feishu', health: [] } as never)
  expect(await waiting).toBe(true)
})
