# PR final validation (DRAFT - pending rows preserved)

Local runs only: this repository has NO GitHub CI. Every result below is a local/sandbox run.

## Baseline (final, Phase 1)
- main = 8c32a9d (= merge-base), PR HEAD de50174 at baseline time, PR #1 open/unmerged.
- Baseline suite 1498/1498 local. Baseline lockfile sha256 ba6b997c...0405c39 (historical evidence, preserved).

## Combined candidate verification (current, NOT the frozen final)
Tree: integ/scratch @727f9eb (215fc4c + persisted containment falsifiers).
- Frozen install: `pnpm install --frozen-lockfile --ignore-scripts` (pnpm 11.7.0) verified by lead and adversary in clean worktrees; supply-chain policy pass.
- Dependency deltas vs baseline (both test-only devDeps, exact pins, verified against the live npm registry): dsh-session-persistence-jsonl 0.2.1-alpha.2 (+238 lock lines, integrity sha512-BS9FkO3O...zeg==); dsh-agent-loop + dsh-session-projection 0.2.1-alpha.2 (+35 lock lines, one new integrity sha512-bw5s6A/w...mcg==; projection already locked transitively). Native prebuilt transitives (koffi, node-addon-system) accepted as test-only within the exact pins.
- tsc: clean on the combined tree.
- Focused suites per merged patch: recorded per finding in PR_FINAL_REVIEW.md (each repair has failing-first evidence + narrow adversary acceptance with independent runs).
- Adversary independent run on 215fc4c (unfrozen): 1538 top-level (118 files) + stage-d 15/2 suite-skipped = 1553 passed, 2 skipped, 0 failed. NOT the final number.

## Secret scan PRE-CHECK (lead-owned; final frozen scan still owed)
Scope: net diff 8c32a9d..727f9eb (535 files, 84,823 added lines) AND full added history (210 commits, all patches). Method: pattern grep for GitHub token shapes (ghp_/gho_/ghs_/github_pat_), sk-*, AWS AKIA, Slack xox*, private-key blocks, plus a generic password/secret/token assignment grep with manual review of every hit. LIMITS: regex grep, NOT gitleaks or entropy scanning; no claim beyond the listed patterns. Result: no real secrets. All hits are test canaries/fixtures (redaction-test canaries 'ghp_SECRET...'/'sk-live-SECRET-...', AWS documentation example AKIAIOSFODNN7EXAMPLE, fixture token 'p1'). Evidence redacted: no secret-shaped values copied here beyond the documented canaries. FINAL scan on the frozen tree at freeze remains owed.

## Owed at freeze (do not read any row above as covering these)
1. Freeze combined tree; frozen pnpm install immediately before the run (stale-install lesson recorded).
2. Full combined suite (all files incl. tests/stage-d), sharded; build; git diff --check.
3. Final full-diff + history secret scan on the frozen tree (same method, adversary spot-check).
4. Adversary final-tree refresh.
5. Reconcile any new patches landed after 727f9eb.
