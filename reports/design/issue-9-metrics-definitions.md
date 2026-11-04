# Issue 9 metric definitions (isolated collector, src/infra/metrics.ts)

Corrections to the earlier draft: `Trigger.at` is the REMOTE event timestamp, not local receipt. Source-to-queue latency must be measured from a local receipt stamp (monotonic) taken when the source loop hands the event to the engine; remote-to-local skew (`Trigger.at` vs local wall) is a separate, clock-skew-affected figure and must not be mixed in.

| Stage key | Start boundary | End boundary | Not claimed |
| --- | --- | --- | --- |
| source_to_eval_queue | local receipt of event | evaluation enqueued | not remote event age |
| eval_queue_wait | enqueued | assessor dispatch starts | |
| eval_run | dispatch starts | decision recorded | |
| decision_to_assignment | decision recorded | Assignment created | |
| slot_wait | Assignment created | worker slot reserved | |
| workspace_prepare | prepare begins | prepare verified or failed | |
| delivery_to_worker | inputs sent | send acknowledged by framework | NOT model turn start; delivery is not model start |
| worker_turn | delivery acknowledged | idle/report observed | measured turn boundary only; no per-token timing |
| tool_run | tool call start | tool call end | only where a hook observes both |
| report_to_response | report recorded | outbox send acknowledged | |
| effect_queue_wait / effect_run | `Row.since` enqueue / handler start | handler start / handler end | |

Rules: local durations use monotonic deltas; wall clocks bound snapshots only. Quantiles use nearest-rank over the most recent window (default1024, validated1..10000); count/sum/max are lifetime totals. Success and failure durations are separate; timers default to success, so failed/cancelled hooks must explicitly stop with `failure`. Stages can overlap and must not be summed. Fixed stage/source labels and bounded pool/state names contain no task IDs or text. No completed-correctly counter is inferred from delivery, idle or reports.
Hook proposals (not applied; wait for correctness review): receive at source loop hand-off; eval enqueue/dispatch/decision (assessment.ts); effects.ts `Row.since`->handler start; slot reserve/free in executor/dsh.ts; prepare start/end; delivery ack; outbox send ack. Usage capture depends on whether the DSH framework exposes provider usage; if not, tokens stay null.

## Revision 2 (semantics pinned by tests)
- Slot utilization = integral(active slots) / integral(configured capacity), over the observation interval that starts when the integrator is created. Slots are counted, not identified. A fixed pool starts fully idle: never-used capacity counts from observation start. `executor.maxWorkers` is a runtime setting, so `setCapacity()` integrates the configured capacity over time. Active reservations above a lowered limit stay in the numerator (utilization can exceed 1) and the excess is integrated separately as `overLimitSlotMs`. Zero capacity time gives null.
- Quantiles cover the most recent `window` samples per key (recent-window, not lifetime); count/sum/max are lifetime-exact.
- Queue (revised): depth is exact only while all ids are tracked (cap 10k). After a dropped enqueue the gauge is `incomplete`: `depth` is a lower bound (tracked count), `oldestAgeMs` is the oldest TRACKED item (`oldestAgeIsLowerBound`), and dropped ids are never added to depth (earlier overflow counter inflated depth on duplicates; fixed). `reconcile(n)` takes the authoritative queue length from the owning durable queue at read time to restore exactness.
- Token mapping from DSH `TokenUsage` (disjoint counts): inputTokens -> inputCacheMiss, cacheReadTokens -> inputCacheHit, outputTokens -> output, cacheWriteTokens -> cacheWrite, reasoningTokens -> reasoning. Reasoning is separate and never added to output or cost until its relation to outputTokens is verified. Cache-write tokens > 0 with no cache-write rate, or an explicit null cacheWrite, make that report's cost unknown (excluded from `costUsd`, counted in `costUnknownReports`). An absent cacheWrite field is unknown. A provider-specific hook may normalize it to explicit zero only with adapter/provider evidence that no cache-write billing applies.

## Independent review corrections

- `snapshot()` captures each slot pool once; utilization uses exactly that snapshot's integrals, not a later clock read. States must be disjoint slot counts; the collector cannot detect the same worker counted as both preparing and busy. Hooks own that invariant. Capacity changes remain integrated over time and over-limit reservations stay visible.
- Queue length reconciliation is point-in-time, not a cached current truth. Any subsequent membership event invalidates the authoritative length, leaving the tracked lower bound until the next owner reconciliation. An authoritative zero clears stale tracking. A count smaller than the tracked identities discards ambiguous identities/ages rather than presenting an invalid age bound. Complete means all current identities are tracked. For incomplete queues, call reconcile(owner.length) immediately before exposing a current depth; length alone cannot reconstruct missing timestamps.
- Window and queue capacity must be integer1..10000. State sets are1..8 distinct bounded labels; pool names are bounded labels and pools remain capped at8. Counter increments must be nonnegative safe integers. Invalid prices or nonfinite computed cost are unknown, not zero/known.
- `failedDurations` has the same recent-window quantiles and lifetime totals as success `durations`; an idempotent timer records only its first completion outcome. Transport retries are separate attempts, not task successes.
- Token sums are known-report subtotals, not complete totals when unknownReports is nonzero. CostUsd is the subtotal of costKnownReports, not total spend when costUnknownReports is nonzero. Optional cacheWrite/reasoning remain null when never known. Reasoning is non-additive. The installed DSH declaration explicitly confirms disjoint uncached/cache-read/cache-write input counts; it does not prove every optional absent value means zero.
- Remaining Stage C work: integrate and independently test complete lifecycle boundaries and dispositions; distinguish actual model start from delivery acknowledgement; define eligible/correct task counts, end-to-end latency, throughput, TPS/CPS, and CPU/memory collection. This module alone does not close Issue9 and must not imply these measurements exist.
