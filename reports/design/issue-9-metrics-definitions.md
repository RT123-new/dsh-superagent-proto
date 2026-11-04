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

Rules: local durations are monotonic deltas (performance.now); wall clock only bounds a snapshot; monotonic values are never persisted or compared across restarts (a restart starts a fresh collector, snapshot `sinceWallMs` marks it). Quantiles: nearest-rank over the most recent `window` (default 1024) samples per stage|source key; count/sum/max are exact over all samples. Labels: fixed stage and source allowlists, everything else 'other'; no ids or text. Slot utilization: exact per-state time integrals for each slot from its first transition (time before is unaccounted, not assumed idle). Queue: depth and oldest tracked age (bounded 10k live ids; overflow counted in depth, untracked). Tokens: categories inputCacheHit / inputCacheMiss / output; unreported = null, cost only when all categories known and pricing supplied; unknown reports counted separately. No "completed correctly" counter is provided: delivery or turn end is not correctness.
Hook proposals (not applied; wait for correctness review): receive at source loop hand-off; eval enqueue/dispatch/decision (assessment.ts); effects.ts `Row.since`->handler start; slot reserve/free in executor/dsh.ts; prepare start/end; delivery ack; outbox send ack. Usage capture depends on whether the DSH framework exposes provider usage; if not, tokens stay null.

## Revision 2 (semantics pinned by tests)
- Slot utilization = integral(active slots) / integral(configured capacity), over the observation interval that starts when the integrator is created. Slots are counted, not identified. A fixed pool starts fully idle: never-used capacity counts from observation start. `executor.maxWorkers` is a runtime setting, so `setCapacity()` integrates the configured capacity over time. Active reservations above a lowered limit stay in the numerator (utilization can exceed 1) and the excess is integrated separately as `overLimitSlotMs`. Zero capacity time gives null.
- Quantiles cover the most recent `window` samples per key (recent-window, not lifetime); count/sum/max are lifetime-exact.
- Queue `oldestAgeMs` covers tracked ids only; nonzero `untrackedOverflow` means it is a lower bound.
- Token mapping from DSH `TokenUsage` (disjoint counts): inputTokens -> inputCacheMiss, cacheReadTokens -> inputCacheHit, outputTokens -> output, cacheWriteTokens -> cacheWrite, reasoningTokens -> reasoning. Reasoning is separate and never added to output or cost until its relation to outputTokens is verified. Cache-write tokens > 0 with no cache-write rate, or an explicit null cacheWrite, make that report's cost unknown (excluded from `costUsd`, counted in `costUnknownReports`). An absent cacheWrite field is treated as no cache-write billing (DeepSeek has none), which is an assumption to confirm against the real adapter output.
