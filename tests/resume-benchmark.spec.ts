import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtureProtocol = { id: 'synthetic-regression-only', minCorrectRate: .9 }
function run(pairs: unknown, protocol: unknown = fixtureProtocol) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-benchmark-'))
  try {
    const input = join(dir, 'pairs.json')
    writeFileSync(input, JSON.stringify({ pairs, ...(protocol === null ? {} : { protocol }) }))
    const result = spawnSync(process.execPath, [resolve('scripts/resume-benchmark.mjs'), input], { encoding: 'utf8' })
    return { ...result, value: result.status === 0 ? JSON.parse(result.stdout) : undefined }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const pair = (i: number) => ({ id: `task-${i}`,
  baseline: { resumeMs: 1000, endToEndMs: 6000, tokens: 1000, correct: true, totalCost: 1, usedSnapshot: false, safetyFailures: 0, staleErrors: 0 },
  snapshot: { resumeMs: 600, endToEndMs: 5900, tokens: 700, correct: true, totalCost: .75,
    safetyFailures: 0, staleErrors: 0, usedSnapshot: true },
})
describe('resume benchmark calculation', () => {
  it('computes the paired percent improvement, p95, bootstrap and cost reproducibly', () => {
    const a = run(Array.from({ length: 30 }, (_, i) => pair(i)))
    expect(a.status).toBe(0)
    expect(a.value).toMatchObject({ n: 30, verdict: 'meets_declared_targets',
      latency: { medianRelativeImprovement: .4, snapshotMedianMs: 600, snapshotP95Ms: 5900,
        confidence95: { lower: .4, upper: .4 } },
      token: { medianRelativeImprovement: .3 }, safety: { failureRate: 0, staleErrorRate: 0 },
      cost: { baseline: 30, snapshot: 22.5, saving: 7.5, savingFraction: .25 } })
    expect(run(Array.from({ length: 30 }, (_, i) => pair(i))).stdout).toBe(a.stdout)
  })
  it('does not claim success from a small sample or unknown costs', () => {
    expect(run([pair(1)]).value?.verdict).toBe('inconclusive_missing_trials_or_cost')
    const records = Array.from({ length: 30 }, (_, i) => pair(i))
    delete (records[0]!.snapshot as { totalCost?: number }).totalCost
    expect(run(records).value?.cost).toBe(null)
  })
  it('does not treat missing safety or snapshot-use observations as measured zero', () => {
    const records = Array.from({ length: 30 }, (_, i) => pair(i))
    delete (records[0]!.snapshot as { safetyFailures?: number }).safetyFailures
    expect(run(records).value).toMatchObject({ verdict: 'inconclusive_missing_safety_or_usage',
      safety: { failures: null, failureRate: null } })
    const unused = Array.from({ length: 30 }, (_, i) => ({ ...pair(i), snapshot: { ...pair(i).snapshot, usedSnapshot: false } }))
    expect(run(unused).value).toMatchObject({ verdict: 'targets_not_met', safety: { snapshotUses: 0, staleErrorRate: null } })
    delete (unused[0]!.snapshot as { usedSnapshot?: boolean }).usedSnapshot
    expect(run(unused).value).toMatchObject({ verdict: 'inconclusive_missing_safety_or_usage', safety: { snapshotUses: null } })
  })
  it('cannot validate a snapshot comparison when the baseline used snapshots or its usage is unknown', () => {
    const records = Array.from({ length: 30 }, (_, i) => pair(i))
    records[0]!.baseline.usedSnapshot = true
    expect(run(records).value).toMatchObject({ verdict: 'targets_not_met', safety: { baselineSnapshotUses: 1 } })
    delete (records[0]!.baseline as { usedSnapshot?: boolean }).usedSnapshot
    expect(run(records).value).toMatchObject({ verdict: 'inconclusive_missing_safety_or_usage',
      safety: { baselineSnapshotUses: null } })
  })
  it('distinguishes the fraction of affected trials from the number of safety events', () => {
    const records = Array.from({ length: 30 }, (_, i) => pair(i))
    records[0]!.snapshot.safetyFailures = 60
    expect(run(records).value).toMatchObject({ verdict: 'targets_not_met', safety: {
      failures: 60, failedTrials: 1, failureRate: 1 / 30, eventsPerTrial: 2,
    } })
    delete (records[1]!.snapshot as { safetyFailures?: number }).safetyFailures
    expect(run(records).value).toMatchObject({ safety: { failures: null, failedTrials: null, failureRate: null, eventsPerTrial: null } })
  })
  it('rejects impossible duration order, fractional failure counts and malformed usage flags', () => {
    const original = pair(1)
    for (const snapshot of [{ ...original.snapshot, resumeMs: 9000 },
      { ...original.snapshot, safetyFailures: .25 }, { ...original.snapshot, usedSnapshot: 'yes' }]) {
      expect(run([{ ...original, snapshot }]).status).not.toBe(0)
    }
  })
  it('cannot pass a cohort of entirely incorrect recoveries even if faster and cheaper', () => {
    const wrong = Array.from({ length: 30 }, (_, i) => ({ ...pair(i),
      baseline: { ...pair(i).baseline, correct: false }, snapshot: { ...pair(i).snapshot, correct: false } }))
    expect(run(wrong).value).toMatchObject({ verdict: 'targets_not_met',
      correctness: { baselineCorrect: 0, snapshotCorrect: 0 },
      cost: { baselinePerCorrect: null, snapshotPerCorrect: null } })
    expect(run(Array.from({ length: 30 }, (_, i) => pair(i))).value?.cost)
      .toMatchObject({ baselinePerCorrect: 1, snapshotPerCorrect: .75 })
  })
  it('rejects malformed or duplicate trial records', () => {
    const duplicate = run([pair(1), pair(1)])
    expect(duplicate.status).not.toBe(0)
    expect(duplicate.stderr).toContain('unique id')
    expect(run([{ id: 'bad', baseline: {}, snapshot: {} }]).status).not.toBe(0)
  })
})

it('requires an explicit declared absolute quality floor and rejects a weak cohort', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair(i))
  expect(run(pairs, null).value?.verdict).toBe('inconclusive_missing_protocol')
  for (const p of pairs.slice(1)) { p.baseline.correct = false; p.snapshot.correct = false }
  expect(run(pairs).value).toMatchObject({ verdict: 'targets_not_met', correctness: { snapshotRate: 1 / 30 } })
  expect(run(pairs, { id: 'bad', minCorrectRate: 0 }).status).not.toBe(0)
})

it('retains a never-resumed trial in quality, cost and safety without inventing a resume duration', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair(i))
  const failed = { ...pairs[0]!, snapshot: { ...pairs[0]!.snapshot,
    outcome: 'never_resumed', resumeMs: null, endToEndMs: 60_000, tokens: 0, correct: false, totalCost: 0 } }
  expect(run([failed, ...pairs.slice(1)]).value).toMatchObject({
    n: 30, verdict: 'targets_not_met', latency: { comparablePairs: 29, snapshotNeverResumed: 1, snapshotP95Ms: null },
    correctness: { snapshotCorrect: 29, baselineCorrect: 30 }, cost: { snapshot: 21.75 }
  })
  expect(run([{ ...failed, snapshot: { ...failed.snapshot, correct: true } }]).status).not.toBe(0)
})

it('does not validate the comparison when baseline safety telemetry is unknown', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair(i))
  delete (pairs[0]!.baseline as { safetyFailures?: number }).safetyFailures
  expect(run(pairs).value).toMatchObject({ verdict: 'inconclusive_missing_safety_or_usage', safety: { baselineSafetyFailures: null } })
})
