// Offline observation overlay for the real-host spike: records permission-preset grants and agent creation, and answers model requests with a stream that never completes (no network, no paid call).
import { appendFileSync } from 'node:fs'
const log = (...a) => appendFileSync('/tmp/overlay/events.log', `${new Date().toISOString()} ${a.join(' ')}\n`)
export const name = 'review-overlay'
export const inject = ['permissionPresets', 'agents']
export function apply(ctx) {
  const presets = ctx.permissionPresets
  const set = presets.set.bind(presets)
  presets.set = (session, preset, ...rest) => { log('permissionPresets.set', session?.id ?? '?', preset); return set(session, preset, ...rest) }
  ctx.on('llm/stream', async function* () { log('llm/stream requested'); await new Promise(() => {}) })
  log('overlay active')
}
