# Issues 13–15 — Coordinator, ordered queues, retry backoff: baseline measurements and fixture candidates

Branch `review/issue-13-15-coordination`, base `reviewed/correctness-stage-b` @ 5752c4c. All work is deterministic and
offline: no model calls, no live source effects, no production file edits. Candidates live in `tests/fixtures/` only,
as evidence for the proposals below. Production changes wait for integrator clearance.

## Test / fixture inventory

- `tests/issue-13-coordinator-load.spec.ts` + `tests/fixtures/coordinator-sim.ts` — virtual-time harness: real Store +
  Effects, production handler registrations (relay/notice ordered serial; assessment limit 4; launch slot-limited;
  delivery limit 4; reply limit 1), seeded workload (mulberry32), 200 tickets + 120 assessments per profile.
- `tests/issue-14-hol-blocking.spec.ts` + `tests/fixtures/partitioned-queue.ts` — HOL fault proofs and the partition candidate.
- `tests/issue-15-retry-backoff.spec.ts` + `tests/fixtures/retry-backoff.ts` — backoff characterization, error
  classification + bounded-jitter candidate implementing the mandate formula exactly.
- Evidence: `reports/evidence/issue-13-coordinator-load.json`, `reports/evidence/issue-13-14-outage-experiment.json`.

Suite cost: the two measurement tests add ~95s; fault proofs add ~2s.

## Issue 14 — HOL blocking: fault proven, candidate measured

Fault (proven in spec, injected clock): `relay` and `notice` are `ordered: true` (sessions.ts:105–106). Effects.dispatch
considers only the single oldest row of an ordered kind, so one failing row holds every later unrelated row for its whole
backoff schedule. Measured: one failing relay delays unrelated relays by **122 s** (2+4+8+16+32+60 s backoff walk); a
failing notice blocks unrelated notices identically. Restart mid-backlog preserves rows, attempts and order (crash-safe).

Candidate: partition the ordered stream by the smallest legitimate consistency boundary (fixture: `partition(key)`).
Verified: per-partition ordering preserved, independent cross-partition progress, no duplicates, per-row backoff,
crash recovery with no loss.

Paired experiment (mandate 9.2): 60 s main-Session outage + 300-relay burst across 50 conversations, 5 seeds, 1500
pairs, 10 000-sample paired bootstrap on P95 queue age:

| variant | P95 queue age |
|---|---|
| baseline (one global ordered stream) | 426.1 s |
| candidate (per-conversation partitions) | 37.6–73.8 s |

**Relative improvement 85.6 %, CI95 [85.4 %, 85.8 %]** — far above the 15 % adoption threshold (9.3).

Proposed boundary (needs integrator design sign-off, not implemented): relay payloads already carry the ticket/request
they concern — thread that identity into the effect key at enqueue (`relay:<ticketId>:<requestId>`) and partition on it.
Notices partition by name (they already coalesce by name). `reply` already has a per-ticket+conversation boundary
(outbox receipts.behind) and stays as is. All relays target one main Session; partitioning changes delivery interleave
order across conversations, not within one. If the main Session truly requires a single global order, the fallback is
failure isolation: skip-and-dead-letter a repeatedly failing head (visible, never silent) instead of partitioning.

## Issue 15 — retry backoff: three faults proven, candidate verified

Baseline (effects.ts attempt()): `min(max, base * 2^min(attempts,16))` — proven:
1. **Lockstep retries**: 50 relays failing at one instant all get the identical `due` (spread 0) and retry as one 50x burst.
2. **No classification**: a 401 retries forever (11/11 attempts consumed in-test); the recorded error string drops the
   structured status entirely, so classification is impossible even post-hoc.
3. **No server_not_before**: there is no channel for Retry-After at all.

Other retry sites audited: launch/delivery/reply effect options ([5000, 300 000]), github.ts per-item retry map
(24 h window), feishu-loops consumerRetry, model budget retries (DSH-side, observed by retry-health.ts).

Candidate (fixture): `classifyError` (cancelled / unauthorized / permanent / programming_error never retry;
rate_limited / provider_temporary / transient retry) + `retryDecision` implementing the mandate formula exactly:
a_n = min(d_max, d_base·2^n), j_n ~ Uniform(0.5·a_n, a_n), delay = max(j_n, server_not_before − now, 0), seeded RNG +
injected clock, Retry-After parsing (delay-seconds and HTTP-date). Verified: seed determinism, bounds, server clamp,
and burst desynchronization (50 correlated failures spread over [0.5·a, a]; worst 100 ms bucket ≤ 15 vs 50; median ≈
0.75·a, no systematic added delay). Idempotency is unchanged: at-least-once handler runs remain protected by the
existing idempotency keys (requestId / receipts); classification only stops retries that can never succeed.

Production seam proposal (not implemented): classify in `attempt()`'s failure path; store `serverNotBefore` when a
handler throws an error carrying one; keep configured `[base, max]` per kind as d_base/d_max per the mandate.

## Issue 13 — coordinator load: baseline profiled

Per profile: 200 tickets, 120 assessments, ~2 900 coordinator-bound enqueues (~980 KB payload, the offline token proxy;
no token claims). Coordinator interactions (relay+notice+assessment deliveries): ~2 320 per run, independent of worker
count in enqueued volume; delivered volume shifts slightly via timing-dependent notice coalescing (2–20/run).

Queue age P95 (virtual ms) by worker count:

| workers | relay (serial) | notice (serial) | assessment (4) | launch (slots) | reply (1) |
|---|---|---|---|---|---|
| 1 | 665 | 0 | 0 | 29 338 749 | 1 212 |
| 3 | 1 376 | 0 | 0 | 9 600 647 | 3 512 |
| 6 | 2 864 | 360 | 0 | 4 493 187 | 6 179 |
| 12 | 19 019 | 594 | 0 | 2 017 656 | 29 190 |

Reading: launch slot wait collapses with more workers (expected), while the **serial coordinator-bound queues (relay,
reply) degrade superlinearly** — more concurrent workers finish simultaneously and burst into one global stream.
Assessment (limit 4, unordered) shows no queueing at this volume. The coordinator's serial surfaces are the bottleneck
that scales with worker count; this is where the Issue 14 partitioning and any batching work pays off.

Deterministic vs model-requiring coordinator actions (code audit): intake/gating, eval batching, follow-up routing,
explicit-request routing and notice injection are already deterministic; only candidate assessment decisions and
free-form steering genuinely need the model. Batching related informational updates (notice coalescing already exists
by name; relay reports are per-event) is a candidate for later measurement, not started.

## Not done / next

- No production edits anywhere; candidates await integrator clearance (hooks integration in flight).
- Token-cost measurement needs the live worker's reviewed-tag runs; offline bytes are the proxy only.
- Issue 13 batching variant (coalescing relays/notices per main-Session turn) not yet simulated.
- Mandate adversarial checks for these areas: partitioned dispatch must not reorder within a conversation (tested),
  must not lose coalesce semantics (tested), and dead-letter visibility for permanent failures is a proposal only.
