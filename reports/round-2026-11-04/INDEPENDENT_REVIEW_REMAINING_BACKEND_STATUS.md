# Independent review (remaining backend) - finding status ledger

Companion status file for `INDEPENDENT_REVIEW_REMAINING_BACKEND.md` (reviewer's verbatim report, scoped to its owning files at freeze candidate `fd3b7a6`; its targeted runs are NOT canonical). Statuses as of head `d7e6cc3`:

| Reviewer finding | Status now | Repair / record |
|---|---|---|
| P2: pre-POST read failures (non-gone GET) lose classification; 401 retried like a local Later (+5s, no error), 429 retried inside its 120s typed embargo | Author-green repair at `d7e6cc3` (ledger R2-22: PARTIALLY VERIFIED; VERIFIED FIXED only on the reviewer's unmodified replay) | `SendNotAttempted` carries the cause; Effects routes provider causes through `retryDecision` (401 -> `blocked:unauthorized`, 429 -> embargo floor >= 120s); not-attempted semantics kept (no attempt marker, no consumed attempt, 0 POSTs) |
| Old-turn tool attribution after assignment replacement | UNRESOLVED (ledger R2-23; framework attribution; no false fixed status) | Independently replayed by the reviewer; not a defect introduced by this round |
| Raw error/health text and HTTP 500 fallback certified secret-free | NOT certified; backend B statics CONFIRM an unbounded feed (ledger R2-25): `effects.ts:305`/`passes.ts:60` interpolate unbounded provider prose into operator health details (P3, loopback-only surface); `http.ts:97` 500 relays raw internal error.message (LOW, internal-only). Fix scoped (typed code + bounded excerpt), NOT applied pending scope decision |
| T_i first-decision stamp consumption (ignore/multi-accept) and requeue losing original receipt | Author-green repair at `592f76f` (ledger R2-10: PARTIALLY VERIFIED); independent re-verdict pending | Peek-retain chain; accept-only propagation; failing-first probes RED -> GREEN |
| Sources mock wire emulation regression (9 github poll failures in the fd3b7a6 canonical, RED truthfully) | Author-green repair at `2dccb20` (ledger R2-21: PARTIALLY VERIFIED); adversary independently root-caused fixture-only and ran fd3b7a6+patch canonical green (141/1749/2/0, exit 0) - that SHA is not the current head, so a fresh canonical at the final head remains required | Mocks now emit the real `gh --paginate --slurp --include` interleaved shape; expectations unchanged |
| Q (correct completion rate) | NOT implemented (ledger R2-20, DEFERRED WITH REASON) | Explicit no-Q claim in the performance report |

| Residual of the presend repair: retryable pre-POST failure never advanced the retry counter or persisted an error (forever first-attempt jitter, health ready) | Author-green repair at `4955cf6` (ledger R2-24: PARTIALLY VERIFIED); reviewer's two-dispatch 503 probe replayed unmodified RED at `d7e6cc3`, GREEN at `4955cf6`; unmodified replay against the real-bundle SHA pending |

Backend B's verbatim report is in `INDEPENDENT_REVIEW_BACKEND_B.md` (fd3b7a6 code + c1d4510 docs-descendant binding; its post-freeze repair reviews are from a reconstructed tree, signal-only until real-bundle identity). The reviewer's verbatim report is preserved unmodified in `INDEPENDENT_REVIEW_REMAINING_BACKEND.md`; this file records only the subsequent fix verdicts and does not rewrite it.
