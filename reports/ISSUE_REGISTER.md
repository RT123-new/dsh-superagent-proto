# ISSUE REGISTER

Every issue in Reg's mandate (2026-11-04, iMessage) plus pre-existing findings.
Dispositions stay alive to programme end, including REFUTED and NOT TESTED.
Classifications: CONFIRMED / SOURCE-SUPPORTED / HYPOTHESIS / REFUTED / NOT TESTED.

Legend for workstream ownership: W13 = ingestion (1-3), W45 = workspace/cancellation (4-5), W68 = app safety (6-8), INT = integration (this branch).

## PRE-1 — Feishu health race on malformed event line (pre-existing, found at baseline)

- Hypothesis: stderr ready-report and stdout malformed-line error-report race; ready can overwrite error.
- Source: src/sources/feishu-loops.ts:70-104; tests/sources.spec.ts:1082-1099.
- Reproduction: `pnpm test` and `npx vitest run tests/sources.spec.ts` at baseline commit 8c32a9d both fail the named test.
- Classification: SOURCE-SUPPORTED (reproduced 2/2; root cause preliminary).
- Root cause: pending W13 confirmation.
- Implementation approach: TBD by W13 (adjacent to Issue 3).
- Tests added: existing test already fails at baseline.
- Final status: REPAIRED (`11457b0` failing-first, `cd5258e` fix). Controlled stdout-error / delayed stderr-readiness test proves the race and preserves diagnostics. Source suite passes; included in green full integration.
- Remaining risk: malformed-line visibility lost in production health panel.

## ISSUE 1 — GitHub notifications can be missed

- Hypothesis: short-overlap cursor misses late-delivered notifications.
- Source: src/sources/github.ts, src/sources/poll.ts, src/kv.ts.
- Classification: NOT TESTED. Owner: W13.
- Plan: durable replay-safe ingestion; watermark/replay-window (120s initial); stable event identity dedupe; reconciliation scan; checkpoint after durable processing; late/out-of-order/repeated/restart/API-failure tests.
- Status: REPAIRED within bounded scan coverage. Independent six-case adversarial failure reproduced before repair; integrated `pnpm check` at f32c506 passes 1271/1271 tests. See reports/independent-ingestion-review.md for exact recovery bounds and remaining remote pagination limits.

## ISSUE 2 — GitHub pagination can lose events

- Source: readStream() in src/sources/github.ts:203-249. Owner: W13.
- Source evidence (INT, 2026-11-04): readStream issues ONE `api(listed, '--include')` call with per_page=100 and NO pagination following (commands.pages() with --paginate exists at src/infra/commands.ts:89-93 but is unused here). Cursor advances to cursorAt(newest item on the FIRST page) = newest-5s (poll.ts cursorAt). With sort=updated asc, >100 items inside the same ~5s timestamp window re-fetch the same first page every round: items beyond page 1 are never reached (timestamp-only cursor, no stable identity ordering). Notifications and per-thread comment reads DO paginate via commands.pages.
- Classification: SOURCE-SUPPORTED (mechanism verified in code; executable loss/stall tests owed by W13).
- Plan: full Link-header pagination; checkpoint never past unread pages; page-limit continuation; identical-timestamp ordering by stable identity; synthetic streams 0/1/99/100/101/201/1000 + identical timestamps + mid-pagination failures.
- Status: REPAIRED in integrated f32c506; author and adversarial suites pass. See reports/independent-ingestion-review.md.

## ISSUE 3 — Feishu history recovery can skip messages

- Source: src/sources/feishu-loops.ts (backfillLoop:127-160, backfillChat:162+), src/sources/feishu-read.ts, src/sources/poll.ts. Owner: W13.
- Source evidence (INT, 2026-11-04): per-chat history cursor advances to cursorAt(started) = started-5s ONLY after backfillChat completes (good checkpoint-after-completion), BUT the same 5s-only overlap as GitHub applies: a message delivered to the history API later than 5s after its create_time, once the cursor passed, is skipped. A never-before-seen chat initialises its cursor to `started` with NO backfill (messages before first observation skipped by design). Mid-backfill page failure leaves earlier pages' triggers created and cursor unmoved, so at-most-once depends entirely on deterministic trigger-ID dedupe. See also PRE-1.
- Classification: SOURCE-SUPPORTED (executable page-failure/restart tests owed by W13).
- Plan: checkpoint-after-completion; stable identity; idempotent replay; first/middle/final page failure injection; disconnect/restart tests.
- Status: REPAIRED in integrated f32c506; author and adversarial suites pass. See reports/independent-ingestion-review.md.

## ISSUE 4 — Workspace preparation falsely considered successful

- Source: src/executor/dsh.ts (prepareDirectory:247-262, launch:434-437). Owner: W45.
- Source evidence (INT, 2026-11-04): launch() treats `stat(workspace)` success as "already prepared" (comment at :434 admits it, including legacy worktrees). prepareDirectory on failure removes only an EMPTY leftover dir; a non-empty partial directory is kept and is then accepted as prepared on retry (comment at :278-281 admits this). No durable prep state, no config-identity validation.
- Classification: CONFIRMED (W45 failing-first: 11/17 new tests fail at baseline 8c32a9d, reproduced by INT).
- W45 fix @4fc0ecc (durable atomic records, SHA-256 identity, legacy adopt-after-verify): typecheck/build PASS, 1213/1214 (only PRE-1). NOT ACCEPTED: independent reviewer found adoption accepts empty/partial dirs (verifyDirectory checks credential config only) and waitForExit descendant gap; repair in flight on review/issue-4-5-adversarial. Legacy-split resolution (parent-refined 06:33 UTC): no-command→adopt after verify; empty+command→run command; non-empty+command→generic readiness (git work tree + agent/<name> branch + verifyDirectory) then needs-migration/blocked with actionable remediation, files preserved, no silent prepared, no non-idempotent re-run; corrupt marker→no record. runtime.spec:1099 revised with evidence, not quietly.
- Plan: durable prep state machine (unprepared/preparing/prepared/failed/cancelled); atomic marker; config-identity hash (no secrets); legacy workspace migration; partial-creation/failure/timeout/interrupt/restart/config-change tests.
- Status: OPEN.

## ISSUE 5 — Cancellation does not reliably stop preparation

- Owner: W45.
- Source evidence (INT, 2026-11-04): prepareDirectory's signal is AbortSignal.any([host.lifetime, timeout]) only (dsh.ts:253-254) — no assignment-cancellation input. launch() polls `current()` at discrete points but cannot interrupt an in-flight runAsWorker prepare. Cancellation does not reach the prepare child process.
- Classification: CONFIRMED (W45 failing-first reproduced by INT).
- W45 fix @4fc0ecc (assignment-scoped controller, combined signal, settle-before-reuse): NOT ACCEPTED pending adversarial repair (cancellation not reaching verification subprocess; descendant-settlement via handle.done vs waitForExit; config-change window during sessions.ensure).
- Plan: assignment-scoped cancellation controller; propagate to command, child processes, session creation, launch; settle before reuse; cancel at every async boundary tests.
- Status: OPEN.

## ISSUE 6 — Delayed retries can outlive authorisation

- Source: resumeAfter() src/executor/dsh.ts:555-579; Sessions.prompt() src/app/sessions.ts. Owner: W68.
- Source evidence (INT, 2026-11-04): resumeAfter's deferred `go()` rechecks liveness/assignment/pause, but its sessions.prompt call passes NO authorization callback — unlike launch() which passes `() => { if (!current()) throw ... }` (dsh.ts:~460-463). Any wait inside prompt after the go()-time checks is an unchecked window. Retry id `retry:${assignmentId}:${tries}` is stable per attempt.
- Classification: SOURCE-SUPPORTED (deterministic race tests owed by W68).
- Plan: revalidate (ticket live, assignment current/not cancelled, processing permitted, permissions valid) immediately before commit; stable idempotency ids; race suite vs stop/policy/replacement/pause/restart/deletion; zero stale deliveries.
- Status: OPEN.

## ISSUE 7 — Configuration changes lost or delivered stale

- Source: src/app/settings.ts (save:148-195), src/app/notices.ts (settingsNotice:21-23, Notice type:12-14), src/app/sessions.ts, src/app/delivery.ts. Owner: W68.
- Source evidence (INT, 2026-11-04): settings notices carry NO revision identity — settingsNotice(block, changedPaths) contains only block name + changed paths + a read pointer. Effects coalesces by name key `settings:<block>`: a newer notice OVERWRITES an unsent waiting one. A->B->A->B under an unsent queue collapses to one notice; no notification_id = block:revision exists, so duplicate/stale detection per the mandate is impossible today. Coalescing is only safe if the coordinator always re-reads committed state, which is convention, not enforced.
- Classification: SOURCE-SUPPORTED (A->B->A->B, rapid-update, restart and duplicate tests owed by W68).
- Plan: versioned notifications (block:revision identity); idempotent redelivery; A→B→A→B, rapid/failure/restart/duplicate/simultaneous-save tests.
- Status: OPEN.

## ISSUE 8 — Nested subagent permission depth limitation

- Source: limitSubagent() in src/app/sessions.ts:303-311. Owner: W68.
- Source evidence (INT, 2026-11-04): parent traversal bound `depth < 8` confirmed verbatim. On unresolved ancestry (parent undefined after the loop, ticket unknown) the function RETURNS WITHOUT APPLYING RESTRICTIONS — fails open for descendants of managed workers, exactly the escape the mandate names.
- Classification: SOURCE-SUPPORTED (executable depth 1/8/9/20 tests owed by W68).
- Plan: validated ancestry resolution (visited set, terminal conditions, defensible bound); fail closed for managed work; depth 1/8/9/20+, missing parents, cycles, ended tickets, policy changes.
- Status: OPEN.

## ISSUE 9 — Insufficient lifecycle visibility

- Owner: later stage (C). Classification: NOT TESTED. Plan: instrument full lifecycle with monotonic clocks + wall-clock persisted events; P50/P95, queue age, utilisation, tokens/cost, bounded cardinality.

## ISSUE 10 — Sequential polling

- Owner: stage D. Classification: HYPOTHESIS. Plan: bounded worker pool C=1,2,4,8; rate-limit-aware scheduling (reserve formula); adopt only on measured improvement without correctness loss.

## ISSUE 11 — Polling detection delay

- Owner: stage D. Classification: HYPOTHESIS. Plan: measure detection latency; evaluate signed webhook intake (persist-before-ack, dedupe by delivery id, no authority from arrival) with polling reconciliation fallback.

## ISSUE 12 — Repeated CLI process launches

- Source: src/infra/commands.ts. Owner: stage D. Classification: HYPOTHESIS. Plan: measure gh subprocess overhead vs reusable authenticated HTTP client; replace only on measured win; preserve scoping/isolation/pagination/cancellation.

## ISSUE 13 — Central coordinator overload

- Source: src/app/assessment.ts, sessions.ts, src/core/evals.ts, engine.ts. Owner: stage D. Classification: HYPOTHESIS. Plan: measure volume/latency/token cost; 1/3/6/12-worker workloads; correctness of decisions is the gate.

## ISSUE 14 — Head-of-line blocking in ordered queues

- Source: src/app/effects.ts, sessions.ts. Owner: stage D. Classification: HYPOTHESIS. Plan: partition by source+conversation (ticket where needed); failure isolation with visible dead-letter; never silently discard.

## ISSUE 15 — Retry backoff delays

- Owner: stage D. Classification: HYPOTHESIS. Plan: error classification; exponential backoff with bounded jitter; honour server retry instructions; seeded randomness + injected clock; no retry of permanent/unauthorised.

## ISSUE 16 — Worker slots held during background work

- Source: src/executor/dsh.ts, background.ts. Owner: stage D. Classification: HYPOTHESIS. Plan: per-state occupancy measurement; evaluate safe slot release preserving ownership/cancellation; keep human-follow-up reservation; no default worker-count increase.

## ISSUE 17 — Worker concurrency/scheduling

- Owner: stage D. Classification: HYPOTHESIS. Plan: benchmark capacities 3/6/12; throughput, P95, token cost, memory, failures; starvation checks; FIFO stays unless measured need.

## ISSUE 18 — Worker creation/recovery overhead

- Owner: stage D. Classification: HYPOTHESIS. Plan: measure session resolution/creation, prep, model selection, prompt decoration, restart recovery, reuse; cache only immutable/versioned; warm/cold starts, restart storms.

## ISSUE 19 — Unbounded history growth

- Source: src/app/store.ts, store-read.ts, migration.ts. Owner: stage E. Classification: HYPOTHESIS. Plan: optional retention/archival with eligibility predicates, referential checks, export/backup, bounded transactional batches; fixtures 10^3..10^6.

## ISSUE 20 — Synchronous DB access and expensive queries

- Owner: stage E. Classification: HYPOTHESIS. Plan: EXPLAIN QUERY PLAN profiling; targeted indexes; FTS5 evaluation; keyset pagination; measured acceptance on large datasets.

## ISSUE 21 — Context reads waste tokens

- Owner: stage E. Classification: HYPOTHESIS. Plan: measure repeated reads; versioned cache keys; lossless structured cards; compare tokens per correctly completed task, not tokens alone.

## ISSUE 22 — Dashboard bottleneck visibility

- Owner: stage E. Classification: HYPOTHESIS (product). Plan: expose Issue 9 instrumentation in panel; clear wait-reason language; measure panel polling before push.

## ISSUE 23 — Human review delay

- Owner: stage E. Classification: HYPOTHESIS (product). Plan: better review summaries/evidence/links; do not automate merging.

## ISSUE 24 — Single-repository architecture limit

- Owner: stage E. Classification: NOT TESTED (documented product limitation). Plan: review isolation of repository assumptions; document multi-repo changes needed; do NOT implement multi-repo without failing requirement + baseline.

## Integration acceptance ledger (supersedes earlier work-in-progress statuses above)

| Issue | Disposition as of f32c506 | Executed evidence | Remaining risk |
| --- | --- | --- | --- |
| PRE-1 | Repaired | Delayed-ready regression red before fix, 72/72 source tests green after | Per-run diagnostic intentionally sticky until restart |
| 1 | Repaired, bounded recovery | Author baseline15red/16green; reviewer6red/0green before repair; final ingestion40/40 | H=3600/C=1800 does not guarantee3600s delay; outages/mutable pages/endpoint visibility limit coverage |
| 2 | Repaired | 101/201/1000-event and identical-time pagination, page failures and multipage ETag proof | Mutable page-number pagination is not remote snapshot isolation |
| 3 | Existing page checkpoint behavior retained; late indexing and first-seen floor repaired | First/middle/final page failure replay; exact-time floor and restart evidence | Legacy first-seen floor adopted from cursor can exclude older missed messages |
| 4 | Repaired within filesystem limitations | Author17 +reviewer12 +integration full check | No power-loss/fsync proof; prepared record cannot certify arbitrary later manual edits |
| 5 | Partially repaired | Assignment cancellation, owned-range probe, four ensure-boundary regressions | In-flight framework create cannot be interrupted; provider observability + failed disk persistence +crash compound gap; ensure decoration independently reviewed and repaired at3f1a8cf |
| 6–7 | Repaired at3938e19 | Author failing-first10red/7green; reviewer6red; final1315/1315 integrated | Required-permission checks apply to new automated retry boundaries, not blanket active-work revocation |
| 8 | Repaired for observed managed lineage; universal coverage unproven | Depth/cycle/unknown unrelated/persisted lineage tests integrated | Never-observed or pre-upgrade missing-parent ancestry cannot be classified without framework gating |
| 9 | Collector implementation under way separately | No optimization adopted | Production hooks pending correctness stabilization |
| 10–24 | Not yet evaluated beyond issue register/source leads | No benchmark or improvement claims | Later staged work remains |

Latest integrated correctness checkpoint3f1a8cf: `pnpm check` PASS: typecheck +1319 tests /73 files +build. Three additional decoration races reproduced independently before generation/readiness repair. Main/default branch unchanged. This is Stage B progress, NOT final programme acceptance.

## Stage B reviewed baseline

Tag `reviewed/correctness-stage-b` includes all reviewed Issue1-8 repairs and PRE-1. Earlier OPEN/NOT ACCEPTED narrative records intermediate findings; the acceptance ledger supersedes it. Issue5 remains partial because an already-running framework create cannot be interrupted or rolled back, and compound unobservable-process/persistence/crash risk remains. Issue8 only covers observed managed lineage; universal pre-upgrade missing-parent classification remains unproven. Performance and product stages are not accepted by this tag.
