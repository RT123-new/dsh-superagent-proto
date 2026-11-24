# Second-pass audit: delivery, worker ownership, recovery, and evaluation

**Repository:** `RT123-new/dsh-superagent-proto`
**Review date:** 24 November 2026
**Status:** thirteen confirmed issue groups repaired across two separate draft stacks; local full gates passed. This report is committed before the resulting remote CI checkpoint.

## Assessment

The second pass found material omissions in the first review. The most consequential involved delivery evidence that could disappear during withdrawal, a replacement message incorrectly inheriting an earlier send's success, cancelled reports still changing ticket state, deferred worker failures being applied to successor assignments, provider retry restrictions being lost across polling boundaries, and malformed Feishu responses being accepted as successful. The experimental snapshot and benchmark paths also contained distinct freshness, configuration, persistence, and measurement defects.

These are **thirteen issue groups, not thirteen equally severe incidents or thirteen demonstrated production failures**. Several groups contain related counterexamples to one invariant. Delivery and assignment defects can change operational outcomes; the snapshot and comparator defects principally weaken experimental recovery behavior and the credibility of its evaluation. The CI finding concerns whether an advertised check actually checks committed changes.

The repairs improve the software's tested behavior. They do not establish production readiness, autonomous task completion, live receipt reliability, lower model cost, or a measured benefit from resume snapshots. The next experiment should test one bounded intervention on a frozen, independently assessed task cohort after the stacks have been reconciled.

## Scope, provenance, and method

The starting points were the exact first-pass heads:

| Stack | Review location | Starting commit |
| --- | --- | --- |
| Reliability | [Draft PR #4](https://github.com/RT123-new/dsh-superagent-proto/pull/4) | `e87680efdf44be4be44bf6bea5e7da8fe414fd0e` |
| Recovery | [Draft PR #5](https://github.com/RT123-new/dsh-superagent-proto/pull/5) | `c0bd1332dfe03d6a2b01992bfbb9f286b46244ef` |

The user directed a deeper second review. Assistant agents performed the source inspection, constructed adversarial cases, implemented repairs, and ran the checks. Separate agent reviews supplied additional review paths; they are not an external certification. No claim is made that the user personally implemented these changes.

The review followed state across boundaries instead of treating a passing helper test as proof that its callers preserve the same guarantees. The main paths examined were queue creation, provider contact, withdrawal, settlement, cancellation, deferred error handling, assignment replacement, bounded file continuation, polling aggregation, retry persistence, snapshot capture and reuse, model-visible configuration, and benchmark verdict calculation. This report does not claim that every repository file received line-by-line review.

For suspected failures, the preferred sequence was a small deterministic counterexample on the preceding implementation, the smallest repair supported by that evidence, and a regression check covering the failure plus a useful control. Broader suite runs then checked compatibility. Synthetic fixtures test code and arithmetic; they are not observations of a live model. Raw failure logs were retained rather than replacing the record with only green reruns.

## Findings ledger

Priority judgement: SP01, SP03, SP04, and SP07 are P1 because they can misstate delivery or mutate the wrong operational state. SP02, SP05, SP06, and SP08–SP12 are P2 correctness or evidence-integrity repairs. SP13 is a P3 validation defect. These priorities describe the demonstrated code paths, not observed production incident frequency.

| ID | Issue group | Main consequence | Stack repaired | Evidence status |
| --- | --- | --- | --- | --- |
| SP01 | Withdrawal erased uncertain sends and allowed false replacement settlement | Duplicate risk or inaccurate delivery history | Reliability | Deterministic failures reproduced; regressions green |
| SP02 | Invalid or future idempotency timestamps passed the window check | Unsafe retry after possibly accepted contact | Reliability | Invalid-date and future-date failures reproduced |
| SP03 | Cancelled reports could still commit | A cancelled ready report could end a ticket | Reliability | Cancellation before and during lookup reproduced |
| SP04 | Deferred failures lost assignment identity | An old worker could fail its successor | Both | Deferred error and retry rejection reproduced |
| SP05 | CRLF handling lost continuation at the byte limit | Omitted source text could become unreachable | Reliability | Exact-boundary counterexamples reproduced |
| SP06 | Polling discarded retry restrictions, including during local write failures | Further reads could occur during an embargo | Reliability | Multiple polling lanes and persistence failures reproduced |
| SP07 | Feishu JSON/envelope failures were misclassified | Lost transport meaning or false acknowledgement | Reliability | Truncated JSON and truthy non-boolean success reproduced |
| SP08 | Delivered-but-unread inputs appeared fresh | Recovery hint could omit an unseen constraint | Recovery | Engine lifecycle counterexample reproduced |
| SP09 | Snapshot enable state was absent from worker context | Worker could not reliably follow the feature toggle | Recovery | Existing-Session toggle regression reproduced |
| SP10 | Corrupt preceding snapshot metadata poisoned replacements | Valid new hints could remain unavailable | Recovery | Malformed revision failure reproduced; metadata variants covered |
| SP11 | Snapshot-contaminated baseline could pass | Positive comparison without a clean control | Recovery | Explicit baseline use incorrectly passed |
| SP12 | Safety event density was labelled trial failure rate | Misleading risk measure, potentially above 100% | Recovery | Sixty events in one of thirty trials reproduced |
| SP13 | CI checked the checkout against itself | Committed whitespace defects escaped the gate | Reliability | Clean-checkout fixture: old exit 0, corrected exit 2 |

### SP01 — Preserve delivery evidence through withdrawal

The relevant invariant is that cancelling future delivery cannot undo provider contact. The old withdrawal path deleted a pending receipt even when an attempt was running or its outcome was uncertain. Reusing that identifier could create a replacement payload, after which a late acknowledgement from the original attempt could incorrectly mark the replacement sent. Withdrawal could also erase evidence that an earlier delivery may already have succeeded.

The repair retains an immutable receipt tombstone when contact or an unsettled attempt exists. It stops future scheduling while preserving the original payload and uncertainty. A later definitive outcome may settle that original receipt. User-facing wording now says delivery stopped instead of asserting that a message was not sent. This is tested state preservation, not proof that a remote provider delivered exactly once. See `src/app/outbox.ts`, `src/app/effects.ts`, `src/app/store.ts`, and `tests/review-second-pass-outbox.spec.ts`.

### SP02 — Reject untrustworthy idempotency ages

A provider's deduplication window only helps when the host can establish that an earlier key use is still inside it. The existing comparison accepted malformed timestamps because comparisons with `NaN` are false. A future timestamp similarly appeared younger than the window, including after a backward clock change.

After possible provider contact, missing, invalid, future, or expired queue times now park the attempt as uncertain before another provider invocation. Valid in-window behavior remains available. Regression cases use both an invalid date and a far-future date. The host still relies on the provider's actual idempotency contract; this check cannot extend that contract or establish a receipt that was never observed.

### SP03 — Cancelled reports must not commit

The reliability report tool checked ticket and assignment identity but did not consistently enforce its cancellation signal. A report already cancelled before invocation could commit a ready state. Cancellation during an asynchronous PR lookup could also be followed by PR claiming and report persistence.

The tool now checks cancellation on entry and again inside the atomic mutation boundary, before claiming the PR or recording the report. Tests verify rejection and the absence of those side effects. This protects cancellation within an invocation. It does not identify which historical model turn originated an invocation that begins after reassignment; that separate provenance gap remains open.

### SP04 — Carry assignment identity into deferred failures

The event handler could observe an error while assignment A owned a ticket, defer its work to a microtask, then reread the ticket after assignment B replaced A. The deferred callback recorded a failure on B because it retained only the ticket identifier. A deferred retry failure exposed the same ownership problem.

The failure path now carries the originating assignment identifier through its callers and validates the current, live, non-ended owner inside the transaction. Closing or disposed runtimes are also excluded. Both stacks received the repair. The deterministic cases reproduce replacement before deferred execution and include a same-assignment control proving legitimate failures still record. This fixes demonstrated callback ownership loss without claiming a general solution to framework-level turn attribution.

### SP05 — Count normalized CRLF text without losing the next page

The bounded reader removed a trailing carriage return when completing a line, but counted that character against the byte limit earlier. When text exactly filled the output allowance before a CRLF, the extra carriage return could prematurely terminate the read and lose a valid continuation. Tests also exercised embedded carriage returns at the boundary.

The reader now defers a potential trailing carriage return until the following character determines whether it belongs to the returned text. Embedded returns remain data; a trailing return at line end or EOF is handled consistently. This repairs the specified text and continuation behavior. The file reader remains application-level containment, not an OS sandbox, and its byte cap does not bound every native tool output or provider token count.

### SP06 — Preserve and obey provider retry restrictions through every boundary

Typed retry metadata at the command layer was insufficient because polling callers aggregated failures into strings and continued into other provider reads. Counterexamples covered notifications, repository streams, notification items, and subscribed threads. A trusted restriction on one lane therefore did not reliably stop the rest of the round.

The round now propagates the original rate-limit or future server-embargo error and halts subsequent provider reads. Notification ownership is retained without advancing past unvisited work. A further adversarial pass found that failure to save a retry map or diagnostic could replace the provider error with a local storage exception, again losing the embargo. Those paths now preserve the original restriction even when the local write fails. Ordinary independent errors still follow their existing handling.

The tests establish propagation and scheduling behavior for the exercised paths. They do not establish all provider retry behavior, recovery under every storage failure, or transport timing in a live account. See `tests/second-pass-poll-embargo.spec.ts` and `tests/second-pass-embargo-persistence.spec.ts`.

### SP07 — Treat unreadable or invalid Feishu envelopes as transport failures

Malformed Feishu CLI JSON previously escaped as a plain parsing exception, losing the unreadable-response classification used at transport boundaries. A separate case exposed a more direct reporting error: the JSON value `ok: "false"` was truthy and could be interpreted as acknowledgement.

The command boundary now requires a non-array object with a boolean `ok` field. Unparseable content or an invalid envelope becomes an unreadable `CliError`; raw response text is excluded from that diagnostic. A valid boolean failure still follows normal provider-error handling. The tests establish these envelope rules, not comprehensive validation of every service-specific `data` payload or a live delivery receipt.

### SP08 — Distinguish delivery from model consumption

An input could arrive before snapshot capture, be delivered to the Session inbox, and disappear from `undelivered` while its `readAt` remained null. The prior freshness check considered only arrival time and the undelivered queue, so it labelled the snapshot fresh even though the reporting model had not read the constraint. Reading the input after capture cannot retroactively update the earlier note.

Freshness now considers trigger read time and conservatively handles unread, unknown, invalid, and equal-time observations. Legacy delivery timestamps remain supported where available. An engine lifecycle test verifies the unseen-input case, the later-read case, and a genuinely later replacement note. Non-trigger notes and policy inputs lack individual read timestamps; their consumption remains unproven after delivery.

### SP09 — Expose the live feature setting to workers

Worker instructions required snapshots only when the deployment enabled them, but the current setting was absent from model-visible context. Workers also could not read the general deployment settings. The implementation therefore supplied a conditional instruction without reliably supplying its condition.

The current enabled/disabled value is now rendered on every worker model request, including requests from a Session created before the setting changed. The test toggles the setting on an existing worker. The added text initially exceeded the existing worker character budget by four characters; it was shortened and the original threshold retained. This establishes configuration visibility, not that a model will produce useful snapshots or that their cost is justified.

### SP10 — Allow valid notes to replace corrupt persisted metadata

Readers correctly rejected malformed stored snapshots, but the write path still trusted their revision when calculating the next one. A malformed revision could make every later valid payload appear invalid. Identical payload deduplication could also retain invalid host-owned ticket or timestamp metadata.

The report boundary now validates the previous snapshot before using its revision. If a valid replacement is ready, invalid previous metadata is removed inside the same transaction as the new report. The ticket is reread after PR binding so that repair does not overwrite the binding. Tests cover malformed revision, wrong ticket identity, invalid capture time, and rollback when the report itself is rejected. This is recovery from injected malformed persisted state, not evidence of a demonstrated external corruption attack.

### SP11 — Require an observed clean baseline

The benchmark validated the type of `usedSnapshot` on both conditions but ignored its baseline value when deciding success. A cohort with explicit snapshot use in every baseline could receive `meets_preregistered_targets`. Missing baseline observations also did not prevent that verdict.

A positive result now requires explicit false usage for every baseline. Missing usage is inconclusive, while observed baseline use invalidates the control. The synthetic positive fixture was updated to state its clean baseline. This closes a control-validation defect; it does not prove task independence, trustworthy telemetry, correct randomization, representative tasks, or actual feature efficacy.

### SP12 — Separate affected trials from event density

The comparator divided total safety events by trial count and named that result `failureRate`. Sixty events in one of thirty trials therefore appeared as a rate of 2. That conflated two different questions: how many trials had any failure, and how many events occurred per trial.

The output now preserves `failures` as the event count, reports `failedTrials`, computes `failureRate` as the affected-trial fraction, and exposes `eventsPerTrial` for event density. Incomplete telemetry leaves these measures unknown. The repair changes measurement semantics explicitly; it does not estimate a population safety guarantee from a small zero-event sample.

### SP13 — Make the committed-change check meaningful

After a clean Actions checkout, `git diff --check HEAD` compared the working tree with its own checked-out commit. It could pass even when the commit introduced trailing whitespace. An isolated clean-checkout fixture demonstrated the old gate returning 0 and a committed-range check returning 2 with the expected diagnostic.

The workflow now fetches history and checks the tested commit against the PR base or preceding push head, with a parent fallback for a branch's first push. The preserved fixture is `ci-committed-diff.json`. The manual result establishes why the old check was ineffective; the final remote workflow result still needs to be bound to the pushed head below.

## Verification record and honest failures

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Recovery initial full gate | 61 files passed, 1 failed; 1,221 tests passed, 1 failed | New test file was missing from the required architecture test inventory; failure retained |
| Recovery final full gate | 62 files; 1,222 tests passed; typecheck and build passed | Inventory corrected, full gate rerun successfully |
| Reliability full gate | 152 files; 1,820 tests passed, 2 skipped; typecheck and build passed | Local full gate successful; existing opt-in REVIEW_MATRIX profiles remain skipped |
| Dedicated Stage D | 2 files, 11 tests passed; `DSH_STAGE_D=1`; 35.87 seconds | Separate strict local gate completed successfully |
| Published reliability commit and remote CI | Recorded subsequently in the PR #4 audit checkpoint | Local source hashes are preserved here; remote results must bind to the pushed commit |
| Published recovery commit and remote CI | Recorded subsequently in the PR #5 audit checkpoint | Local source hashes are preserved here; remote results must bind to the pushed commit |

Targeted runs overlap the full suites and must not be added together as a count of distinct checks. Before/after logs include `outbox-red.log`, `worker-boundaries-red.log`, `worker-error-generation-red.log`, `poll-embargo-red.log`, `embargo-persistence-red.log`, `lark-response-red.log`, `lark-envelope-red.log`, and the recovery regression logs. They record observed failures and subsequent results without implying that every imaginable interleaving was exercised.

The accompanying [evidence.zip](evidence.zip) contains 32 evidence files, including the source SHA-256 manifests, plus an archive checksum index. It preserves original failure output and successful local gates without rewriting raw log whitespace. Archive size: **62,102 bytes**. SHA-256: `6c92c34b9d30508fa631f00f268244bdf7a2a2bf88fc36d6b9fcfca29d5236e1`. Remote CI is recorded separately after this report is committed. The PR checkpoint must identify the actual pushed commit and workflow result instead of inferring them from local success.

Local gates used Node 24.22.3 and pnpm 11.25.0 with the frozen lockfile. CI uses pnpm 11.7.0, with Node 22.23.4 on reliability and Node 24 on recovery. The local dependency-manager difference is a verification boundary, not an automatic failure. A Node FileHandle garbage-collection warning appeared during the reliability suite without failing it; its origin was not localized. It should not be represented as either a proven leak or a demonstrated clean resource lifecycle.

## Integration remains a separate blocking task

The complete original branch comparison, using the local repository rather than a truncated remote file listing, found **609 changed paths on reliability, 24 on recovery, and 12 shared paths**. A dry integration attempt found seven conflicts:

- `.github/workflows/validate.yml`
- `docs/007-architecture.md`
- `src/app/tools/executor.ts`
- `src/executor/dsh.ts`
- `src/sources/feishu-loops.ts`
- `tests/core-engine.spec.ts`
- `tests/sources.spec.ts`

These counts describe the original audit stacks, not the number of files changed by this second pass. The older remote comparison's 300-file ceiling was not a complete overlap analysis. Separate green branches do not prove the combined behavior. The seven conflicts include execution, reporting, and event handling, so resolving them requires preserving both sets of invariants and running the combined tree's gates. This review has not merged or deployed either stack.

## What remains unproven, and the next experiment

The original performance hypothesis is that bounded, relevant context and optional recovery notes reduce repeated model work while preserving correct completion and delivery. Deterministic tests show narrower software properties: particular receipts survive withdrawal, particular stale callbacks cannot mutate successors, specific reads retain continuation, and specified invalid evidence cannot earn a positive benchmark verdict. There is still no live cohort demonstrating the performance hypothesis.

Before expanding orchestration, freeze the reconciled code and choose one intervention. Use paired tasks from equivalent clean repository states, unchanged model and tool configurations, a fixed total budget, and independent completion checks. Explicitly record which baseline runs were unexposed. Keep all eligible attempts in the denominator, including failed, abandoned, and timed-out work. Record full prompt, output, cached usage, retry and snapshot-generation overhead, measured spend, actual completion status, and original-conversation delivery receipts where delivery is part of the task.

At least thirty pairs can provide an initial evaluation, but thirty alone does not establish independence, adequate power, or rare-event safety. Freeze an absolute correctness floor and the latency, token, cost-per-correct-completion, and tail-latency targets before observing the cohort. Reject the hypothesis if savings disappear after overhead and failures are counted, correctness regresses, an agreed quality floor is missed, or required delivery cannot be independently confirmed. A single compelling example does not override the cohort.

The current comparator cannot represent a never-resumed trial with a null resume time. Define censoring and failure treatment before running the experiment; do not delete such trials or invent terminal timestamps. Partial candidate adoption can support an intention-to-treat comparison, but it does not by itself establish efficacy among actual snapshot users. The feature remains off by default, and snapshot freshness, repository claims, credential filtering, trusted turn identity, OS isolation, provider billing coverage, and live delivery retain their stated limits.

**Next most valuable action:** reconcile the two stacks, bind the combined gates to an immutable commit, then complete one preregistered paired evaluation. Adding mechanisms before that evaluation would make attribution harder while leaving the central hypothesis unresolved.
