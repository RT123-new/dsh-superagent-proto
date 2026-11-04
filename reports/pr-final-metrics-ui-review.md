# PR final review - metrics (phase 5) and dashboard (phase 10) workstream

Base: programme/reliability @ de50174f86cb5499f1c482a4bd432a77386737c9. Review branch: review/metrics-ui. Failure evidence: reports/evidence/pr-final/metrics-ui-before-fix.txt (run on the unmodified source with the new spec; M1, M2, M3 fail, M4 passes).

| ID | Sev | Class | Finding | Code | Result |
|---|---|---|---|---|---|
| M1 | Low | Confirmed defect | Counters add past MAX_SAFE_INTEGER and lose integer precision (9007199254740996 observed). | Metrics.count, src/infra/metrics.ts | Saturate at MAX_SAFE_INTEGER, count `counter_saturated`. |
| M2 | Medium | Confirmed defect | DomainTimeline and SessionTimeline clamped negative deltas with Math.max(0, ...), so a backwards clock became a 0 ms success sample (count 1, p50 0). Violates "never substitute zero for unknown". | src/infra/metrics-lifecycle.ts (since, arrived, eval.started, SessionTimeline.finish) | Pass raw delta; Metrics.observe rejects negatives and counts `invalid_duration`. |
| M3 | Medium | Confirmed defect | MetricsPanel threw RangeError (Date.toISOString) on non-finite wall bounds, crashing the whole panel. | src/client/metrics.tsx header | Invalid bounds render as "Not observed". |
| M4 | - | Refuted | nearestRank equals exact integer ceil(p*n/100) for p=50,95, n=1..10000. | metrics.ts nearestRank | NO CHANGE. |
| M5 | Low | Code-supported risk, unrepaired | Overview renders no panel when `data.metrics` is undefined, so "instrumentation off" and "snapshot failed" are indistinguishable from "no telemetry section". Needs an API field to tell them apart. | src/client/overview.tsx:103, runtime.metricsSnapshot | NO CHANGE - needs API shape decision. |
| M6 | - | Platform limit | step_to_settlement covers step admission to first settlement event; DSH events carry no provider request-start, so provider latency stays unavailable. UI label already says "not API request". | metrics-lifecycle.ts SessionTimeline | Remains unavailable. |
| M7 | Info | Unrepaired | No correctness oracle exists; completion rate, correct completion rate and correct-task throughput are not computed anywhere (dashboard shows none). Not invented. | - | Remains unmeasured. |

Not verified: pixel inspection of narrow/wide/dark/light layouts and keyboard behaviour (the only visual change is the timestamp line fallback, no new layout); the Phase 10 state taxonomy (paused, waiting for capacity, retrying, etc.) was not audited against src/client beyond metrics.tsx and overview.tsx.

Tests: tests/pr-final-metrics-review.spec.tsx (4 pass after fix). Adjacent: issue-9*, issue-22*, runtime, client specs 190/190 pass; tsc --noEmit clean. Full suite, build and CI not run here (integration lead owns).
