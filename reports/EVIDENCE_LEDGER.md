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

## Verified integration checkpoints

- 8c20a1c: typecheck +1227/1227 tests +build PASS after workspace review repair and PRE-1 fix.
- f32c506: typecheck +1271/1271 tests +build PASS after ensure gates and ingestion review repair.
- Independent local-provider experiment rerun: SIGTERM-resistant child stopped, heartbeat stopped, managed range empty, unrelated sleep alive. Raw result: reports/evidence/integration/provider45-result.json.
- No additional paid calls. Conservative cumulative live spend $0.0001 /$5; direct probe only, not end-to-end model validation.

- 3938e19: all original correctness +independent review repairs integrated. `pnpm check` PASS1315/1315 tests72files +typecheck/build. Ensure-decoration independent review still pending; scoped Issue5/8 gaps remain. Raw log: reports/evidence/integration/all-safety-check.log.

- 3f1a8cf: independent ensure-decoration review integrated. Three new races independently red at f32c506; four reviewer regressions green after repair. Full `pnpm check` PASS1319/1319 tests73files +typecheck/build. Raw logs: reports/evidence/integration/ensure-review-red.log and stage-b-final-check.log. Reviewed correctness baseline tag: reviewed/correctness-stage-b. This is a bounded Stage B checkpoint, not full programme acceptance.
| Issue 9 collector | bounded metrics module: nearest-rank P50/P95, exact slot integrals, queue depth/oldest age, tokens/cost unknown=null | CONFIRMED (unit) | Passed | 14 tests; tsc clean; bench 123ns/observe, 210ns/timer, snapshot 1.7KB serialize p50 0.69ms (reports/evidence/issue-9-bench-local.json, single local run, unloaded) | production hooks after Stage B; real-usage capture unverified |

- a5c5b6f: isolated metric collector +independent bounds/accounting review and repository-reference repair integrated; full `pnpm check` PASS1368/1368 tests78files +typecheck/build. Collector reviewer10/10 red independently reproduced;39/39 collector+docs green. Foreign-repo URL alias independently reproduced2red/3green before repair;26/26 focused context/review/scope tests green. SourceKind optional config repair reviewed directly; no polling semantics changed. Metrics hooks and dashboard NOT yet accepted. Logs: reports/evidence/integration/*-integration.log and metrics-context-check.log.

- ebde6bd: dashboard candidate plus independent UI repair integrated.26/26 focused dashboard/HTTP/overview tests independently rerun; reviewer actual desktop/narrow-keyboard pixels inspected. Component outcome separation, observed other stages and unknown coverage preserved. Synthetic fixture only; real Runtime metrics callback composition and final hook-dependent labels still pending. Full suite checkpoint remains earlier1368tests before dashboard; no new full-check claim.

-733691c: full integrated hooks/dashboard `pnpm check` PASS1394/1394tests83files +typecheck/build. Raw current-hooks-full.log. Subsequent independent additivehook review287802a and integrator actualRuntimeGET test pass10focused+typecheck: real receive increments intake, real terminal coordinator event reaches serializedusage, broken collector snapshot leaves overview200with normalflow. This is simulatedDSHhost through realRuntime/HTTP, not deployed service. Lifecycle coverage still explicitly partial.
