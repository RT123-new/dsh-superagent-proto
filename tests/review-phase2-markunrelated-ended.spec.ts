// Final review (NF-3, failing-first): a stale worker tool on an ENDED ticket must not mutate state.
// Adversary confirmed orchestrator_thread_unrelated dropped the ticket's subscription after stopTicket
// (markUnrelated had no liveTicket check; ack/follow/report already guard). Live control must keep working.
import { afterEach, expect, it } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

const snap = (h: Host) => JSON.stringify({ t: h.runtime.store.tickets.list(), subs: ['github:77', 'github:78'].map(k => h.runtime.store.threads.get(k)?.subscriptions ?? null) })

it('orchestrator_thread_unrelated on a LIVE ticket drops the subscription (control)', async () => {
  h = await startRuntime()
  const { sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  await h.runTool(sessionId, 'orchestrator_thread_follow', { thread: 'github:77', reason: 'ctx' })
  await h.runtime.idle()
  const removed = await h.runTool(sessionId, 'orchestrator_thread_unrelated', { thread: 'github:77', reason: 'not about it' }) as { removed?: boolean }
  expect(removed.removed).toBe(true)
})

it('orchestrator_thread_unrelated after stopTicket refuses and mutates nothing', async () => {
  h = await startRuntime()
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot fix'))
  await h.runTool(sessionId, 'orchestrator_thread_follow', { thread: 'github:78', reason: 'ctx' })
  await h.runtime.idle()
  h.runtime.engine.stopTicket(ticket.id)
  await new Promise(r => setTimeout(r, 50)); await h.runtime.idle()
  expect(h.runtime.store.tickets.get(ticket.id)!.ended).toBeDefined()
  const before = snap(h)
  await expect(h.runTool(sessionId, 'orchestrator_thread_unrelated', { thread: 'github:78', reason: 'late' })).rejects.toThrow(/ended|ticketEnded/i)
  await h.runtime.idle()
  expect(snap(h)).toBe(before)
})
