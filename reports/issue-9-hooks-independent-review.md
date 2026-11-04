# Independent review of existing metrics hooks

Base `4ae8158`; isolated branch `review/issue-9-hooks-adversarial`. No paid calls, deployments or main changes.

## Module delta accepted

The three additive fixed STAGES labels and bounded byComponent usage tallies preserve the collector corrections. Fixed component allowlist keeps cardinality bounded. This accepts the module extension, not the completeness of lifecycle metrics.

## Reproduced hook defects and repairs

- The worker pool was absent until first slot activity, omitting never-used idle capacity. Sample at executor construction.
- Capacity changes were only observed at later reservation/status events. Optional SettingsHost callback samples immediately after committed capacity change; Runtime wires it to executor sampling.
- Runtime called snapshot() without isolation. Collector failure now increments metrics_error when possible and returns unavailable, rather than breaking caller control flow.
- WeakSet usage identity counted reconstructed terminal messages twice and accepted unrelated user sessions. Stable session+turn+step+message identities now deduplicate process-local observations; only coordinator, positively bound worker and managed subagent events count. At 10k identities collection of new usage stops visibly (usage_identity_overflow), rather than evicting old identities and silently rebilling replay. This bounds storage but deliberately undercounts after saturation; it is not unlimited exactly-once accounting.
- Effect queue COUNT included running attempts as waiting. Waiting depth now excludes only rows matching the running kind/key/generation. A coalesced newer generation stays waiting while the old attempt runs. SQL COUNT plus bounded running-point lookups avoids loading the full durable queue.
- Cancelled preparation durations were dropped. They now stop in failure-duration series, alongside prepare_cancelled count.

Initial failing-first commit136e75d contained five failures: idle denominator, usage replay, effect waiting depth, and two HTTP checks that returned404. The HTTP findings were subsequently narrowed: that base has no GET route, only host callback, so they were not snapshot-failure proofs. Final tests directly reproduce snapshot isolation instead. The actual GET test must run on composed dashboard integration, not this branch. Existing usage/queue/denominator failures remain independently reproduced behavior defects.

Final tests additionally cover unrelated sessions excluded, committed capacity transitions and generation-aware waiting depth. All use actual Runtime/SQLite/Effects with synthetic host services. Full suite1367/1367 across77files, typecheck and build pass. Seven independent hook tests pass; prior hook/collector tests remain green.

## Limits and remaining acceptance

Slot busy/preparing sets are disjoint in WorkerSlots.states(). Source scheduling lateness/total effect age are explicitly wall-clock persisted estimates, not monotonic durations. Effect handler duration and preparation use local monotonic time. These can overlap and must not be summed.

The capacity callback covers supported Settings saves; direct Store.saveSettings writes outside the settings workflow are not runtime configuration API and have no hook. Snapshot collection failure reports unavailable, not a fabricated empty metric report. Usage dedupe is process-local; restored historical events should not be replayed as new usage across a fresh collector without a declared observation-boundary rule. This review does not verify arbitrary reconnect/re-emission semantics of the live DSH service.

No assertion that full Issue9 is done. Author continuation and composed default-collector GET route still require independent checks, as do actual model-start, task correctness/eligible denominators and stage-coverage dispositions. This branch intentionally avoids new stage hooks/dashboard machinery.
