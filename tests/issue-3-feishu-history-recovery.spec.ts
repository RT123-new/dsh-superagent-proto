/**
 * Issue 3 — Feishu history recovery can skip messages.
 * Regression tests for checkpoint-after-completion recovery: a failed page read (first, middle or final) cannot skip
 * unprocessed messages, replay is idempotent on stable message identity, late-indexed messages stay reachable through
 * the replay window, and unauthorized senders gain no work from recovery.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { feishuTriggerId, backfillChat, feishuTrigger } from '../src/sources/feishu.ts'
import { pollThreads, recoverySince, reconcileDue, runFeishu } from '../src/sources/feishu-loops.ts'
import { cursorAt } from '../src/sources/poll.ts'
import { KV } from '../src/kv.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { closeHost, feishuHistoryServer, feishuMessage, hostDir, pinCommands, sourceHost } from './fixtures/source-host.ts'

const T0 = Date.parse('2026-09-09T00:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('issue 3 — Feishu history recovery', () => {
  it.each([[1], [2], [3]])('recovers every message when history page %i of 3 fails, exactly once each', async failAt => {
    const h = sourceHost(hostDir('issue3-'))
    const server = { items: Array.from({ length: 120 }, (_, index) => feishuMessage(`om_${index + 1}`, 'oc_team', T0 + index * 1000)),
      failAtCall: [failAt] }
    feishuHistoryServer(h, server)
    const scan = () => backfillChat(h, 'oc_team', false, iso(T0 - 1000), iso(T0 + 200_000), new AbortController().signal)
    await expect(scan()).rejects.toThrow('Feishu read failed (simulated)')
    await scan()
    for (let index = 1; index <= 120; index++) expect(h.store.triggers.get(feishuTriggerId(`om_${index}`))).toBeDefined()
    // Replayed pages were deduplicated on stable message identity: each message entered intake exactly once.
    expect(h.results.filter(result => result === 'stored' || result === 'filtered')).toHaveLength(120)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(50 * (failAt - 1))
    closeHost(h)
  })

  it('keeps the recovery checkpoint when the process stops mid-scan, and resumes without loss or duplication', async () => {
    const h = sourceHost(hostDir('issue3-'))
    const server = { items: Array.from({ length: 120 }, (_, index) => feishuMessage(`om_${index + 1}`, 'oc_team', T0 + index * 1000)) }
    feishuHistoryServer(h, server)
    const stop = new AbortController()
    // The process dies after the first message of the burst is durably ingested.
    h.receive.mockImplementation(async (trigger: Parameters<typeof h.engine.receive>[0]) => {
      const result = h.engine.receive(trigger)
      h.results.push(result)
      stop.abort()
      return result
    })
    await expect(backfillChat(h, 'oc_team', false, iso(T0 - 1000), iso(T0 + 200_000), stop.signal)).rejects.toThrow()
    const ingested = h.results.length
    expect(ingested).toBeGreaterThan(0)
    h.receive.mockImplementation(async (trigger: Parameters<typeof h.engine.receive>[0]) => {
      const result = h.engine.receive(trigger)
      h.results.push(result)
      return result
    })
    await backfillChat(h, 'oc_team', false, iso(T0 - 1000), iso(T0 + 200_000), new AbortController().signal)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(ingested)
    for (let index = 1; index <= 120; index++) expect(h.store.triggers.get(feishuTriggerId(`om_${index}`))).toBeDefined()
    closeHost(h)
  })

  it('recovers a message indexed late but within the replay window of the scan that preceded it', async () => {
    const h = sourceHost(hostDir('issue3-'))
    const server = { items: [] as Record<string, unknown>[] }
    feishuHistoryServer(h, server)
    await backfillChat(h, 'oc_team', false, iso(T0), iso(T0 + 60_000), new AbortController().signal)
    // The loop's checkpoint after that scan: a 120-second replay window behind it (plus a one-second edge guard).
    const checkpoint = cursorAt(iso(T0 + 60_000), 121_000)
    // Feishu indexes the message 30 seconds late: its create_time precedes a five-second overlap, but not the window.
    server.items = [feishuMessage('om_late', 'oc_team', T0 + 30_000)]
    await backfillChat(h, 'oc_team', false, checkpoint, iso(T0 + 120_000), new AbortController().signal)
    expect(h.store.triggers.get(feishuTriggerId('om_late'))).toBeDefined()
    closeHost(h)
  })

  it('grants a recovered stranger\'s unaddressed message no work, while an allowed member\'s mention is received', async () => {
    const h = sourceHost(hostDir('issue3-'))
    const mention = feishuMessage('om_ok', 'oc_team', T0, { sender: { id: 'ou_alice', sender_type: 'user' },
      body: { content: '{"text":"@bot fix it"}' }, mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'Bot' }] })
    feishuHistoryServer(h, { items: [feishuMessage('om_stranger', 'oc_team', T0 + 1000), mention] })
    await backfillChat(h, 'oc_team', false, iso(T0 - 1000), iso(T0 + 60_000), new AbortController().signal)
    expect(h.store.triggers.get(feishuTriggerId('om_stranger'))).toBeDefined()
    expect(h.store.triggers.get(feishuTriggerId('om_ok'))).toBeDefined()
    // The stranger's message was filtered by the Source scope; only the allowed member's mention became a candidate.
    expect(h.engine.candidate(feishuTriggerId('om_ok'))).toBeDefined()
    expect(h.engine.candidate(feishuTriggerId('om_stranger'))).toBeUndefined()
    closeHost(h)
  })

  it('recovers a subscribed topic when a middle page read fails, without duplicating replies', async () => {
    const h = sourceHost(hostDir('issue3-'))
    const source = feishuTrigger({ message_id: 'om_root', chat_id: 'oc_1', chat_type: 'group', sender_id: 'ou_alice',
      sender_type: 'user', content: '@bot fix', create_time: '1', mentions: [{ id: 'ou_bot' }] }, 'ou_bot', 'cli_bot')!
    h.store.triggers.save(source)
    h.store.threads.save({ key: 'feishu:oc_1:om_root', ref: { source: 'feishu', id: 'oc_1:om_root' },
      createdAt: new Date().toISOString(), lastAt: new Date().toISOString(), subscriptions: ['ticket'], correlated: [], pending: [],
      meta: { chatId: 'oc_1', messageId: 'om_root', sourceTriggerId: source.id } })
    const replies = Array.from({ length: 45 }, (_, index) => ({ message_id: `om_r${index + 1}`, chat_id: 'oc_1', msg_type: 'text',
      content: `reply ${index + 1}`, sender: { id: 'ou_guest', sender_type: 'user' }, create_time: String(Date.now()),
      thread_id: 'omt_1', root_id: 'om_root', mentions: [] }))
    let failP2 = true
    pinCommands(h)
    vi.spyOn(h.commands, 'lark').mockImplementation(async args => {
      if (args[0] === 'api') return { items: [{ message_id: 'om_root', chat_id: 'oc_1', thread_id: 'omt_1' }] }
      if (args[1] === '+messages-mget') return { messages: [] }
      const token = args.includes('--page-token') ? String(args[args.indexOf('--page-token') + 1]) : 'p1'
      if (token === 'p2' && failP2) { failP2 = false; throw new Error('Feishu read failed (simulated)') }
      const page = { p1: replies.slice(0, 20), p2: replies.slice(20, 40), p3: replies.slice(40) }[token]!
      const next = { p1: 'p2', p2: 'p3', p3: undefined }[token]
      return { thread_id: 'omt_1', has_more: !!next, ...(next ? { page_token: next } : {}), messages: page }
    })
    await pollThreads(h)
    expect(h.store.threads.get('feishu:oc_1:om_root')?.meta.pollError).toContain('Feishu read failed')
    await pollThreads(h)
    for (let index = 1; index <= 45; index++) expect(h.store.triggers.get(feishuTriggerId(`om_r${index}`))).toBeDefined()
    // Page 1 was not re-received after the failure: its messages were already durably checkpointed per-thread.
    expect(h.receive).toHaveBeenCalledTimes(45)
    expect(h.store.threads.get('feishu:oc_1:om_root')?.meta).not.toHaveProperty('pollError')
    closeHost(h)
  })

  it('recovers a message indexed beyond the replay window once the reconciliation cadence is due', async () => {
    const h = sourceHost(hostDir('issue3-'))
    const server = { items: [] as Record<string, unknown>[] }
    feishuHistoryServer(h, server)
    const t1 = T0 + 60_000
    await backfillChat(h, 'oc_team', false, iso(T0), iso(t1), new AbortController().signal)
    const checkpoint = cursorAt(iso(t1), 121_000)
    const t2 = t1 + 60_000
    // Indexed ten minutes late: outside the replay window, inside the reconciliation horizon.
    server.items = [feishuMessage('om_slower', 'oc_team', t1 - 600_000)]
    await backfillChat(h, 'oc_team', false, checkpoint, iso(t2), new AbortController().signal)
    expect(h.store.triggers.get(feishuTriggerId('om_slower'))).toBeUndefined()
    const wide = recoverySince(checkpoint, iso(t2), reconcileDue(undefined, iso(t2), 30), 3600)
    await backfillChat(h, 'oc_team', false, wide, iso(t2), new AbortController().signal)
    expect(h.store.triggers.get(feishuTriggerId('om_slower'))).toBeDefined()
    expect(h.results.filter(result => result === 'stored' || result === 'filtered')).toHaveLength(1)
    closeHost(h)
  })

  it('keeps a replay window behind each recovery scan, so late-indexed messages stay reachable', async () => {
    const dir = hostDir('issue3-')
    const cli = join(dir, 'lark-bot')
    writeFileSync(cli, '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 })
    const h = sourceHost(dir, { deployment: testDeployment({ feishu: { ...testDeployment().feishu!, cli } }) })
    pinCommands(h)
    vi.spyOn(h.commands, 'lark').mockImplementation(async args =>
      (args[1] === '+chat-list' ? { chats: [] } : { has_more: false, items: [] }))
    const hour = new Date(Date.now() - 3_600_000).toISOString()
    h.store.set(KV.feishu.history('oc_team'), hour)
    const stop = new AbortController()
    const running = runFeishu(h, stop.signal)
    await vi.waitFor(() => expect(['ready', 'error']).toContain(h.health.history?.state), { timeout: 10_000 })
    const cursor = h.store.get(KV.feishu.history('oc_team'))!
    stop.abort()
    await running
    const behind = Date.now() - Date.parse(cursor)
    // The checkpoint trails the completed scan by the configured replay window, not by the old five-second overlap.
    expect(behind).toBeGreaterThanOrEqual(119_000)
    expect(behind).toBeLessThan(130_000)
    closeHost(h)
  }, 15_000)

  it('keeps live events, history backfill and per-conversation polling on one message identity', async () => {
    const h = sourceHost(hostDir('issue3-'))
    // The same message arriving through history recovery and again through the live event shape is one trigger.
    feishuHistoryServer(h, { items: [feishuMessage('om_both', 'oc_team', T0)] })
    await backfillChat(h, 'oc_team', false, iso(T0 - 1000), iso(T0 + 60_000), new AbortController().signal)
    const live = feishuTrigger({ message_id: 'om_both', chat_id: 'oc_team', chat_type: 'group', sender_id: 'ou_bob',
      sender_type: 'user', content: 'hi', create_time: String(T0), mentions: [] }, 'ou_bot', 'cli_bot')!
    const again = await h.receive(live)
    expect(again).toBe('duplicate')
    expect(h.store.triggers.get(feishuTriggerId('om_both'))).toBeDefined()
    closeHost(h)
  })
})
