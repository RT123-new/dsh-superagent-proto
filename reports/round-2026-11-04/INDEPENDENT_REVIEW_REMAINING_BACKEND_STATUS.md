# Independent review (remaining backend) - finding status ledger

Companion status file for `INDEPENDENT_REVIEW_REMAINING_BACKEND.md` (reviewer's verbatim report, scoped to its owning files at freeze candidate `fd3b7a6`; its targeted runs are NOT canonical). Statuses as of head `d7e6cc3`:

| Reviewer finding | Status now | Repair / record |
|---|---|---|
| P2: pre-POST read failures (non-gone GET) lose classification; 401 retried like a local Later (+5s, no error), 429 retried inside its 120s typed embargo | REPAIRED at `d7e6cc3` (evidence ledger R2-22); reviewer's unmodified probe replay against the repair SHA is pending | `SendNotAttempted` carries the cause; Effects routes provider causes through `retryDecision` (401 -> `blocked:unauthorized`, 429 -> embargo floor >= 120s); not-attempted semantics kept (no attempt marker, no consumed attempt, 0 POSTs) |
| Old-turn tool attribution after assignment replacement | UNRESOLVED (ledger R2-23; framework attribution; no false fixed status) | Independently replayed by the reviewer; not a defect introduced by this round |
| Raw error/health text and HTTP 500 fallback certified secret-free | NOT certified | Separate error-feed review remains open; no claim made |
| T_i first-decision stamp consumption (ignore/multi-accept) and requeue losing original receipt | REPAIRED at `592f76f` (ledger R2-10 update); independent re-verdict pending | Peek-retain chain; accept-only propagation; failing-first probes RED -> GREEN |
| Sources mock wire emulation regression (9 github poll failures in the fd3b7a6 canonical, RED truthfully) | REPAIRED at `2dccb20` (ledger R2-21); fresh canonical at the final head pending | Mocks now emit the real `gh --paginate --slurp --include` interleaved shape; expectations unchanged |
| Q (correct completion rate) | NOT implemented (ledger R2-20, DEFERRED WITH REASON) | Explicit no-Q claim in the performance report |

The reviewer's verbatim report is preserved unmodified in `INDEPENDENT_REVIEW_REMAINING_BACKEND.md`; this file records only the subsequent fix verdicts and does not rewrite it.
