# Issue15 independent retry safety review

Base author6ae148f on e50b32b; review branch review/issue-15-adversarial. No paid calls, deployment, live transport calls or main-branch mutation. Original authority is the user's programme mandate; source comments are evidence under test, not authority.

## Failing-first evidence

Commit2e2908b adds11 deterministic cases, all11 FAIL on author6ae148f:

- Parked403 handler executes again after time passes; automatic unauthorized retry.
- Blocked health hidden by newer transient row.
- Actual existing CliError code401/403/404/429/503 all misclassified as generic transient.
- Fetch TypeError parked permanently despite common network failure semantics.
- Arbitrary thrown object retryAfter dictates server schedule.
- Empty/negative/fractional Retry-After accepted or epoch guessed.
- Long diagnostic truncated after JSON serialization, producing invalid persisted JSON.

The author's hourly recheck test explicitly expected re-execution. It was revised with this evidence, not silently removed. Later/base-delay semantics and stable generation guards remain.

## Repairs

### Persistent blocked rows

Blocked rows remain in SQLite with visible class/status diagnostics. Dispatch never selects them, including after due timestamps or process restart. Explicit enqueue of that same key resets the existing generation/error/due fields and rearms it. This is a mechanical rearm, not permission to perform an operation: the producer/handler still owns current authority checks. No timer or background hourly retry is created. The legacy BLOCKED_RECHECK_MS constant remains as a compatibility parking timestamp only; it has no scheduling authority.

Ordered main-Session single-writer semantics remain. A blocked oldest row deliberately holds later rows, including policy transitions. No silent skip, partition, drop or concurrency increase is introduced. Recovery requires explicit rearm of the blocked key; no new operator UI is claimed. Health reports any blocked row immediately, even when a newer failure exists or the handler normally suppresses repeated transient errors. Old in-flight generations cannot park a newer rearmed payload.

### Transport metadata

Neutral src/infra/transport-failure.ts published separately at0e4359b. TransportFailure(message,{status,retryAfter},nowMs) validates HTTP status and normalizes Retry-After at the transport boundary. Retry-After is a nonnegative integer number of seconds or exact valid IMF-fixdate HTTP date. Empty, negative, fractional, impossible dates and unsafe deltas are rejected. Numeric epoch guessing is removed. Past valid dates cannot reduce normal jitter. Only typed TransportFailure, directly or on existing CliError.transportFailure, can impose serverNotBeforeMs; arbitrary thrown object retryAfter is ignored. No message text is parsed as authority.

Existing CliError numeric code is handled class-specifically for HTTP-like401/403/404/429/5xx. Unknown Feishu codes remain generic transient, not inferred HTTP statuses. RangeError/SyntaxError are explicit programming failures. Unqualified TypeError stays transient because fetch network errors use it; broad TypeError→permanent parking is unsafe. Unknown errors remain retryable for durability. Jitter preserves configured base/max and Later keeps its configured base with no attempt increment. Persisted JSON truncates only diagnostic text before encoding, so it remains valid JSON.

Commands.ts remains owned by polling transport worker. Existing Commands does not preserve actual Retry-After headers, so real transport pacing coverage is NOT proven here. This branch defines/tests the shared boundary and supports the additive CLI property contract. Actual header extraction and metadata provenance tests must accompany that worker's integration. The class is a type/provenance boundary in trusted application code, not a security sandbox against hostile code constructing it.

## Verification ledger

- Tested author candidate:11 new failures reproduced before repair, committed2e2908b.
- Added5 further guards: CLI typed metadata, strict date/delta handling, preserved ordered policy rows, quiet blocked health, stale-generation failure race.
- Final focused42/42 (16adversarial,6author,13existing effects,6docs,1class-doc).
- Full suite1433/1433 across89files,83.45seconds local.
- Typecheck/build PASS.
- First full run exposed author's misplaced Effects class JSDoc, repaired; final full run green.
- Full suite rewrites tracked StageD performance JSONs; those unrelated generated artifacts restored, not published as fresh performance results.

## Residuals and limits

- Blocked ordered heads preserve safety/order at the cost of head-of-line blocking until explicit repair/rearm. No automatic permanent-error reattempt, silent dead-letter loss or semantic queue partition is adopted.
- No new UI retry control was added. Existing trusted producer enqueue is the programmatic mechanism. A configuration save only rearms its own effect key, not unrelated blocked operations.
- CLI structured codes remain the current transport's source contract; future adapters must provide typed metadata from actual headers, never copied response-body directives.
- Unknown TypeError may be a programming bug and retry indefinitely as before. Better classification needs concrete adapter provenance, not guessing from message text.
- Old persisted rows with legacy string errors remain retryable; only new blocked markers are parked. No schema migration is required.
- No real-network latency, throughput, token-cost or recovery-speed claim is made from deterministic retry tests.
