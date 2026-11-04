# Final status: acceptance pending

This is a working closeout, not a success declaration. The programme has repaired reviewed correctness defects and adopted the measured storage query optimization. Other mechanisms remain disabled, rejected, partial or under review. Main is unchanged; no automatic merge or external deployment has occurred.

The most recent fully green checkpoint before current retry/coordination integration was f675f71:1442tests/typecheck/build. The five stale retry characterization assertions were repaired in dbbacaa with an explicitly frozen baseline model plus current production checks;44focused tests pass, final full suite still pending. StageF and the final pull request remain outstanding. This file will be updated with the exact final tested revision and review result.

| Issue | Initial status | Action taken | Verified result | Remaining risk |
| --- | --- | --- | --- | --- |
|1 GitHub notifications|Late arrivals could fall behind a short cursor overlap|Durable replay identities and bounded reconciliation|Falling-first author/reviewer proofs repaired; coverage tested|Outages, API visibility and bounded scan cadence limit recovery|
|2 Pagination|First-page/cursor advancement could lose dense same-time events|Follow pages and advance only after durable processing|Identical-time,>100events and page-failure cases pass|Mutable remote pagination is not a snapshot|
|3 Feishu history|Late indexing/first-seen gaps; baseline diagnostic race|Replay/floor repair and sticky malformed-line health|History replay and controlled diagnostic race pass|Legacy floor and endpoint visibility limits|
|4 Workspace readiness|Directory existence falsely implied successful preparation|Identity-bound record, fail-closed migration, preserve unknown work|Partial/corrupt/legacy/config-change regressions pass|No arbitrary future edit or power-loss guarantee|
|5 Cancellation|Preparation and async ensure could outlive cancellation|Assignment abort, owned process settlement, boundary generations|Process and ensure/decorate regressions pass|Already-running framework creation cannot be interrupted; compound unobservable/crash risk|
|6 Retry authorization|Delayed retry had a stale-authority window|Recheck immediately at managed prompt delivery|Revocation/replacement/pause races pass|Not blanket revocation of active external work|
|7 Settings notices|Unsent updates coalesced without revision identity|Revisioned idempotent notifications|Rapid revisions/restart/dedupe pass|No universal exactly-once remote delivery|
|8 Subagents|Depth8 bound could fail open|Persist observed managed lineage and validate ancestry|Deep/cyclic/restored managed cases pass|Never-observed missing ancestry cannot be classified|
|9 Metrics|Lifecycle missing or named too strongly|Bounded collector, causal committed identities, actual runtime hooks, process snapshot|Red/green correlation, HTTP, usage, failure isolation and atomic slot checks|PARTIAL. Provider attempt start, full eligible/correct denominator and TPS/CPS absent; source queue review pending|
|10 Polling|Subscription reads sequential|Matched-gate isolated actual Source/Engine/SQLite pool experiments|11isolated tests/script typecheck; virtual clock measurements|Optional production pool still under review; no real-network gain claim|
|11 Detection|Poll interval creates detection delay|Signed durable wake experiment retaining polling fallback|Synthetic loss/dedupe/backup checks|Not deployed; end-to-end account/reconciliation/parallel drain proof missing|
|12 CLI overhead|Repeated process startup costs time|Measured startup and loopback transport alternative|200paired iterations/profile;3page gain below15%|Retain existing CLI account/wrapper boundary; no production HTTP replacement|
|13 Coordinator load|Potential overload from reports/notices|Store/Effects virtualclock workload at1/3/6/12workers|Independent explicit two-case benchmark and conservation tests pass|No real-model quality/cost/throughput inference|
|14 Ordered queues|Head-of-line blocking exists|Partition fixture evaluated; real single-writer boundary audited|Ordering/failure fixtures pass|No partition adopted; blocked ordered head intentionally holds following rows|
|15 Retry policy|Lockstep retries and repeating permanent failures|Jitter and typed transport semantics; blocked row persists until explicit samekey enqueue|11independent failures before review repair;36current production checks green|Current/frozen-baseline44tests pass; unknown TypeError transient; no new rearmUI; actual header producer pending|
|16 Background slots|Some background work retains slot|Measured handoff/ownership/cancel/person cases|14independent executor baseline cases pass|No generic release without ownership/completion proof; default count unchanged|
|17 Slot refill|Quiet completion could wait~2s for pump|Narrow wake-on-free candidate and capacity/FIFO experiments|Independent candidate review in progress|Not adopted yet; disposed callback edge being repaired; exploratory sample sizes|
|18 Creation overhead|Possible repeated preparation/decorating cost|Real filesystem/cold-warm/restart/decorating measurement|Existing prep reuse works; no extra cache justified|Provider/session startup not fully measured|
|19 History growth|No bounded retention policy|Large store/backup/crash profiling; isolated candidate evaluation|No deletion adopted|Live references and required history must survive any optional retention|
|20 DB queries|Statistics/flow scans expensive|Reviewed generated/indexed source and decision links, SQL maintenance|40independent paired query windows,0mismatch; warm P95stats151.21→13.93ms,flow118.69→28.17ms|~16%disk/save/migration/bulkload tradeoffs; not global DB performance|
|21 Context|Repeated reads may waste tokens|Retrieval/access/policy audit, truncation counterexample|Evidence-preserving current path retained;5000retrieval oracle checked|No10%cost-per-correct-task proof; no new cache|
|22 Dashboard|No runtime bottleneck panel|Metrics/unknown/failure/usage/process panel with locales|Actual runtimeGET and wide/narrow pixels checked|Process-local partial metrics, not correctness; synthetic fixtures not deployment|
|23 Review delay|Human timing unmeasured|Checklist within existing full evidence/PR report|Scoped report-resource tests pass|No delay improvement claim, no merge automation|
|24 Repository scope|One-repo by design, foreignURL could alias local number|Current canonicalrepo scoped lookup; multi-repo isolation documented|Actual card/search alias red/green and plugin compatibility pass|No shared multi-repo service; separate state/workspaces/credentials required|

## Money and validation limits

All additional paid model calls are stopped. Conservative total$0.001021636 of approved$5; pending0. Live v1 failed its grammar task; prospective v2 baseline1/2 vs repaired2/2 in a tiny synthetic provider-adapter test. That is neither full service end-to-end nor a cost/speed claim. Raw failures, usage, byte-equal prompts and replay checks remain in reports/evidence.

Unsuccessful or unsupported optimizations stay documented and off. No speculative external memory, biological routing, myc-harness or Elephia integration was added. Reviewable branch: `programme/reliability` in the user's fork. A final unmerged pull request and exact StageF acceptance record are still pending.
