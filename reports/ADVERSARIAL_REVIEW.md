# Adversarial review (running record)

Independent author/reviewer work and integration reproductions are required before acceptance. This record is incomplete until later-stage and final cross-scope review close.

## Correctness review outcomes

| Area | Independent challenge | Result/repair | Residual boundary |
| --- | --- | --- | --- |
| Workspace adoption | Empty/partial existing directories accepted; credential verification alone insufficient | Reviewer5fail on initial fix; conservative migration and generic readiness repair integrated | Arbitrary later manual edits not certified; no power-loss/fsync proof |
| Process cancellation | Verification subprocess and descendant settlement not guaranteed by direct child completion | Assignment signal propagation; owned-range settlement; independent resistant-child experiment passes | Unknown-range+failed durable marker+crash compound gap; unrelated processes deliberately untouched |
| Session ensure | Cancelling/config change during awaited create/model/workspace leaves later mutations | Await-boundary gates integrated;4author tests | In-flight create cannot be interrupted or retroactively undone |
| Decoration | Late injection registers after cancellation; stale release removes newer binding; concurrent caller skips pending limits |3reviewer failures independently reproduced; readiness and generation-owned release/skill binding repair | Shared initialized worker limits persist beyond originating assignment; callback boundaries cannot undo completed synchronous work |
| Ingestion | Older reconciliation boundary, multipage conditional request, exact timestamp and replay semantics |6independent failures reproduced before repair | Finite scan horizon/cadence/outage and mutable page-number APIs bound delivery; no remote snapshot isolation |
| Settings/retries/lineage | Stale authorization, revision ABA, cycles/missing parents and stale policy |6reviewer failures reproduced before repair | Active-work revocation not universally implemented; never-observed missing ancestry remains unknown |
| Repository lookup | Foreignsame-number URL resolves unrelated local candidate |2red registry/candidateCard proofs reproduced; current-config scoped repair | One-repository service remains; no cross-repo orchestration |
| Metrics | Stale authoritative queue, zero reset, divergent slot ratio time, unbounded inputs, invalid pricing/counter data |10red independently reproduced;33unit/39withdocs green | Hook state disjointness and failure isolation require separate acceptance |
| Live validation | Model success text mistaken for task success; malformed generated executable output | Strict bounded AST interpreter; v1 failed and retained; unchanged206oracle replays all3v2ASTs | Synthetic executor/outbox only; no full service or external-effect validation |

## Evidence locations

Issue-specific reports and raw evidence directories preserve failing-first and repaired results. Integration independently reran the important red cases and full checkpoints, not only author summaries:

- reports/evidence/integration/ensure-review-red.log
- reports/evidence/integration/metrics-red-integration.log
- reports/evidence/integration/context-red-integration.log
- reports/evidence/integration/provider45-result.json
- reports/evidence/integration/stage-b-final-check.log
- reports/evidence/integration/metrics-context-check.log
- reports/evidence/integration/live-ast-replay.json

Original Issue6–8 author failing-first evidence contains17tests10red/7green, not the earlier claimed12red/28.11resolver tests arrived with the fix and cannot be relabelled failing-first evidence.

## Still pending

Production metrics hooks/dashboard, performance experiments10–18, Store/index/retention19–20, and final cross-scope reviewer dispositions. No acceptance of a performance change follows merely from a passing functional suite. Required measured gains/uncertainty, migration/crash semantics and relevant resource costs must be reviewed before adoption. Main remains untouched and no auto-merge is permitted.

## Latest lifecycle independent integration

Reproduced all3 causal/receipt failures from557adf6 before33a9d0e. Integrated repair9f401a2 and22focusedgreen. Reviewer seven-case suite includes synchronous worker history, committed identities, blocked/unmatched timing and injected clock boundaries. Slotwait own added clock regression4b42ac4 failed beforef675f71; fivefocusedgreen afterward. Additional slotwait rollback and complete-launch review remains open. Latest full checkpoint1442green/typecheck/build, no full end-to-end provider-deployment claim. Source queue boundary and atomic slot integration remain pending parallel author/reviewer work.

## Final cross-scope discoveries and current repair

Independent reviewer f0fc44a found ordinary follow-up after pause and pre-create cancellation bypass through deleted-worker recreation. Own2/2red on currentintegration reproduced;90e6d47 applies deliveryCurrent at ensure and prompt async boundaries.26targeted and full1498/typecheck/build pass. Independent refresh is still required. Two disposed idle-continuation defects also reproduced without slotwake and repaired separately(c25187b). No general slotwake adopted. Normal tests no longer rewrite archived StageD evidence.
