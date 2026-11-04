# Issues 19-20 storage: baseline profile (read-only, no production code changed)

Harness: `scripts/storage/profile.ts` (node 22 + node:sqlite, real `Store` schema, synthetic rows via bulk SQL, then the real `store.read.*` / repository methods, median of 3-5 runs, EXPLAIN QUERY PLAN of the exact SQL executed). Raw data: `reports/evidence/storage/profile-*.json`.
Dataset per N triggers: N dispositions, N/2 decisions, N/10 threads, N/20 tickets/outbox/effects. Triggers carry ~250 byte text. One machine, warm cache, WAL; absolute ms are indicative, scaling shape is the evidence. Synthetic, not production data.

Median ms (all synchronous, i.e. each blocks the event loop for that long):

| query | 1k | 10k | 100k | 1M |
|---|---|---|---|---|
| recentTriggers(0,50) | 0.11 | 0.09 | 0.09 | 0.1 |
| recentTriggers(offset=N/2,50) | 0.11 | 1.28 | 4.39 | 55.32 |
| triggerStats(since 90%) | 1.18 | 16.5 | 181.34 | 2154.82 |
| triggerStats(since all) | 1.15 | 15.72 | 178.29 | 2075.42 |
| flow(since 90%) | 0.7 | 9.29 | 96 | 1076.77 |
| triggers(source=github) | 0.2 | 0.16 | 0.18 | 0.17 |
| triggers(filtered) | 0.21 | 0.21 | 0.22 | 0.22 |
| triggers(filtered, offset N/8) | 0.46 | 3.35 | 34.26 | 372.86 |
| threadTriggers(mid) | 0.06 | 0.05 | 0.05 | 0.05 |
| threadPage(mid, 5, 5) | 0.03 | 0.03 | 0.04 | 0.04 |
| neighbours(mid) | 0.05 | 0.04 | 0.05 | 0.05 |
| firstTrigger(mid) | 0.02 | 0.01 | 0.01 | 0.02 |
| search(text LIKE miss) | 1.04 | 11.03 | 113.26 | 1183.99 |
| search(text LIKE hit rare) | 1.1 | 12.03 | 24.53 | 25.17 |
| recentDecisions(0,50) | 0.06 | 0.05 | 0.05 | 0.05 |
| decisions(kinds,since 90%) | 0.36 | 0.21 | 0.16 | 0.16 |
| decisionsOfKinds | 0.14 | 1.31 | 14.13 | 145.63 |
| failingReplies | 0.02 | 0.03 | 0.2 | 2.71 |
| droppedReplies | 0.04 | 0.03 | 0.03 | 0.03 |
| droppedSince | 0.01 | 0.01 | 0.01 | 0.05 |
| subscribedThreads() | 0.01 | 0.03 | 0.3 | 5.15 |
| threads.list() | 0.18 | 2.06 | 17.67 | 216.25 |
| threads.active() | 0.01 | 0.01 | 0.01 | 0.01 |
| tickets.list() | 1.86 | 0.64 | 11.38 | 144.92 |
| tickets.open() | 0.02 | 0.06 | 0.51 | 7.13 |
| tickets.active() | 0.01 | 0.03 | 0.24 | 4.04 |
| decisions.byThread(mid) | 0.02 | 0.02 | 0.02 | 0.02 |
| triggers.get(id) | 0.01 | 0.01 | 0.01 | 0.01 |
| triggers.save(1) | 0.43 | 0.69 | 3.56 | 31.8 |
| _size_MB | 1.0 | 9.5 | 96.1 | 977.7 |

## Findings (measured)
- Point/indexed reads (threadTriggers, neighbours, byThread, get, open/active, subscribed) stay under ~8 ms at 1M.
- triggerStats: SCAN of trigger (+ disposition join) on every call; 2.1 s at 1M (linear). Cause: all-time MAX(at) per source forces full scan, not the since window.
- flow: scans decision + json_each; 1.1 s at 1M.
- search: LIKE %x% over text/url, linear; ~1.2 s at 1M on a miss.
- OFFSET pagination (recentTriggers, triggers filtered): linear in offset (55 ms / 373 ms at 1M).
- threads.list / tickets.list / decisionsOfKinds: unbounded full loads/scans, 145-216 ms at 1M.
- triggers.save grows 0.4 ms -> 32 ms at 1M in this run (index maintenance + 1GB file); to re-check in isolation.
- Not yet measured: backup/restore, VACUUM/checkpoint time, crash mid-batch, concurrent write latency, FTS5.

## Retention reference audit (source read, not yet proven by test)
- Triggers are referenced by id from: decision.triggerIds, thread.pending / thread.evaluating.triggerIds, ticket.origin.triggerId(s), ticket.inputs[kind=trigger/resumed], Attention.triggerId, reply/outbox request.triggerId, disposition.id, trigger_thread rows.
- core/intake.ts:23 dedupes by `triggers.get(id)`. Deleting an old trigger therefore lets a source replay or reconciliation (H=3600s) re-ingest it as NEW work. Any retention must stay older than max replay horizon or keep a tombstone (id only) - this is the main correctness risk.
- Retention eligibility must exclude: triggers referenced by open/active tickets, pending/evaluating threads, pending effects/outbox. Tickets/decisions/audit history: no eligibility defined yet.
- Existing deletes are KV cache cleanups only; there is no history deletion path today.

## Next (no schema changes until safety KV additions land)
1. Candidate repairs, each failing-first with before/after on these fixtures: windowed triggerStats/flow (index-supported, per-source last-at), keyset pagination, bounded list APIs, search via FTS5 only if measured worthwhile.
2. Backup/restore + crash + bounded-batch retention prototype as opt-in, off by default, with reference/tombstone checks.
3. Independent review before integration.

## Backup / crash experiment (scripts/storage/crash-backup.ts, 100k triggers, evidence crash-backup-100000.json)
- VACUUM INTO 96 ms, sqlite backup API 66 ms (57-59 MB); both copies: integrity_check ok, row counts equal source.
- 8 SIGKILL trials during 500-row-batch delete (trigger + trigger_thread + disposition in one BEGIN IMMEDIATE txn): every trial integrity ok, deleted counts multiples of batch size, the three tables always in step; rerun resumed to the exact expected 40000 rows.
- Limits: process kill only, NOT power loss/fsync fault; eligibility predicate in the script is age only (placeholder), not the reference-safe predicate; 100k only so far; backup run while idle (no concurrent writers).

## Candidate 1 (Issue 20): windowed triggerStats and flow (commit follows this report)
Changes: generated column `trigger.source` + index `trigger_source_at(source, at)`; derived table `decision_trigger(trigger, decision)` (WITHOUT ROWID) maintained inside `decisions.save` (atomic) and rebuilt once from Decision records when first created. triggerStats uses a loose index scan over sources + per-source index ranges; flow is driven from the arrival window. Result semantics unchanged: tests/issue-19-20-storage.spec.ts compares both against the previous SQL verbatim on randomized data (filtered/unfiltered dispositions, re-saved decisions with changed triggerIds, decisions referencing missing triggers, sources with no window rows keep lastAt). Failing-first: the link-rebuild and index-plan tests fail on the base source; the equivalence test passes on both by design. Full pnpm check on this branch (rebased on 6846973): 1318/1318 tests, 73 files, typecheck+build PASS.

Paired repeated measurement, 100k triggers, 6 alternating process runs each (median of 3-5 inner reps per run), mean ± sd:
| query | baseline ms (mean ± sd, n=6) | candidate ms (mean ± sd, n=6) | ratio |
|---|---|---|---|
| recentTriggers(offset=N/2,50) | 5.12 ± 0.59 | 4.66 ± 0.19 | 1.1x |
| triggerStats(since 90%) | 182.84 ± 1.95 | 8.45 ± 0.06 | 21.6x |
| triggerStats(since all) | 178.99 ± 2.55 | 84.53 ± 0.66 | 2.1x |
| flow(since 90%) | 97.40 ± 1.57 | 28.44 ± 0.29 | 3.4x |
| triggers(filtered, offset N/8) | 34.48 ± 0.30 | 34.49 ± 0.28 | 1.0x |
| search(text LIKE miss) | 112.58 ± 1.15 | 112.88 ± 0.86 | 1.0x |
| search(text LIKE hit rare) | 24.57 ± 0.15 | 24.63 ± 0.08 | 1.0x |
| decisionsOfKinds | 14.37 ± 0.12 | 14.31 ± 0.09 | 1.0x |
| threads.list() | 17.91 ± 3.31 | 25.45 ± 1.82 | 0.7x |
| tickets.list() | 9.61 ± 3.16 | 8.90 ± 1.59 | 1.1x |
| triggers.save(1) | 3.70 ± 0.24 | 3.64 ± 0.06 | 1.0x |
(threads.list difference is unrelated code: noise/layout; not claimed.) 1M figures for the candidate are not yet paired - only baseline 1M exists. "since 90%" is a 10% window; production views use a 24h window, so real gain depends on arrival rate. "since all" stays O(window=all).
Costs: upgrade-open of an existing 1M-trigger/500k-decision DB took 2.0 s once (index + link backfill), file grew ~14% (483 -> 549 MB); steady reopen 0.31 s. decisions.save now does one extra DELETE + INSERT per trigger id (not separately benchmarked). triggers.save unchanged (3.70 vs 3.64 ms).
Not changed / still open: search LIKE (linear), OFFSET paging, unbounded list loads, retention, FTS5 evaluation.

## Candidate 1 decisions.save regression (measured, scripts/storage/decision-save-bench.ts; single runs per N, mean ms per save)
| N decisions | baseline autocommit / batched | candidate autocommit / batched |
|---|---|---|
| 2k | 0.142 / 0.009 | 0.248 / 0.239 |
| 10k | 0.152 / 0.007 | 0.394 / 0.411 |
| 40k | 0.095 / 0.009 | 1.102 / 1.171 |
Candidate cost grows linearly with history: `DELETE FROM decision_trigger WHERE decision=?` cannot use the (trigger, decision) primary key and full-scans the link table. This is a real regression introduced by Candidate 1 as committed in b57bbce (about 12x autocommit, >100x batched at 40k; extrapolates to ~tens of ms per save at 1M). The 100k/6-run version timed out the harness, so only single runs are claimed. A repair needs a (decision) index or PK order change; independent reviewer owns that repair. Candidate 1 read gains stand, but it must not be adopted as committed.

## Paired measurements of the reviewer-repaired Candidate 1 (ref review/issue-20-independent @06ad576) vs base (programme/reliability 6846973 source)
Method: alternating base/repaired process runs, same harness and machine, synthetic data, raw JSON in reports/evidence/storage/paired2/. Mean ± sd across process runs (each run itself a median of 3-5 inner reps). Small n: no P95/CI claim.

### Reads, 100k triggers (n=6 pairs)
| query | baseline ms (mean ± sd, n=6) | repaired ms (mean ± sd, n=6) | ratio |
|---|---|---|---|
| recentTriggers(offset=N/2,50) | 5.01 ± 0.89 | 4.88 ± 0.24 | 1.03x |
| triggerStats(since 90%) | 183.20 ± 1.31 | 8.50 ± 0.17 | 21.56x |
| triggerStats(since all) | 184.00 ± 13.32 | 85.90 ± 2.02 | 2.14x |
| flow(since 90%) | 95.72 ± 0.77 | 14.59 ± 0.14 | 6.56x |
| triggers(filtered, offset N/8) | 34.45 ± 0.24 | 34.66 ± 0.33 | 0.99x |
| search(text LIKE miss) | 112.32 ± 0.77 | 112.98 ± 1.44 | 0.99x |
| search(text LIKE hit rare) | 24.53 ± 0.20 | 24.60 ± 0.21 | 1.00x |
| decisionsOfKinds | 14.34 ± 0.29 | 14.46 ± 0.32 | 0.99x |
| threads.list() | 20.75 ± 4.43 | 23.51 ± 4.48 | 0.88x |
| tickets.list() | 9.73 ± 1.23 | 7.17 ± 0.93 | 1.36x |
| triggers.save(1) | 3.50 ± 0.06 | 3.71 ± 0.20 | 0.94x |

### Reads, 1M triggers (n=3 pairs)
| query | baseline ms (mean ± sd, n=3) | repaired ms (mean ± sd, n=3) | ratio |
|---|---|---|---|
| recentTriggers(offset=N/2,50) | 57.6 ± 1.3 | 56.1 ± 1.9 | 1.03x |
| triggerStats(since 90%) | 2131.1 ± 23.7 | 88.7 ± 3.2 | 24.02x |
| triggerStats(since all) | 2090.5 ± 6.8 | 938.1 ± 11.2 | 2.23x |
| flow(since 90%) | 1067.5 ± 15.1 | 157.4 ± 1.6 | 6.78x |
| triggers(filtered, offset N/8) | 374.2 ± 2.4 | 370.8 ± 1.7 | 1.01x |
| search(text LIKE miss) | 1183.1 ± 6.1 | 1183.5 ± 10.9 | 1.00x |
| search(text LIKE hit rare) | 25.4 ± 0.5 | 25.0 ± 0.2 | 1.02x |
| decisionsOfKinds | 150.9 ± 5.2 | 148.0 ± 1.7 | 1.02x |
| threads.list() | 218.4 ± 3.7 | 213.7 ± 5.2 | 1.02x |
| tickets.list() | 127.0 ± 4.7 | 100.7 ± 6.3 | 1.26x |
| triggers.save(1) | 32.2 ± 0.5 | 32.0 ± 0.2 | 1.01x |

### decisions.save (scripts/storage/decision-save-bench.ts, n=6 pairs, ms per save)
| N decisions | metric (ms/save) | baseline mean±sd | repaired mean±sd | n |
|---|---|---|---|---|
| 10000 | autocommitMs | 0.1300 ± 0.0018 | 0.1459 ± 0.0068 | 6 |
| 10000 | resaveMs | 0.0911 ± 0.0050 | 0.1249 ± 0.0036 | 6 |
| 10000 | batchedMs | 0.0078 ± 0.0013 | 0.0261 ± 0.0047 | 6 |
| 100000 | autocommitMs | 0.1023 ± 0.0038 | 0.1340 ± 0.0036 | 6 |
| 100000 | resaveMs | 0.0943 ± 0.0069 | 0.1311 ± 0.0044 | 6 |
| 100000 | batchedMs | 0.0087 ± 0.0014 | 0.0298 ± 0.0036 | 6 |
The regression of b57bbce (linear growth, 1.1 ms at 40k) is gone: repaired cost is flat in history size (0.134 vs 0.102 ms autocommit at 100k; batched 0.030 vs 0.009 ms). That is ~+0.03 ms per decision save, +30% autocommit, ~3x batched (still tiny in absolute terms).

### Upgrade and disk
- Upgrade-open of an existing 1M trigger / 500k decision DB: 2.2 s once (one run), steady reopen 0.33 s; file 483 MB -> 560 MB (+16%) on that fixture.
- Profile fixture (1M triggers, 500k decisions, other tables): 978 MB -> 1060 MB (+8%); bulk load of the fixture 13.2 s -> 20.0 s (~+50%: the SQL triggers/links add write work per decision insert; this fixture also inserts links redundantly via INSERT OR IGNORE).
- triggers.save unchanged (32.2 vs 32.0 ms at 1M; the 32 ms itself is a baseline cost of this fixture, not caused by the candidate).
### Still not done
- triggerStats "since all" and flow remain O(window); at 1M a 24h window depends on arrival rate. No claim for production windows.
- No claim on P95/CI, power-loss, concurrent writers, or production-shaped data. Upgrade time/disk are single runs on synthetic data.

## Paired representative query sample (task-pair identity; scripts/storage/paired-query.ts + paired-analyze.py)
Design: 5 workload seeds (different source count/skew, filtered share, decision share, thread count), each a 100k-trigger store built once with the BASE schema, copied, the copy opened (upgraded) by the repaired tree (06ad576). Per seed 40 selective windows (1%-20% of the timeline, same list for both trees) x triggerStats and flow = 200 task pairs per query; each pair is the median of 3 inner reps. Nearest-rank P50/P95 over pairs; 10,000-resample bootstrap that resamples task pairs (base and repaired values kept together). Results compared per pair: 0 mismatches in 200 pairs x 2 queries.
pairs=200 seeds=5 result-mismatches=0

| query | stat | baseline ms | repaired ms | paired ratio base/rep | 95% bootstrap CI of ratio (10k) |
|---|---|---|---|---|---|
| triggerStats | P50 | 146.50 | 7.00 | 20.9x | 18.6x - 24.7x |
| triggerStats | P95 | 152.43 | 13.70 | 11.1x | 10.9x - 11.8x |
| stats | per-pair ratio min/median/max | | | 9.9 / 20.7 / 257.4 | pairs where repaired slower: 0 |
| flow | P50 | 109.20 | 15.13 | 7.2x | 6.4x - 8.0x |
| flow | P95 | 119.16 | 27.51 | 4.3x | 4.3x - 4.5x |
| flow | per-pair ratio min/median/max | | | 3.0 / 6.6 / 77.0 | pairs where repaired slower: 0 |
Caveats: pairs within a seed share a dataset (bootstrap resamples pairs, not seeds, so the CI is narrower than a cluster bootstrap with only 5 seeds would give); synthetic data, one machine; warm cache; the thresholds in the user's preregistration are not restated here, so no pass/fail on them is claimed.
