> Historical candidate report, NOT adopted in programme/reliability. Later independent review and integration disposition supersede its implementation/performance statements. Candidate code remains on its separate review branch.

# Issue 19: opt-in, reference-safe Trigger retention (branch review/issue-19-retention, base a69705d)

Scope implemented (smallest safe path): `store.retention.run(options)` / `restore(archivePath, ids?)` for old Triggers only. Off by default: nothing in the runtime calls it, no schedule, no setting. Decisions, Tickets, Threads, outbox, effects and kv are never deleted.

## Rules
- Eligible: `at` older than `olderThanMs` (hard floor 48 h; the 14-day poll horizon and the 1800 s reconciliation scan are covered by tombstones, not by age).
- Always kept: newest Trigger of each Source (all-time `lastAt` stays exact); first and first-human Trigger of each Thread (titles and links in views); Triggers queued or evaluating on a Thread; any Trigger whose id appears as an exact string value anywhere in a Ticket, Thread, outbox row, effect payload or kv value, or as an effect key / outbox id.
- Order of operations per batch: choose by keyset (at,id), evaluate keep rules, write archive rows (separate SQLite file, synchronous=FULL) and commit, read back and compare sha256 of value+disposition+thread index, then in ONE main transaction re-check eligibility and unchanged value, insert tombstones and delete Trigger, disposition, trigger_thread and decision_trigger rows. Archive failure or mismatch deletes nothing.
- Dedupe: new optional `triggers.retired(id)` port; `Intake.receive` returns `duplicate` for a tombstoned id. Tombstones are permanent (id, at, source) so replay, reconciliation or late indexing of an old event cannot become new work, whatever the age.
- Restore reinserts rows from the archive (Trigger, disposition, thread index, decision links for decisions that still exist) and removes tombstones; idempotent.
- Backup: VACUUM INTO / backup API copies include tombstones; test restores such a copy and checks integrity and `retired`.
- Store change beyond retention: new index `trigger_thread_id(id)`; found while profiling the retention pass (see below).

## Evidence (tests/issue-19-retention.spec.ts, 11 tests; full vitest on this branch 1434/1434 in 90 files, tsc clean)
dry run writes nothing; floor and live-file refusal; eligible/kept classification across all reference kinds; archive rows byte-equal to source; every pruned id tombstoned; idempotent rerun; replay via a real Engine returns `duplicate` and creates no thread; windowed triggerStats/flow equal before/after for windows inside retention; decision `triggerIds` retained and resolvable via archive; full restore equals pre-prune table dumps; archive failure leaves live DB untouched; post-prune backup keeps tombstones; 5 SIGKILL trials (2 self-killed after fixed batch counts, 3 timer kills) with 6000 triggers (integrity ok, every missing Trigger has tombstone and archive row, no thread-index orphans, rerun completes); index-plan test for trigger_thread_id.

## Measurements (scripts/storage/retention-bench.ts, synthetic, single runs, 500-row batches, ~66% of rows eligible)
Before the index: 10k rows 2.9 s; 50k rows 86.2 s (979 ms per batch, quadratic: `trigger_thread WHERE id=?` scanned the whole table per candidate).
After `trigger_thread_id`: 10k 0.45 s; 50k 3.0 s; 200k 22.8 s (65 ms per batch; remaining growth is the exact-reference scan over Tickets/threads/outbox/effects/kv per batch).
Side effect: `triggers.save` (which runs `DELETE FROM trigger_thread WHERE id=?`) drops from 3.5 ms to ~0.4 ms at 100k and 32 ms to 0.49 ms at 1M (single runs; raw reports/evidence/storage/profile-1000000-trigger-thread-id-index.json). Index cost: 1M fixture 1060 MB -> 1077 MB (+1.6%).

## Residual risks and limits (not closed)
- Process-kill proof only; no power-loss/fsync-fault proof. A crash between archive commit and main delete leaves harmless extra archive rows.
- Reference check is exact-string: an id embedded inside a larger string, or only in a kv KEY, is not detected. Tombstones and the archive make a wrong prune recoverable, not impossible.
- Pruned Triggers vanish from live timelines/search and from windowed counts for windows reaching before the cutoff by design; they are only in the archive (not queryable from the UI).
- The live file does not shrink (free pages are reused); no automatic VACUUM. Tombstones grow forever (about 60 bytes each).
- Each batch is synchronous; at 200k rows about 65 ms per batch blocks the event loop; callers use `maxBatches` to interleave.
- Not exercised: production data, concurrent writers during a run, retention of Tickets/Decisions/Threads (out of scope), operator UI or CLI (library API only), restore of a subset while newer data exists for the same ids (restore skips present ids).
