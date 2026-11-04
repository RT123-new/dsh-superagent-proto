# Merge-readiness report: mandate review round of 2026-11-04

> Round scope `6027b6e..4955cf6` on `programme/reliability`, PR #1 (open, unmerged): https://github.com/RT123-new/dsh-superagent-proto/pull/1. Main is untouched; no merge, no deploy, no upstream changes. The earlier `fd3b7a6` freeze candidate was superseded after three confirmed findings (T_i stamp retention, sources mock wire emulation, pre-send classification); its canonical run went RED (9 github poll failures), which the repair commits address.

## Current verdict: NOT READY TO CERTIFY

Three independent gates are still open, by design:

1. **Independent code verdict on the current head.** PARTIALLY LANDED: the complementary independent review (`INDEPENDENT_REVIEW_COMPLEMENTARY.md`, verbatim) accepts all client findings and the settings allowlist at `fd3b7a6` with actual probes replayed unmodified; the remaining-backend review (`INDEPENDENT_REVIEW_REMAINING_BACKEND.md`, verbatim) covers the owning files it names with 339 unique targeted tests green at `fd3b7a6` (explicitly not canonical), found the pre-send P2 (now repaired at `d7e6cc3`, its unmodified replay pending) and confirmed the old-turn attribution issue unresolved. Still pending: re-verdicts on the T_i correction `592f76f` and the two repair commits `2dccb20`/`d7e6cc3`, plus the metrics/backend verdict from the original adversary.
2. **Stable full canonical run.** Canonical validation is adversary-run only (`pnpm test`). The frozen-`fd3b7a6` canonical went RED truthfully (141 files, 9 fail - all github poll, 1740 pass, 2 skip; install/typecheck/build green): the failure-propagation repair worked as designed, and the failures were root-caused to the sources mocks (fixed at `2dccb20`). A fresh canonical at the FINAL head is required. The reference count of record at the last good freeze is 140 files / 1728 pass / 2 skip at `6027b6e` from an independent LOCAL run; the real CI at `6027b6e` was false-green, masking 2 failed files (artifact run 41835601528). No author-side run substitutes.
3. **CI proof.** The CI failure-masking repair (`8643e27`, `d6e0f60`, `e0d7fc3`) is proven behaviorally and structurally: artifact run 41835601528 demonstrated the mask; the independent extracted-pipeline check returns 0 for success, 17 for test exit 17, 23 for tee exit 23; the workflow contract is pinned by `tests/ci-workflow.spec.ts`. But the fixed workflow has not executed on GitHub; that requires an authorized push of the frozen head.

## Known open items (carried in the evidence ledger)

- R2-5: `tests/runtime-concurrency.spec.ts:758` `candidates()` full-suite race - UNPROVEN hypothesis; the bounded deterministic barrier probe was stopped after its harness consumed the bound (Test A: no reproduction); recorded as UNPROVEN, not a defect and not a pass. No product fix is claimed or made for it.
- R2-23: old-turn tool attribution after assignment replacement - independently replayed UNRESOLVED (framework attribution mechanism; the report lands on the replacement assignment). Not a defect introduced by this round; no fixed status is claimed.
- R2-11: provider HTTP retries inside dsh-llm below the session-event surface are unobservable - UNPROVEN.
- R2-12/R2-13: five whitelisted metrics stages have no production emitter; token/cost categories unhooked - DEFERRED WITH REASON.
- R2-17: 500 catch-all, persisted failure messages, health details - bounded pre-existing risk, no demonstrated remote-text feed.
- Measurement-scope reductions (M4 2000-cap, issue-18 2k iterations) are reported as reductions; historical larger-scope numbers are never cited as current.

## What is verified at this head

- All 25 ledger entries carry exact statuses: 9 VERIFIED FIXED, 2 VERIFIED UNCHANGED, 8 PARTIALLY VERIFIED (including the author-green repairs R2-10/R2-21/R2-22/R2-24 awaiting independent replay or a fresh final-head canonical), 1 REPRODUCED FAILURE (R2-25 health-feed prose, open pending scope decision), 4 DEFERRED WITH REASON, 1 UNPROVEN, plus the CI/canonical sub-gates above.
- Failing-first discipline held for every new repair this round (RED captured before GREEN), including the reviewer's wire probe reproduced unmodified.
- Diff basis stated exactly: full `6027b6e..4955cf6` = 64 files, +3488/-83; excluding `reports/` = 44 files, +1677/-83 (20 code/test commits + 7 docs-only report commits = 27 total, measured). The earlier '46 files, +2751/-74' figure was the full diff at the `fd3b7a6` freeze candidate. Every commit surgical (sweep-commit risk noted and avoided after `a5a8a41`).

## Conditions to certify

1. Independent reviewer verdicts bound to the REAL bundle identity on `592f76f` (T_i retention), `2dccb20` (sources mocks), `d7e6cc3` (pre-send classification) and `4955cf6` (pre-send retry counter). Backend B reviewed all three frozen-SHA repairs SOUND/EQUIVALENT from the reconstructed tree and replayed the 401/429 probe GREEN there, but acceptance awaits the real git bundle (the mbox format-patch could not certify commit identity); the phase-3 503 probe awaits unmodified replay against `4955cf6`. The client + allowlist portion landed at `fd3b7a6` (scoped).
2. Adversary-run canonical `pnpm test` green at the frozen final head.
3. Authorized push of the accepted freeze; fixed CI workflow executes green on GitHub.
4. Only then: merge readiness can be asserted, and merge itself remains the user's explicit decision.
