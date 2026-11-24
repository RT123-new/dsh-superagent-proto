#!/usr/bin/env node
/**
 * Analyse recorded paired recovery trials. This does not run a model or manufacture measurements.
 * Each trial must begin from the same task and repository state in both conditions.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
export function evaluate(pairs, protocol) {
  // The caller must declare an absolute quality target before seeing outcomes.
  // Supplying this object is not proof of preregistration or independent trials.
  if (protocol !== undefined && (!protocol || typeof protocol.id !== 'string' || !protocol.id.trim()
    || typeof protocol.minCorrectRate !== 'number' || !Number.isFinite(protocol.minCorrectRate)
    || protocol.minCorrectRate <= 0 || protocol.minCorrectRate > 1))
    throw new Error('protocol requires an id and minCorrectRate in (0, 1]')
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Provide at least one paired trial')
  const ids = new Set()
  for (const [i, pair] of pairs.entries()) {
    if (!pair || typeof pair.id !== 'string' || !pair.id.trim() || ids.has(pair.id)) throw new Error(`Trial ${i} needs a unique id`)
    ids.add(pair.id)
    for (const label of ['baseline', 'snapshot']) {
      const run = pair[label]
      if (!run) throw new Error(`Missing ${label} for ${pair.id}`)
      if (run.resumeMs === null) {
        if (run.outcome !== 'never_resumed' || run.correct !== false)
          throw new Error(`${pair.id}.${label}: null resumeMs requires never_resumed and correct=false`)
      } else {
        if (run.outcome === 'never_resumed') throw new Error(`${pair.id}.${label}: never_resumed requires null resumeMs`)
        finite(run.resumeMs, `${pair.id}.${label}.resumeMs`, true)
      }
      finite(run.endToEndMs, `${pair.id}.${label}.endToEndMs`, true)
      finite(run.tokens, `${pair.id}.${label}.tokens`)
      if (typeof run.correct !== 'boolean') throw new Error(`Missing correctness verdict for ${pair.id}.${label}`)
      if (run.totalCost !== undefined) finite(run.totalCost, `${pair.id}.${label}.totalCost`)
      if (run.resumeMs !== null && run.resumeMs > run.endToEndMs) throw new Error(`${pair.id}.${label}: resumeMs exceeds endToEndMs`)
      for (const field of ['safetyFailures', 'staleErrors']) {
        if (run[field] !== undefined && (!Number.isSafeInteger(run[field]) || run[field] < 0))
          throw new Error(`${pair.id}.${label}.${field} must be a nonnegative integer`)
      }
      if (run.usedSnapshot !== undefined && typeof run.usedSnapshot !== 'boolean')
        throw new Error(`${pair.id}.${label}.usedSnapshot must be boolean`)
    }
  }
  // 'tokens' must include prompt/output/cached usage plus all snapshot-generation overhead.
  const comparable = pairs.filter(p => p.baseline.resumeMs !== null && p.snapshot.resumeMs !== null)
  const baselineNeverResumed = pairs.filter(p => p.baseline.resumeMs === null).length
  const snapshotNeverResumed = pairs.filter(p => p.snapshot.resumeMs === null).length
  const timePairs = comparable.map(p => ratio(p.baseline.resumeMs, p.snapshot.resumeMs))
  const tokenPairs = pairs.filter(p => p.baseline.tokens > 0).map(p => ratio(p.baseline.tokens, p.snapshot.tokens))
  const latency = { comparablePairs: comparable.length, baselineNeverResumed, snapshotNeverResumed,
    baselineMedianMs: median(comparable.map(p => p.baseline.resumeMs)),
    snapshotMedianMs: median(comparable.map(p => p.snapshot.resumeMs)), medianRelativeImprovement: median(timePairs),
    confidence95: timePairs.length >= 2 ? confidence(timePairs) : null,
    // A censoring window is not a completed duration. Do not report it as such.
    baselineP95Ms: baselineNeverResumed ? null : percentile(pairs.map(p => p.baseline.endToEndMs), .95),
    snapshotP95Ms: snapshotNeverResumed ? null : percentile(pairs.map(p => p.snapshot.endToEndMs), .95) }
  const token = { comparablePairs: tokenPairs.length, baselineMedian: median(pairs.map(p => p.baseline.tokens)),
    snapshotMedian: median(pairs.map(p => p.snapshot.tokens)), medianRelativeImprovement: median(tokenPairs) }
  const baselineCorrect = pairs.filter(p => p.baseline.correct).length
  const snapshotCorrect = pairs.filter(p => p.snapshot.correct).length
  const correctness = { baselineCorrect, snapshotCorrect, baselineRate: baselineCorrect / pairs.length,
    snapshotRate: snapshotCorrect / pairs.length,
    regressedPairs: pairs.filter(p => p.baseline.correct && !p.snapshot.correct).map(p => p.id) }
  // Missing telemetry is unknown, not a measured zero. A valid comparison also
  // needs an explicitly unexposed baseline; the group name alone is not evidence.
  const safetyFailures = pairs.every(p => p.snapshot.safetyFailures !== undefined)
    ? sum(pairs.map(p => p.snapshot.safetyFailures)) : null
  const failedTrials = safetyFailures === null ? null : pairs.filter(p => p.snapshot.safetyFailures > 0).length
  const staleErrors = pairs.every(p => p.snapshot.staleErrors !== undefined)
    ? sum(pairs.map(p => p.snapshot.staleErrors)) : null
  const usedSnapshots = pairs.every(p => typeof p.snapshot.usedSnapshot === 'boolean')
    ? pairs.filter(p => p.snapshot.usedSnapshot).length : null
  const baselineSnapshotUses = pairs.every(p => typeof p.baseline.usedSnapshot === 'boolean')
    ? pairs.filter(p => p.baseline.usedSnapshot).length : null
  const baselineSafetyFailures = pairs.every(p => p.baseline.safetyFailures !== undefined)
    ? sum(pairs.map(p => p.baseline.safetyFailures)) : null
  const baselineStaleErrors = pairs.every(p => p.baseline.staleErrors !== undefined)
    ? sum(pairs.map(p => p.baseline.staleErrors)) : null
  const telemetryKnown = safetyFailures !== null && staleErrors !== null && usedSnapshots !== null && baselineSnapshotUses !== null
    && baselineSafetyFailures !== null && baselineStaleErrors !== null
  const costsKnown = pairs.every(p => p.baseline.totalCost !== undefined && p.snapshot.totalCost !== undefined)
  const cost = costsKnown ? (() => {
    const baseline = sum(pairs.map(p => p.baseline.totalCost))
    const snapshot = sum(pairs.map(p => p.snapshot.totalCost))
    return { baseline, snapshot, saving: baseline - snapshot, savingFraction: baseline > 0 ? (baseline - snapshot) / baseline : null,
      baselinePerCorrect: baselineCorrect ? baseline / baselineCorrect : null,
      snapshotPerCorrect: snapshotCorrect ? snapshot / snapshotCorrect : null }
  })() : null
  const latencyOK = latency.snapshotP95Ms !== null && latency.baselineP95Ms !== null && latency.snapshotP95Ms <= latency.baselineP95Ms * 1.1
  const pass = protocol !== undefined && pairs.length >= 30 && comparable.length === pairs.length
    && tokenPairs.length === pairs.length && latency.medianRelativeImprovement >= 0.2 && latency.confidence95?.lower > 0 &&
    // A faster wrong answer is not a successful recovery; zero correct completions cannot pass.
    token.medianRelativeImprovement >= 0.2 && correctness.snapshotRate >= protocol.minCorrectRate && correctness.snapshotRate >= correctness.baselineRate &&
    correctness.regressedPairs.length === 0 && telemetryKnown && baselineSnapshotUses === 0 && usedSnapshots > 0 && safetyFailures === 0 && staleErrors === 0 && baselineSafetyFailures === 0 && baselineStaleErrors === 0 &&
    latencyOK && cost !== null && cost.saving > 0
  return { n: pairs.length, protocol: protocol ?? null, latency, token, correctness, safety: { failures: safetyFailures, failedTrials, staleErrors, baselineSafetyFailures, baselineStaleErrors,
    baselineSnapshotUses, snapshotUses: usedSnapshots, snapshotUseRate: usedSnapshots === null ? null : usedSnapshots / pairs.length,
    failureRate: failedTrials === null ? null : failedTrials / pairs.length,
    eventsPerTrial: safetyFailures === null ? null : safetyFailures / pairs.length,
    staleErrorRate: usedSnapshots && staleErrors !== null ? staleErrors / usedSnapshots : null },
    cost, verdict: pass ? 'meets_declared_targets' : protocol === undefined ? 'inconclusive_missing_protocol'
      : pairs.length < 30 || cost === null ? 'inconclusive_missing_trials_or_cost'
      : !telemetryKnown ? 'inconclusive_missing_safety_or_usage' : 'targets_not_met' }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/resume-benchmark.mjs paired-trials.json')
    const body = JSON.parse(readFileSync(process.argv[2], 'utf8'))
    process.stdout.write(JSON.stringify(evaluate(body.pairs, body.protocol), null, 2) + '\n')
  } catch (error) { process.stderr.write(String(error) + '\n'); process.exitCode = 1 }
}
