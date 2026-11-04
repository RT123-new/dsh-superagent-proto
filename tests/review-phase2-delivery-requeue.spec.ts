/**
 * Final review phase 2.2: the branches of AgentDelivery.send that re-queue a message already pending in an idle agent's inbox, against a fake agent
 * (status, inbox and steer/followup are the only parts used). The real-loop proof of the main case is tests/review-phase2-agent-loop-kill.spec.ts.
 */
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { AgentDelivery, messageId } from '../src/app/delivery.ts'

const msg = (request: string, form: 'relay' | 'notice' = 'relay') => freezeMessage({ id: messageId(request), role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], source: { kind: 'dsh-superagent' as const, form } } as never)
function setup(status: 'idle' | 'running', pending: ReturnType<typeof msg>[] = [], steer?: (m: unknown) => void) {
  const inbox = { nextTurn: [...pending] as unknown[], nextStep: [] as unknown[], remove: (id: string) => { const n = inbox.nextTurn.length; inbox.nextTurn = inbox.nextTurn.filter(m => (m as { id: string }).id !== id); return inbox.nextTurn.length < n } }
  const calls = { steer: 0, followup: 0, inject: 0 }
  const agent = { id: 'a', status, session: {}, inbox,
    steer: (m: unknown) => { calls.steer++; if (steer) steer(m); inbox.nextStep.push(m) },
    followup: (m: unknown) => { calls.followup++; inbox.nextTurn.push(m) }, inject: () => { calls.inject++ } }
  const ctx = { on: () => {}, sessionPersistence: { flush: async () => {}, open: async () => ({ read: async () => ({ events: [] }), [Symbol.asyncDispose]: async () => {} }) }, agents: { get: () => agent } }
  return { agent, calls, delivery: new AgentDelivery(ctx as never), signal: new AbortController().signal }
}

it('a pending message in an idle agent is re-queued through the waking path, once, and authorize runs', async () => {
  const s = setup('idle', [msg('r1')]); const authorize = vi.fn()
  await s.delivery.send(s.agent as never, 'r1', 'hi', 'steer', s.signal, authorize)
  expect(s.calls).toEqual({ steer: 1, followup: 0, inject: 0 }); expect(authorize).toHaveBeenCalledTimes(1)
  expect([...s.agent.inbox.nextTurn, ...s.agent.inbox.nextStep]).toHaveLength(1)
})
it('queue mode re-queues with followup', async () => {
  const s = setup('idle', [msg('r1')])
  await s.delivery.send(s.agent as never, 'r1', 'hi', 'queue', s.signal)
  expect(s.calls).toEqual({ steer: 0, followup: 1, inject: 0 })
  expect(s.agent.inbox.nextTurn).toHaveLength(1)
})
it('a running agent keeps its pending message untouched: nothing is removed or re-queued', async () => {
  const s = setup('running', [msg('r1')]); const before = s.agent.inbox.nextTurn[0]
  await s.delivery.send(s.agent as never, 'r1', 'hi', 'steer', s.signal)
  expect(s.calls).toEqual({ steer: 0, followup: 0, inject: 0 }); expect(s.agent.inbox.nextTurn[0]).toBe(before)
})
it('inject mode never wakes: a pending injected notice stays untouched', async () => {
  const s = setup('idle', [msg('r1', 'notice')]); const before = s.agent.inbox.nextTurn[0]
  await s.delivery.send(s.agent as never, 'r1', 'hi', { inject: 'note' }, s.signal)
  expect(s.calls).toEqual({ steer: 0, followup: 0, inject: 0 }); expect(s.agent.inbox.nextTurn[0]).toBe(before)
})
it('if the re-queue throws after the remove, the send rejects, the producer retries with authorization, and the message is delivered once in this sequence', async () => {
  let fail = true
  const s = setup('idle', [msg('r1')], () => { if (fail) { fail = false; throw new Error('boom') } })
  const authorize = vi.fn()
  await expect(s.delivery.send(s.agent as never, 'r1', 'hi', 'steer', s.signal, authorize)).rejects.toThrow('boom')
  expect(s.agent.inbox.nextTurn).toHaveLength(0)           // removed, not acknowledged
  expect(await s.delivery.holds(s.agent as never, 'r1')).toBe(false)   // so the producer's retry is not skipped
  await s.delivery.send(s.agent as never, 'r1', 'hi', 'steer', s.signal, authorize)
  expect(authorize).toHaveBeenCalledTimes(2)
  expect([...s.agent.inbox.nextTurn, ...s.agent.inbox.nextStep].filter(m => (m as { id: string }).id === messageId('r1'))).toHaveLength(1)
})
it('a revoked authorization on the retry stops before any re-queue', async () => {
  const s = setup('idle', [msg('r1')])
  await expect(s.delivery.send(s.agent as never, 'r1', 'hi', 'steer', s.signal, () => { throw new Error('revoked') })).rejects.toThrow('revoked')
  expect(s.calls).toEqual({ steer: 0, followup: 0, inject: 0 }); expect(s.agent.inbox.nextTurn).toHaveLength(1)
})
