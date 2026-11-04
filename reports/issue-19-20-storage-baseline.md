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
