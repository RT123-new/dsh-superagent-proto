# PR final validation (FINAL - frozen tree 85b5358)

Local runs only: this repository has NO GitHub CI. Every result below is a local/sandbox run.

## Baseline (final, Phase 1)
- main = 8c32a9d (= merge-base), PR HEAD de50174 at baseline time, PR #1 open/unmerged.
- Baseline suite 1498/1498 local. Baseline lockfile sha256 ba6b997c...0405c39 (historical evidence, preserved).

## Frozen final verification (85b5358, pushed to programme/reliability)
Tree: integ/scratch @85b5358 = de50174 + the accepted review series, pushed as a fast-forward (de50174..85b5358) to the existing PR branch programme/reliability. PR #1 remains OPEN and UNMERGED; main unchanged at 8c32a9d. Tail of the series: b9e39aa (NF5 RED, red by design - bisect note), 04aeecb (NF5 revoke), 6b31f05 (restart-ordering guard), e2d97c7 (NF5 throw regression), 59104e1 (koffi build-gate explicit deny), 47bc140 (revoke diagnostics isolation + accurate issue-4/5 fixtures), 1c375fe (failed-revoke visibility assertions), 85b5358 (tsx declared local devDependency). 403edc8 (late2) also red by design - bisect notes in REVIEW.

### Lead frozen run (fresh worktree of 85b5358, default commands only - no flag variants)
- pnpm@11.7.0 install --frozen-lockfile: exit 0. pnpm build: exit 0 (11 ESM files). tsc --noEmit: exit 0. git diff --check: exit 0. Tree clean after install.
- Full sharded suite (vitest include tests/**/*.spec.{ts,tsx}, 4 shards incl. tests/stage-d): 1710 passed, 0 failed, 2 skipped (shards: 262 / 281 / 729 / 438+2skip). The 2 skips are the suite's own.

### Adversary independent final refresh (own fresh worktree of the 85b5358 bundle, pnpm@11.7.0 default install)
- install exit 0, build exit 0, tsc exit 0, git status clean. Evidence persisted at reports/evidence/pr-final/adversary-final-refresh/ (MANIFEST, batch lists, install log, build tail; sanitized).
- Suite: 121 .spec.ts in 3 batches 450+627+493 = 1570 passed; 14 .spec.tsx 125 passed; stage-d 15 passed / 2 skipped. Total 1710 passed, 2 skipped, 0 failed - matches the lead exactly.
- Count reconciliation: the adversary's earlier totals (1553 on 215fc4c, 1576 on 59104e1) covered only .spec.ts files and omitted the 14 .spec.tsx specs, so they were not comparable to lead counts; the frozen number 1710 is now collected on the same include on both sides.
- Neuter check on the new throwing-logger test: removing the nested logger isolation in dsh.ts turns 'a failing revoke warning cannot block the rest of the stop cleanup' RED; discriminating.

### Historical failed checkpoint (preserved, not rewritten)
Frozen refresh on the previous candidate 59104e1 found 8 failures in two classes (evidence: reports/evidence/pr-final/adversary-frozen-59104e1-failures/, sanitized):
- Class A (5): the issue-4/5 hand-built ExecutorFixture predated the ExecutorHost contract (sessions.revoke required since NF5) and had no context.logger, so the revoke warn itself threw inside the catch and skipped the rest of the stop - the ADV NF5-a class one level down. Repair 47bc140: accurate fixtures (revoke + logger stub) AND production hardening - the warn is nested-exception-isolated so a missing OR throwing logger can never block stopWork/abort/personal-state cleanup; probe counter session_revoke_failed remains the durable surface; new bounded RED-first test in the existing issue-5 spec. Visibility assertions added in 1c375fe.
- Class B (3-4): issue-20 resolved the tsx binary by parsing 'pnpm exec which tsx' stdout; tsx was never a declared dependency (it resolved to the machine-global /usr/bin/tsx) and a default frozen install pollutes that stdout with deps-status lines. Repair 85b5358: tsx pinned devDependency 4.23.15 (identical to the global previously used), resolved from the local dependency graph via createRequire.resolve('tsx/package.json') -> dist/cli.mjs, realpath, loud failure when absent; the helper's own failure mode is preserved. An intermediate stdout-line-filter approach was rejected and withdrawn (not source-backed). No assertion changed.

### Dependency and supply-chain deltas vs baseline
- Test-only devDeps, exact pins, verified against the live npm registry: dsh-session-persistence-jsonl 0.2.1-alpha.2 (+238 lock lines), dsh-agent-loop + dsh-session-projection 0.2.1-alpha.2 (+35 lock lines), tsx 4.23.15 (+303 lock lines incl. its esbuild transitive).
- Registry integrity (npm view dist.integrity vs pnpm-lock.yaml, lead AND adversary independent): tsx@4.23.15, esbuild@0.28.2 and @esbuild/linux-x64@0.28.2 MATCH exactly. The other ~50 @esbuild platform optionals were not compared; platform scope is Linux-only (prebuilts arrive via optional platform packages).
- Build-script policy: koffi AND esbuild install scripts explicitly DENIED via the committed pnpm-workspace.yaml allowBuilds; no install script is enabled anywhere; plain default install and build pass. Other platforms untested.
- package.json carries pnpm's pure re-sorting from 'pnpm add' (verified: every +/- pair matches an existing entry; the only content addition is tsx). Left as-is deliberately: reformatting would invalidate the frozen SHA for a cosmetic change.

## Secret scan (FINAL, lead-owned; adversary spot-check concurs)
Scope: full added history main..85b5358 (87,506 added lines across the PR series) AND a tree grep at 85b5358. Method: pattern grep for GitHub token shapes (ghp_/gho_/ghs_/github_pat_), sk-*, AWS AKIA, Bearer literals, private-key blocks, plus password/secret/token assignment grep with manual review of every hit. LIMITS: regex grep, NOT gitleaks or entropy scanning; no claim beyond the listed patterns. Result: no real secrets. The only match class is synthetic adversarial canaries in redaction-test fixtures (tests/review-db-migrate-links.spec.ts:61: ghp_${'A'.repeat(80)}, 'ghp_'+'B'.repeat(36), 'sk-short1234', AWS's documentation example AKIAIOSFODNN7EXAMPLE). Adversary independent spot-check (MANIFEST, main..85b5358 added lines excluding lockfile) found the same canaries and nothing else. Evidence archives carry no secret-shaped values (both scanned before persisting).

## Freeze checklist (all complete)
1. Frozen tree 85b5358; fresh default frozen install immediately before the run - DONE.
2. Full combined suite (all files incl. tests/stage-d), sharded; build; git diff --check; tsc - DONE (above).
3. Final full-diff + history secret scan on the frozen tree - DONE (above).
4. Adversary final-tree refresh - DONE, GREEN (above).
5. Post-6b31f05 patches reconciled - DONE: e2d97c7, 59104e1, 47bc140, 1c375fe, 85b5358 each failing-first where they repair behavior, each independently adversary-verified on the frozen tree. B2 remains NOT independently verified (see REVIEW; not closed capability).
