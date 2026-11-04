# PR final adversarial review (issue register)

Review of existing PR #1 (`programme/reliability` -> `main`). This register adds to, and does not overwrite, the 24-issue history in `reports/ISSUE_REGISTER.md` and the dispositions in `reports/FINAL_STATUS.md`. New findings from this review are registered below as they are independently reproduced; final dispositions are recorded at integration.

## Phase 1 authoritative baseline (independently established 2026-11-04 ~08:02 UTC)

| Fact | Value | How verified |
| --- | --- | --- |
| Base SHA (merge-base) | `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` (`main`) | `git merge-base origin/main programme/reliability`; equals `main` remote HEAD |
| PR HEAD at review start | `de50174f86cb5499f1c482a4bd432a77386737c9` | `git ls-remote origin programme/reliability` and `git rev-parse HEAD` after checkout |
| PR state | PR #1 open, unmerged, single PR against `main` | GitHub REST `pulls` list: state open, merged_at null |
| GitHub CI status | **No CI configured**: zero check-runs and zero commit statuses on `de50174`; no `.github/workflows` in the tree | GitHub REST `check-runs` (total_count 0) and `status` (0 statuses). Local logs below are NOT GitHub CI results. |
| Lockfile | `pnpm-lock.yaml` sha256 `ba6b997c448984a04b28eeb5b620c14c7cfeff5eb170e1abd6e0734007405c39` | `sha256sum`; `pnpm install --frozen-lockfile` clean |
| Local checks at baseline | `pnpm typecheck` PASS; `pnpm build` PASS; `pnpm test` PASS **1498/1498 tests in 102 files** (duration 94.9s), worktree left clean | Independent run in isolated worktree `review/final-baseline` at `de50174`, Node v22.23.4, pnpm 11.7.0 |
| Prior checkpoint equivalence | `src/` and `tests/` trees identical between `90e6d47` and `de50174`; all later commits are reports/evidence only | `git diff --exit-code 90e6d47 de50174 -- src tests` exit 0 |
| Held candidates | No pool/retention/slot-refill/slot-wake code in `src/` at `de50174`; no candidate branch merged into the PR branch | `git grep` over `src` at `de50174` (no matches); `git branch -r --merged` (no candidate branches) |
| Secret scan | No token/private-key patterns in tracked files | `git grep` for `ghp_`, `github_pat_`, `sk-`, `AKIA`, PEM headers (no matches) |
| PR review comments | No actionable external review comments. One Codex bot summary reported the automated review **failed to run** (usage limit) at `45d57ff`; zero inline comments, zero reviews | GitHub REST issue/PR comments and reviews endpoints |

Baseline result: the reported 1498-test / typecheck / build checkpoint **reproduces independently** on the exact reviewed SHA. GitHub CI success must never be claimed: no CI exists for this repository.

## Carried-forward residuals under re-review (from existing dispositions, not new findings)

- Issue 9 metrics: PARTIAL (provider attempt start, eligible/correct denominator, TPS/CPS absent).
- Issue 5: in-flight framework creation cannot be interrupted; compound unobservable/crash risk.
- Issue 8: never-observed missing ancestry cannot be classified.
- Issue 15: production `Commands` does not supply genuine Retry-After metadata.
- Issues 10/11/17/19: pool, wake, general slot-refill and retention candidates HELD; adoption gates unmet.
- Issue 20: reported ~16% disk growth is workload-dependent (fresh evidence shows ~35-39% on small-row workloads); original figure retained with workload provenance.

## New findings (populated at integration; each entry gets ID, severity, classification, location, reproduction, repair, tests, regression risk, result, residual uncertainty, disposition)

_Pending workstream reports: executor/delivery, sources/retry, metrics/UI, database/performance, independent adversarial acceptance._
