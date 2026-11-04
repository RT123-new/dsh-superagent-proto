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

## Storage adoption checkpoint

Issue20 selective stats/flow index optimization adopted for tested large-history workload after independent semantic/migration/crash and measured-tail review. Production source includes reviewer06ad576equivalent765f8a8, never the originalb57bbcecandidate alone. StrictSIGKILL/save-boundary proofa7b5554 retained. Author200pairs across5datasets yields0semantic mismatches; P95stats152.43→13.70ms, flow119.16→27.51ms with10kpairedbootstrap supporting>15%gain. Pairwise bootstrap is not cluster bootstrap; warm synthetic one-machine evidence only. Integration independently recomputed analysis and built a fresh100kseed3BASEstore copied/upgraded into repaired71c1b8f:40paired windows0mismatches, P95stats151.21→13.93ms, flow118.69→28.17ms.37integrated storage+migration+docs tests pass. Write overhead+0.03ms/save, blocking1Mupgrade~2.2s,~16%disk increase andbulkload tradeoffs acknowledged. No generalproduction throughput claim; retention/search/OFFSET/unboundedlists remain separate. Raw integration/storage/.

10–12offline experiment delivery initially lacked ignoredsharedlibs and failed independent tests/typecheck; additiveba8a6f2equivalenteea4bab repairs delivery.8isolatedtests+explicitexperimentaltsc nowpass. No polling/webhook/transport productionoptimization adopted by that evidence.

### Lifecycle integration checkpoint

* e56e546original,5dc223ered (3/3 independently reproduced),9f401a2repair;22focusedgreen plus typecheck062dcc7.
* UIlabels/processd70850d;11focusedgreen and typecheck. Supplementary lifecycle-ui pixels are server-rendered fixtures with minimal CSS, not external deployment.
* ec99708slotwait,4b42ac4independent injectedclockred,f675f71repair,5green. Further rollback/full-success review pending.
* f675f71full1442/1442 tests92files plus typecheck; combined build timeout, standalone build passes. Evidence integration-full-lifecycle.log and lifecycle-build.log. No paid tests, budget unchanged.

* Atomic slot API reviewer1129d39/2955934 integratedcddecb7/ea5035d. Own1red before fix;31metrics/hooks/atomic tests andtypecheckgreen. Validation precedes clockread; complete disjoint state+capacity replace atoneboundary, older optionalcollector fallback explicitlyapproximate. Rawatomic-red/green/type.log.

* Coordinator evidence1cc27ab/452be2b/6e780ef/5328291 independently rerun:13fasttests green,explicit `pnpm bench` twoofflinebenchcases green100s, typecheckgreen. Ownrawlogs+JSON retained in integration/coordination. No partition adopted; single mainSession semantic order stays.
* Poll actual-Source/Engine/SQLite matched-gate experiment c881b64 independently11green/explicit script tscgreen26c6442. Virtualclock/syntheticnetwork, not real network gain. No production pool adopted.
* SlotwaitafterCommit e448ad3/dc11c24 independently3red beforefix,8greenafter; includesactualsuccessfulRuntime launch. Name launch_slot_wait: launch scheduling, pause/retry/denial included.
* Retry candidateb9c2dc4,11redfa49929/strictboundary704e05f,reviewedrepair34f9ad6. Independent11/11red reproduced;36currentproduction/effects/adversarialgreen. Five older characterization tests still assume old production retry behavior/ducktypeheaders and need explicit frozenbaseline/newsemantics repair. Integration not declaredgreen atthischeckpoint.

* df2d07c integrateddbbacaa resolves all five stale retry assertions without reverting production semantics: explicit baseline model pinned to5752c4c plus current production typed metadata/block/jitter assertions.44focusedgreen. Paired provider-adapter offline suite16green after documented standalone package frozen-lockfile install (initial dependency-not-installed failure not mistaken for behavior regression). No paid calls. Latest collector overhead loop:143.1ns/observe,216.7ns/timer pair,50snapshot P50serialization1.544ms; single microbench only, not end-to-end service overhead.

* Sourcequeuefe1105c/106359a/c9f952f: own1red2green beforefailure-isolationrepair;153targeted testsafterinclcore/lifecycle/hooks/docs green. StartsPassesreceipt, endscommittedtrigger.receivedactualqueued, includestransactiontail; noexternaltransporttimestamp. Pendingboundedstampafterouterrollbacknotduration.
* Remaining HOL characterization repairedb52a683 with seeded midpoint RNG and currentjitter schedule; no production rollback. Lastfull119abf4 failedonlythatstaleassertion(1486/1487), not finalgreen.
* Issue17slotwake generaladoptiondeferred: cap3below15%,cap6/12uncertainty. Reviewreport/pairedarms retained unenabled. Disposal correctness separately2red beforefourguardrepair,2greenafter; no slotFreed/kick added.
* NormalStageDtests no longer overwrite tracked timingevidence. Explicit STAGE_D_EVIDENCE_DIR enables freshcapture to a chosen directory; archived measurements stay unchanged bypnpmcheck.

* Poolcandidate774278e reviewed35728cf fourred, repairedbf136ef, finalb270676. Reports/rawevidenceonlyimported. No productionpool/parser/gateadoption because restartdiscardsknownembargo/accountscopeincomplete; defaultoffnotproof. Candidate actualstdout429→typedretrypolicycompositiongreen, not claimedcurrentproduction. Conditionalrepairedbenchmarkretained, notoldgainreuse.

* Final focused fault/migration/security regression pass atfefef6f (same source as90e6d47):63tests/7filesgreen covering ingestion, workspace cancellation, usage isolation, typed retry, repo scope andstorage SIGKILL/reconciliation. Tracked tree clean afterrun. Privatecredential exact scan across626trackedfiles plus commonkeypatternscan foundno matches; no credential data published. Paid tests remain stopped.

* Retention19review2c34c5f→8e2cef9fiveconfirmedred→f921a28repair24focused/1447fullgreenonisolatedcandidate. Reports/evidenceonlyimported: no destructiveAPI/tombstones/Intakechangesadopted. Fresh10krun1639msinvarianttrue,differentcohortnotpairedbenefit; oldfiguresstale. Powerloss/hostilearchive operationalgapsremain. Originalmandatepreferssimplerimplementationwhenbenefitunsupported.

* Frozen finalimplementation candidatea4f1812 source/test/scripts/package/lock/config isbyte-equivalenttotested90e6d47; diffexit0, no falselyclaimedrerun. All subsequentchanges reports/evidenceonly. FinalindependentreportdispositionrefreshandactualunmergedPRstillawaited.
