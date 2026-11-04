/**
 * Paired analysis of the slot-free-wake benchmark arms: node tests/stage-d/refill-bench-analyze.mjs BASELINE.json VARIANT.json OUT.json
 * Pairs runs by (capacity, seed) and capacity-1 refill latencies by (seed, refill index); reports per-arm summaries,
 * per-pair deltas, and a percentile-bootstrap 95% CI of the mean paired delta (10,000 resamples, seeded mulberry32).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [baselinePath, variantPath, outPath] = process.argv.slice(2)
if (!baselinePath || !variantPath || !outPath) throw new Error('usage: node refill-bench-analyze.mjs BASELINE.json VARIANT.json OUT.json')
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const variant = JSON.parse(readFileSync(variantPath, 'utf8'))

const mean = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)
const median = values => percentile(values, 50)
function percentile(values, p) {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]
}
const summarize = values => values.length
  ? { n: values.length, mean: mean(values), median: median(values), p95: percentile(values, 95), min: Math.min(...values), max: Math.max(...values) }
  : { n: 0 }
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}
/** Percentile bootstrap 95% CI of the mean of paired deltas (baseline - variant; positive = variant is faster/lower). */
function paired(deltas) {
  if (!deltas.length) return { n: 0 }
  const rand = prng(0x5eed)
  const means = []
  for (let r = 0; r < 10_000; r++) {
    let sum = 0
    for (let i = 0; i < deltas.length; i++) sum += deltas[Math.floor(rand() * deltas.length)]
    means.push(sum / deltas.length)
  }
  return { n: deltas.length, meanDelta: mean(deltas), medianDelta: median(deltas),
    meanDeltaCi95: [percentile(means, 2.5), percentile(means, 97.5)] }
}

const key = run => `${run.capacity}:${run.seed}`
const baseByKey = new Map(baseline.runs.map(run => [key(run), run]))
const profiles = []
for (const v of variant.runs) {
  const b = baseByKey.get(key(v))
  if (!b) continue
  profiles.push({ capacity: v.capacity, seed: v.seed,
    makespanMs: { baseline: b.makespanMs, variant: v.makespanMs, delta: b.makespanMs - v.makespanMs },
    queueWaitMedianMs: { baseline: median(b.queueWaitsMs), variant: median(v.queueWaitsMs) },
    completionMedianMs: { baseline: median(b.completionsMs), variant: median(v.completionsMs) } })
}
const byCapacity = [...new Set(variant.runs.map(run => run.capacity))].sort((a, b) => a - b).map(capacity => {
  const rows = profiles.filter(row => row.capacity === capacity)
  return { capacity, pairs: rows.length, makespanDeltaMs: paired(rows.map(row => row.makespanMs.delta)),
    makespanMs: { baseline: summarize(rows.map(row => row.makespanMs.baseline)), variant: summarize(rows.map(row => row.makespanMs.variant)) } }
})
// Capacity-1 refill latencies pair by (seed, refill index): same seed, same workload, same refill event.
const refillDeltas = [], refillsBaseline = [], refillsVariant = []
for (const v of variant.runs.filter(run => run.capacity === 1)) {
  const b = baseByKey.get(key(v))
  if (!b) continue
  refillsBaseline.push(...b.refillsMs)
  refillsVariant.push(...v.refillsMs)
  for (let i = 0; i < Math.min(b.refillsMs.length, v.refillsMs.length); i++) refillDeltas.push(b.refillsMs[i] - v.refillsMs[i])
}
const out = {
  analysis: 'paired baseline - variant deltas of the slot-free wake bench; positive delta = variant lower',
  inputs: { baseline: baselinePath, variant: variantPath },
  grid: { baseline: baseline.grid, variant: variant.grid },
  makespanByCapacity: byCapacity,
  refillLatencyCapacity1: { baseline: summarize(refillsBaseline), variant: summarize(refillsVariant), paired: paired(refillDeltas) },
  pairs: profiles,
}
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(JSON.stringify({ makespanByCapacity: byCapacity, refillLatencyCapacity1: out.refillLatencyCapacity1 }, null, 2))
