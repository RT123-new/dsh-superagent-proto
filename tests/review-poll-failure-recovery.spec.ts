import { expect, it, vi } from 'vitest'
import { pollThreads } from '../src/sources/github.ts'
import { sourceHost, hostDir, closeHost } from '../scripts/stage-d/lib/host.ts'

const N = 200, EPOCH = Date.parse('2026-11-04T00:00:00Z')
// The pool benchmark's failure-burst fixture injects HTTP 502 for every 17th issue in ONE poll round and records 189/200 stored. This proves the 11 are
// deferred, not lost: their checkpoints stay unset, and the next round (production sequential path) stores them.
it('events whose read failed in one round are stored by the next round, none lost', async () => {
  vi.useFakeTimers(); vi.setSystemTime(EPOCH)
  try {
    const h = sourceHost(hostDir('review-failure-recovery-'))
    h.store.saveSettings({ ...h.store.settings(), sources: { github: { enabled: true, config: { reconcileMinutes: 0 } } } })
    for (let number = 1; number <= N; number++) h.store.threads.save({ key: `github:${number}`, ref: { source: 'github', id: String(number) }, createdAt: new Date(EPOCH - 60_000).toISOString(), subscriptions: ['ticket'], correlated: [], pending: [], meta: { isPr: false, title: `Issue ${number}` } })
    let failing = true
    const failed = new Set<number>()
    h.commands.withSignal = () => h.commands
    h.commands.run = async (_program, args) => {
      const number = Number(/issues\/(\d+)/.exec(args[1]!)?.[1])
      if (failing && number % 17 === 0) { failed.add(number); throw new Error('HTTP502 injected') }
      return JSON.stringify([[{ id: number, body: '@agent-bot take this', user: { login: 'alice', type: 'User' }, html_url: `https://github.com/acme/widgets/issues/${number}#issuecomment-${number}`,
        created_at: new Date(EPOCH - 1000).toISOString(), updated_at: new Date(EPOCH - 1000).toISOString() }]])
    }
    const round = async () => { const controller = new AbortController(); const pending = pollThreads(h, controller.signal); await vi.runAllTimersAsync(); await pending }
    await round()
    expect([...failed]).toHaveLength(Math.floor(N / 17))
    const cursorSet = (n: number) => h.store.get(`github-cursor:${n}`) !== undefined
    expect([...failed].every(n => !cursorSet(n))).toBe(true)          // nothing marked done for a failed read
    expect(Array.from({ length: N }, (_, i) => i + 1).filter(n => !failed.has(n)).every(cursorSet)).toBe(true)
    const afterFirst = h.results.filter(r => r === 'stored').length
    expect(afterFirst).toBe(N - failed.size)
    failing = false
    vi.advanceTimersByTime(60_000)
    await round()
    expect(Array.from({ length: N }, (_, i) => i + 1).every(cursorSet)).toBe(true)
    expect(h.results.filter(r => r === 'stored').length).toBe(N)      // every eligible event stored exactly once across both rounds
    closeHost(h)
  } finally { vi.useRealTimers() }
}, 120000)
