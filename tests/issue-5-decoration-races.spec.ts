import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, feishu, type Host } from './fixtures/host.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
const gate = () => {
  let revoked = false
  return { revoke: () => { revoked = true }, check: () => { if (revoked) throw new Error('Assignment cancelled') } }
}
const privates = () => h!.runtime.sessions as unknown as {
  decorate(agent: Agent, authorize?: () => void): Promise<void>
  release(agent: Agent): void
  bindings: Map<Agent, unknown>
}
async function setup() {
  h = await startRuntime()
  const { sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  const agent = h.agents.get(sessionId)! as unknown as Agent
  privates().release(agent)
  return agent
}
function holdScope(agent: Agent) {
  const entered = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>()
  const dispose = vi.fn(async () => {})
  const registration = vi.fn(() => () => {})
  const inject = vi.spyOn(agent.ctx, 'inject').mockImplementationOnce(((_deps: unknown, callback: (scope: unknown) => void) => {
    entered.resolve()
    const pending = wait.promise.then(() => callback({ skills: { register: registration } }))
    return Object.assign(pending, { dispose })
  }) as never)
  return { entered, wait, dispose, registration, inject }
}

it('does not register skills when cancellation occurred while the scope was unavailable', async () => {
  const agent = await setup(), auth = gate(), scope = holdScope(agent)
  const pending = privates().decorate(agent, auth.check)
  await scope.entered.promise
  auth.revoke(); scope.wait.resolve()
  await expect(pending).rejects.toThrow('Assignment cancelled')
  expect(scope.registration).not.toHaveBeenCalled()
})

it('a stale decoration cancellation must not release a newer binding on the shared worker', async () => {
  const agent = await setup(), auth = gate(), scope = holdScope(agent)
  const old = privates().decorate(agent, auth.check)
  await scope.entered.promise
  privates().release(agent)
  await privates().decorate(agent)
  const newer = privates().bindings.get(agent)
  expect(newer).toBeDefined()
  auth.revoke(); scope.wait.resolve()
  await expect(old).rejects.toThrow('Assignment cancelled')
  expect(privates().bindings.get(agent) === newer).toBe(true)
})

it('a concurrent ensure cannot set broad permissions before an existing decoration finishes', async () => {
  const agent = await setup(), scope = holdScope(agent)
  const decoration = privates().decorate(agent)
  await scope.entered.promise
  const permissions = vi.spyOn(h!.ctx.permissionPresets, 'set')
  const ensure = h!.runtime.sessions.ensure(agent.id, h!.directory, 'same', 'worker')
  await new Promise(resolve => setTimeout(resolve, 20))
  const beforeReady = permissions.mock.calls.length
  scope.wait.resolve()
  await Promise.all([decoration, ensure])
  expect(beforeReady).toBe(0)
})
