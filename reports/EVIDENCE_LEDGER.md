# EVIDENCE LEDGER

Running ledger: Tested → Passed → Failed → Unproven → Next experiment.
Classifications: CONFIRMED / SOURCE-SUPPORTED / HYPOTHESIS / REFUTED / NOT TESTED.

| Item | Claim | Classification | Tested? | Result | Next experiment |
| --- | --- | --- | --- | --- | --- |
| Baseline typecheck | repo typechecks at 8c32a9d | CONFIRMED | Passed | tsc --noEmit clean | — |
| Baseline tests | 1196/1197 pass at 8c32a9d | CONFIRMED | Failed (1) | feishu malformed-line health race, see PRE-1 | Issue 3 workstream |
| Baseline build | tsdown build succeeds | CONFIRMED | Passed | lib/ emitted | — |
| PRE-1 feishu health race | malformed event line health overwritten by ready report | SOURCE-SUPPORTED | Reproduced (2/2 runs) | health stays 'ready', expected 'error' | deterministic stream-order test by Issue 3 worker |
| Issue 1 late GitHub notifications | short-overlap cursor can miss late events | NOT TESTED | — | — | workstream 1-3: replay-window fault-injection tests |
| Issue 2 pagination loss | readStream may not follow Link pagination | NOT TESTED | — | — | workstream 1-3: synthetic 0/1/99/100/101/201/1000-event streams |
| Issue 3 Feishu recovery skip | failed page read can skip messages | NOT TESTED | — | — | workstream 1-3: page-failure injection |
| Issue 4 prep false-success | directory presence treated as prepared | NOT TESTED | — | — | workstream 4-5: partial-dir/command-failure tests |
| Issue 5 cancellation | cancelled assignment keeps preparing | NOT TESTED | — | — | workstream 4-5: cancel at each async boundary |
| Issue 6 stale retries | delayed retry can outlive authorisation | NOT TESTED | — | — | workstream 6-8: deterministic race suite |
| Issue 7 settings notices | config changes lost/stale | NOT TESTED | — | — | workstream 6-8: A→B→A→B, rapid updates |
| Issue 8 subagent depth-8 limit | nested agents escape restrictions | NOT TESTED | — | — | workstream 6-8: depth 1/8/9/20 ancestry tests |
| Issues 9-24 | instrumentation/perf/storage/UX | NOT TESTED | — | — | later stages per mandate |
