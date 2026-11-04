/**
 * Issue 13 — central coordinator: fast deterministic invariants for the load harness.
 * The ~95 s measurement runs live in bench/issue-13-14-coordinator-load.bench.spec.ts (`pnpm bench`);
 * evidence JSON lands in reports/evidence/.
 */
import { expect, it } from 'vitest'
import { percentile, runCoordinatorSim, type SimResult } from './fixtures/coordinator-sim.ts'

const summarize = (result: SimResult) => Object.fromEntries(Object.entries(result.kinds).map(([kind, s]) => [kind, {
  enqueued: s.enqueued, coalesced: s.coalesced, ran: s.ran, bytes: s.bytes,
  p50QueueAge: percentile(s.queueAges, 0.5), p95QueueAge: percentile(s.queueAges, 0.95), p95Latency: percentile(s.latencies, 0.95),
}]))

it('conserves effects and preserves per-ticket relay order (partitioned variant, 40 tickets)', { timeout: 60_000 }, async () => {
  const result = await runCoordinatorSim({ seed: 11, workers: 3, tickets: 40, assessments: 24, relayVariant: 'partitioned' })
  for (const [kind, s] of Object.entries(result.kinds)) {
    // Nothing lost: every row that remained ran at least once. A payload replaced while its row was running runs
    // again (Effects/upsert semantics), so runs may exceed enqueued - coalesced; they may never fall below it.
    expect(s.ran, `${kind}: no effect lost`).toBeGreaterThanOrEqual(s.enqueued - s.coalesced)
    expect(s.ran, `${kind}: no runs beyond enqueues`).toBeLessThanOrEqual(s.enqueued)
  }
  const byTicket = new Map<string, number[]>()
  for (const relay of result.relays) {
    const list = byTicket.get(relay.partition) ?? []
    list.push(relay.enqueuedAt)
    byTicket.set(relay.partition, list)
  }
  for (const list of byTicket.values()) expect([...list].sort((a, b) => a - b)).toEqual(list) // completion order == enqueue order
})

it('is deterministic for a fixed seed', { timeout: 60_000 }, async () => {
  const a = summarize(await runCoordinatorSim({ seed: 47, workers: 3, tickets: 40, assessments: 24, relayVariant: 'baseline' }))
  const b = summarize(await runCoordinatorSim({ seed: 47, workers: 3, tickets: 40, assessments: 24, relayVariant: 'baseline' }))
  expect(a).toEqual(b)
})

