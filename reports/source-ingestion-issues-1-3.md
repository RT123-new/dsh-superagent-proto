# Source-ingestion correctness: Issues 1-3

Branch `fix/source-ingestion-issues-1-3` from `8c32a9d`. Main untouched, no merge. Evidence classifications:
CONFIRMED / SOURCE-SUPPORTED / HYPOTHESIS / REFUTED / NOT TESTED.

## Issue 1 - GitHub notifications can be missed (CONFIRMED, fixed)

Defect (SOURCE-SUPPORTED, pre-fix `src/sources/github.ts` `pollNotifications`): the notification cursor advanced to five
seconds before the scan start, and GitHub's `since` filter is strictly-after; an event whose notification GitHub
delivered more than five seconds late was never listed and never read.

Fix:
- Configurable replay window `replaySeconds` (default 120, range 5-3600): the durable cursor trails each completed
  scan by the window plus a one-second edge guard against the strictly-after filter.
- Separate durable concepts: `KV.github.since` (replay cursor), `KV.github.cursor(number)` (per-thread read position),
  `KV.github.retries` (failed reads), and new `KV.github.scan` = `{ lastCompletedScan, lastReconciliation }`.
- Periodic reconciliation: every `reconcileMinutes` (default 30; 0 switches it off) a wider scan over
  `reconcileHorizonSeconds` (default 3600) recovers notifications delivered beyond the replay window. Each recovered
  item reads from the later of its thread cursor and the reconciliation window, so reconciliation never re-reads what
  a thread already has. A failed reconciliation fails the round toward the error threshold and does not advance the
  cadence record.
- At-most-once: trigger identity is unchanged (`key('github-comment', html_url, id, version)` etc.); overlap is
  re-read and deduplicated, never re-stored (CONFIRMED by stored-vs-duplicate counts in the tests).
- The checkpoint advances only after every notified item is durably processed, atomically with the retry and scan
  records (pre-existing atomicity preserved, scan record folded in).

Regression matrix (`tests/issue-1-github-notification-delivery.spec.ts`, 10 tests):
immediate (passed throughout); 5s / 30s / 120s late (CONFIRMED failing before, passing after); beyond-window via
reconciliation (failing before, passing after); reconciliation cadence: due on the round after the scan record
appears, then not again inside the interval (failing before, passing after); `reconcileMinutes: 0` pins the documented
residual risk (passing throughout); out-of-order notifications exactly once each (passing throughout); repeated
listing stays at-most-once (passing throughout); process restart mid-retry resumes from the durable retry record
(passing throughout); a failing later notifications page keeps the checkpoint and retries with neither loss nor
duplication (passing throughout).

Residual risk (documented): a notification delayed beyond `reconcileHorizonSeconds` is undetectable by polling, and
`reconcileMinutes: 0` leaves beyond-window events uncovered (a test pins both behaviors). Webhook path evaluation:
GitHub webhooks would remove the delivery-latency dependence but require a reachable endpoint and secret management;
NOT TESTED here. Replay window plus bounded-horizon reconciliation covers the failure mode without new infrastructure.

## Issue 2 - GitHub `readStream()` pagination loses events (CONFIRMED, fixed)

Defect (SOURCE-SUPPORTED, pre-fix `readStream`): only the first `per_page=100` page was read. A burst larger than one
page dropped its tail, and a burst of more than 100 events sharing one timestamp starved the stream: the cursor stayed
five seconds before the shared timestamp, so every round re-read page one and never reached the rest.

Fix: fetch page one with `--include`; when the Link header carries `rel="next"`, follow pagination from `page=2` via
`commands.pages` (the first page is never re-requested); stage nothing until every page is read, so a failed later page
ingests nothing and leaves the cursor untouched; order items deterministically by (`updated_at`, `id`) so
identical-timestamp bursts are stable; the cursor steps five seconds behind the newest item only after all pages are
processed; ETag-on-unchanged is preserved.

Tests (`tests/issue-2-github-stream-pagination.spec.ts`, 11): sizes 0/1/99/100 (passed throughout); 101/201/1000
(failing before, passing after); 150 events sharing one timestamp (failing before, passing after; cursor holds and a
quiet round deduplicates all 150); mid-pagination failure: checkpoint never advances past unread pages, nothing is
staged, the next round recovers all 201 (failing before, passing after); a re-presented burst is ingested exactly once
logically (passing throughout); pagination links are followed instead of re-requesting page one (failing before,
passing after).

## Issue 3 - Feishu history backfill recovery (gap CONFIRMED, fixed; existing behavior locked)

Already correct pre-fix (CONFIRMED by behavior-lock tests passing before and after): the per-chat checkpoint advances
only after the chat and its active topics complete; a failed first/middle/final page skips nothing (the cursor holds
and the next round re-reads, deduplicated by message identity); a mid-scan abort holds the cursor; live events,
history backfill and per-conversation polling share `feishuTriggerId(message_id)`; the stranger/mention admission
distinction is preserved; a first-seen chat intentionally initializes without backfill (unchanged).

Gap fixed: the fixed five-second overlap could not cover Feishu's history indexing latency. Now `replaySeconds`
(default 120) trails each chat's cursor; per-chat reconciliation (`reconcileMinutes` / `reconcileHorizonSeconds`,
`KV.feishu.reconcile:<chat>`) widens the scan window when the cadence is due; the cursor still advances only after
durable completion, so a failed page still skips nothing and replay stays idempotent.

Tests (`tests/issue-3-feishu-history-recovery.spec.ts`, 10): the seven behavior-lock tests above (passing throughout);
a message indexed late but inside the replay window (failing before, passing after); a message indexed beyond the
window recovered once reconciliation is due (failing before, passing after); the loop keeps the configured replay
window behind each scan (failing before, passing after).

## Failing-first evidence

With only the source changes stashed (tests in place): 15 failed / 16 passed across the 31 tests (issue-1: 5,
issue-2: 7, issue-3: 3). With the fixes: 31/31 pass. `tests/sources.spec.ts` is back to 70/71, the one failure being
the pre-existing PRE-1. Full suite: 1227/1228, the one failure being PRE-1.

## PRE-1 (pre-existing, characterized, NOT fixed - integration owns it)

`tests/sources.spec.ts` "feishu event consumer > takes in the event lines it reads, records each chat as direct or
not, and reports a malformed line without stopping" fails reproducibly on baseline `8c32a9d` and still fails on this
branch. Characterization: `consume()` in `src/sources/feishu-loops.ts` reports Feishu health from two unordered
channels. The stderr handler sets state `ready` / "Listening for bot events" when the `[event] ready` line arrives;
the stdout chain's `catch` reports a malformed event line as `error`. The channels race: when the ready line arrives
after the malformed line, the later `ready` report overwrites the error, and the test's error expectation fails (it
observes `ready`/Listening instead). The consumer keeps running either way; the impact is that the health note of a
dropped malformed event can be masked by the ready report. Registered as PRE-1; not folded into these fixes.

## Shared-interface notes for integration

- `src/sources/poll.ts`: `cursorAt(started, replayMs = 5000)` gains an optional second parameter (old behavior is the
  default); adds exported helpers `reconcileDue` and `recoverySince`. Additive only.
- `src/kv.ts`: additive, namespaced keys only: `KV.github.scan` (`github-notification-scan`) and the
  `KV.feishu.reconcile` family (`feishu-reconcile:`). No existing key changed.
- Config schemas: `GithubConfigSchema` and `FeishuConfigSchema` gain `replaySeconds`, `reconcileMinutes`,
  `reconcileHorizonSeconds` with defaults (120 / 30 / 3600). Both schemas are `.strict()`; stored configs parse
  unchanged. No UI `fields` entries were added: the knobs are advanced, schema-only, and defaults apply.
- Owned-file interactions per the ownership map: `tests/sources.spec.ts` (one expectation: github schema defaults),
  `tests/registry.spec.ts` (github defaults), `docs/007-architecture.md` (test-table row for the new specs).
  `src/core/**` and `src/infra/**` are untouched (zero diff).
- Health detail: a round that recovered items appends `; reconciliation recovered N earlier` to the GitHub detail.
