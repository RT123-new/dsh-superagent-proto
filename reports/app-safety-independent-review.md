# Independent adversarial review: Issues 6-8

Base: author fix cda2328, baseline 8c32a9d, author failing-first 17e4a14. Review branch: review/app-safety-adversarial. No paid model calls, deployment, source polling, or live external effects were used. Main branch untouched.

## Evidence ledger

- Tested: author's 28 tests on cda2328. Passed: 28/28.
- Tested: author's failing-first commit17e4a14 independently. Failed:10; passed:7 (17 total). The later11 resolver tests were introduced with the fix; they cannot be run against the nonexistent resolver module in the failing-first commit. The claimed12 failures were not reproduced.
- Tested: six new adversarial cases on cda2328, committed29aa358. Failed all six: permission loss during delivery; permission loss during backoff; missing master losing notice; same-millisecond repeated policy transition loss; unrelated unloaded parent denied; unrelated deeply nested chain denied. Other29 tests passed.
- Tested: immutable revision duplicate with different serialization/changed-path payload. Failed before identity repair; passed after.
- Tested: real SQLite close/reopen and history replay, coalesced waiting revisions, in-flight generation replacement, injection failure/retry, simultaneous saves, runtime current-policy permission loss, persisted managed provenance across SQLite reopen, bounded record size per Session.
- Passed: final scoped tests and typecheck/build. See evidence logs. Final full suite:1240 passed/1241 total, sole failure PRE-1 Feishu health-state expectation. Final focused suite:50/50, including docs and43 issue-specific tests.

## Findings and repairs

### Issue6: retry permissions

Author callback protected liveness/current assignment/pause but never checked current permissions. Added required ExecutorHost.authorized(ticket), runtime-wired to the existing settingsPolicy(...).revalidate(mandate). Checked before starting retry delivery and immediately before commit. Automated retries are new-message boundaries; this does not revoke active Mandates or stop unrelated active work. Unit races and a real Runtime policy withdrawal prove zero new stale retry messages; existing active Ticket remains live. Shutdown/restart callback discards pending retry. Existing AgentDelivery validates that the exact target Agent still exists after history awaits, so Session deletion cannot deliver to a disposed target. Session creation cancellation is a separate integration-owner workstream and was not changed here.

### Issue7: notices and required policy transitions

Revision in the payload alone was not immutable identity: hashing serialization allowed one revision to deliver twice with reordered or expanded fields. Settings now use settings:<block>:<revision> directly. Other notices retain payload identity. Master resolution failure now throws, retaining its durable effect instead of silently deleting it. Informational notices may coalesce to latest; tests check latest observed state, not delivery of every rapid revision. Effects generation matching protects newer payloads during an older in-flight attempt, and replayed history prevents duplicate delivery after reopen.

Required policy Inputs had a separate collision: their key used from/to/wall timestamp, dropping repeated transitions within one millisecond. Key now uses Ticket input append position, allocated synchronously inside the existing transaction. Every required repeated revocation input remains distinct. Simultaneous same-block saves produce one success and one optimistic conflict, preserving state and observation revision.

### Issue8: provenance and unrelated Sessions

Author denied every unknown parent/cycle/depth chain. That modified unrelated user permissions and violated the explicit requirement. Fixed by retaining one originating Ticket ID per observed managed Session in session-worker: KV records. Known managed parents resolve through durable records after unloading/restart; descendants cannot change their inherited Ticket by changing parent metadata, and deleted/ended Tickets still deny execution through the live guard. Unrelated unknown or very deep chains are logged, not restricted.

State is constant-size per managed Session, no records for unrelated Sessions and no per-turn history. Total records grow with managed Session count, intentionally retained after parent deletion because deleting them would permit surviving descendants to escape. No schema migration is required. Existing loaded chains migrate lazily when first observed. Framework persistence does expose asynchronous Session headers; adopting it needs a separate pre-execution gating design and was not quietly introduced across synchronous guard boundaries.

## Residual risks / unproven

- A pre-upgrade or never-observed managed descendant with a missing parent and no recorded provenance is indistinguishable from unrelated work. It is not restricted automatically. Universal fail-closed protection cannot be claimed for that case. The limitation is explicit rather than silently restricting all unrelated Sessions.
- The defensive64-hop resolver bound can leave wholly unobserved chains unclassified; normally observed managed descendants use recorded ticket lineage in one hop.
- Provenance records have no garbage collection because surviving descendants may still need them. They are one ticket string per Session, not globally capped storage.
- Agent creation before cancellation is handled separately by integration owner. These changes prove retry message commit safety, not full creation cancellation.
- No performance, token saving, live-provider permission enforcement, or paid-model claims are made.
