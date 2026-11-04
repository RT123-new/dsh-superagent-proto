# Merge-readiness report: mandate review round of 2026-11-04

> Round scope `6027b6e..c69a1f9` on `programme/reliability`, PR #1 (open, unmerged): https://github.com/RT123-new/dsh-superagent-proto/pull/1. Main is untouched; no merge, no deploy, no upstream changes. The earlier `fd3b7a6` freeze candidate was superseded after three confirmed findings (T_i stamp retention, sources mock wire emulation, pre-send classification); its canonical run went RED (9 github poll failures), which the repair commits address.

## Current verdict: NOT READY TO CERTIFY

Three independent gates are still open, by design:

1. **Independent code verdict on the current head.** PARTIALLY LANDED: the complementary independent review (`INDEPENDENT_REVIEW_COMPLEMENTARY.md`, verbatim) accepts all client findings and the settings allowlist at `fd3b7a6` with actual probes replayed unmodified; the remaining-backend review (`INDEPENDENT_REVIEW_REMAINING_BACKEND.md`, verbatim) covers the owning files it names with 339 unique targeted tests green at `fd3b7a6` (explicitly not canonical), found the pre-send P2 (now repaired at `d7e6cc3`, its unmodified replay pending) and confirmed the old-turn attribution issue unresolved. Still pending: re-verdicts on the T_i correction `592f76f` and the two repair commits `2dccb20`/`d7e6cc3`, plus the metrics/backend verdict from the original adversary.
2. **Stable full canonical run.** LANDED for `07e7470` (code `3144dde` + adversary test patch): the adversary's acceptance canonical on the real bundle, tree-equivalence proven (tree `925ce362`; delta vs the proof worktree = the exact runtime.spec patch + 2 docs files), is **GREEN - 144 files / 1757 pass / 2 skip / 0 fail / truthful EXIT=0, install/tsc/build RC=0** (B final addendum; intermediate REDs at `fd3b7a6` (9 sources) and `03feb74` (1 stale runtime expectation) preserved as evidence). The `c69a1f9` presentation-field repair on top needs the adversary's target replay + canonical evidence binding; CI green after an authorized push is the final proof for the last head. Historical counts of record: 140 files / 1728 pass / 2 skip at `6027b6e` (independent LOCAL run; the real CI at `6027b6e` was false-green masking 2 failed files, artifact run 41835601528).
3. **CI proof.** The CI failure-masking repair (`8643e27`, `d6e0f60`, `e0d7fc3`) is proven behaviorally and structurally: artifact run 41835601528 demonstrated the mask; the independent extracted-pipeline check returns 0 for success, 17 for test exit 17, 23 for tee exit 23; the workflow contract is pinned by `tests/ci-workflow.spec.ts`. But the fixed workflow has not executed on GitHub; that requires an authorized push of the frozen head.

## Known open items (carried in the evidence ledger)

- R2-5: `tests/runtime-concurrency.spec.ts:758` `candidates()` full-suite race - UNPROVEN hypothesis; the bounded deterministic barrier probe was stopped after its harness consumed the bound (Test A: no reproduction); recorded as UNPROVEN, not a defect and not a pass. No product fix is claimed or made for it.
- R2-23: old-turn tool attribution after assignment replacement - independently replayed UNRESOLVED (framework attribution mechanism; the report lands on the replacement assignment). Not a defect introduced by this round; no fixed status is claimed.
- R2-11: provider HTTP retries inside dsh-llm below the session-event surface are unobservable - UNPROVEN.
- R2-12/R2-13: five whitelisted metrics stages have no production emitter; token/cost categories unhooked - DEFERRED WITH REASON.
- R2-17: 500 catch-all, persisted failure messages, health details - bounded pre-existing risk, no demonstrated remote-text feed.
- Measurement-scope reductions (M4 2000-cap, issue-18 2k iterations) are reported as reductions; historical larger-scope numbers are never cited as current.

## What is verified at this head

- All 26 ledger entries carry exact statuses: 14 VERIFIED FIXED (R2-25 health redaction adversary-CLOSED), 2 VERIFIED UNCHANGED, 5 PARTIALLY VERIFIED (R2-26 presentation-field redaction is the one remaining author-green repair awaiting replay; R2-3/R2-4/R2-11/R2-17 keep their named limits), 4 DEFERRED WITH REASON, 1 UNPROVEN, plus the canonical-binding/CI sub-gates above.
- Failing-first discipline held for every new repair this round (RED captured before GREEN), including the reviewer's wire probe reproduced unmodified.
- Diff basis stated exactly: full `6027b6e..c69a1f9` = 81 files, +3889/-104; excluding `reports/` = 57 files, +1908/-104 (25 code/test commits + 8 docs-only report commits = 33 total, measured). The earlier '46 files, +2751/-74' figure was the full diff at the `fd3b7a6` freeze candidate. Every commit surgical (sweep-commit risk noted and avoided after `a5a8a41`).

## Conditions to certify

1. Independent reviewer verdicts bound to the REAL bundle identity. LANDED (scoped): pre-send classification + retry-counter repairs VERIFIED FIXED at real-bundle `4955cf6` (tree `157887d5`; byte-identical 401/429/503 probe replays GREEN; local Later semantics preserved) per `INDEPENDENT_REVIEW_REMAINING_BACKEND_STATUS_4955.md`; client + allowlist at `fd3b7a6`; backend B's statics SOUND/EQUIVALENT on the frozen-SHA repairs. T_i retention (`592f76f`) and sources mocks (`2dccb20`) are VERIFIED FIXED via confirmed tree equivalence (f493e71/a4dcd26/09150e9 tree-exact); the §10 health redaction (`3144dde`) is adversary-CLOSED (SOUND); the acceptance canonical at `07e7470` is GREEN (gate 2). STILL PENDING: the adversary's target replay of the `c69a1f9` presentation-field probes + canonical evidence binding for the last head, then CI green after an authorized push.
2. Adversary-run canonical `pnpm test` green at the frozen final head.
3. Authorized push of the accepted freeze; fixed CI workflow executes green on GitHub.
4. Only then: merge readiness can be asserted, and merge itself remains the user's explicit decision.
