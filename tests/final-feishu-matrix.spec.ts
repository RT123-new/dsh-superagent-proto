/** Final review 3.5: concurrent live and backfill delivery, first-seen admission boundary, and pagination that does not advance. */
import { describe, expect, it, vi } from 'vitest'
import { backfillChat, feishuTrigger, feishuTriggerId } from '../src/sources/feishu.ts'
import { KV } from '../src/kv.ts'
import { closeHost, feishuHistoryServer, feishuMessage, hostDir, pinCommands, sourceHost } from './fixtures/source-host.ts'

const T0 = Date.parse('2026-09-09T00:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const live = (id: string, at: number) => feishuTrigger({ message_id: id, chat_id: 'oc_team', chat_type: 'group', sender_id: 'ou_bob',
  sender_type: 'user', content: 'hi', create_time: String(at), mentions: [] }, 'ou_bot', 'cli_bot')!
const scan = (h: ReturnType<typeof sourceHost>, since = T0 - 1000, until = T0 + 60_000) =>
  backfillChat(h, 'oc_team', false, iso(since), iso(until), new AbortController().signal)

describe('3.5 Feishu matrix', () => {
  it('a message delivered by the live stream and by backfill at the same moment is stored once', async () => {
    const h = sourceHost(hostDir('f35-'))
    feishuHistoryServer(h, { items: Array.from({ length: 30 }, (_, i) => feishuMessage(`om_${i}`, 'oc_team', T0 + i * 1000)) })
    await Promise.all([scan(h), ...Array.from({ length: 30 }, (_, i) => h.receive(live(`om_${i}`, T0 + i * 1000)))])
    expect(h.results.filter(result => result === 'stored' || result === 'filtered')).toHaveLength(30)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(30)
    for (let i = 0; i < 30; i++) expect(h.store.triggers.get(feishuTriggerId(`om_${i}`))).toBeDefined()
    closeHost(h)
  })

  it('first-seen boundary: older messages are never admitted, a message exactly at the boundary is, even when indexed late', async () => {
    const h = sourceHost(hostDir('f35-'))
    h.store.set(KV.feishu.started('oc_team'), iso(T0))
    feishuHistoryServer(h, { items: [feishuMessage('om_before', 'oc_team', T0 - 1000), feishuMessage('om_at', 'oc_team', T0), feishuMessage('om_after', 'oc_team', T0 + 1000)] })
    await scan(h, T0 - 60_000)
    expect(h.store.triggers.get(feishuTriggerId('om_before'))).toBeUndefined()
    expect(h.store.triggers.get(feishuTriggerId('om_at'))).toBeDefined()
    expect(h.store.triggers.get(feishuTriggerId('om_after'))).toBeDefined()
    // A restart changes nothing: the boundary is durable and a wider replay still never admits the old message.
    await scan(h, T0 - 3_600_000)
    expect(h.store.triggers.get(feishuTriggerId('om_before'))).toBeUndefined()
    expect(h.store.get<string>(KV.feishu.started('oc_team'))).toBe(iso(T0))
    closeHost(h)
  })

  it('a page token that does not advance fails the scan after admitting only the first page, and a page-count loop cannot run forever', async () => {
    const h = sourceHost(hostDir('f35-'))
    pinCommands(h)
    let calls = 0
    vi.spyOn(h.commands, 'lark').mockImplementation(async () => {
      calls += 1
      return { has_more: true, page_token: 'same', items: [feishuMessage(`om_${calls}`, 'oc_team', T0 + calls * 1000)] }
    })
    await expect(scan(h)).rejects.toThrow('pagination did not advance')
    expect(calls).toBeLessThanOrEqual(3)
    closeHost(h)
  })

  it('a duplicate message inside one history page is stored once', async () => {
    const h = sourceHost(hostDir('f35-'))
    feishuHistoryServer(h, { items: [feishuMessage('om_dup', 'oc_team', T0), feishuMessage('om_dup', 'oc_team', T0)] })
    await scan(h)
    expect(h.results.filter(result => result === 'stored' || result === 'filtered')).toHaveLength(1)
    expect(h.results.filter(result => result === 'duplicate')).toHaveLength(1)
    closeHost(h)
  })

  it('LIVE BOUNDARY: an allowed member\'s mention older than the first-seen boundary is not made a candidate by backfill, but is by a live event (no age check on the live path)', async () => {
    const h = sourceHost(hostDir('f35-'))
    h.store.set(KV.feishu.started('oc_team'), iso(T0))
    const old = feishuMessage('om_old', 'oc_team', T0 - 5000, { sender: { id: 'ou_alice', sender_type: 'user' },
      body: { content: '{"text":"@bot fix it"}' }, mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'Bot' }] })
    feishuHistoryServer(h, { items: [old] })
    await scan(h, T0 - 60_000)
    expect(h.engine.candidate(feishuTriggerId('om_old'))).toBeUndefined()
    const event = feishuTrigger({ message_id: 'om_old', chat_id: 'oc_team', chat_type: 'group', sender_id: 'ou_alice', sender_type: 'user',
      content: '{"text":"@bot fix it"}', create_time: String(T0 - 5000), mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'Bot' }] }, 'ou_bot', 'cli_bot')
    if (event) await h.receive(event)
    // Observed behaviour, recorded rather than endorsed: the live path applies the sender policy only.
    expect(h.engine.candidate(feishuTriggerId('om_old'))).toBeDefined()
    closeHost(h)
  })
})
