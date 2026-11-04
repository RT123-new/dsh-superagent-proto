#!/usr/bin/env node
/**
 * Analyse recorded paired recovery trials. This does not run a model or manufacture measurements.
 * Each trial must begin from the same task and repository state in both conditions.
 */
import { readFileSync } from 'node:fs'

const median = values => {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}
const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]
const sum = values => values.reduce((n, x) => n + x, 0)
const ratio = (a, b) => (a - b) / a
function confidence(values, rounds = 10_000, seed = 20261104) {
  let state = seed >>> 0
  const next = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
  const scores = []
  for (let j = 0; j < rounds; j++) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)])
    scores.push(median(sample))
  }
  return { lower: percentile(scores, 0.025), upper: percentile(scores, 0.975) }
}
const finite = (value, name, positive = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0))
    throw new Error(`${name} must be a ${positive ? 'positive' : 'nonnegative'} finite number`)
  return value
}
export function evaluate(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Provide at least one paired trial')
  const ids = new Set()
  for (const [i, pair] of pairs.entries()) {
    if (!pair || typeof pair.id !== 'string' || !pair.id.trim() || ids.has(pair.id)) throw new Error(`Trial ${i} needs a unique id`)
    ids.add(pair.id)
    for (const label of ['baseline', 'snapshot']) {
      const run = pair[label]
      if (!run) throw new Error(`Missing ${label} for ${pair.id}`)
      finite(run.resumeMs, `${pair.id}.${label}.resumeMs`, true)
      finite(run.endToEndMs, `${pair.id}.${label}.endToEndMs`, true)
      finite(run.tokens, `${pair.id}.${label}.tokens`, true)
      if (typeof run.correct !== 'boolean') throw new Error(`Missing correctness verdict for ${pair.id}.${label}`)
      if (run.totalCost !== undefined) finite(run.totalCost, `${pair.id}.${label}.totalCost`)
      if (run.safetyFailures !== undefined) finite(run.safetyFailures, `${pair.id}.${label}.safetyFailures`)
      if (run.staleErrors !== undefined) finite(run.staleErrors, `${pair.id}.${label}.staleErrors`)
    }
  }
  // 'tokens' must include prompt/output/cached usage plus all snapshot-generation overhead.
  const timePairs = pairs.map(p => ratio(p.baseline.resumeMs, p.snapshot.resumeMs))
  const tokenPairs = pairs.map(p => ratio(p.baseline.tokens, p.snapshot.tokens))
  const latency = { baselineMedianMs: median(pairs.map(p => p.baseline.resumeMs)),
    snapshotMedianMs: median(pairs.map(p => p.snapshot.resumeMs)), medianRelativeImprovement: median(timePairs),
    confidence95: confidence(timePairs), baselineP95Ms: percentile(pairs.map(p => p.baseline.endToEndMs), .95),
    snapshotP95Ms: percentile(pairs.map(p => p.snapshot.endToEndMs), .95) }
  const token = { baselineMedian: median(pairs.map(p => p.baseline.tokens)),
    snapshotMedian: median(pairs.map(p => p.snapshot.tokens)), medianRelativeImprovement: median(tokenPairs) }
  const correctness = { baselineRate: sum(pairs.map(p => Number(p.baseline.correct))) / pairs.length,
    snapshotRate: sum(pairs.map(p => Number(p.snapshot.correct))) / pairs.length,
    regressedPairs: pairs.filter(p => p.baseline.correct && !p.snapshot.correct).map(p => p.id) }
  const safetyFailures = sum(pairs.map(p => p.snapshot.safetyFailures ?? 0))
  const staleErrors = sum(pairs.map(p => p.snapshot.staleErrors ?? 0))
  const usedSnapshots = pairs.filter(p => p.snapshot.usedSnapshot === true).length
  const costsKnown = pairs.every(p => p.baseline.totalCost !== undefined && p.snapshot.totalCost !== undefined)
  const cost = costsKnown ? (() => {
    const baseline = sum(pairs.map(p => p.baseline.totalCost))
    const snapshot = sum(pairs.map(p => p.snapshot.totalCost))
    return { baseline, snapshot, saving: baseline - snapshot, savingFraction: baseline > 0 ? (baseline - snapshot) / baseline : null }
  })() : null
  const latencyOK = latency.snapshotP95Ms <= latency.baselineP95Ms * 1.1
  const pass = pairs.length >= 30 && latency.medianRelativeImprovement >= 0.2 && latency.confidence95.lower > 0 &&
    token.medianRelativeImprovement >= 0.2 && correctness.snapshotRate >= correctness.baselineRate &&
    correctness.regressedPairs.length === 0 && safetyFailures === 0 && staleErrors === 0 &&
    latencyOK && cost !== null && cost.saving > 0
  return { n: pairs.length, latency, token, correctness, safety: { failures: safetyFailures, staleErrors,
    snapshotUses: usedSnapshots, failureRate: safetyFailures / pairs.length,
    staleErrorRate: usedSnapshots ? staleErrors / usedSnapshots : null },
    cost, verdict: pass ? 'meets_preregistered_targets' : pairs.length < 30 || cost === null
      ? 'inconclusive_missing_trials_or_cost' : 'targets_not_met' }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/resume-benchmark.mjs paired-trials.json')
    const body = JSON.parse(readFileSync(process.argv[2], 'utf8'))
    process.stdout.write(JSON.stringify(evaluate(body.pairs), null, 2) + '\n')
  } catch (error) { process.stderr.write(String(error) + '\n'); process.exitCode = 1 }
}
