# Merge-readiness report: mandate review round of 2026-11-04

> Round scope `6027b6e..fd3b7a6` on `programme/reliability`, PR #1 (open, unmerged): https://github.com/RT123-new/dsh-superagent-proto/pull/1. Main is untouched; no merge, no deploy, no upstream changes.

## Current verdict: NOT READY TO CERTIFY

Three independent gates are still open, by design:

1. **Independent code verdict on the current head.** PARTIALLY LANDED: the complementary independent review (`INDEPENDENT_REVIEW_COMPLEMENTARY.md`, verbatim) accepts all client findings and the settings allowlist at `fd3b7a6` with actual probes replayed unmodified (32/32 client probes at `26ab444`; the original wire RED restored and replayed GREEN as 1 selected test at `fd3b7a6` - filtered, not the full suite). That acceptance is explicitly scoped: it is NOT whole-backend acceptance. Still pending: the deep backend review (source ingestion, executor, persistence, runtime safety) and the backend verdict on the section-11 T_i commits (`56bb709`, `c0794ca`). Earlier scoped accepts cover the transport verdicts at `3eb84b5`/`26ab444`, the historical banners at `910cfa9`/`627d356`, and the adversary timing patch `a5a8a41`.
2. **Stable full canonical run.** Canonical validation is adversary-run only (`pnpm test`). The reference count of record at the last freeze is 140 files / 1728 pass / 2 skip at `6027b6e`; the branch is now 141+ files with new tests. No author-side run substitutes.
3. **CI proof.** The CI failure-masking repair (`8643e27`, `d6e0f60`, `e0d7fc3`) is structurally proven (artifact run 41835601528 demonstrated the mask; the workflow contract is pinned by `tests/ci-workflow.spec.ts`) but the fixed workflow has not executed on GitHub; that requires an authorized push of the frozen head.

## Known open items (carried in the evidence ledger)

- R2-5: `tests/runtime-concurrency.spec.ts:758` `candidates()` full-suite race - UNPROVEN hypothesis; the adversary's bounded deterministic barrier probe (production prompt/inputs, Delivered barrier) is the next experiment. No product fix is claimed or made for it.
- R2-11: provider HTTP retries inside dsh-llm below the session-event surface are unobservable - UNPROVEN.
- R2-12/R2-13: five whitelisted metrics stages have no production emitter; token/cost categories unhooked - DEFERRED WITH REASON.
- R2-17: 500 catch-all, persisted failure messages, health details - bounded pre-existing risk, no demonstrated remote-text feed.
- Measurement-scope reductions (M4 2000-cap, issue-18 2k iterations) are reported as reductions; historical larger-scope numbers are never cited as current.

## What is verified at this head

- All 18 ledger entries carry exact statuses; 8 VERIFIED FIXED, 2 VERIFIED UNCHANGED, 3 PARTIALLY VERIFIED, 2 DEFERRED WITH REASON, 1 UNPROVEN, plus the CI/T_i sub-gates above.
- Failing-first discipline held for every new repair this round (RED captured before GREEN), including the reviewer's wire probe reproduced unmodified.
- 46 files changed, +2740/-73 across 16 commits; every commit surgical (sweep-commit risk noted and avoided after `a5a8a41`).

## Conditions to certify

1. Independent reviewer verdict on `56bb709`, `c0794ca` (backend T_i) and the remaining backend surface; the client + allowlist portion landed at `fd3b7a6` (scoped).
2. Adversary-run canonical `pnpm test` green at the frozen final head.
3. Authorized push of the accepted freeze; fixed CI workflow executes green on GitHub.
4. Only then: merge readiness can be asserted, and merge itself remains the user's explicit decision.
