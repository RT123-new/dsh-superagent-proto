# Remaining-backend review: repair status addendum

PR: https://github.com/RT123-new/dsh-superagent-proto/pull/1

## Identity and verdict

Actual Git bundle imported and verified. Bundle HEAD is `4a80182d867f1a8ab881d3f876f7761dffb672c7`; tested code commit is `4955cf6290555d23c39e6f7b502a618997afa066`, tree `157887d5a30b0fa6de3b420824102608bc186fb2`. The 4955cf6..4a80182 delta is documentation/evidence only.

The pre-send retry-policy defect's tested mechanisms are VERIFIED FIXED at 4955cf6: HTTP401 unauthorized parking, typed HTTP429 embargo, repeated HTTP503 failure accounting, and preservation of local no-contact waits. This is a scoped repair verdict, not whole-PR or merge acceptance.

The first repair (d7e6cc3) fixed the 401/429 cases but left repeated retryable pre-read errors at attempts=0/error empty. The second repair (4955cf6) increments the failure counter and stores classified errors while keeping no-POST outcome semantics. This addendum supersedes any earlier statement treating the first repair as complete.

## Independent replay

The reviewer's ORIGINAL 401/429 probe and repeated503 probe were copied unchanged, with byte equality checked against the saved originals. Both pass on the actual code commit:

- HTTP401: blocked:unauthorized, attempts=1.
- HTTP429 Retry-After120s: due=1120000 at clock1000000, attempts=1, stored class rate_limited and serverNotBeforeMs1120000.
- HTTP503 across two dispatches: attempts advances1 to2 and provider_temporary error remains recorded. The existing retryDecision implementation now receives the increasing counter rather than resetting to first-retry jitter.
- Two additional local Later/SendNotAttempted cases pass: due+5000ms, attempts=0, error empty, no post-contact marker retained.

Eight test files /39 executed tests passed in3.83s, including the unchanged private probes, owner's committed presend test, Effects, final outbox recovery (unknown outcomes, explicit acknowledgement and expiry), actual process-kill outbox tests and source faults. The committed owner's401/429 test duplicates the private original and is not additional independent scenario coverage. No canonical full suite, typecheck or build is claimed here. Full output is attached as backend-4955-green.log.

## Remaining limits

The earlier full owning-file coverage and limitations remain in INDEPENDENT_REVIEW_REMAINING_BACKEND.md. Old-turn tool attribution remains unresolved. Provider-error prose in health and the generic500 fallback are not certified secret-free. This review does not establish live provider idempotency or external delivery behavior. Canonical and newCI gates are owned separately. No production edits, external messages, paid calls, push, merge or deployment were performed by this reviewer.
