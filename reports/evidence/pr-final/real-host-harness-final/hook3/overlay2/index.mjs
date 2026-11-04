// Offline overlay 2: logs preset grants; answers llm/stream with a scripted tool call to orchestrator_report once /tmp/overlay2/release exists (no network, no paid call).
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
const log = (...a) => appendFileSync('/tmp/overlay2/events.log', `${new Date().toISOString()} pid=${process.pid} ${a.join(' ')}\n`)
export const name = 'review-overlay2'
export const inject = ['permissionPresets', 'agents', 'sessionController']
export function apply(ctx) {
  const presets = ctx.permissionPresets
  const set = presets.set.bind(presets)
  presets.set = (session, preset, ...rest) => { log('permissionPresets.set', session?.id ?? '?', preset); return set(session, preset, ...rest) }
  const sc = ctx.sessionController
  const create = sc.create.bind(sc)
  sc.create = async (...a) => {
    const id = a[0]?.sessionId ?? '?'
    log('sessionController.create begin', id)
    const result = await create(...a)
    log('sessionController.create returned', id)
    if (id.startsWith('worker-') && existsSync('/tmp/overlay2/hang-after-create')) { log('hanging after create (kill point)', id); await new Promise(() => {}) }
    return result
  }
  let n = 0
  ctx.on('llm/stream', async function* (options) {
    const call = ++n
    log('llm/stream requested #' + call, 'signalAborted=' + String(options?.signal?.aborted))
    while (!existsSync('/tmp/overlay2/release')) await new Promise(r => setTimeout(r, 100))
    log('release seen', 'signalAborted=' + String(options?.signal?.aborted))
    if (call > 1) return await new Promise(() => {})
    const id = 'call_review_1'
    const raw = readFileSync('/tmp/overlay2/release', 'utf8').trim(); let parsed; try { parsed = JSON.parse(raw) } catch {}
    const args = JSON.stringify(parsed ?? { state: 'progress', summary: raw || 'late-hook probe' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'orchestrator_report', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'orchestrator_report', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    log('tool-call chunks emitted', 'signalAborted=' + String(options?.signal?.aborted))
  })
  log('overlay2 active')
}
