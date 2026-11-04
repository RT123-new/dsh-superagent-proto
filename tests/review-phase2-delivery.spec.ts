import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { AgentDelivery } from '../src/app/delivery.ts'

function fixture(history: UserMessage[] = []) {
  const ctx = new Context()
  const inbox = { nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[] }
  const steer = vi.fn((message: UserMessage) => { inbox.nextStep.push(message) })
  const followup = vi.fn((message: UserMessage) => { inbox.nextTurn.push(message) })
  const injected = vi.fn((_message: UserMessage) => {})
  // Only the delivery-facing Agent methods participate in this fixture.
  const agent = { id: SessionId('delivery-test'), session: {}, inbox, steer, followup, inject: injected } as unknown as Agent
  const event = (message: UserMessage): SessionEvent => ({ type: 'user/message', seq: SessionSeq(0), time: 0, surfaceOp: 'append', data: message })
  const read = vi.fn(async (offset: number, length: number) => ({ events: history.slice(offset, offset + length).map(event) }))
  const close = vi.fn(async () => {})
  const flush = vi.fn(async () => {})
  const open = vi.fn(async () => ({ read, [Symbol.asyncDispose]: close }))
  const agents = new Map([[agent.id, agent]])
  ctx.reflect.provide('agents', agents)
  ctx.reflect.provide('sessionPersistence', { open, flush })
  const delivery = new AgentDelivery(ctx)
  const signal = new AbortController()
  const send = (id = 'request', mode: 'queue' | 'steer' = 'steer') => delivery.send(agent, id, '{"event_id":"event"}', mode, signal.signal)
  const inject = (id: string, summary: string) => delivery.send(agent, id, '{"settings_saved":"policy"}', { inject: summary }, signal.signal)
  const sendWith = (id: string, accepted: () => void, authorize?: () => void) => delivery.send(agent, id, '{}', 'queue', signal.signal, authorize, accepted)
  const holds = (id: string) => delivery.holds(agent, id)
  const consume = (message: UserMessage) => {
    inbox.nextStep.splice(0); inbox.nextTurn.splice(0)
    ctx.emit('session/event', agent.session, event(message))
  }
  return { agent, agents, inbox, steer, followup, injected, open, read, close, flush, send, sendWith, inject, holds, consume, signal }
}


/** Final adversarial review, phase 2.3: characterization of the acceptance/flush window (not a confirmed defect). */
it('a persistence flush failure after acceptance retries without duplicating the message and re-acknowledges', async () => {
  const f = fixture()
  const accepted = vi.fn()
  f.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'))
  await expect(f.sendWith('r1', accepted)).rejects.toThrow('disk full')
  expect(accepted).toHaveBeenCalledTimes(1)
  expect(f.followup).toHaveBeenCalledOnce()
  await f.sendWith('r1', accepted)
  expect(f.followup).toHaveBeenCalledOnce()
  expect(accepted).toHaveBeenCalledTimes(2)
  expect(f.inbox.nextTurn).toHaveLength(1)
})

it('a delivery whose authorization is revoked before acceptance never reaches the inbox or acknowledges', async () => {
  const f = fixture()
  const accepted = vi.fn()
  await expect(f.sendWith('r2', accepted, () => { throw new Error('revoked') })).rejects.toThrow('revoked')
  expect(f.followup).not.toHaveBeenCalled()
  expect(accepted).not.toHaveBeenCalled()
})
