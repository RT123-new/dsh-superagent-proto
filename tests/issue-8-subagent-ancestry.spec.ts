/**
 * Issue 8 (mandate Part 2): a managed worker's subagents keep the worker's restrictions at ANY nesting depth, and a
 * descendant whose ancestry cannot be resolved fails closed instead of running unrestricted. Independently created
 * Sessions and their subagents are never touched.
 */
import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/app/store.ts'
import { Context } from '@deepseek-ai/cordis'
import { KV } from '../src/kv.ts'
import { Sessions } from '../src/app/sessions.ts'

const MASTER = 'master'

function harness(tickets: Record<string, unknown> = { t1: { id: 't1', ended: undefined } }, durable = new Map<string, unknown>()) {
  const ctx = new Context()
  const agents = new Map<string, unknown>()
  ctx.reflect.provide('agents', agents)
  const host = {
    context: ctx,
    store: { tickets: { get: (id: string) => tickets[id] }, settings: () => ({}), get: (id: string) => durable.get(id), set: (id: string, value: unknown) => { durable.set(id, value) }, keys: () => [] },
    prompts: { current: () => ({ revision: 1, config: {} }), version: () => ({}), compose: () => '', skills: () => [] },
    effects: { handle: vi.fn(), enqueue: vi.fn(), idle: async () => {}, pending: () => false },
    health: { set: vi.fn() }, masterId: MASTER, lifetime: new AbortController().signal,
    closing: () => false, environment: () => [], tools: () => [],
  }
  const sessions = new Sessions(host as never)
  sessions.install()
  return { ctx, agents, durable }
}

function fakeAgent(id: string, parentSession?: string) {
  const agentCtx = new Context()
  const restrict = vi.fn((_rule: { allow: string[] }) => () => {}), guard = vi.fn((_check: () => string | undefined) => () => {})
  agentCtx.reflect.provide('tools', { register: () => () => {}, get: () => ({}), restrict, guard })
  agentCtx.reflect.provide('skills', { register: () => () => {} })
  agentCtx.reflect.provide('systemPrompt', { section: () => () => {} })
  const agent = { id, ctx: agentCtx, status: 'idle', inbox: { nextTurn: [], nextStep: [] },
    session: { id, header: { parentSession }, snapshotEvents: () => [], requestHeader: () => undefined } }
  return { agent, restrict, guard }
}

/** Registers worker-t1 and `intermediates` nested subagent Sessions, returning the next generation's fake agent. */
function chain(agents: Map<string, unknown>, intermediates: number) {
  agents.set('worker-t1', fakeAgent('worker-t1').agent)
  let parent = 'worker-t1'
  for (let i = 1; i <= intermediates; i++) { agents.set(`c${i}`, fakeAgent(`c${i}`, parent).agent); parent = `c${i}` }
  return fakeAgent('leaf', parent)
}

it.each([1, 8, 9, 20])('keeps a subagent under the worker\'s restrictions through %i nested subagent(s)', intermediates => {
  const { ctx, agents } = harness()
  const leaf = chain(agents, intermediates)
  ctx.emit('agent/created', { agent: leaf.agent } as never)
  expect(leaf.restrict).toHaveBeenCalledTimes(1)
  // The worker's work tools, not the whole profile.
  const allow = leaf.restrict.mock.calls[0]![0].allow as string[]
  expect(allow).toContain('bash')
  expect(allow).not.toContain('ask')
  expect(leaf.guard).toHaveBeenCalledTimes(1)
})

it('keeps managed restrictions when an observed ancestor Session is gone', () => {
  const { ctx, agents, durable } = harness()
  durable.set(KV.sessions.worker('c2'), 't1')
  agents.set('worker-t1', fakeAgent('worker-t1').agent)
  agents.set('c1', fakeAgent('c1', 'worker-t1').agent)
  const leaf = fakeAgent('leaf', 'c2') // c2 is unloaded, but its originating ticket was durably recorded
  ctx.emit('agent/created', { agent: leaf.agent } as never)
  expect(leaf.restrict).toHaveBeenCalledTimes(1)
  expect(leaf.restrict.mock.calls[0]![0].allow).toContain('bash')
  expect(leaf.guard).toHaveBeenCalledTimes(1)
})

it('keeps the recorded managed ticket despite cyclic parent metadata', () => {
  const { ctx, agents, durable } = harness()
  durable.set(KV.sessions.worker('c1'), 't1')
  agents.set('c1', fakeAgent('c1', 'c2').agent)
  agents.set('c2', fakeAgent('c2', 'c1').agent)
  const leaf = fakeAgent('leaf', 'c1')
  ctx.emit('agent/created', { agent: leaf.agent } as never)
  expect(leaf.restrict).toHaveBeenCalledTimes(1)
  expect(leaf.restrict.mock.calls[0]![0].allow).toContain('bash')
})

it('keeps managed provenance through nesting beyond the safety bound', () => {
  const { ctx, agents, durable } = harness()
  durable.set(KV.sessions.worker('c100'), 't1')
  const leaf = chain(agents, 100)
  ctx.emit('agent/created', { agent: leaf.agent } as never)
  expect(leaf.restrict).toHaveBeenCalledTimes(1)
  expect(leaf.restrict.mock.calls[0]![0].allow).toContain('bash')
})

it('fails closed a worker Session whose ticket is gone', () => {
  const { ctx } = harness({})
  const worker = fakeAgent('worker-t9')
  ctx.emit('agent/created', { agent: worker.agent } as never)
  expect(worker.restrict).toHaveBeenCalledTimes(1)
  expect(worker.guard).toHaveBeenCalledTimes(1)
})

it('never touches independently created Sessions or their subagents', () => {
  const { ctx, agents } = harness()
  agents.set('user-1', fakeAgent('user-1').agent)
  const own = fakeAgent('user-2')
  ctx.emit('agent/created', { agent: own.agent } as never)
  expect(own.restrict).not.toHaveBeenCalled()
  const child = fakeAgent('child', 'user-1')
  ctx.emit('agent/created', { agent: child.agent } as never)
  expect(child.restrict).not.toHaveBeenCalled()
  const masterChild = fakeAgent('master-child', MASTER)
  ctx.emit('agent/created', { agent: masterChild.agent } as never)
  expect(masterChild.restrict).not.toHaveBeenCalled()
})

it('does not restrict an independent user child just because its parent is unloaded', () => {
  const { ctx } = harness()
  const child = fakeAgent('independent-child', 'unloaded-independent-parent')
  ctx.emit('agent/created', { agent: child.agent } as never)
  expect(child.restrict).not.toHaveBeenCalled()
  expect(child.guard).not.toHaveBeenCalled()
})
it('does not restrict an unrelated independently rooted deep chain', () => {
  const { ctx, agents } = harness()
  agents.set('user-root', fakeAgent('user-root').agent)
  let parent = 'user-root'
  for (let i = 0; i < 100; i++) { const id = `user-${i}`; agents.set(id, fakeAgent(id, parent).agent); parent = id }
  const child = fakeAgent('independent-deep', parent)
  ctx.emit('agent/created', { agent: child.agent } as never)
  expect(child.restrict).not.toHaveBeenCalled()
})

it('records one originating ticket per observed managed Session and retains it across restart', () => {
  const h = harness()
  h.agents.set('worker-t1', fakeAgent('worker-t1').agent)
  const child = fakeAgent('child', 'worker-t1')
  h.ctx.emit('agent/created', { agent: child.agent } as never)
  expect(h.durable.size).toBe(1)
  expect(h.durable.get(KV.sessions.worker('child'))).toBe('t1')
  const restored = harness({}, h.durable) // originating ticket was deleted while the parent unloaded
  const grandchild = fakeAgent('grandchild', 'child')
  restored.ctx.emit('agent/created', { agent: grandchild.agent } as never)
  expect(grandchild.restrict).toHaveBeenCalledTimes(1)
  expect(grandchild.guard.mock.calls[0]![0]()).toMatch(/Ticket ended/)
  expect(h.durable.size).toBe(2)
})
it('records provenance once per managed Session, not per event or turn', () => {
  const h = harness()
  h.agents.set('worker-t1', fakeAgent('worker-t1').agent)
  const child = fakeAgent('child', 'worker-t1')
  for (let i = 0; i < 100; i++) h.ctx.emit('agent/created', { agent: child.agent } as never)
  expect(h.durable.size).toBe(1)
})

it('reloads observed lineage from SQLite across a real store reopen without schema migration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lineage-review-'))
  const path = join(directory, 'store.sqlite')
  let store = new Store(path)
  try {
    const h = harness()
    h.agents.set('worker-t1', fakeAgent('worker-t1').agent)
    const child = fakeAgent('child', 'worker-t1')
    h.ctx.emit('agent/created', { agent: child.agent } as never)
    for (const [key, value] of h.durable) store.set(key, value)
    store.close(); store = new Store(path)
    const durable = new Map(store.keys(KV.sessions.worker).map(key => [key, store.get(key)]))
    const restored = harness({}, durable)
    const grandchild = fakeAgent('grandchild', 'child')
    restored.ctx.emit('agent/created', { agent: grandchild.agent } as never)
    expect(grandchild.guard.mock.calls[0]![0]()).toMatch(/Ticket ended/)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
