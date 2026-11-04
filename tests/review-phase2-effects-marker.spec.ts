/** Final review phase 2.4: attempt marker across every attempt, failure, crash, coalescing and old-row sequence. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ATTEMPT_STARTED, ATTEMPT_UNKNOWN, Effects } from '../src/app/effects.ts'
import { Later } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'

describe('effect attempt marker sequences', () => {
  const dirs: string[] = []
  const stores: Store[] = []
  afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
  let clock = 1_000_000
  const open = (path?: string) => {
    const dir = path ? undefined : mkdtempSync(join(tmpdir(), 'effects-')); if (dir) dirs.push(dir)
    const file = path ?? join(dir!, 'o.sqlite')
    const store = new Store(file, () => {}); stores.push(store)
    const effects = new Effects(store, new HealthBoard(), () => clock)
    return { file, store, effects }
  }
  const row = (store: Store) => store.db.prepare("SELECT attempts, error FROM effect WHERE key = 'k'").get() as { attempts: number; error: string } | undefined
  type Step = 'ok' | 'fail' | 'later' | 'hang'
  const drive = (effects: Effects, steps: Step[], hung: (() => void)[] = []) => {
    effects.handle('reply', async () => {
      const step = steps.shift() ?? 'ok'
      if (step === 'fail') throw new Error('provider 503')
      if (step === 'later') throw new Later('source off')
      if (step === 'hang') await new Promise<void>(resolve => hung.push(resolve))
    }, { markAttempt: true, retry: [10, 10] })
  }
  const advance = async (effects: Effects) => { clock += 10_000_000; effects.kick(); await new Promise(resolve => setTimeout(resolve, 30)) }

  it('a retry after a failure is marked too, and a crash in it keeps the failure text and becomes unknown', async () => {
    const first = open(); drive(first.effects, ['fail', 'hang'])
    first.store.atomic(() => first.effects.enqueue('reply', 'k', {})); first.effects.start(); await first.effects.idle('reply')
    expect(row(first.store)?.attempts).toBe(1)
    expect(row(first.store)?.error).toContain('503')
    expect(row(first.store)?.error).not.toContain(ATTEMPT_STARTED)
    await advance(first.effects)                                  // the second attempt is now in flight (hung)
    expect(row(first.store)?.error).toContain('503'); expect(row(first.store)?.error).toContain(ATTEMPT_STARTED)
    const restarted = open(first.file); restarted.effects.start()    // crash recovery on the same database file
    expect(restarted.effects.attemptUnknown('reply', 'k')).toBe(true)
    expect(row(restarted.store)?.error).toContain('503'); expect(row(restarted.store)?.error).toContain(ATTEMPT_UNKNOWN)
    expect(restarted.effects.blocked('reply').map(item => item.key)).toEqual(['k'])
  })

  it('unknown is sticky across later failures and repeated crashes, and appears exactly once; success clears the row', async () => {
    const a = open(); drive(a.effects, ['hang'])
    a.store.atomic(() => a.effects.enqueue('reply', 'k', {})); a.effects.start(); await new Promise(resolve => setTimeout(resolve, 30))
    const b = open(a.file); b.effects.start()
    expect(b.effects.attemptUnknown('reply', 'k')).toBe(true)
    drive(b.effects, ['fail'])
    await advance(b.effects)
    expect(row(b.store)?.error).toContain('blocked:unknown_outcome') // no replay without operator consent
    expect(b.effects.rearm('reply', 'k')).toBe(true)
    await advance(b.effects)                                        // explicit rearm permits a retry
    expect(row(b.store)?.error).toContain('503')
    expect((row(b.store)?.error.match(/\[attempt-unknown\]/g) ?? []).length).toBe(1)   // still unknown: the earlier attempt's outcome is not known
    expect(row(b.store)?.error).not.toContain(ATTEMPT_STARTED)
    const hung: (() => void)[] = []
    const c = open(a.file); drive(c.effects, ['hang'], hung); c.effects.start()
    expect(c.effects.blocked('reply')).toHaveLength(1)
    expect(c.effects.rearm('reply', 'k')).toBe(true)
    await advance(c.effects)
    const d = open(a.file); d.effects.start()                        // second crash during another attempt
    expect((row(d.store)?.error.match(/\[attempt-unknown\]/g) ?? []).length).toBe(1)
    expect(row(d.store)?.error).not.toContain(ATTEMPT_STARTED)
    drive(d.effects, ['ok']); await advance(d.effects)
    expect(row(d.store)?.error).toContain('blocked:unknown_outcome')
    expect(d.effects.rearm('reply', 'k')).toBe(true)
    await advance(d.effects)
    expect(row(d.store)).toBeUndefined()                             // a recorded success clears it
  })

  it('a Later outcome (nothing sent) drops the in-flight marker and keeps a prior unknown one', async () => {
    const a = open(); drive(a.effects, ['later', 'ok'])
    a.store.atomic(() => a.effects.enqueue('reply', 'k', {})); a.effects.start(); await a.effects.idle('reply')
    expect(row(a.store)?.error).toBe('')
    expect(a.effects.attemptUnknown('reply', 'k')).toBe(false)
  })

  it('re-enqueue while an attempt is in flight (new generation) is not clobbered by the old attempt settling', async () => {
    const a = open(); const hung: (() => void)[] = []; drive(a.effects, ['hang', 'ok'], hung)
    a.store.atomic(() => a.effects.enqueue('reply', 'k', { v: 1 } as never)); a.effects.start(); await new Promise(resolve => setTimeout(resolve, 30))
    a.store.atomic(() => a.effects.enqueue('reply', 'k', { v: 2 } as never))   // coalesces: new generation, error reset
    expect(row(a.store)).toEqual({ attempts: 0, error: '' })
    hung[0]!(); await new Promise(resolve => setTimeout(resolve, 30))
    expect(row(a.store)?.error ?? '').not.toContain(ATTEMPT_UNKNOWN)
  })

  it('an old row from before markers (failed once, plain text) is not misread as unknown and still completes', async () => {
    const a = open()
    a.store.db.prepare("INSERT INTO effect (kind, key, value, seq, due, since, attempts, error) VALUES ('reply','k','{}',1,0,'x',2,'old failure')").run()
    drive(a.effects, ['ok']); a.effects.start(); await a.effects.idle('reply')
    expect(row(a.store)).toBeUndefined()
    expect(a.effects.attemptUnknown('reply', 'k')).toBe(false)
  })

  it.each([ATTEMPT_STARTED, ATTEMPT_UNKNOWN])('restart parks a %s reply; dispatch is impossible until explicit rearm', async marker => {
    const a = open()
    a.store.db.prepare("INSERT INTO effect (kind, key, value, seq, due, since, attempts, error) VALUES ('reply','k','{}',1,0,?,0,?)")
      .run(new Date(clock).toISOString(), marker)
    const sent: string[] = []
    a.effects.handle('reply', async () => { sent.push('sent') }, { markAttempt: true })
    a.effects.start()
    await advance(a.effects)
    expect(sent).toEqual([])
    expect(a.effects.blocked('reply').map(item => item.key)).toEqual(['k'])
    expect(a.effects.attemptUnknown('reply', 'k')).toBe(true)
    expect(a.effects.rearm('reply', 'k')).toBe(true)
    await a.effects.idle('reply')
    expect(sent).toEqual(['sent'])
    expect(row(a.store)).toBeUndefined()
  })

  it('remote failure text containing marker strings cannot spoof unknown or suppress the started marker', async () => {
    const a = open(); const hung: (() => void)[] = []
    let n = 0
    a.effects.handle('reply', async () => {
      n++
      if (n === 1) throw new Error('x [attempt-unknown] y [attempt-started]')
      await new Promise<void>(resolve => hung.push(resolve))
    }, { markAttempt: true, retry: [10, 10] })
    a.store.atomic(() => a.effects.enqueue('reply', 'k', {})); a.effects.start(); await a.effects.idle('reply')
    expect(a.effects.attemptUnknown('reply', 'k')).toBe(false)           // text alone is not a recorded unknown outcome
    await advance(a.effects)                                              // attempt 2 in flight
    expect(row(a.store)?.error.endsWith(ATTEMPT_STARTED)).toBe(true)      // started marker still written
    const b = open(a.file); b.effects.start()
    expect(b.effects.attemptUnknown('reply', 'k')).toBe(true)             // now genuinely unknown (crash in flight)
  })
})
