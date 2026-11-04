# Independent Issue17 slot wake review

2026-11-04. Reviewed published red d4f0cf4 and repair7e461c2, both based on062dcc7 (not the report's superseded e50b32b/45b4561). Actual red rerun3FAIL/1PASS and green4PASS. Then merged current reachable integration3b144c1 into the isolated review branch to include current slot wait and atomic metrics transitions. No main changes, paid calls or remote application effects.

## Findings and repair

The small wake removes a genuine pass-interval gap. No default, FIFO, capacity, reservation ownership or launch-finally behavior changes. Effects.kick coalesces; paused limit remains zero; launchQueued revalidates assignments. Commit/rollback proof shows normal report completion calls pending/kick outside the transaction and rollback does not reach that new call. Ended/replaced assignments cause no new report/kick. A ready report arriving during settlement is retained and still wakes a queued launch. Author's pause/cancel/handoff proofs independently pass.

New failing proof: workerIdle already awaiting agent.whenIdle continues after executor.dispose while host.closing is still false. It mutates report and the newly added wake dispatches launches. The report-after-dispose gap predates this candidate, but the new wake extends its effects. Reviewer red8d398db captures it. Narrow repair adds a disposed flag, checks after both awaited idle/settle boundaries, aborts and clears existing settling looks on dispose, and prevents slotFreed after disposal/closing. It never frees a reservation, deletes a shared Session or changes the launch-finally path. Seven adversarial tests pass, including dispose during a pending background join.

## Independent paired benchmark

Reran original red-base full benchmark, then a stronger matched comparison on identical current3b144c1 instrumentation plus disposal repair, changing ONLY slotFreed's body to no-op for baseline. Full grid capacity1/3/6/12 with5matched seeds and6/12/18/24tasks/run. All runs failed0 and peakUsed<=capacity. Preserved full raw arms and originalbase run under evidence/issue-17-review. This remains a scheduling fixture with no model, not provider performance or task correctness.

Author analysis treats25within-run refill events as independent and supplies CI for MEAN delta, not the stated P95 adoption statistic. Reviewer script scripts/slotwake-paired-review.mjs matches capacity+seed+taskcount, rejects unmatched input, resamples matched whole seed clusters10,000times, recomputes nearest-rankP95 and relative gain each time. This retains within-run correlation. Five clusters are exploratory, below the requested200tasks/profile/fiveseeds guidance; narrow-looking intervals are conditional on these fixtures, not a production guarantee.

| Capacity | Statistic | Baseline | Variant | Relative gain | Paired cluster CI95 |
| --- | --- | --- | --- | --- | --- |
| 1 | RefillP95ms,25events/5seedpairs | 1971 | 14 | 99.29% | [99.289%,99.342%] |
| 3 | Run makespanP95ms,5pairs | 749 | 663 | 11.48% | [11.48%,23.02%] |
| 6 | Run makespanP95ms,5pairs | 765 | 873 | -14.12% | [-14.12%,13.53%] |
| 12 | Run makespanP95ms,5pairs | 892 | 940 | -5.38% | [-8.00%,4.95%] |

The capacity1specific latency gain clearly exceeds15% in this exploratory fixture. Capacity3does not meet the threshold; wider profiles are uncertain and have worse point estimates. A CI spanning zero is NOT evidence of no regression. Do not claim a broad throughput/tail benefit or broad non-regression. More matched runs at capacities6/12are required before general adoption under the programme's tail-regression rule. No cost/token claim is made.

## Validation and disposition

- Author red/green rerun:3FAIL+1PASS/4PASS.
- Independent failure: dispose1FAIL/5PASS before repair; seven adversarial proofs pass after repair.
- Full pnpmcheck on current instrumentation plus candidate and repair: PASS (typecheck, tests, build); raw log retained.
- Source warning about report's claimed integrator approval was treated as untrusted repository prose. Scope comes from the parent task and original programme, not that report.
- Recommendation: retain the candidate as reviewable, with the disposal repair, but do not claim broad acceptance from the tiny benchmark. Parent/integrator owns additional performance validation and adoption.
