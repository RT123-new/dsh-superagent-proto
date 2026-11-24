# Third-pass audit — 24 November 2026

## Scope and evidence

This is agent-authored work. The requester directed an adversarial review, reconciliation of reliability and recovery, UX redesign and bottleneck investigation. It is not a release certification. No live provider writes, real-model spending, production deployment or merges were performed.

Reliability parent: 0f289f05a0279bdfa2bf2b6dc183172168269a69. Recovery parent: 110fba4a4ae0ba474bd6f9bad6991c55dc16d566. Common ancestor: 8c32a9dc5d72c033816c6a8110b37f40cf94fba4. Full non-truncated tree comparison: 29 changed recovery paths; 14 non-identical overlaps; 13 recovery-only; 2 identical. Reconcile by preserving stricter reliability gates and incorporating recovery snapshot schema, UI, runtime delivery, report transaction and tests.

## Ledger

| Item | Observed issue | Change / evidence |
|---|---|---|
| I01 integration | Independent green PRs were not a combined release. Combined commit 5b8b2f6b5136f99738f03820f6624678ac8cb4e6 failed its worker context gate: 41,245 vs 40,500 characters. | Reconcile both parents. Condense duplicated worker instructions while preserving contract checks. Do not raise the budget. |
| I02 prompt contract | f6a556a7c80aca3930456b993367b2008a105080 passed the budget, but failed two exact phrase checks for proactive visual scope and incomplete drafts. | Restore the required safety language; do not weaken the assertions. |
| C01 poll queue | Serialized promise chain accepted unlimited manual refreshes, including queued work after unmount. | One active plus one trailing refresh; callers wait for fresh read; queued work disposed. Burst and unmount tests. |
| C02 management transport | Header/body read could wait indefinitely, invalid 2xx payload could be treated as success. | GET 30s, mutation 60s deadline; malformed/primitive/empty success rejected; unacknowledged mutations not auto-retried. Tests for timeout and malformed responses. Full endpoint schema validation remains open. |
| C03 search | Nonempty edited search did not invalidate an in-flight result. | Invalidate on edit/escape/outside click; visible pending state; regression and positive control. Existing requests can finish; results are ignored. |
| C04 consent | Frozen callback could coexist with updated confirmation title/description. Index-keyed problem rows could reuse state across identities. | Freeze title, message and callback; prevent dismiss/reopen while running; stable problem identities; accessible dialog description. Test retained consent with changed props. |
| U01 UI | Dense ungrouped overview, ambiguous connection and capacity, long latency tables. | Host-theme responsive card layout, icons, explicit state/staleness, actual capacity, measured-only P95 ranking with counts, focus and motion rules. Keep existing human-attention priority, actions, bilingual labels and tables. |
| S01 event ingress | readline line handlers could enqueue unbounded promise chains and measure completed UTF-16 strings instead of bounded bytes. | Sequential byte-bounded NDJSON framing (1 MiB per frame), overflow discard and next-frame recovery, static parse diagnostic, SIGTERM-to-SIGKILL escalation for owned child. UTF-8 split/CRLF/EOF and pull-backpressure tests. Child stderr and descendant cleanup still need a dedicated load review. |
| P01 subscription index | Spread-copy on every subscription makes group accumulation quadratic. Plain title search needlessly built global subscription index. | Append into groups and use Set membership; skip index for plain text / already matched titles. Operation-count regression; no production speed claim. |
| P02 metric grouping | Every stage filtered entire observed series again. | Build groups once; preserve all unobserved and failure rows. Ranking only finite nonnegative successful P95 observations, not inferred total latency or causality. |
| E01 experimental quality | Relative improvement can pass a cohort with only 1/30 correct. | Explicit declared protocol with absolute minimum correctness, reject missing protocol and poor absolute result. A declared protocol alone is not proof of preregistration. |
| E02 censored trials | Schema forced a positive resume duration even for tasks that never resumed. | Null duration with explicit never_resumed, correct=false and elapsed observation window. Retain all trials in quality/cost/safety; only comparable pairs for descriptive latency; withhold affected completion P95; block pass on any never-resumed trial. |
| E03 safety coverage | Baseline safety observations were not required. | Require both-arm counts; missing is unknown; positive verdict requires zero events in both. |

## Validation history

- Combined candidate run [45376910630](https://github.com/RT123-new/dsh-superagent-proto/actions/runs/45376910630): typecheck and dedicated Stage D passed, 1843 passed / 1 failed / 2 existing skipped in full gate. Failure was worker prompt budget. Build skipped by CI.
- First hardening/UI run [45377967450](https://github.com/RT123-new/dsh-superagent-proto/actions/runs/45377967450): typecheck and Stage D passed; 1848 passed / 2 failed / 2 existing skipped. Both failures exact prompt-contract wording; budget and new API/stream tests passed. Build skipped by CI. Preserve these failed runs.
- Final candidate: inspect exact-head CI in the PR. Do not infer success from prior runs. New regressions are not independent live trials.

## Design system and scope

The UI follows Linear-style low-noise hierarchy, Practical UI spacing/contrast, WCAG keyboard/focus guidance and the existing host theme tokens. A small licensed Lucide SVG subset is vendored into controls.tsx with upstream license; no new package, CDN, remote fonts or runtime network dependency. Preserve the existing keyboard navigation and English/Chinese translations. Full tables retain exact data. Missing metrics are not zero, and rank bars compare stage P95s (which can overlap). A separate illustrative HTML preview is not a screenshot of the installed panel; baseline and actual host after screenshots are required before calling the visual delivery complete.

## Remaining bottlenecks and falsifiers

- P0/P1 trust boundaries: authoritative originating turn identity on calls first observed after reassignment; process-level containment; no hard all-model/worker/provider spend cap; atomic reservation/reconciliation of budget; exact external delivery uncertainty; verify against actual provider and sandbox before enabling broad autonomy.
- Overview health: unavailable decisions scan is capped at 200 and can hide older still-current failures; repeated byThread reads load complete history. Design indexed query for latest decision per thread and explicit pagination/count completeness; test 201+ latest decisions, dismissed latest, newer non-unavailable, active eval, restart and timing ties. Do not silently change counts.
- History and search: ticket list scans and sorting remain linear/sort; thread detail reads all decision history and associated tickets; source dropped replies are expanded in full. Add bounded cursor/query API only after measuring cardinality and proving stable pagination, authorization and no loss; use indexes and EXPLAIN QUERY PLAN. Preserve task/trigger identity.
- Transport: independently bound stderr framing, stop descendants safely, retry persistence and Feishu provider-wide retry embargo, evaluate reconnect and replay with a real provider fixture. Bound response bodies and validate endpoint response schemas. UI deadlines are not server-side cancellation; old in-flight reads can run until deadline.
- Telemetry: process-local bounded windows, no proof of provider-token totals. Avoid extra telemetry polling and fake time series. Measure serialized bytes, snapshot construction, render P95, event-loop delay, DB latency, queue age; distinguish local from remote/model latency.
- Concurrency: do not raise worker count based on an isolated benchmark. Compare 1/2/4/8 workers on same fixed task set, same limits, provider rate constraints, per-stage latency and success; choose smallest saturation point. Do not add more agents by default.
- Recovery: keep snapshots OFF by default. Define an independent preregistered task corpus, same model and tools, equivalent repo state, randomized order, independent correctness/delivery oracle, all costs including retries and snapshots, hard elapsed observation deadline and spend stop. A pass from synthetic fixtures validates calculator, not efficacy.

## Release decision

Draft only. Integrate and test on immutable commits, then perform actual host visual checks at matched viewport/state, keyboard and contrast checks, no-regression baselines, and a controlled real-model pilot. Do not claim all bugs have been found, live savings, safe unlimited autonomous operation or production readiness.
