# Independent ingestion review: Issues 1-3

Starting revision: `cdd3c6a`, clean checkout on independent branch `review/issue-1-3-adversarial`. Baseline `8c32a9d`. No main/upstream changes, paid calls, deployment or live work effects.

## Reproduction

Author tests independently reproduced against baseline using a separate worktree with original source and the new tests/fixture: **15 failed, 16 passed**. Against `cdd3c6a`: **31 passed**.

Failing-first commit `572a2b9` adds six independent behavioral failures against `cdd3c6a`:

- Notification reconciliation cannot recover an older comment when its issue already has a newer thread cursor.
- Same loss when that issue also appears in the normal notification scan.
- A pending retry similarly prevents reconciliation from widening its read boundary.
- Repository-wide comments without notifications receive neither configured replay nor periodic reconciliation.
- A first-page ETag can incorrectly suppress a changed later page of a multi-page stream.
- Feishu reconciliation resurrects pre-first-seen requests despite the intentionally non-backfilling initialization rule.

## Repairs

Notification enqueue merges read boundaries at the earliest needed timestamp, bypasses the thread cursor during reconciliation, and retains failedAt/attempts. Durable retry and intake behavior is unchanged.

Each repository stream now uses the configured replay window and independently persists its reconciliation cadence only after complete page reading and intake. Reconciliation cannot roll its durable cursor backwards. It bypasses conditional requests. Only single-page responses retain ETags, since page one's ETag proves nothing about page two.

Feishu persists `feishu-started:<chat>` atomically with first initialization. Recovery clamps to that floor and filters exact timestamps after second-rounded API reads. A legacy cursor without a floor is conservatively adopted as its floor. This prevents old unauthorized-by-time requests being introduced, but cannot reconstruct the original first-seen timestamp: previously missed messages older than that migration cursor are not recovered. Existing files/work are untouched. No consume() changes overlap the separate PRE-1 fix.

## Additional evidence

The test suite also checks retained retry age/attempts on another failure; restart after intake+ticket decision but before scan checkpoint; one logical Ticket, Assignment, executor start and acknowledgement across replay/restart; and post-first-seen late Feishu messages versus excluded earlier same-second messages. These use actual SQLite persistence and Engine intake/decision code, mocked transports/ports only.

External effect exactly-once delivery is NOT claimed. Tests prove one queued acknowledgement through the Engine port, not transactional remote delivery across a crash after a remote service accepts an effect.

## Delivery guarantee and limits

Recoverability is bounded by successful scans, endpoint visibility, first-seen/admission boundaries and retained stable trigger identities. An event must be returned while its timestamp is still inside a successful scan window. Horizon H with cadence C is not a guarantee of H seconds of delivery delay: continuously running defaults H=3600s, C=1800s allow roughly H-C=1800s delay less scan duration, while outages reduce that bound further. Turning reconciliation off accepts loss beyond replay. Neither unlimited exactly-once nor unlimited late-event delivery is claimed.

GitHub uses its supported page-number mechanism starting at page two, with subsequent Link traversal delegated to `gh api --paginate --slurp`. A failed paginated command stages nothing from that stream, retains its cursor and reconciliation cadence, and retries the scan. Live GitHub/Feishu services were not exercised. Mutable offset pagination is not snapshot isolation; concurrent remote mutations can shift pages and are bounded by subsequent replay/reconciliation, not proved impossible.

Feishu first/middle/final page recovery already worked and remains pinned by the author tests. Invalid remote items still follow the pre-existing explicit skip-and-health-count policy, not a promise to recover malformed data.

## Final validation

- Focused author+independent ingestion tests: **40/40 pass**.
- Full suite: **1236/1237 pass**. Only failure is known PRE-1 in Feishu event-consumer health ordering, independently reproduced before this repair and assigned separately to integration.
- `pnpm typecheck`: pass.
- `pnpm build`: pass.
- No UI or visual artifacts changed.
