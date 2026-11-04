# Implementation report: mandate review round of 2026-11-04

> Scope: code commits `6027b6e..d7e6cc3` on `programme/reliability` (25 commits total, of which 6 are docs-only report commits; code+tests diff excluding `reports/`: 43 files, +1643/-83). The earlier `fd3b7a6` freeze candidate was superseded by three confirmed findings (T_i stamp retention, sources mock wire emulation, pre-send classification); each fix is its own commit below. This round implements the repair mandate received 2026-11-04 12:25 GMT (iMessage) and the 13:20 GMT full-review request. Prior checkpoints (`reports/FINAL_STATUS.md`, `reports/EVIDENCE_LEDGER.md`) are historical records labelled as such at `910cfa9`; they are not current validation. Canonical full-suite validation is adversary-run only; the counts cited here are author-side focused runs (`npx vitest`), never canonical.

## 1. Blocked-effects endpoint keyset pagination (`fa9d8ef`, mandate section 8)

- File/function: `src/app/http.ts` blocked-effects list route; `src/app/effects.ts` blocked-row query.
- Original defect: the operator blocked-effects list was unbounded: one response returned every blocked row.
- Why it occurs: there was no paging at all, so the list grew without bound and the client held the whole set.
- What changed: keyset (cursor) pagination over a stable row key (strict `seq > cursor`, no inclusive anchor); the endpoint returns a cursor the client passes back.
- Why safe: keyset windows follow the stored key order, independent of inserts before the cursor.
- Tests: pagination cases in the effects-route and client suites.
- Before/after: before, an unbounded or drifting list; after, stable bounded pages with an explicit cursor.
- Remaining limitation: mutable remote state between pages still means a row can change state after its page was read; the row's generation is re-validated server-side at rearm.

## 2. Boundary-row dedupe and rearm-refusal surface (`1901887`)

- File/function: client blocked-list page assembly; toast surface; `scripts/browser-harness/`.
- Original defect: a row could render twice across a refresh; a refused rearm was silent.
- Why: a refreshed FIRST page can overlap the older appended cache after mutations (rows shifting across the page boundary), and the client appended without deduping. Refusals returned no user-visible signal.
- What changed: client dedupes the shifted boundary row on merge; a refused rearm raises a refusal toast.
- Tests: client probes plus portable browser-harness pixel snapshots (viewport-exact layout evidence only; no theme/touch/Safari fidelity is claimed from Chrome-mouse captures).
- Before/after: duplicate row and silent refusal before; single row and explicit refusal signal after.
- Remaining limitation: pixels prove layout/flow at exact viewports only.

## 3. CI failure masking (`8643e27`, `d6e0f60`, `e0d7fc3`)

- File/function: `.github/workflows` canonical-test job; `tests/ci-workflow.spec.ts`.
- Original defect: the canonical run piped through `tee` under the default `run:` shell (`bash -e`, no pipefail), so a failing suite exited 0 behind a green label. Artifact run 41835601528 proved 2 failed test files behind a green check.
- Why: exit status of a pipeline is the last command without `pipefail`.
- What changed: the pipefail mask removed (`8643e27`), explicit `shell: bash` pinned (`d6e0f60`), and the tested SHA recorded after checkout because `actions/checkout` default clean wipes untracked files (`e0d7fc3`); `tests/ci-workflow.spec.ts` pins the propagation contract.
- Why safe: the workflow only gains failure propagation and evidence recording; no test logic changes.
- Tests: `tests/ci-workflow.spec.ts` regression spec.
- Before/after: masked green before; failures now propagate by construction.
- Remaining limitation: UNPROVEN until the fixed workflow runs on GitHub after an authorized push; local proof is structural, not an executed CI run.

## 4. Blocked-list operator states and rearm safety (`6248a3e`, `3139960`, `c3e9492`)

- File/function: `src/client/` blocked-effects panel (`ConfirmButton`, Load More, refetch merge); `tests/fixtures/panel-server.ts` (CAS + downPaths).
- Original defects: (a) missing error states left the panel blank on load/action failure; (b) an armed confirmation could be re-armed by a prop update mid-approval; (c) a refused rearm left the row looking current; (d) two Load More requests could run concurrently; (e) the fixture's compare-and-set mutated generation on refusal, unlike production.
- What changed: explicit error, stale-data, and page-failure handling (no separate empty-state or first-load indicator is claimed; an empty list renders no section); approval freeze on the armed confirmation; refused-rearm recovery (row refetch and surface); a ref guard so only one Load More is in flight; functional collection updates so state merges cannot reuse stale arrays; refetch merge by extent epoch so pages settling during a refused-rearm refetch are not clobbered; fixture CAS corrected to mirror production (refusal does not mutate generation, tests set external state changes explicitly).
- Why safe: server validation of generation at rearm is unchanged. The approval freeze lives in the SHARED `ConfirmButton` widget (8 consumers across 6 files), so it is not automatically local: for consumers whose confirmation does not close over mutating state the open-time capture is behavior-identical, and the other consumers were exercised by the panel suites (independent run: 62/62 at `6248a3e`); only a confirmation whose target mutates while open changes behavior, which is the intended fix. The remaining changes are client-local or fixture-local.
- Tests: reviewer probes replayed unmodified and failing-first; independent runs: 31/31 across 8 files at `3139960`; 32/32 at `26ab444` (adds the refetch-merge probe).
- Before/after: silent stale UI before; explicit states, frozen approval, single-flight paging, accurate fixture semantics after.
- Remaining limitation: same-tick Load More guard covers the in-flight window, not a deliberately double-issued user action across ticks; server-side rearm validation remains the backstop.

## 5. Transport Retry-After honours (`3eb84b5`, `26ab444`, mandate section 7)

- File/function: `src/infra/commands.ts` (lark-cli stderr envelope parsing; gh api pagination header strip).
- Original defects: lark-cli's typed `retry_after_seconds` error envelope was not honored at the transport boundary; paginated `gh api --include` composition could interleave response headers into the body stream.
- What changed: branch only on the wire-stable envelope fields (`retryable`, `retry_after_seconds`; message prose never feeds scheduling), contract grounded in lark-cli's ERROR_CONTRACT.md and the v1.0.84 CHANGELOG entry (repo docs require lark-cli tested 1.0.90); paginated include output is stripped via a sequential scanner so headers cannot leak between outer-array parts (composition grounded in cli/cli source: headersWriter/bodyWriter, jsonArrayWriter wraps bodies only).
- Tests: transport boundary suites; independent reviewer verdict SOUND on actual consumers and commands at `3eb84b5` and `26ab444`.
- Before/after: retry hints ignored and possible header pollution before; typed backoff and clean paginated bodies after.
- Remaining limitation: only lark-cli >= 1.0.84 emits the typed envelope; older CLIs fall back to prior behavior.

## 6. Adversary timing patch (`a5a8a41`)

- File/function: `tests/pr-final-metrics-review.spec.tsx` (M4), `tests/stage-d/issue-18-startup.spec.ts`, `tests/runtime-concurrency.spec.ts` timing.
- Original defect: two CI timing failures (5s timeouts in `tests/pr-final-metrics-review.spec.tsx` M4 and `tests/stage-d/issue-18-startup.spec.ts`, per artifact run 41835601528) masked by defect 3. The separate `tests/runtime-concurrency.spec.ts:758` `candidates()` failure is a local assertion race, not a 5s timeout, and stays UNPROVEN (ledger R2-5).
- What changed: the independent adversary's minimal patch, applied byte-exact. Note: M4 sweep is capped at 2000 rows plus spot checks and issue-18 iterations reduced 20k to 2k; these are reduced-scope measurements and are never reported against the old 20k numbers.
- Remaining limitation: reduced iteration counts narrow the measured envelope; the runtime-concurrency `candidates()` race hypothesis remains UNPROVEN (see ledger).

## 7. Mandate T_i measurement (`56bb709`, `c0794ca`, mandate section 11)

- File/function: `src/infra/metrics-lifecycle.ts` (`DomainTimeline`), `src/infra/metrics.ts` (stage whitelist), `src/client/locales.ts` (zh/en label).
- Original defect: the mandate's per-task T_i = t_terminal - t_received was never recorded; lifecycle_elapsed was a bounded approximation.
- What changed: a dedicated receipt-stamp chain (trigger receipt -> eval -> decision -> ticket) carries the application's actual receipt of the trigger - the intake arrival noted at the entry of `Passes.receive`, with the queue commit as fallback. Stamps come only from the trigger's own receipt path, never from session steps or model events. `ticket.ended` observes `task_total`; a terminal without the chain is counted unmatched, never guessed. W_i (`trigger_to_eval_start`) keeps queue-commit semantics; the intake window is part of T_i and still measured separately as `source_to_eval_queue`.
- Why safe: monotonic per-process stamps; no cross-restart comparison; missing chains stamp nothing.
- Tests: `tests/issue-9-lifecycle.spec.ts` failing-first (RED 168/90 then corrected expectations 175/95 including the intake window; GREEN after implementation); 41/41 across lifecycle, adversarial, source-queue, locales, docs, dashboard files; tsc clean.
- Before/after: no T_i before; one correlated request-received-to-terminal latency per task after.
- Independent re-review correction (`592f76f`): the first review found the chain consumed stamps it must keep - `evalReceived.take` at the first decision of an eval (so an ignore, or the first of several accepts, left the real tickets without task_total), and a requeued trigger lost its original receipt (follow-on ticket measured from the requeue commit, with a spurious unmatched). The chain now peeks where it must retain: only accept decisions propagate the receipt, every accepted ticket of an eval is measured, and a requeue keeps the original receipt with no spurious unmatched. Failing-first probes: mixed ignore-then-accept and multi-accept (count 2, max 68, sum 130) and requeue (91 from the original receipt) - RED before, GREEN after.
- Remaining limitation: in-memory chains do not survive process restart (mandate allows monotonic stamps only within one process; cross-restart correlation is not claimed). HTTP retries inside dsh-llm below the session-event surface remain unobservable (UNPROVEN). Five whitelisted stages have no production emitter (eval_queue_wait, decision_to_assignment, slot_wait, effect_queue_wait, report_to_response) - duplicates or unobservable, left in place. Token/cost categories are not hooked (DEFERRED WITH REASON). The correct completion rate Q is not implemented (remaining Stage C work; no Q claim is made anywhere).

## 8. modelUnavailable error redaction (`e62ad1a`, `fd3b7a6`, mandate section 10)

- File/function: `src/app/settings.ts` (`save`), `src/app/http.ts` (error serialization).
- Original defect: the settings save echoed `error.message` from dsh-llm `resolveCallConfig` into the panel-facing `modelUnavailable` values.
- Why it matters: dsh-llm's own `LlmError` messages are fixed templates over configured provider/model/effort ids (safe), but `resolveModelInfoFor` delegates to host-registered adapter code whose prose - and even whose `code` property, if attacker-chosen - can carry remote text or a credential; the mandate bars arbitrary remote text in error messages.
- What changed: `e62ad1a` first replaced prose interpolation with the error's string `code`, which the independent reviewer's wire probe falsified end to end (`REMOTE-CONTROLLED-CODE-MUST-NOT-LEAK` reflected into the 400 body). `fd3b7a6` replaced duck-typing with a finite allowlist of the 16 `LlmError` codes enumerated from the pinned `@deepseek-ai/dsh-llm` 0.2.1-alpha.2 (NO_ADAPTER, UNSUPPORTED_REASONING_EFFORT, INVALID_MODEL_INFO, INVALID_MODEL_CONTEXT, INVALID_MODEL_MAX_TOKENS, INVALID_MODEL_REASONING, INVALID_ADAPTER, INVALID_CATALOG, INVALID_DIRECTORY, INVALID_DISCOVERY, INVALID_PREPARED_CALL, DUPLICATE_ADAPTER, DUPLICATE_DIRECTORY, DUPLICATE_DISCOVERY, NO_DISCOVERY, REGISTRATION_DISPOSED); any other failure degrades to the fixed token `unavailable`.
- Tests: reviewer's wire probe kept unmodified (RED reproduced exactly, then GREEN); complementary assertions: NO_ADAPTER shown, prose-only failure yields `unavailable`, credential-shaped decoy prose (`sk-live-9f8e7d body`) never appears; 120/120 runtime+locales+docs, tsc clean.
- Before/after: arbitrary upstream prose, then arbitrary upstream codes, echoed before; allowlisted codes or a fixed token only after.
- Remaining limitation: the allowlist is pinned to dsh-llm 0.2.1-alpha.2; a future dsh-llm version adding codes shows `unavailable` until the allowlist is extended. Upstream detail remains available in server logs.

## 9. Pre-send failure classification (`d7e6cc3`, independent backend finding) and sources mock wire emulation (`2dccb20`)

- File/function: `src/sources/github-channel.ts` (`sendGithub` pre-POST reads), `src/sources/send.ts` (`SendNotAttempted`), `src/app/effects.ts` (failure settlement); `tests/sources.spec.ts` mocks.
- Original defects: (a) every pre-POST read failure was wrapped in `SendNotAttempted(message)`, dropping the `CliError` status and typed Retry-After, so Effects scheduled a 401 like a local Later (+5s, no error) and retried inside a 429's 120s embargo; (b) the sources mocks answered paginated `--include` calls with the un-prefixed single-page body, so `pages()` rejected them - 9 github poll tests went RED in the frozen canonical run (the mock emulated the pre-`26ab444` invocation contract, not the consumer).
- What changed: `SendNotAttempted` carries the original cause; Effects distinguishes a LOCAL not-attempted failure (no cause: Later treatment, unchanged) from a PROVIDER one: the cause goes through `retryDecision`, so unauthorized/permanent classes park visibly as `blocked:<class>` and retryable classes honor the typed embargo floor, while the row keeps not-attempted semantics (no attempt marker, no consumed attempt, zero POSTs). The mocks now emulate the real gh wire shape (slurp wrap under the header prefix; one header block per page interleaved between outer-array parts).
- Tests: reviewer's real Effects+Outbox+Store+sendGithub probe replayed unmodified (RED at the freeze: 401 due+5s/empty error, 429 due+5s; GREEN after: `blocked:unauthorized`, due >= embargo floor); 210/210 across effects, outbox, delivery, retry and source suites; sources 79/79 with expectations unchanged; registered in the test table.
- Before/after: silent 5s polls against auth failures and embargo violations before; classified policy with not-attempted safety after.
- Remaining limitation: the independent reviewer's unmodified replay of the probe against the repair SHA is pending; old-turn tool attribution after assignment replacement remains unresolved (framework attribution, ledger R2-23).

## Audited and deliberately unchanged

- Same-origin protection and loopback binding (section 10): VERIFIED UNCHANGED - `src/app/http.ts` throws unless the host is loopback; same-origin requires exact host match plus the `x-orchestrator-request: 1` header with Origin absent-or-self, matching `docs/006-deployment.md`.
- `commandError` (commands.ts): never echoes argv (message text protected); JSON stderr envelopes surface only the CLI's own error.message+code; non-JSON stderr bounded at 2000 chars. VERIFIED UNCHANGED.
- `validItems` rejected diagnostics: numeric id or sha256 hash, whitelisted field names only, never values, capped. VERIFIED UNCHANGED.
- HTTP 500 catch-all (`http.ts:97`), persisted failure messages (`retry-policy.ts:77`, 500-char bound), health details (`effects.ts`, `passes.ts`, `runtime.ts`): bounded pre-existing risk, base-identical to the accepted freeze, with no demonstrated remote-text or credential feed; not classified as a new defect of this round. Contract-tested as-is; named here as limitations.
