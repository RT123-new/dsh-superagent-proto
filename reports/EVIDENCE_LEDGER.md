# EVIDENCE LEDGER

Running ledger: Tested → Passed → Failed → Unproven → Next experiment.
Classifications: CONFIRMED / SOURCE-SUPPORTED / HYPOTHESIS / REFUTED / NOT TESTED.

| Item | Claim | Classification | Tested? | Result | Next experiment |
| --- | --- | --- | --- | --- | --- |
| Baseline typecheck | repo typechecks at 8c32a9d | CONFIRMED | Passed | tsc --noEmit clean | — |
| Baseline tests | 1196/1197 pass at 8c32a9d | CONFIRMED | Failed (1) | feishu malformed-line health race, see PRE-1 | Issue 3 workstream |
| Baseline build | tsdown build succeeds | CONFIRMED | Passed | lib/ emitted | — |
| PRE-1 feishu health race | malformed event line health overwritten by ready report | SOURCE-SUPPORTED | Reproduced (2/2 runs) | health stays 'ready', expected 'error' | deterministic stream-order test by Issue 3 worker |
| Issue 1 late GitHub notifications | short-overlap cursor can miss late events | SOURCE-SUPPORTED | — | 5s-only overlap: poll.ts cursorAt(); github.ts:341 advances notification cursor to round.started-5s | W13: replay-window fault-injection tests |
| Issue 2 pagination loss | readStream does not paginate | SOURCE-SUPPORTED | — | github.ts:213 single api call per_page=100, no --paginate; identical-timestamp >100-item window stalls indefinitely | W13: synthetic 0/1/99/100/101/201/1000-event streams |
| Issue 3 Feishu recovery skip | failed page read can skip messages | NOT TESTED | — | — | workstream 1-3: page-failure injection |
| Issue 4 prep false-success | directory presence treated as prepared | SOURCE-SUPPORTED | — | dsh.ts:434 stat-exists==prepared; :278-281 non-empty partial kept and accepted on retry | W45: partial-dir/command-failure tests |
| Issue 5 cancellation | cancelled assignment keeps preparing | SOURCE-SUPPORTED | — | dsh.ts:253-254 prepare signal lacks assignment cancellation; current() polled only at discrete points | W45: cancel at each async boundary |
| Issue 6 stale retries | delayed retry can outlive authorisation | SOURCE-SUPPORTED | — | dsh.ts:555-579 resumeAfter prompt lacks launch's authorization callback; unchecked window inside prompt wait | W68: deterministic race suite |
| Issue 7 settings notices | config changes lost/stale | NOT TESTED | — | — | workstream 6-8: A→B→A→B, rapid updates |
| Issue 8 subagent depth-8 limit | nested agents escape restrictions | SOURCE-SUPPORTED | — | sessions.ts:303-311 depth<8 bound; unresolved ancestry returns UNRESTRICTED (fails open) | W68: depth 1/8/9/20 ancestry tests |
| Issues 9-24 | instrumentation/perf/storage/UX | NOT TESTED | — | — | later stages per mandate |
| Issue 9 collector | bounded metrics module: nearest-rank P50/P95, exact slot integrals, queue depth/oldest age, tokens/cost unknown=null | CONFIRMED (unit) | Passed | 14 tests; tsc clean; bench 123ns/observe, 210ns/timer, snapshot 1.7KB serialize p50 0.69ms (reports/evidence/issue-9-bench-local.json, single local run, unloaded) | production hooks after Stage B; real-usage capture unverified |
