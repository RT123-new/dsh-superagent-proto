# PR final review: database, migration and performance (phases 6-8, partial)

Reviewed candidate: branch review/db-links on PR head de50174 (main 8c32a9d). All numbers: own synthetic data, one machine, Node 22, exploratory (not clustered or paired). Harness: scripts/_rev_*.ts (untracked helper scripts, provenance only).

## Confirmed defects (fixed, failing test first)
- D1 Link triggers v1 broke direct-SQL writes the legacy query tolerated (`triggerIds:null`, null element, malformed JSON) and linked non-string ids. Fixed by v2 triggers (array and text-element filter, malformed JSON links nothing). Tests: tests/review-db-link-shapes.spec.ts.
- D2 `flow()` ran two statements, so a commit by another connection between them returned a state that never existed ({judged:0,accepted:1}). Fixed with one statement. Test: tests/review-db-flow-snapshot.spec.ts.

## Malformed-decision read semantics (deliberate, accurate scope)
- Metrics queries (flow, triggerStats) tolerate a malformed decision row and count no link. Baseline `flow` threw.
- Decision readers (recentDecisions, decisions, decisionsOfKinds) still throw on such a row, unchanged. Tests: tests/review-db-malformed-reads.spec.ts.

## Measurements
- Equivalence (baseline vs PR queries, incl. direct SQL update/delete/id change/replace): 0 mismatches at 1k, 10k, 100k, 1M. 1M ran on the pre-flow-edit candidate; 100k was re-run after it.
- Query P50/P95 ms at 1M: triggerStats 940/949 -> 52/55; flow 1054/1077 -> 119/121. Calls are synchronous, so this is also event-loop block per call.
- Disk: G_disk +35% to +39% from 1k to 1M on small rows (237.6 -> 327.4 MB at 1M). The earlier "about 16%" is not reproduced; it depends on row shape.
- Bulk load 1M in one transaction: 5.8 s -> 12.5 s.
- Single-row autocommit decision insert (2000 writes): P50 0.086-0.096 -> 0.112-0.116 ms; P95 about 0.32 -> 0.34 ms.
- Startup on an already-upgraded DB: about 1 ms at 100k and 1M. First open of a pre-existing DB runs the link backfill synchronously: 125 ms at 100k, 1283 ms at 1M (blocks the event loop once). Repeat open 0.9 ms.
- RSS: 128-139 MB for both, no meaningful difference (whole-process, not per query).
- Hard kill: before commit (timing based, 9 delays, 600k rows) recovered with integrity ok, exact links, idempotent reopen. After commit (explicit marker) links and app write survived.
- Concurrent reader/writer (20k writes from a second process): 0 busy and 0 reader errors; the snapshot defect D2 was found here.

## Not verified
Own schema-10 upgrade matrix and rollback during migrateTo11 combined with the new triggers (existing specs cover some), recomputation of saved scripts/storage raw evidence, clustered paired analysis, full-suite rerun on this candidate. Retention remains held and untouched.
