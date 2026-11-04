# Independent Issue 19 retention review

Candidate2c34c5f, basea69705d. Synthetic databases only. No runtime enablement, schedule, deployment, main change or user database prune.

## Verdict
Retain as reviewed opt-in library candidate, not automatic retention adoption. Original five boundary failures independently reproduced in red8e2cef9 (5/5 failing, typecheck passing), with narrow repairs in retention.ts. Keep the original author report as historical evidence, not current safety/performance claims.

## Proven defects and repairs
- Exact references missed embedded IDs, JSON object keys and kv keys. Conservative substring matching now scans string values plus object/record keys across ticket/thread/outbox/effect/kv. False positives retain more data. Encoding/alias conventions beyond literal substrings remain unproven.
- Archive path equality accepted symlink/hardlink live aliases and could write archive tables into a live database. Canonical path/inode checks reject aliases; a separate existing Store database is also refused. Archives restricted to owner read/write permissions. Concurrent filesystem path replacement by a hostile writer is not covered.
- INSERT OR REPLACE allowed another Store with colliding IDs to overwrite the only archived copy, then original restore imported wrong content. Archive rows are immutable INSERT OR IGNORE with full verification; stable Store lineage binds archive and restore, preserved in normal backups. Foreign Store archive/restore fails closed. A changed already-archived ID needs a separate archive; no silent overwrite.
- Restore trusted corrupted archive contents. Format2 hashes value, disposition, thread links, decision links and timestamp; restore validates the complete selected archive before live mutations, including trigger identity/timestamp. Format1 archives are refused, not silently upgraded. This is corruption detection, not authentication against an attacker able to rewrite hashes.
- Concurrent disposition update between archive commit and delete was lost because only trigger.value was checked. Final transaction now compares the complete snapshot that was actually archived. Changed rows are retained. SQLite snapshot/locking rules prevent committing a conflicting writer unnoticed after the read snapshot; no automatic busy retry is added.
- Restore no longer resurrects stale derived decision links when a decision still exists but its triggerIds changed. Existing live triggers are never overwritten.

## Evidence
13 independent tests plus author11, focused24/24. Whole suite1447/1447 across91files, typecheck/build pass. Author SIGKILL trials independently rerun as part of suite. Raw logs reports/evidence/retention-independent/. Final permission-only tightening rerun separately.

Fresh 10k single-arm synthetic benchmark on repaired gate: 6699 pruned,3301 retained,91.1ms/batch,1639ms total, invariant true. Historical author10k450ms is not the repaired result. New substring scan keeps353 referenced rows in this fixture; do not compare as equal cohorts or claim a speedup. No1M repaired benchmark or index-write-cost remeasurement, so no adoption performance gate is claimed.

## Remaining limits
Library remains OFF. No power-loss/directory-fsync/storage-fault proof; only process kill. Archive WAL sidecars belong to the archive, copy/backup operational tooling not implemented. Concurrent hostile archive rewriting between verification/delete is not supported. Restore validates all rows first but writes500-row transactions, so operational errors can leave a partial restore that is safe to rerun. Permanent tombstones and identity table survive normal SQLite backup. Read APIs/UI do not automatically resolve archived decision references; pre-cutoff history/counts disappear from live views by design. Whole-history eligibility scan remains synchronous and can block event loop; maxBatches controls only batch count, not duration. Substring matching may be expensive or retain nearly everything for short IDs. No automatic VACUUM or tombstone expiry.
