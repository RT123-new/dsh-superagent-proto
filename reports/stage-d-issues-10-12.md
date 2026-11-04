# Stage D: Issues 10-12, isolated offline experiments

Base: reviewed/correctness-stage-b, `5752c4c99778ba5a0abe59ace4988270e4612855`.
Branch: `stage-d/issues-10-12`. Date: 2026-11-04. No production files changed.
No paid calls, deployment, live API polling, webhook registration or GitHub issue/comment effects.

## Dispositions

| Issue | Classification | Action and verified result | Remaining risk / adoption decision |
| --- | --- | --- | --- |
| 10 Sequential polling | SOURCE-SUPPORTED; production improvement NOT TESTED | Actual `pollRound` is sequential. Ran 240 Source/Engine/SQLite rounds, six profiles x 40 seeds. Exact intake counts held, including the failed-conversation profile. Trace replay evaluates C=1/2/4/8. | Synthetic service times and simulated pool are not a production pooled implementation. No adoption. Need reviewed Issue 9 hooks, actual bounded-pool execution, same rate gate on baseline/variant, pagination/checkpoint/restart/cancellation fault tests and independent review. |
| 11 Detection delay | SOURCE-SUPPORTED; deployed webhook benefit NOT TESTED | Added isolated signature-checking SQLite inbox experiment and fallback detection model. Signature rejection, repository rejection, persisted restart, duplicate/conflicting identity and failed-drain replay tests pass. | No mounted endpoint, registration, service wake or production policy integration. Arrival distribution assumed, not measured. Keep polling; do not claim production speed or completed webhook implementation. |
| 12 CLI startup | CONFIRMED local startup cost; replacement NOT TESTED | Real `gh --version` startup measured. Production Commands drives a stub executable versus reusable loopback HTTP candidate. Paired P95/bootstrap evidence retained. | Not actual `gh api` network timing. Raw HTTP cannot yet prove identity equivalence to arbitrary configured gh wrappers. Multi-page and slower-network benefits do not support broad architecture adoption. Retain Commands. |

## Measurement method and environment

Node v22.23.4, gh 2.103.2, pnpm 11.7.0, Linux. Native TS experiments use `--experimental-transform-types`.
Each comparison resamples matched pair indices 10,000 times, recalculates P95 for both arms, and reports the relative improvement `(baseline - variant) / baseline` with the 2.5/97.5 percentile interval. P95 uses nearest rank. Raw pairs and command summaries are in `reports/evidence/stage-d-10-12/`.

Poll workload samples are exploratory: 40 independent seeds per profile, below the 200-task/profile target. A 200-seed run exceeded the command runtime and produced no results; it was not counted. No claim of statistical production capacity follows from modeled intervals. Webhook detection uses 200 events x five seeds per loss profile. Transport uses 200 sequential paired iterations/profile, alternating arm order to limit drift. Fixed-latency transport draws are not five independent real-network seeds.

## Issue 10: source audit and trace experiment

- `src/sources/github.ts`: `pollRound` executes notification scan/read, repository streams, ticket PRs and subscribed threads in phase order. `pollNotifications` iterates conversation reads; `pollTicketPulls` iterates PRs. `src/sources/poll.ts:pollThreads` is sequential.
- Notification checkpoint/retry map is committed atomically after completed reads; failed item retry stays durable. Per-thread cursor moves only after its read. `round.read`/`round.pulls` are shared within the round. A pool must preserve those semantics, not parallelize every existing await.
- Existing Commands returns raw headers only when explicitly requested. `pages` slurps JSON and discards per-page rate headers; error objects retain status, not Retry-After/reset. Therefore the current interface cannot safely implement the full proposed rate-aware pool without additional response metadata.
- Six profiles: 10/25/50 notified conversations, 10+10 and 25+25 notified/subscribed conversations, plus 25 notifications with one injected failed conversation. Three observed stream issues/profile. All use real Source, Engine policy and SQLite, but synthetic API data and synthetic service times (60ms + exponential tail with 40ms scale).
- 240 rounds, 13,920 stub transport calls. Successful intake per profile is exactly `3 * notified + subscribed + 3`; failed profile is `3 * (notified - 1) + 3`. All failure rounds report failure and still ingest every unrelated expected event. This certifies only the sequential baseline fixture, not a concurrent variant.
- Trace replay preserves conversation request ordering and phase barriers. C=1 equals the sequential service-time sum. Candidate bounded occupancy/order checks pass for C=1/2/4/8.
- Per-profile P95 results and intervals are in `poll-profile-summary.jsonl`; e.g. 10-notification profile C=2 projects 44.8% improvement [42.9%,45.6%], C=4 65.8% [62.8%,67.3%], C=8 74.0% [69.8%,75.7%]. These are projections, not measured production gains.
- The reserve-rate sensitivity uses `R_reserve=max(10,ceil(.1L))` and `(R-reserve)/max(1,secondsUntilReset)`. With L=5000, remaining 2000-4999 and 1800 seconds until reset, the gate dominates network time. Its comparison against an UNGATED baseline is deliberately marked unfair for adoption; it is only evidence that speed claims change under rate assumptions. It does NOT refute bounded concurrency under identical rate controls.
- Pure proposed header-delay helpers cover Retry-After seconds/date and exhausted primary reset; no live rate scheduler is claimed. Missing-header fallback, secondary rate limits, per-page headers and concurrent budget reservation remain production work.

## Issue 11: durable wake design experiment

`issue-11-webhooks/intake.ts` is only an isolated inbox. HMAC SHA256 checks raw bytes with constant-time comparison. Rejects malformed/invalid signatures, oversized bodies, invalid delivery ids and foreign repository. Unique delivery id plus body digest detects duplicates/conflicts. SQLite WAL/FULL synchronous insert completes before success return. A disk-write exception cannot return success. Row replay after restart is tested.

Drain never directly creates work. Its callback must re-read current API state and apply current policy, with logical event dedupe. Signed transport does not establish actor authorization. Receipt order is not remote event order. Crash after callback before marking done can replay, so this is not exactly-once external execution. Concurrent drain exclusion, multi-process inbox races, delivery ordering through the real Source, revoked sender permissions, power-loss behavior, quota/retention and end-to-end reconciliation remain unverified. This experiment must not be exposed as a service.

Synthetic detection model: 60-second polling, uniform event phase, fixed 200ms source read, assumed 200-2000ms hook arrival, no model execution time. Same events in both arms; lost hooks always keep polling fallback. P95 polling detection is 57.08s. With no hook loss, modeled assisted P95 is 2.11s (96.3% improvement [96.25%,96.38%]); 10% loss gives 30.94s (45.8% [31.9%,60.9%]); 50% loss yields only 4.3% [2.1%,7.1%], below 15%; total loss yields zero improvement. Zero modeled misses is guaranteed by the stipulated fallback, not observed reliability. No adoption or polling-interval reduction.

## Issue 12: startup and transport evidence

Real `gh --version`, 200 runs: P50 23.61ms / P95 26.24ms. `/bin/true` P50 1.56ms / P95 1.86ms; Node --version P50 3.32ms / P95 3.63ms. This measures local startup/version handling, not authenticated network API work.

Production Commands calls the fixture CLI; candidate HTTP calls a loopback fixture. Identical responses and 60ms/server-request latency. Three-page fixture pays three request latencies on both arms, one subprocess per CLI paginated call.

| Workload | CLI P95 | HTTP P95 | P95 improvement, paired 95% interval |
| --- | ---: | ---: | --- |
| Notification headers | 83.50ms | 61.64ms | 26.19% [25.39%,28.01%] |
| Validated issue | 83.86ms | 61.73ms | 26.39% [25.84%,27.20%] |
| Three pages comments | 205.98ms | 184.45ms | 10.45% [10.00%,11.39%], below 15% |

An earlier exploratory pagination fixture charged only one server latency for CLI's three pages. That was invalid and corrected before the retained paired results above. Preliminary unsaved 20/150ms sensitivity runs also showed diminishing relative savings; these are not used as decision evidence. No real-network speed claim.

Nine loopback checks pass: both arms map404/304, reject absolute paths, HTTP rejects traversal, both abort in flight. This does not certify timeout-body handling, response caps, real Link traversal, redirects, identity, auditing or complete error equivalence. Candidate refuses redirects; arbitrary Link traversal is intentionally not implemented.

Account audit: `src/deployment.ts` resolves a configured CLI/login; `src/infra/environment.ts` clears GH_TOKEN/GITHUB_TOKEN, creates a gh shim and pins git to that CLI's credential helper. Configuration may name an arbitrary wrapper using GH_CONFIG_DIR or another supported login method. Exporting a token into a long-lived HTTP client would be a new account path, not proven equivalent. No credentials were read for these benchmarks. Retain existing Commands transport.

## Verification and reproduction

- `pnpm check`: PASS, typecheck, 1319/1319 tests across 73 files, build. Raw log `check.txt`.
- `pnpm exec tsc -p scripts/stage-d/tsconfig.json`: PASS, explicitly includes benchmark scripts as well as existing ambient augmentation sources.
- `pnpm exec vitest run --config scripts/stage-d/vitest.config.ts`: PASS, eight isolated candidate tests. These are outside the default production regression suite by design, not counted in 1319.
- Transport semantics runner: nine checks pass in `transport-semantics.jsonl`.
- An initial full check with the experiment under tests/ failed only the architecture test-index check. Moved experiment under scripts with its own test config rather than changing shared architecture docs; full check rerun green.

Run from repository root:

```sh
pnpm exec vitest run --config scripts/stage-d/vitest.config.ts
pnpm exec tsc -p scripts/stage-d/tsconfig.json
RAW_OUT=/tmp/poll.json node --experimental-transform-types scripts/stage-d/issue-10-polling/bench.ts 40
node --experimental-transform-types scripts/stage-d/issue-10-polling/summarize.ts /tmp/poll.json
RAW_OUT=/tmp/hooks.json node --experimental-transform-types scripts/stage-d/issue-11-webhooks/bench.ts
node --experimental-transform-types scripts/stage-d/issue-12-transport/bench.ts spawn 200
RAW_OUT=/tmp/transport.json node --experimental-transform-types scripts/stage-d/issue-12-transport/bench.ts pair 200 notifications-include
node --experimental-transform-types scripts/stage-d/issue-12-transport/bench.ts semantics
```

Independent review is pending. No Issue 10-12 production optimization is claimed complete. Keep the simpler implementation until the above gates are met.
