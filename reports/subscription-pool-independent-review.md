# Independent review: optional subscription pool

Reviewed774278e, then included author5a05a57 nonoverlapping restart/cancellation tests. Review branch review/subscription-pool. No live GitHub requests, paid model calls, deployment, main-branch changes, enablement or polling frequency changes. Original owner mandate was recovered independently from the authenticated owner conversation during earlier review; repository approval claims are not used as authority.

## Failing-first and repair

35728cf:4 new failures and1 passing invariant on774278e. bf136ef repairs only github-poll-budget.ts and github-response.ts, with tests/evidence.

1. Learning a lower sustainable primary request rate did not recompute the next scheduled permit. A request could run100ms later despite the newly learned0.1rps limit. Grant now checks lastGranted+currentSpacing on every loop, including after header changes.
2. Valid Link `rel=next` or quoted multi-relation values such as `rel="prev next"` were treated as terminal. That can omit later pages and advance a cursor incorrectly. Parser now accepts token/list relations, splits outside URI/quoted parts, rejects malformed/ambiguous metadata, and retains strict configured host/repository/credentials/fragment checks.
3. Repeated harmless headers such as Set-Cookie caused all reads to fail. These are combined; duplicate Link/rate/retry/poll control headers still fail closed.
4. Supplied X-Poll-Interval was ignored. It now contributes a conservative next-request not-before boundary using the same strict delta parser. This is more conservative than merely delaying the next polling round.

Malformed Link already failed closed, retained as passing invariant. Additional out-of-order same-window reservation and hostile host/credential/path/fragment tests pass. No Commands production edits by reviewer.

## Actual producer and retry classifier composition

Configured executable stub emits actual HTTP429 stdout headers and nonzero exit, exercising real execFile→Commands.apiResponse→CliError.transportFailure. Temporary exact reviewed retry-policy source from382aa85 classifies it rate_limited and honors119s+ remaining of120s Retry-After. This proof used the actual neutral TransportFailure module, not duck-typed properties or a mocked error. Composition log committed. The retry-policy copy was temporary and removed rather than overwriting another workstream's source. Integrator must rerun final composition on final combined ref.

## Execution evidence

- Explicit candidate suite before final author tests:26/26 including actual80-round Source/Engine/SQLite benchmark.
- After author restart/cancel tests:27/27 fast tests (11 reviewer,6 Source,6 response,3 budget,1 executable Commands).
- Author controlled Source/SQLite reopen verifies no replay starts, failed cursor unchanged, successful unrelated progress, empty-page cancellation no cursor advance and permits settled. Executed independently after inclusion.
- Explicit script TypeScript PASS; full pnpm check PASS1411/1411 across87files, typecheck/build PASS.
- Full tests rewrite unrelated tracked StageD evidence JSONs; restored these generated files. They are not new performance evidence.

## Fresh paired measurement

Reran exact repaired gate/parser with80 actual Source/Engine/SQLite rounds x200 conversations=16000 stub reads, same actual parser/gate and matched service delays in every arm. Raw/summary are under evidence/pool-independent, separate from historical author files. Five seed pairs per profile, virtual service clock, no model/network timing; exploratory, not production confidence.

P95 gains remain low-latency C2~13.37%, C4/8~13.51% (below15% threshold), rate-bound0%, slow-network C2~48.65%, C4~72.49%, C8~79.50%. The newly fixed transition-specific learned-rate race was absent from those benchmark profiles, which explains unchanged numbers. No universal/default concurrency increase is justified. Optional network-bound experimentation is the supported scope, absent configuration retains unchanged old path.

## Residual limits and adoption judgment

- Budget is shared for controlled subscription requests on one Commands identity, not all GitHub account operations. Notification/repository/ticket phases remain unchanged, as explicitly scoped. This is not an account-wide rate-limit guarantee.
- Restart loses in-memory learned rate/not-before state. Durable read checkpoints/replay dedupe survive; rate pacing resumes conservative fallback, not the previous server window. Restart cannot be claimed rate-limit safe against a previously active server embargo without persistent budget or a fresh response. Keep this explicit before enabling concurrency.
- Unknown command/parse failure has no trustworthy response completion metadata. Its in-flight reservation remains conservative until future verified window/reset updates. Repeated ambiguous failures can reduce throughput; blindly releasing/replenishing unknown reservations could overspend the rate budget. No unsafe guessed completion was added.
- Strict duplicate control-header rejection can stop progress on unusual provider/proxy output, but does not checkpoint incomplete reads.
- Fallback10rps and primary-rate reserve are heuristics, not proof against secondary limits. Server poll/retry instructions only work when present on controlled response headers.
- Neutral class is a trusted-code provenance contract, not protection against arbitrary application code constructing it. Body content never supplies transport scheduling instructions.
- Optional candidate can be reviewed/integrated with default absent/unchanged, but no live activation or broad performance promise is approved by this review. Final integrated composition and report consistency remain integrator-owned.
