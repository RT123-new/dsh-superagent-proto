# Independent review of storage Candidate 1

Base b57bbce, rebased by author onto 6846973. No retention implementation reviewed or changed here.

Author's three tests pass independently. Production decision write audit: core/evals.ts and migration.ts use decisions.save; no other src decision SQL writers found. Store.db is exposed and scripts/storage/profile.ts directly inserts Decisions and separately maintains links, so the candidate invariant was application-only.

## Reproduced gaps and repair

Failing-first 6d37ac7: 2 failures / 2 passes.

- DELETE FROM decision_trigger WHERE decision=? scans all historical links because the only key begins with trigger. Each save therefore acquired an O(history) write step. This write cost was not included in the author's read speedup evidence.
- Direct decision inserts leave flow wrong; direct updates/deletes likewise drift from the authoritative JSON query. This is a compatibility hazard for maintenance/imports/older writers, not a claim that the current Engine bypasses decisions.save.

Repair adds decision_trigger_decision index and SQL insert/update/delete triggers, replacing duplicated JS link maintenance. INSERT OR REPLACE, id changes, repeated trigger IDs and outer savepoint rollback are tested. The first install of all three versioned maintenance triggers reconciles existing link rows from decisions in the schema transaction, including earlier application-only drift. Removing/recreating the table also rebuilds even if triggers remain. Statement failures roll back decision and links together.

Adding the decision-side index changed SQLite's flow join order: an independent actual profile showed 65.97 ms vs author's 28.44 ms, including full decision scans. The final repair pins arrival-window order with INDEXED BY trigger_at and CROSS JOIN to the link table. An actual-query plan test prevents that regression. This is a measured, scoped planner hint, not an assumption that adding an index is always faster.

## Proofs

Eight independent tests cover query plans, direct insert/update/delete/REPLACE/id changes, rollback with an injected link-write failure, reopen integrity, one-time stale-link upgrade, and SIGKILL immediately after an uncommitted vs committed save. Both crash cases recover the expected Decision and exact links with integrity_check=ok. These are process-kill tests, not power-loss or fsync fault injection.

Final full suite: 1326/1326 tests, 74 files. Final typecheck and build pass. Author randomized semantic equivalence and all 19 migration tests pass. No paid calls, production data or external effects.

## Independent measurements

100k existing links; 3 alternating process pairs; each process saves one decision 60 times at fanout 1/10/100. Warm local SQLite WAL/FULL, same synthetic links and operations. Raw distributions retained.

| fanout | original mean ms (mean of runs) | repaired mean ms | original per-run P95 range ms | repaired per-run P95 range ms |
|---|---:|---:|---:|---:|
| 1 | 2.7611 | 0.3422 | 2.8267-2.8946 | 0.3686-0.4227 |
| 10 | 3.0562 | 0.3542 | 2.9329-4.3988 | 0.3963-0.4647 |
| 100 | 3.1262 | 0.5966 | 3.5741-3.8526 | 1.0579-1.1654 |

These local nearest-rank P95 values are not service tail latency. Samples within a process are correlated and only three process pairs ran. No confidence interval or production throughput claim is made. Measured repair removes the original scan and preserves bounded fanout cost.

Final real profile run three times at 100k rows retains index-supported window reads. Raw JSON is under reports/evidence/storage/review/profile-final-*.json. Original candidate's 6-run evidence remains available; no result is silently replaced.

## Costs and limits

The new decision-side index consumes more disk and write maintenance; it is needed to avoid historical scans. The one-time reconciliation scans all decisions, in addition to the author's source index/backfill migration. Author's 1M upgrade timing and +14% size are NOT final repair measurements. Final 1M upgrade cost remains unmeasured and must not inherit that number. Initial adoption requires the normal backup/maintenance-window practice for a blocking synchronous migration.

Source stats assumes valid Trigger.source strings, as the domain type requires. Direct corrupt/missing source data is not silently normalized in this change. Direct manual writes to decision_trigger itself remain outside the invariant; the authoritative source is decision JSON. No automatic per-open full consistency scan is added after the maintained marker exists. Deleting/replacing schema triggers manually requires repair/migration, not ordinary application behavior.

Flow's hinted time-window plan is supported by measured selective-window benefit. All-time windows remain linear in the selected data and hints may need reevaluation on future SQLite versions or different distributions. Search LIKE, OFFSET paging, unbounded lists, vacuum/retention and production contention remain separate issues.

## Crash-proof strengthening after integration review

The first crash assertion allowed any nonzero helper exit. This could false-pass the uncommitted case if setup/import failed before a save. The additive proof now resolves the real tsx loader and spawns Node directly (no wrapper that converts signals into exit codes), requires a synchronously written `SAVE_BOUNDARY:<mode>` marker after decisions.save and before the kill, and requires child.signal exactly SIGKILL. A negative helper-failure case throws before the boundary and proves neither marker nor SIGKILL is present. Both recovery cases and the negative case pass. Latest storage-focused suite 12/12 and typecheck pass; full suite above predates this assertion-only refinement and extra negative case.

Migration maintenance detection intentionally checks the presence of all three versioned trigger names, not SQL definition equivalence. Manual DDL edits that replace those definitions under the same names are unsupported and are not automatically detected or healed. Ordinary direct SQL Decision data writes are covered; manual changes to the maintenance schema are not. The initial proof logs are retained rather than overwritten.
