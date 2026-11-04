import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
const require = createRequire(import.meta.url)
const transportPath = createRequire(require.resolve('@deepseek-ai/dsh-llm-deepseek-api-key')).resolve('@deepseek-ai/dsh-llm-deepseek')
const { DeepSeekAdapter, resolveAdapterOptions } = await import(transportPath)
export const INPUT_BYTES = 16384, MAX_OUTPUT = 1024
// 1M context documented. Reserve 2M uncached input to avoid interpreting M as decimal/binary.
export const RESERVATION = 2_000_000 * 0.30 / 1_000_000 + MAX_OUTPUT * 1.20 / 1_000_000
export const pricing = { url: 'https://api-docs.deepseek.com/quick_start/pricing.md', verified: '2026-11-04', inputMiss: .30, inputHit: .006, output: 1.20, unit: 1_000_000, currency: 'USD' }
export function usageCost(u) {
  for (const k of ['inputTokens', 'outputTokens']) if (!Number.isSafeInteger(u?.[k]) || u[k] < 0) throw Error('Missing or invalid billing category')
  if (u.cacheWriteTokens) throw Error('Unknown cache-write billing; stop')
  if (u.cacheReadTokens !== undefined && (!Number.isSafeInteger(u.cacheReadTokens) || u.cacheReadTokens < 0)) throw Error('Invalid cached-input billing')
  if (u.inputTokens + (u.cacheReadTokens ?? 0) > 2_000_000 || u.outputTokens > MAX_OUTPUT) throw Error('Provider exceeded reserved bounds')
  return (u.inputTokens * pricing.inputMiss + (u.cacheReadTokens ?? 0) * pricing.inputHit + u.outputTokens * pricing.output) / pricing.unit
}
export class Budget {
  constructor(path, limit = 1) { this.path = path; this.state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { limit, charged: 0, pending: null, calls: [] }; if (this.state.limit !== limit) throw Error('Budget limit mismatch') }
  reserve(id) {
    if (this.state.pending || this.state.stopped) throw Error('Unknown or pending billing; stopped')
    if (this.state.charged + RESERVATION > this.state.limit) throw Error('Insufficient pessimistic budget headroom')
    this.state.pending = {id, maximum: RESERVATION}; this.persist()
  }
  persist() { mkdirSync(dirname(this.path), {recursive:true}); writeFileSync(this.path + '.tmp', JSON.stringify(this.state, null, 2)); rename(this.path + '.tmp', this.path) }
  settle(usage) { const cost = usageCost(usage); this.state.calls.push({...this.state.pending, usage, cost}); this.state.charged += cost; this.state.pending = null; this.persist(); return cost }
  stop() { this.state.stopped = true; this.persist() }
}
import { renameSync as rename } from 'node:fs'
export function adapter(baseURL, key) {
  return new DeepSeekAdapter({ options: () => resolveAdapterOptions({baseURL, thinking:'disabled', maxTokens:MAX_OUTPUT, models:[{id:'deepseek-flash'}]}), resolveAuth: async () => ({headers:{'x-api-key': key}}), resolveUserId: () => 'synthetic-validation', prepareExtensions: async () => ({fields:{}, accept: async()=>{}}) })
}
export async function modelCall({id, prompt, live, budget, evidenceDir, offlineAnswer}) {
  if (Buffer.byteLength(prompt) > INPUT_BYTES) throw Error('Input byte cap')
  if (!live) return {text:JSON.stringify(offlineAnswer), usage:null, latencyMs:0, offline:true}
  if (process.env.PAIRED_ALLOCATION !== 'approved-1-usd' || !process.env.PAIRED_REVIEWED_TAG) throw Error('No reviewed tag/allocation')
  budget.reserve(id)
  const start = performance.now(), chunks = []
  try {
    const key = readFileSync(process.env.DEEPSEEK_KEY_FILE, 'utf8').trim()
    const provider = adapter('https://api.deepseek.com/anthropic', key)
    const options = {provider:'deepseek-official',model:'deepseek-flash',maxTokens:MAX_OUTPUT,signal:AbortSignal.timeout(60_000),messages:[{role:'user',content:[{type:'text',text:prompt}]}]}
    for await (const chunk of provider.stream(options)) chunks.push(chunk)
    const terminal = chunks.findLast(c=>c.type==='finish'), usage = chunks.findLast(c=>c.type==='usage')?.usage
    const text = chunks.filter(c=>c.type==='text-delta').map(c=>c.text ?? c.delta ?? '').join('')
    const record = {id, prompt, chunks, text, latencyMs:performance.now()-start, usage, baselineTag:process.env.PAIRED_BASELINE_TAG, repairedTag:process.env.PAIRED_REVIEWED_TAG, pricing}
    mkdirSync(evidenceDir,{recursive:true}); writeFileSync(resolve(evidenceDir, id+'.json'),JSON.stringify(record,null,2))
    if (terminal?.reason?.kind !== 'stop' || !usage) throw Error('Unknown/incomplete billing or failed terminal')
    record.cost = budget.settle(usage)
    writeFileSync(resolve(evidenceDir, id+'.json'),JSON.stringify(record,null,2))
    return record
  } catch (error) { budget.stop(); throw error }
}
