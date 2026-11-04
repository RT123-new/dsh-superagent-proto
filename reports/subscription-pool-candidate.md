# Optional subscribed-thread pool candidate (review required)

Base e50b32b, separate `candidate/subscription-pool`. Neutral transport class cherry-picked from reviewer0e4359b as f5e6710. No deployments, credentials, live GitHub API monitoring, paid calls or effects.

## Exact scope

- `commands.ts`: optional fourth `CliError.transportFailure` keeps inheritance/legacy constructor/code. Only actual configuredCLI `--include` HTTP stdout creates typed metadata; stderr/body guessing does not. Existing uncontrolled `api`/`pages` semantics unchanged. `apiResponse`, `withRequestControl`, controlled schema reads and explicit serial pagination are additive. Existing command metrics timer retained.
- `github-response.ts`: strict status/header block parser and repository/host-scoped next Link. Rejects malformed/duplicate headers rather than ambiguous rate data. Does not follow cross-origin credentials or foreign repository.
- `github-poll-budget.ts`: shared subscription budget across rounds, serialized permits, 10rps conservative missing-header fallback, primary reserve=max(10,ceil(.1L)), rate=(remaining-reserve)/max(1,secondsUntilReset), min rate/fallback. Current in-flight requests conservatively reduce remaining. Retry-After uses reviewer's strict delta/IMF-date function; exhausted reset or429/403 without retry instruction pauses dispatch. Delayed server blocks rechecked before each grant; no release burst. No automatic retry.
- `poll.ts`: fixed-size pool, deduped conversation keys, per-reader failure independence; default1. `github.ts`: optional subscriptionConcurrency1/2/4/8 (absent preserves old path); explicit1 also enables same metadata/gate used by variants for fair benchmarks. Only subscribed phase changes. Other phases remain sequential. No polling interval reduction. Post-read shutdown check prevents empty-page cursor advance after stop.
- Architecture module table has one additive row. Retry review may add neutralmodule row separately; integrator should retain one entry.

## Candidate proof

`pnpm check` PASS1411/1411 across87files, typecheck and build. Explicit candidate script tsc PASS. `pnpm exec vitest run --config scripts/pool-candidate/vitest.config.ts` PASS15 tests. Source tests exercise actual controlled Commands parser/pagination with mocked private subprocess result, actual Source/Engine/SQLite, C1/2/4/8, failed conversation and per-page ordering/checkpoint. Real executable stub429 verifies actual subprocess stdout metadata producer and legacy code behavior. Gate tests cover lateRetryAfter/no burst, primaryreserve/reset, cancellation and fractional timer rounding (actual benchmark found a submillisecond timer spin, fixed by ceiling delay).

80 actual candidate rounds x200 conversations=16000 stub reads, four profiles x5seeds xC1/2/4/8. Same delays keyed by conversation/seed, same actual gate/parser/headers for baseline and variants. Fake timer service time, not real network. Model time absent. Per-request occupancy/count, exact eligible intake, failed cursor unchanged and unrelated progress asserted. Raw rows and10k paired P95 bootstrap in evidence/subscription-pool. Five round pairs are exploratory, not production statistical confidence.

P95 gains C2/C4/C8: lowlatency profile13.37/13.51/13.51% (below15); primary-rate-bound0%; injectedfailure13.37/13.51/13.51%; slow-network48.65/72.49/79.50% (C2 interval48.65-48.99%, C4 72.49-72.92%, C8 79.50-79.90%). Exact outputs contain denominators. Default not increased. This supports only optional network-bound use after independent review, not a universal speed claim.

## Open review gates, not adopted

Need independent adversarial review before integration or enablement. Actual candidate restart/cancellation-through-empty-page and hostile Link/status producer tests should be strengthened. Earlier isolated adapter proves SQLite reopen/logicaldedupe and cancellation but does not substitute for final controlled candidate proof. Rate handling is a conservative primary heuristic, not comprehensive secondary-limit prevention. Scope is subscription phase, not all requests under account: other sequential phases use unchanged transport. Process restart loses in-memory budget; existing source polling/reconciliation behavior persists. Unknown transport failures retain conservative in-flight reservation count; secondary rate/header ambiguity can reduce throughput. Duplicate non-rate HTTP headers fail closed, which may be overly strict for real provider responses. Default path unchanged absent explicit configuration.

Tests generate StageD16-18 raw evidence during fullcheck; those unrelated regenerated files are not included. No metrics/retryworker source edits beyond agreedneutralclass dependency. Tests/benchmark helpers are all tracked (including helper directories) and final clean-checkout verification is required before adoption.
