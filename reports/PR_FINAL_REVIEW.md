# PR final adversarial review (issue register)

DRAFT LEDGER - in progress, pending rows preserved. Do not treat any row marked PENDING or UNVERIFIED as closed. Statuses use four categories only: SATISFIED (implemented + independently verified), DISPOSITIONED (deliberately held / NO CHANGE with justification), PARTIAL, SEQUENCED-PENDING.

## Phase 1 authoritative baseline (independently established 2026-11-04 ~08:02 UTC)

SATISFIED. main = 8c32a9d (= merge-base with PR), PR HEAD de50174 at baseline time, PR #1 open/unmerged/only PR on the fork. Local baseline suite 1498/1498 (local run only - this repository has NO GitHub CI; every green in this review is a local or sandbox run). Baseline lockfile sha256 ba6b997c...0405c39 preserved as historical evidence. Later justified test-only dependency delta (JSONL backend, exact pin) recorded alongside with old/new hashes; baseline evidence not rewritten.

## Phase 2 - critical correctness and safety

| Req | Status | Evidence / pending |
|---|---|---|
| 2.1 Workspace prep crash consistency: state transitions, write-failure injection, crash between prep and durable record, restart with owned process, config change/corrupt records/legacy dirs | PARTIAL | Executor runtime proofs (patches 0016/0017) adversary-accepted narrow: cancellation before/during/after create, ensure-matrix boundaries, fail-closed on unknown state. Record-write-failure and process-crash matrices: executed per executor inventory; adversary reproduced 6 red cases. Power-loss durability NOT claimed. |
| 2.2 Cancellation during session creation: async boundaries, recreate cannot bypass auth, cancelled assignment receives nothing, restart reconciles orphans, late decoration/tool registration | PARTIAL | Proven: delivery authorize-before-acceptance; stopTicket cancels active turn; ensure-matrix revocation cases; harmless-completion for uncancellable upstream create; unresolved sessions surfaced via probe.count (in-memory, capped 256). NOT yet proven: late TOOL registration after stop (executor: code-supported only, not re-audited); restart reconciliation of PERSISTED orphaned sessions (unresolved set is in-memory only). Full agent-loop consume/claim/append crash proof: spike in progress (registry-verified packages, offline mock LLM, no paid calls). |
| 2.3 Delivery acknowledgement vs persistence ordering | PARTIAL | Real-backend durability proven over JSONL backend (devDep, exact pin 0.2.1-alpha.2): SIGKILL after append+flush, held messages not redelivered, unflushed-append characterization, torn-tail 5-byte truncation characterization (at-least-once residual, adversary-verified incl. surviving-header assertion). Acceptance-before-flush window: code-supported concern, disposition per delivery authorize-first design; exact ordering proof for the full claim/append path pending the agent-loop spike. |
| 2.4 Durable external replies (outbox) | PARTIAL | Outbox attempt markers + no-send-on-close regression test (integration-owned, adversary accepted red/green). Operator surface: GET effects/blocked (safe class only), POST effects/:kind/rearm with unknown-outcome duplicate warning; no discard route, no auto-rearm. |
| 2.5 Managed subagent permissions | PARTIAL | Policy-guard minimal repair: host.authorized at new grant points, Later-defer for unknown Source kind (never allow), disabled denies. Adversary accepted narrow. Residuals per adversary verdict list. |

## Phase 3 - source ingestion and event loss

| Req | Status | Evidence / pending |
|---|---|---|
| 3.1 GitHub pagination/replay/reconciliation | PARTIAL | Source workstream patches 0001-0021 merged after narrow acceptance. Typed not-before floor (0011); embargo persistence across restart via absolute epoch ms in existing KV (0019-0021). Live GitHub replay against real API: UNVERIFIED (no live calls made). |
| 3.2 Large responses / memory pressure | DISPOSITIONED | Check-runs 16MiB cap = explicit operating limit + health-visibility test only; not a full large-response proof. |
| 3.3 Repeated review-history scanning | DISPOSITIONED | NO CHANGE with documented reopen conditions (prior disposition stands). |
| 3.4 Malformed remote events | PARTIAL | 24h-401 durable park with explicit rearm (0014+0016); untrusted remote text handled via static allowlists/hashes after adversary leak findings. Full malformed-event fuzz matrix: not claimed complete. |
| 3.5 Feishu recovery and monitoring | PARTIAL | Heuristic backoff in-memory (operating limit); Feishu live-replay UNVERIFIED; 14-day horizon unproved. |

## Phase 4 - retry policy and rate-limit safety

| Req | Status | Evidence / pending |
|---|---|---|
| 4.1 Preserve existing retry correctness | PARTIAL | Retry behavior preserved through all merged repairs; regression specs green. |
| 4.2 Actual Retry-After metadata | PARTIAL | Typed not-before floor; honor-server not-before, never shortened; over-horizon fails closed (visible park). |
| 4.3 Account-wide rate budget across concurrent operations | DISPOSITIONED | Concurrent pool HELD (account-wide budget absent = operating limit; evidence gates not met). |

## Phase 5 - metrics correctness

| Req | Status | Evidence / pending |
|---|---|---|
| 5.1 Timing boundary definitions | PARTIAL | Metrics workstream M1-M5; metricsState minimal API accepted narrow. |
| 5.2 Provider-attempt measurements | PARTIAL | Per metrics/UI review report; adversary acceptance per-workstream. |
| 5.3-5.5 Correctness/throughput, percentiles, worker utilisation | PARTIAL | Synthetic measurements only; see PR_FINAL_BENCHMARKS.md (draft). |
| 5.6 Token accounting and cost | PARTIAL | COST_LEDGER.md carried; no paid calls made in this review. |

## Phase 6 - database and migration

| Req | Status | Evidence / pending |
|---|---|---|
| Migration chain, redaction, closing() guard, left-job handling | PARTIAL | DB bundles through 14 merged (5758b04 redaction, 515e863 closing() guard, cf70071 left-job tests, c3911d5 docs). Disk code identity verified artifact-based: store/migration/store-read blobs identical c3911d5..current. |
| Retention optimisation | DISPOSITIONED | HELD experiment; evidence gates not met. |

## Phase 7 - concurrency and orchestration

| Req | Status | Evidence / pending |
|---|---|---|
| Dispatch lock/guard | SATISFIED-narrow | Integration-owned dispatch guard d3e6299 + outbox no-send test bef7fa5; adversary reproduced red/green on both sides. |
| Slot orchestration (slotwake) | DISPOSITIONED | HELD experiment; evidence gates not met. |

## Phase 8 - performance experiments and mathematical acceptance

COMPUTATIONS INDEPENDENTLY REPRODUCED - this is NOT production acceptance. All numbers synthetic/local/exploratory, workload-window and row-shape specific: paired P95 +49.6% [47.5,53.9] regression on the measured shape; flow -3.0% [-6.1,-1.1] overall with gains only in narrow windows; disk +8.29% shape A / +35-39% shape B; outage 5-seed mean 87.6% (range 82.7-91.2) exploratory, per-seed means (within-run pair CI invalid). Raw evidence archive verified (SHA256SUMS). Strict rejection criteria (8.5) applied: unfavourable load costs recorded; no optimisation adopted without its gate.

## Phase 9 - security and adversarial review

| Boundary | Status | Evidence / pending |
|---|---|---|
| Untrusted remote text (stderr/errors/ids/rejected fields) | PARTIAL | Multiple adversary-found leaks repaired (token/control-char/path interpolation; KV saveFailure leak latest) with static allowlists/hashes + regression tests. |
| Policy changes during async work | PARTIAL | Fail-closed policy guard (see 2.5). |
| GitHub/Feishu source authorisation | PARTIAL | Adversary static re-audit on combined 191db58: Feishu intake filters scope BEFORE gating (intake.ts:25; ordering is load-bearing because policy.gate admits "allowed && addressed" before its own scope check); end-to-end path covered by runtime.spec.ts:733 (not rerun on current tree yet); sender identity from lark event (bot-type senders cannot be explicit; allowed ids match ^ou_[a-zA-Z0-9]+$; mentions verified against event mentions[] not text). RESIDUAL (coupling, not a bug today): gate() alone is not scope-safe; any new caller that gates without intake would bypass chat scope. PENDING: rerun Feishu unlisted-chat test on current tree; hostile fixtures for remaining rows. |
| Workspace paths and symlinks | PARTIAL (repair pending adversary verification) | Adversary static re-audit: feishu-image.ts download path is realpath-resolved, dirname must equal realpath(temp dir) (symlink-outside rejected), regular-file + byte-limit enforced, temp dir removed; TOCTOU between realpath and read noted (needs a writer in a mkdtemp dir; app-level limit, not OS boundary claim). GitHub readRepositoryPath rejects '..' and hidden paths (static read only). PENDING: hostile-symlink fixture, workspace execution-name sanitization + preexisting-symlink fixture, cross-repo alias call-path proofs, encoded/decoded traversal forms in command regex - all requested, not yet run. |
| Dashboard secret/token exposure, secret scan of final diff | PENDING-VERIFICATION | Full-diff secret scan at freeze REQUIRED; not yet run on combined tree. |
| Repository identity/URL canonicalisation, cross-repo aliasing, credential isolation, subagent permission inheritance, argument/env handling, source-generated instructions, historical events newly actionable, error logging payloads, migration/archive paths | PARTIAL | Covered by earlier adversarial review rounds (see issue register); consolidated final-tree re-check owed at freeze. |

OS-boundary honesty: no application-level guard is claimed as a hard operating-system security boundary.

## Phase 10 - UI and operational visibility

PARTIAL. Blocked-tasks operator UI (Execution tab section, rearm with confirmation + unknown-outcome duplicate warning) accepted narrow as readable-in-render: real React DOM in jsdom + flat palette screenshots at 1280/390 zh inspected by main, adversary and lead. NOT verified: real host theme, en locale pixels, keyboard/focus flow, touch, dark/light. Health-state distinctions and no-invented-zeroes rules per metrics workstream; final UI ledger row stays open pending en/keyboard checks.

## Phase 11 - testing and independent acceptance

PARTIAL. Rule enforced throughout: failing-proof-first repairs, adversary independent acceptance before integration, lead independent verification runs. Frozen combined-tree full suite (sharded) + build + git diff --check + full-diff secret scan owed at freeze; adversary final-tree refresh owed at freeze.

## Phase 12 - required deliverables

SEQUENCED-PENDING by design: PR_FINAL_REVIEW.md (this ledger), PR_FINAL_VALIDATION.md, PR_FINAL_BENCHMARKS.md, PR_FINAL_HANDOFF.md drafted now, finalized at freeze; then push accepted fixes to the existing PR branch, update PR #1 description to actual final state, leave PR open and unmerged. No merge, no automerge, no deploy, no upstream mutation.

## Carried-forward residuals under re-review (from existing dispositions, not new findings)

See FINAL_STATUS.md 24-issue disposition matrix; held experiments (pool/retention/slotwake) remain held unless full evidence gates pass.

## New findings (populated at integration; each entry gets ID, severity, classification, location, reproduction, repair, tests, regression risk, result, residual uncertainty, disposition)

NF-2 (DRAFT ID). Workspace symlink escape outside executionRoot. Severity: low under the stated threat model (requires local write access to executionRoot + ticket id knowledge; worker already runs as the operator's OS user) but a confirmed gap in intended path containment. Location: src/executor/dsh.ts prepared() used stat(), which follows symlinks; nothing checked the resolved workspace against the execution root. Reproduction: adversary fixture adv-symlink.spec.ts (real ExecutorFixture launch; pre-planted symlink to an outside directory was followed and the worker prompted there). Repair: realpath containment both sides before preparation and record-based reuse (e3726cb); escape throws PrepareFailed, ticket marked failed, files preserved. Failing-first verified by the lead; independent adversary verification pending at ledger time. Tests: tests/review-phase9-symlink-containment.spec.ts (deny-outside, allow-legit, allow-root-itself-symlink) + adversary's flipped characterization in tests/review-phase9-boundaries.spec.ts. Residuals: TOCTOU swap-after-check not defended; application-level containment, NOT an OS security boundary; no escalation beyond the documented guardrail limit claimed.

NF-1 (DRAFT ID). Idle agent with restored inbox never woken - held message, false accepted launch. Severity: high (message accepted but never processed until unrelated activity). Location: src/app/delivery.ts send(). Reproduction: real agent loop 0.2.1-alpha.2 + real JSONL backend + real SIGKILL, offline never-answering model (no network, no paid calls); prefix sweep over event boundaries of one real log shape; prefixes containing the inbox insert without user/message restore the message into the agent inbox with holds()=true and an idle agent, so no model request starts. RED reproduced independently by the adversary against the pre-fix delivery.ts (4/4 vs 3 pass + 1 fail). Repair: 6-line wake branch (commit 83a4edd on integ/scratch), runs only when pending && !seen && not inject-mode && agent.status==='idle'; authorize() and the disposed-target check run before it, so authorization gates are preserved (adversary read). Result: 4/4 kill spec + 10/10 focused on combined tree, tsc clean; merged at db92158. Residuals (open, owned by executor): steer/followup throw after remove (producer retry path) untested; idle-to-turn-start status race untested; prefix sweep is simulated event-boundary prefixes from ONE real log shape, actual SIGKILL timings covered for 2 cases only; no exactly-once or power-loss claim.
