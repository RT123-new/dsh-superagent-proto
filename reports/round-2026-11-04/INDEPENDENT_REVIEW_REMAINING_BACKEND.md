# Independent remaining-backend review

PR: https://github.com/RT123-new/dsh-superagent-proto/pull/1

Reviewed code: `fd3b7a6accdb34dcbd22476c79cce604226a6021`.
Base: `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`.
Remote reference supplied for this review: `6027b6e797ab1a866c7504016fbbfb39af1c7357`.
Imported bundle HEAD: `c1d4510535dae6d25ad3541276f227342960965c`.
The fd3b7a6..c1d4510 file delta contains reports/evidence only, not production code. Tests below ran on fd3b7a6, not on the later documentation commit.

## Verdict

One new confirmed P2 defect. The reviewed code must not be described as having complete classified retry/embargo behavior. The review does not certify the whole PR or authorize merging. No production code was changed during this review.

## P2: proven-not-attempted GitHub sends bypass retry classification and trusted embargoes

Locations: `src/sources/github-channel.ts:32-49`, `src/sources/send.ts:14-16`, `src/app/effects.ts:274-276`.

Both read-only GitHub checks before POST wrap non-gone failures in `SendNotAttempted(message)`. That wrapper drops the original status and typed transport metadata. Effects then handles every nonpermanent instance as `Later`: schedule exactly 5 seconds later, leave attempts unchanged, and restore the previous error (empty on a first attempt). Knowing that a send was not attempted establishes duplicate-send safety; it does not establish that the failure was transient or that it has no server embargo.

A deterministic private test exercised real Store, Effects, Outbox and sendGithub with a stubbed read boundary. No POST was called. Both assertions failed at the reviewed SHA:

| Read failure | Required policy | Actual persisted state |
| --- | --- | --- |
| `CliError` HTTP 401 | Park as unauthorized and surface failure | due=1005000 at clock=1000000, attempts=0, error empty |
| `CliError` HTTP 429 with typed `TransportFailure` Retry-After 120s | No next attempt before 1120000 | due=1005000, attempts=0, error empty |

Impact: repeated pre-send auth failures can poll indefinitely without an error health state; a transport-supplied rate-limit embargo can be violated. Transient pre-read failures also lose exponential backoff and jitter. This is a retry-policy integration defect, not a claim that an external duplicate was produced.

Suggested repair boundary: preserve the original cause/typed metadata and apply normal classified retry policy to proven-not-attempted failures, while retaining their no-provider-contact semantics. Keep permanent validation failures and ambiguous post-POST sends distinct. The implementation owner should choose the exact repair.

Evidence: `independent-presend.spec.ts` and `presend-red.log`. Two cases failed in 23ms. Copy the test into `tests/` so its relative imports resolve. No assertions were weakened.

## Existing unresolved issue confirmed, not newly discovered

Old-turn tool attribution after replacement remains unresolved. `src/app/tools/executor.ts` captures the current running assignment at invocation time, not the originating turn. Its post-await assignment guard correctly rejects replacement during a PR lookup and pending replacements, but cannot reject an old turn that invokes after the new assignment is already running. The existing characterization in `tests/review-phase2-late-tools.spec.ts` passed in this review and demonstrates that the report lands on the replacement assignment. Ended-ticket refusal is not a fix for this case. This review does not resolve the framework attribution mechanism or broaden this characterization into an exploit claim.

## Actual source coverage

Read the base-to-code-freeze changes and complete owning files for:

- `src/app/effects.ts`: dispatch ordering, parked rows, generations, markers, explicit rearm, failure settlement and health.
- `src/app/outbox.ts`: durable receipts, per-conversation waiting, provider-contact tracking, unknown outcomes and expiry gates.
- `src/app/http.ts`, `api.ts`: management origin checks, bounded blocked pagination, static classification payload, rearm schema and server validation.
- `src/app/settings.ts`, `notices.ts`: asynchronous validation/CAS, origin guards, durable revision notices, source synchronization and retry timers.
- `src/app/delivery.ts`, `passes.ts`, `assessment.ts`, `tools/executor.ts`: persisted delivery dedupe and flush, pass serialization, eval read/cache lifecycle, report atomicity and assignment revalidation.
- `src/app/store-read.ts`: changed arrival-window queries, one-statement flow snapshot, indexed subscribed reads and failure joins. Receipt methods in `store.ts` were traced as an interaction, not a new full storage-engine audit.
- `src/sources/registry.ts`, `kind.ts`, `send.ts`, `poll.ts`: registration and health ownership, plugin outcome contracts, source scope, idempotency declarations, thread failure persistence and sliced waits.
- `src/sources/feishu-loops.ts`, `feishu.ts`, `feishu-channel.ts`, `github-channel.ts`, `github-trigger.ts`: source configuration, first-observed floor, replay/reconciliation checkpoints, page progress guards, thread polling, event diagnostics, outbound checks and marker lookup.
- Changed core owning files `src/core/intake.ts`, `evals.ts`, `tickets.ts`, `ports.ts`; supporting complete files `engine.ts`, `part.ts`, `assignments.ts`, `replies.ts`, `model.ts` for transactional/authority and lifecycle interactions.

`github.ts`, executor/workspace/session internals, metrics and other storage internals were assigned to the other backend reviewer. Reading an interaction here does not replace that review.

## Executed verification

Dependency install: frozen lockfile, scripts disabled; succeeded. No paid model or external messaging calls.

Existing test batches at fd3b7a6:

- 18 files, 233 tests, all passed, 28.28s.
- 12 files, 57 tests, all passed, 6.94s.
- 8 files, 68 tests, all passed, 9.37s.

Three test files were repeated between batches. Exact unique inventory is attached separately. These are targeted checks, not a canonical full-suite claim. They include actual outbox process-kill tests, persisted markers, blocked/rearm HTTP handling, delivery requeue, 49/50/10000-event ingestion, source faults, malformed responses, late-tool characterization, durable records, repository scoping, source recovery and snapshot reads. The new two-case falsifier is RED separately and not included in the green totals.

`git diff --check` passed for the reviewed checkout. No tracked source changes were made; only the private new probe was untracked.

## Limits and non-claims

- No new canonical full suite, typecheck or build was run by this reviewer; another reviewer owns those gates. No new GitHub CI artifact was inspected here.
- No live GitHub/Feishu send or provider dedupe/expiry experiment. Provider and CLI service behavior is not proven by local stubs.
- No new exhaustive storage crash/backup, concurrent-writer, pool, benchmark, operating-system or browser certification.
- No exhaustive review of all tests, reports, scripts or every unchanged core module. The explicit owning-file list above is the coverage claim.
- Unbounded Feishu seen-ID history and live stdout queue growth remain operational boundaries in the owning files, but this review did not establish a new regression or measure a failure threshold. They are not promoted to confirmed defects.
- The runtime-758 ordering hypothesis was not probed by this reviewer and remains outside this verdict.
- Raw error/health text and the general HTTP 500 fallback are not certified secret-free. A separate error-feed review remains necessary; this review does not convert it to fixed.

## Required next step

Repair and independently replay the P2 falsifier unchanged, then run the affected GitHub read/send, Effects, outbox unknown-outcome and expiry checks. Record the repair SHA separately from the reviewed SHA. Keep the unresolved old-turn attribution and other open gates named in merge readiness.
