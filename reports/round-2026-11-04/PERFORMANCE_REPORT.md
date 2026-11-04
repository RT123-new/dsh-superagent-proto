# Performance report: mandate review round of 2026-11-04

> Round scope `6027b6e..fd3b7a6`. Mandate-required fields are shown; null means not measured. Canonical counts are adversary-run only.

## Accepted performance changes this round

None. This round's changes are correctness, operator-safety, transport-contract, and instrumentation repairs; no optimization was adopted. The pagination work (`fa9d8ef`) is a correctness bounding change, not a measured latency adoption; the header-strip scanner (`26ab444`) processes the same bytes once, sequentially, and no latency claim is made.

| Field | Value |
| --- | --- |
| Baseline SHA | null |
| Candidate SHA | null |
| Workload | null |
| Tasks / independent runs | null |
| Random seeds | null |
| P50 / P95 latency | null |
| Throughput | null |
| Correct completion rate | null |
| Missed/duplicate work | null |
| Model/API cost | null. Zero paid model or API calls this round. The earlier spend figure ($0.001021636 against a $5 authorization) is a historical record of a prior checkpoint only; it is not current paid permission, and this round holds no paid-call authority |
| CPU/memory/storage overhead | null |
| Confidence interval | null |
| Adoption rationale | No candidate was adopted; nothing to accept or reject |

## Measurement-scope reductions honestly reported

- `tests/pr-final-metrics-review.spec.tsx` (M4): sweep capped at 2000 rows plus spot checks. Earlier 20k-row measurements are historical and are never reported as current.
- `tests/stage-d/issue-18-startup.spec.ts`: iterations reduced 20k -> 2k. Earlier 20k-iteration numbers are historical and are never reported as current.

## Instrumentation added (section 11), not performance claims

- `task_total` (mandate T_i) is now measured per task from the application's receipt of the trigger (intake arrival, queue commit as fallback) to its terminal event; W_i keeps queue-commit semantics. These are measurement capabilities, not measured production values: no P50/P95 or throughput figures exist yet, and none are claimed.
- Token/cost categories remain unhooked (DEFERRED WITH REASON); no cost-per-task claim is made.
