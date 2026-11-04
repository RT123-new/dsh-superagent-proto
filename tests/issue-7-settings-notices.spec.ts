/**
 * Issue 7 (mandate Part 2): configuration-change notifications are versioned by block revision
 * (`settings:<block>:<revision>` identity). Every committed revision's notice must reach the main Session exactly
 * once - a newer revision is never suppressed because its payload resembles an older one (A→B→A→B), and redelivery
 * of the same revision stays idempotent.
 */
import { afterEach, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

/** JSON payloads of the `settings:eval` notices injected into the main Session so far. */
const notices = () => {
  const master = h!.agents.get(h!.runtime.masterId)!
  return (master.inject as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => {
    try { return JSON.parse((message as UserMessage).content.map(block => block.type === 'text' ? block.text : '').join('')) as Record<string, unknown> }
    catch { return undefined }
  }).filter((payload): payload is Record<string, unknown> => payload?.settings_saved === 'eval')
}

const saveEval = async (timeoutSeconds: number) => {
  const { settings } = h!.runtime
  const { revision, value } = settings.block('eval')
  const result = await settings.save('eval', { ...(value as Record<string, unknown>), timeoutSeconds }, revision, 'panel')
  expect(result.restarting).toBe(false)
  return result
}

it('delivers every committed eval revision to the main Session through A→B→A→B', async () => {
  h = await startRuntime()
  await saveEval(60) // A (revision 1)
  await saveEval(90) // B (revision 2)
  await saveEval(60) // A again (revision 3): same payload as revision 1, which must not suppress it
  await saveEval(90) // B again (revision 4)
  expect(notices().map(payload => payload.revision)).toEqual([1, 2, 3, 4])
})

it('delivers a redelivered revision only once', async () => {
  h = await startRuntime()
  const notice = { settings_saved: 'eval', revision: 41, changed: ['eval.timeoutSeconds'], read: 'settings/eval' }
  h.runtime.sessions.notify('settings:eval', notice, 'Settings saved: eval')
  await h.runtime.idle()
  h.runtime.sessions.notify('settings:eval', notice, 'Settings saved: eval')
  await h.runtime.idle()
  expect(notices().filter(payload => payload.revision === 41)).toHaveLength(1)
})
