# Complementary PR review

PR: https://github.com/RT123-new/dsh-superagent-proto/pull/1

Reviewed base: 8c32a9dc5d72c033816c6a8110b37f40cf94fba4
Latest reviewed local revision: fd3b7a6accdb34dcbd22476c79cce604226a6021
Last remote head observed: 6027b6e797ab1a866c7504016fbbfb39af1c7357, November 4, 2026, 13:47 GMT. The fixes below were unpublished when reviewed.

## Finding status

| Priority | Finding and evidence | Status at latest reviewed revision |
| --- | --- | --- |
| P1 | CI test pipeline returned tee's status, masking test failures. The unspecified GitHub Linux shell lacks pipefail. Local failure reproduction and actual failed test artifact support the finding. `.github/workflows/validate.yml`, original line 33. | Fixed locally by explicit bash and exit propagation. Extracted pipeline returns 0 for success, 17 for test exit 17, 23 for tee exit 23. New live CI evidence remains required. |
| P1/P2 | A rearm dialog opened for generation 7 silently changed its approval target to generation 8 after polling. Original `src/client/execution.tsx:47-52`, `widgets.tsx:75-89`. Independent failing interaction probe observed outgoing generation 8. | Fixed. Approval action is captured on dialog opening; unmodified probe now sends 7. Cancel/reopen selects current generation 8. |
| P2 | Failure of only the blocked-effects endpoint hid all recovery work while tickets and executor still looked healthy. `execution.tsx`, original lines 20,46-54. | Fixed. Targeted error is visible; prior rows remain with a stale notice on refresh failure. |
| P2 | Load More 503 caused an unhandled rejection without a visible error. Unpublished pagination code. | Fixed. Prior rows survive, error is visible and retry remains available. |
| P2 | Refused rearm removed an older-page row even though it was still blocked remotely. A 250-row probe lost r249. | Fixed. Refusal refetches loaded pages; old rows are preserved on partial refetch failure. |
| P2 | Freezing a confirmation also froze an older collection closure. A page loaded while confirmation was open disappeared on successful rearm. | Fixed by functional collection updates. Unmodified pending-page probe passes. |
| P2 | Refusal refetch discarded a page that settled while the refetch was in flight. | Fixed for the reproduced schedule by append-epoch-aware merge and cursor preservation. Unmodified probe passes. |
| P2 | Model-unavailable sanitization accepted arbitrary string `error.code`. An actual settings HTTP request reflected a controlled marker in error text and values. `src/app/settings.ts:168` at e62ad1a. | Fixed at fd3b7a6 with a finite 16-code allowlist and fixed fallback. Original wire probe passes unchanged. |
| Low | Same-tick Load More clicks dispatched two requests because the guard only used rendered state. | Fixed by a synchronous guard. Probe passes. |

No remaining confirmed defect in this review's client fixes. This is scoped review acceptance, not approval to merge or proof of every concurrent schedule.

## Executed evidence

- 26ab444: seven independent client probe files plus panel-execution: 32/32 passing across eight files. Includes all original failing client probes, with no weakened assertions.
- 26ab444: additional partial-refetch failure probe: 1/1 passing. With 450 loaded rows, refused rearm and failure on the last refetch page preserve all rows and show the error.
- 3139960: prior overlap probe: 249 rows, 249 unique keys, one copy of boundary row r200.
- 6248a3e: six other panel suites: 62/62 passing. Existing execution tests and cancel/reopen checks also pass.
- 6027b6e: metrics, overview and runtime HTTP focused checks: 36/36 passing across six files; Stage D isolated candidate checks: 10/10; expanded script TypeScript check passes.
- e0d7fc3: client and CI source-contract checks: 19/19 passing; independent extracted-shell behavior checked separately.
- fd3b7a6: original model-code reflection probe: 1 selected test passing. Other tests were filtered out, not a claim that the complete runtime suite passed.

## Coverage

Direct source review covered every changed client file at the original pushed revision, subsequent client fixes, package/build/test/CI configuration, scripts/stage-d, scripts/storage and scripts/paired-validation. Selected fixture implementations, relevant panel and metrics assertions, changed test assertions and report claims were inspected. Later client changes after 26ab444 are a task-total locale label only; settings allowlist was reviewed separately.

102 test paths changed in the original base-to-head diff. This review did not inspect every line of all 102. Deep production backend, source ingestion, executor, persistence and runtime safety review is separate. A passing suite is not treated as full code-review coverage.

Not independently rerun here: full canonical suite at the final revision, actual pool benchmark, million-row storage and crash experiments, paid provider tests, live DSH host, or iPhone Safari.

## Evidence quality and residual limits

- Historical FINAL_STATUS and EVIDENCE_LEDGER now prominently identify their earlier SHA and test totals; they are not current validation. The Stage D workflow comment now correctly says unconditional.
- The panel fixture now checks generation and unknown-outcome acknowledgement without mutating generation on refusal.
- The browser harness uses real client components and CSS. Portable dependency resolution and committed viewport metadata are repaired. DSH host theme fidelity, Safari and touch behavior remain unverified; mouse events in mobile Chrome emulation do not prove them.
- Performance-heavy unit tests were reduced in sample size while preserving their assertions. The percentile oracle now exhausts sizes 1 through 2000 plus large boundary checks, not all sizes through 10000. Reported benchmark sample sizes must match the run cited.
- Generic HTTP fallback still returns raw Error.message/String(error), unchanged from the base. This is a preexisting raw-prose risk, not a demonstrated credential leak in this review. Wider error and health audit remains separate.
- No production adoption of the experimental pool, webhook, transport or retention candidates was established in these reviewed paths. Their synthetic/held labels and operational limits must remain.

## Next acceptance gates

Bind the final source revision to fresh full tests, typecheck, build and diff checks; push only the approved branch; then inspect actual CI output and artifacts, not job conclusions alone. Keep the PR open and unmerged pending the user's decision.
