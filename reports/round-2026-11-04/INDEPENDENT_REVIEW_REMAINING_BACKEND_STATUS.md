# Independent review (remaining backend) - finding status ledger

Companion status file for `INDEPENDENT_REVIEW_REMAINING_BACKEND.md` (reviewer's verbatim report, scoped to its owning files at freeze candidate `fd3b7a6`; its targeted runs are NOT canonical). Statuses as of head `d7e6cc3`:

| Reviewer finding | Status now | Repair / record |
|---|---|---|
| P2: pre-POST read failures (non-gone GET) lose classification; 401 retried like a local Later (+5s, no error), 429 retried inside its 120s typed embargo | Author-green repair at `d7e6cc3` (ledger R2-22: PARTIALLY VERIFIED; VERIFIED FIXED only on the reviewer's unmodified replay) | `SendNotAttempted` carries the cause; Effects routes provider causes through `retryDecision` (401 -> `blocked:unauthorized`, 429 -> embargo floor >= 120s); not-attempted semantics kept (no attempt marker, no consumed attempt, 0 POSTs) |
| Old-turn tool attribution after assignment replacement | UNRESOLVED (ledger R2-23; framework attribution; no false fixed status) | Independently replayed by the reviewer; not a defect introduced by this round |
| Raw error/health text and HTTP 500 fallback certified secret-free | Health feed: VERIFIED FIXED at `3144dde` (adversary source review SOUND, §10 health P3 CLOSED - all three paths incl. the `report()` stored-record path). Same-class bypass (overview outgoing.error + ticket delivery fields) repaired at `c69a1f9` (ledger R2-26 PARTIALLY VERIFIED; target replay pending). `http.ts:97` 500 kept preexisting LOW: internal-only feed traced by backend B, documented, unchanged |
| T_i first-decision stamp consumption (ignore/multi-accept) and requeue losing original receipt | Author-green repair at `592f76f` (ledger R2-10: PARTIALLY VERIFIED); independent re-verdict pending | Peek-retain chain; accept-only propagation; failing-first probes RED -> GREEN |
| Sources mock wire emulation regression (9 github poll failures in the fd3b7a6 canonical, RED truthfully) | Author-green repair at `2dccb20` (ledger R2-21: PARTIALLY VERIFIED); adversary independently root-caused fixture-only and ran fd3b7a6+patch canonical green (141/1749/2/0, exit 0) - that SHA is not the current head, so a fresh canonical at the final head remains required | Mocks now emit the real `gh --paginate --slurp --include` interleaved shape; expectations unchanged |
| Q (correct completion rate) | NOT implemented (ledger R2-20, DEFERRED WITH REASON) | Explicit no-Q claim in the performance report |

| Residual of the presend repair: retryable pre-POST failure never advanced the retry counter or persisted an error (forever first-attempt jitter, health ready) | VERIFIED FIXED at real-bundle `4955cf6` (same addendum: 503 counter 1 -> 2; local Later 5s/attempt 0/marker-free) |

Backend B's verbatim report is in `INDEPENDENT_REVIEW_BACKEND_B.md` (fd3b7a6 code + c1d4510 docs-descendant binding; its post-freeze repair reviews are from a reconstructed tree, signal-only until real-bundle identity). The reviewer's verbatim report is preserved unmodified in `INDEPENDENT_REVIEW_REMAINING_BACKEND.md`; this file records only the subsequent fix verdicts and does not rewrite it.
