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

## Addendum: fresh clustered paired analysis (exploratory, one machine)
Raw: reports/evidence/db-review/paired-100k-seed6.json; harness: reports/evidence/db-review/harness/ (_rev_paired.ts, _rev_cluster.py). Candidate = review/db-links code (v2 triggers, one-statement flow), baseline = main 8c32a9d, 100k triggers per seed, 6 independent seeds (separate databases), 40 paired windows per seed, alternating run order, 0 result mismatches in 240 pairs. Uncertainty: 10,000-draw bootstrap that resamples whole seeds (clusters), keeping all pairs within a seed. The saved evidence (paired-query, 200 pairs, 5 seeds) was re-analysed with the same cluster bootstrap; the earlier report used a pair-level bootstrap, which understates uncertainty because pairs within a seed are correlated. With 5-6 clusters the intervals are themselves coarse.

My windows were drawn uniformly over the whole history (`since` anywhere from 1% to 99% of it).
| query | stat | gain, cluster CI | per-seed gains |
|---|---|---|---|
| triggerStats | P50 | 73.6% [69.9, 76.5] | 69-79% |
| triggerStats | P95 | 49.6% [47.4, 53.9] | 47-55% |
| flow | P50 | 39.2% [33.7, 44.2] | 32-47% |
| flow | P95 | -3.0% [-6.0, -1.1] | -7.6 to +8.6% |

The saved evidence windows covered only the most recent 1-20% of history (frac 0.011-0.196). Re-analysed with clusters: triggerStats P95 gain 91.0% [90.8, 92.7]; flow P95 gain 76.9% [76.0, 79.8]; no slower pair.

Finding (workload dependence): the gain shrinks as the window covers more of the history, because both queries then read most of it. flow P95 gain by window width in my data: under 25% of history 63.9%; 25-50% 38.8%; 50-75% 24.0%; over 75% -4.5% (slightly slower). triggerStats stays positive (50.6% even at over 75%). Production callers use `since` = last 24 h (src/app/views/overview.ts, sources.ts), so the real gain depends on how many days of history a deployment holds: a store with about a day or less of history sees no flow benefit. The earlier "15% gate met" statement should carry this condition: it holds for the workload sampled (windows of at most 20% of history), and in this exploratory data the flow gain falls below 15% when the window covers most of the history. The widths above are empirical buckets from one synthetic generator, not a guaranteed threshold.

## Compatibility and migration checks (own runs)
- Opening a PR-upgraded schema 11 database with main's Store and writing a decision keeps the link table correct (the v2 triggers live in the file); reopening with the PR store gives identical flow and triggerStats. No generated column was dropped.
- Supported schemas: OLDEST_SCHEMA 10 to SCHEMA_VERSION 11. Older is refused (tooOld) and newer is refused ("Unsupported orchestrator database version"), both before any change. Schema 10 upgrades once; repeat opens are idempotent; a failed upgrade rolls back the link DDL (tests/review-db-migrate-links.spec.ts).
- A schema 10 database with a malformed decision row is still refused, fail closed, nothing skipped or deleted. The error now names the decision id and never its payload (src/app/migration.ts; red first).

## Addendum: two separate comparisons
1. Original optimization versus main (above): inherited PR optimization re-evaluated against main 8c32a9d.
2. This review's repairs versus the unchanged PR implementation (de50174), same harness (reports/evidence/db-review/harness/_rev_paired_prhead.ts, raw: paired-100k-seed6-prhead-vs-candidate.json), 6 seeds, 240 pairs, 0 mismatches. The query SQL did not change except flow now being one statement, so no speed difference is expected, and none is found beyond noise: triggerStats P95 -1.1% [-4.0, 1.2], flow P95 -0.2% [-0.9, 1.3], flow P50 -3.0% [-4.8, 1.3] (cluster bootstrap over seeds; negative means the repaired candidate is slower). No performance gain is claimed for the repairs; they are correctness changes.

## Migration error label
The decision id in the schema 10 refusal is untrusted data and can look like a secret at any length, so it is never printed: the error gives the SQLite rowid, the id length and the first 12 hex digits of its SHA-256, and never the payload. Hostile fixtures in tests/review-db-migrate-links.spec.ts (ESC and newline with an 80-char token, a 40-char ghp_ shape, a short sk- shape, an AKIA shape).

## Phases 7 and 8: audit of the existing raw evidence (read-only; no new mechanism, no new benchmark run)
Status: accounting and recomputation from saved raw files only. I did not rerun the Stage D scheduling benchmarks, and I did not review the coordinator/queue/session source for new defects (that review is not done by this section). Real-service latency is not covered anywhere: all of these runs are virtual-time or fixture runs.

Coverage map of the mandated factors against saved evidence (existence and scenario text only unless marked "recomputed"):
- W in {1,3,6,12}: bench/issue-13-14-coordinator-load.bench.spec.ts runs 1/3/6/12 with 5 seeds (queue ages, relay burst, outage). stage-d/issue-17-capacity-matrix.json covers only 3/6/12 with 3 seeds each (no W=1 there; W=1 appears only in issue-17-review). No default capacity increase was adopted.
- C in {1,2,4,8} (held pool): pool-independent/actual-pool-raw.json, 4 profiles x 4 C x 5 seeds, virtual time. Recomputed below.
- Scenarios: saturated (capacity matrix, 24 tickets), bursty (failure-burst, relayBurst), long background work (issue-16 a-f), one blocked ordered message (issue-14 HOL spec), slow external dependency (slow-network profile, outage experiment), rate limiting (rate-bound profile; retry specs), cancellation (issue-16 c), restart during active work (issue-18 restart storm, 5 restarts). I found no profile named "light workload"; treat it as not shown unless the lead finds one. Pause is not an explicit scenario in these files.

Recomputed from raw (own script, not the saved summaries):
- issue-17-review baseline-full/variant-full (slot refill candidate, held): refill capacity 1 P95 1971 -> 14 ms, gain 99.29%; makespan P95 gain cap 3 +11.48%, cap 6 -14.12%, cap 12 -5.38%; 0 failures; all match the report. Caveats the report should carry: (a) 5 seed clusters and a P95 over 5 makespans is just the maximum, so the cluster interval is degenerate (cap 3: [11.48, 23.02], lower bound equal to the point estimate); (b) the capacity-1 baseline refill is a fixed ~1.9-2.0 s timer after a quiet turn end in a scenario with no pump, while a relayed end already kicks the queue (issue-17-slot-refill-latency.json: 1982 vs 9 ms), so the 99% applies only to quiet ends. The candidate stays held; the lower-capacity result is not a basis to re-enable it.
- Pool (held): per-seed gain vs C=1: latency-bound C=2 11.1-13.6%, C=4/8 11.5-13.9% (below the 15% gate in every seed); rate-bound 0% at every C; slow-network C=2/4/8 about 49/72.6/79.5%. maxActive is 3 for C=4 and 8 in latency-bound, so C=4 and C=8 are the same measured system. Matches the report's held decision.
- Lost-event rate: failure-burst shows 189 stored of 200 requests (55 failures) at every C, baseline included, i.e. R_loss = 5.5% in that profile for both arms. Section 8.3 requires these to be classified as deliberately unsupported remote visibility/admission or counted as losses; the saved summary does not classify them. Needs an explicit classification in the final report.
- Outage experiment (coordinator): relativeImprovement 0.8557 with a CI over 1500 "pairs". Those are 300 relays x 5 seeds, i.e. correlated events inside 5 seeds, and baseline P95 is identical (426075) in all seeds. By Phase 8.4 this interval is not a valid cluster interval; at most 5 clusters exist. Treat as exploratory.
