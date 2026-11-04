/**
 * Issue 13/14 benchmark: coordinator load profiles and the paired outage experiment (~95 s).
 * Excluded from `pnpm test`; run explicitly with `pnpm bench`. Deterministic and offline: real Store + Effects,
 * virtual time, seeded workloads, no model calls. Writes evidence JSON to reports/evidence/.
 */
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { pairedBootstrap, percentile, runCoordinatorSim, type SimResult } from '../tests/fixtures/coordinator-sim.ts'

const SEEDS = [11, 29, 47, 83, 131]

it('measures coordinator load at 1/3/6/12 workers', { timeout: 110_000 }, async () => {
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString(), base: 'reviewed/correctness-stage-b@5752c4c', seeds: SEEDS, profiles: {} }
  // Baseline load profiles: how coordinator queue age and launch slot wait scale with worker count.
  for (const workers of [1, 3, 6, 12]) {
    const runs: SimResult[] = []
    for (const seed of SEEDS) runs.push(await runCoordinatorSim({ seed, workers, relayVariant: 'baseline' }))
    const merge = (kind: string) => runs.flatMap(run => run.kinds[kind]?.queueAges ?? [])
    ;(evidence.profiles as Record<string, unknown>)[`workers-${workers}`] = {
      relayEnqueued: runs.map(run => run.kinds.relay?.enqueued ?? 0),
      noticeEnqueued: runs.map(run => run.kinds.notice?.enqueued ?? 0),
      assessmentEnqueued: runs.map(run => run.kinds.assessment?.enqueued ?? 0),
      coordinatorInteractions: runs.map(run => run.coordinatorInteractions),
      coordinatorBytes: runs.map(run => run.coordinatorBytes),
      relayQueueAge: { p50: percentile(merge('relay'), 0.5), p95: percentile(merge('relay'), 0.95) },
      noticeQueueAge: { p50: percentile(merge('notice'), 0.5), p95: percentile(merge('notice'), 0.95) },
      assessmentQueueAge: { p50: percentile(merge('assessment'), 0.5), p95: percentile(merge('assessment'), 0.95) },
      launchQueueAge: { p50: percentile(merge('launch'), 0.5), p95: percentile(merge('launch'), 0.95) },
      replyQueueAge: { p50: percentile(merge('reply'), 0.5), p95: percentile(merge('reply'), 0.95) },
      noticesCoalesced: runs.map(run => run.kinds.notice?.coalesced ?? 0),
      simDurationMs: runs.map(run => run.simDurationMs),
    }
  }
  // Enqueued coordinator interaction volume must not depend on worker count (same tickets), only on ticket volume.
  // Delivered volume can differ slightly: notice coalescing is timing-dependent (recorded per profile).
  const enqueued = [1, 3, 6, 12].map(w => (evidence.profiles as Record<string, Record<string, number[]>>)[`workers-${w}`]!)
  for (const profile of Object.values(evidence.profiles as Record<string, Record<string, number[]>>)) {
    profile.coordinatorEnqueued = profile.relayEnqueued!.map((v, i) => v + profile.noticeEnqueued![i]! + profile.assessmentEnqueued![i]!)
  }
  for (const series of enqueued.map(p => p.coordinatorEnqueued)) expect(series).toEqual(enqueued[0]!.coordinatorEnqueued)
  // Launch slot wait collapses once slots exist.
  const launch95 = (w: number) => (evidence.profiles as Record<string, { launchQueueAge: { p95: number } }>)[`workers-${w}`]!.launchQueueAge.p95
  expect(launch95(3)).toBeLessThan(launch95(1))
  expect(launch95(12)).toBeLessThan(launch95(3))
  writeFileSync('reports/evidence/issue-13-coordinator-load.json', JSON.stringify(evidence, null, 2))
})

it('paired outage experiment: baseline global ordered relay vs per-ticket partitioned relay', { timeout: 110_000 }, async () => {
  // 60s main-Session outage; identical seeded workloads; pair relays by key across variants (mandate 9.2).
  const outage = { start: 240_000, end: 300_000 }
  // A 300-relay burst across 50 conversations lands just as the outage begins: this is the HOL scenario — one backed-off
  // head per kind (baseline) vs one per conversation (candidate). Pair the burst relays by key.
  const relayBurst = { at: 241_000, count: 300, acrossTickets: 50 }
  const baselineQueueAges: number[] = []
  const candidateQueueAges: number[] = []
  const perSeed: Record<string, { baselineP95: number; candidateP95: number; relays: number }> = {}
  for (const seed of SEEDS) {
    const base = await runCoordinatorSim({ seed, workers: 6, relayVariant: 'baseline', outage, relayBurst })
    const cand = await runCoordinatorSim({ seed, workers: 6, relayVariant: 'partitioned', outage, relayBurst })
    expect(base.relays.map(r => r.key).sort()).toEqual(cand.relays.map(r => r.key).sort()) // identical workload, nothing lost
    const byKey = new Map(cand.relays.map(r => [r.key, r]))
    const seedBase: number[] = [], seedCand: number[] = []
    for (const relay of base.relays) {
      if (!relay.key.startsWith('burst:')) continue
      baselineQueueAges.push(relay.queueAge)
      candidateQueueAges.push(byKey.get(relay.key)!.queueAge)
      seedBase.push(relay.queueAge)
      seedCand.push(byKey.get(relay.key)!.queueAge)
    }
    perSeed[`seed-${seed}`] = { baselineP95: percentile(seedBase, 0.95), candidateP95: percentile(seedCand, 0.95), relays: seedBase.length }
  }
  // Deterministic stride subsample to 1000 pairs keeps the 10k-resample p95 bootstrap tractable; the point
  // estimates below use the full population.
  const stride = Math.max(1, Math.floor(baselineQueueAges.length / 1000))
  const b: number[] = [], c: number[] = []
  for (let i = 0; i < baselineQueueAges.length; i += stride) { b.push(baselineQueueAges[i]!); c.push(candidateQueueAges[i]!) }
  const boot = pairedBootstrap(b, c, xs => percentile(xs, 0.95), 7)
  const evidence = {
    generatedAt: new Date().toISOString(), base: 'reviewed/correctness-stage-b@5752c4c', seeds: SEEDS, outage, relayBurst,
    pairs: baselineQueueAges.length, bootstrapPairs: b.length, perSeed,
    baselineP95QueueAge: percentile(baselineQueueAges, 0.95),
    candidateP95QueueAge: percentile(candidateQueueAges, 0.95),
    relativeImprovement: boot.estimate, ci95: boot.ci,
  }
  writeFileSync('reports/evidence/issue-13-14-outage-experiment.json', JSON.stringify(evidence, null, 2))
  expect(boot.ci[0]).toBeGreaterThan(0) // a real gain, not noise (input to the mandate 9.3 latency decision rule)
})
