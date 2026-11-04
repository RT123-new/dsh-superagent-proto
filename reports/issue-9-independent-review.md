# Independent collector review

Baseline `4b73f50`, branch `review/issue-9-adversarial`; no production hooks, deployment or paid calls. Original20 collector tests reproduce passing. Failing-first `8c14756` contains10 behavioral failures, all independently reproduced against baseline.

## Confirmed and repaired

- Authoritative queue length stayed cached after membership changed. It now invalidates on membership notifications; incomplete queues require owner reconciliation before current depth publication.
- `reconcile(0)` reported stale tracked entries, and reconciling below tracked size could claim an obsolete oldest age as a lower bound. Zero resets tracking; smaller counts discard ambiguous identities and ages; authoritative depth is not replaced with max(stale tracked,authoritative).
- Slot snapshot used different time boundaries for integrals and utilization. Ratio now derives from the exact captured integrals.
- Infinity/NaN/huge constructor options violated bounded-storage claims. Windows/queue capacity now validated integer1..10000, state sets1..8 distinct bounded labels and pool names bounded.
- Negative/nonfinite rates could become known negative/NaN costs. Invalid pricing and nonfinite computed costs now count unknown.
- Invalid counter increments could poison serialization; now rejected.

Additional tests pin failure duration separation, absent cache-write uncertainty and pool name bounds. Success timer API remains compatible; failure-aware hooks use stop('failure') or observe(...,'failure'). `failedDurations` is additive snapshot data, with its own recent-window quantiles.

Absent cache-write usage no longer assumes zero. Explicit0 must come from verified provider normalization. The installed DSH TokenUsage declaration confirms disjoint input/cache categories, but optional absence alone does not prove zero. Known token and cost values are subtotals when unknown report counts are nonzero, not complete spend estimates. Reasoning stays non-additive.

## Validation

- Original20 plus13 independent collector tests:33/33.
- Metrics plus documentation tests:39/39.
- Full suite:1260/1260 across64 files.
- Typecheck and build pass.
- Docs updated to remove obsolete contradictory first-transition-denominator/overflow-depth text and explain revised semantics.

## Acceptance boundaries

Slot states must represent disjoint counts. The collector has no worker identities and cannot itself detect double counting preparing and busy; actual WorkerSlots hooks need independent proof. Capacity decreases can legitimately yield utilization above1, recorded with excess occupancy. A length-only queue reconcile does not recover missing item timestamps; incomplete oldest age is partial or null. Owner reconciliation must be immediately before publication, not assumed durable through later mutations.

Nearest-rank ring behavior is correct for validated finite windows: quantiles are recent-window, while count/sum/max are lifetime. Metrics are process-local, not persisted across restart. No code claims remote delivery exactly-once or task correctness from a successful model turn.

Stage C remains incomplete until production hooks and metric coverage are reviewed. Missing task-level work includes eligible/correct/missed/duplicate/failed denominators, end-to-end latency, throughput, TPS/CPS, actual model turn start, external response acknowledgement, CPU/memory and a complete boundary/disposition register. Do not sum overlapping stage durations. This review accepts only the isolated collector corrections, not full Issue9 completion.
