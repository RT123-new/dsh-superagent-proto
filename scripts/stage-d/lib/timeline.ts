/** Trace replay, not production concurrency. Service times are synthetic; phases are barriers. */
export interface RequestRecord {
  seq: number; label: string; conversation: string; serviceMs: number
  startedMs: number; endedMs: number; failed: boolean; phase: string
}
export interface PoolOptions { concurrency: number; ratePerSecond?: number }
export function simulatePool(trace: RequestRecord[], options: PoolOptions): { records: RequestRecord[]; completionMs: number } {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error('invalid concurrency')
  const rate = options.ratePerSecond
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) throw new Error('invalid rate')
  if (rate === 0 && trace.length) return { records: [], completionMs: Infinity }
  const pending = [...trace]
  const workers = Array<number>(options.concurrency).fill(0)
  const conversationEnd = new Map<string, number>()
  const records: RequestRecord[] = []
  let nextDispatch = 0
  while (pending.length) {
    const worker = workers.indexOf(Math.min(...workers))
    // Only each conversation's first remaining request may run. FIFO breaks equal-ready-time ties.
    const seen = new Set<string>()
    let chosen = 0, earliest = Infinity
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!
      if (seen.has(item.conversation)) continue
      seen.add(item.conversation)
      const start = Math.max(workers[worker]!, conversationEnd.get(item.conversation) ?? 0, nextDispatch)
      if (start < earliest) { earliest = start; chosen = i }
    }
    const [item] = pending.splice(chosen, 1)
    const end = earliest + item!.serviceMs
    records.push({ ...item!, startedMs: earliest, endedMs: end })
    workers[worker] = end
    conversationEnd.set(item!.conversation, end)
    if (rate !== undefined) nextDispatch = earliest + 1000 / rate
  }
  return { records, completionMs: Math.max(0, ...records.map(r => r.endedMs)) }
}
