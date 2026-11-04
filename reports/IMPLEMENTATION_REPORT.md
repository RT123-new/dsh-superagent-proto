# Implementation report

This report records adopted code separately from held experiments and known limitations. Starting point8c32a9d; default main remains unchanged. Integration branch programme/reliability. No external deployment or automatic merge. Reviewed bounded correctness baseline: tag reviewed/correctness-stage-b at5752c4c.

## Confirmed correctness repairs

| Scope | Change and reason | Integration commits | Executable proof |
| --- | --- | --- | --- |
| GitHub ingestion1–2 | Replay/reconciliation boundaries, pagination and safe durable checkpoints; preserve stable logical identities |308db6f,cd27148,f32c506 | Author15failing baseline tests; independent6case adversarial failure reproduced before repair. Exact-time, burst pagination, restart and safe failure recovery suites |
| Feishu3/PRE-1 | Safe bounded history recovery/first-seen floor; preserve malformed-event diagnostic against late ready |308db6f,f32c506,11457b0,cd5258e | Page failures/replay and deterministic delayed-stderr-ready race |
| Workspace4–5 | Config-identity preparation records, fail-closed migration, assignment cancellation and process-range settlement |72f68b3,fdb0636,7abf27b,8c20a1c |17author tests, independent extra failures, resistant-child/unrelated-process experiment |
| Session preparation5 | Revalidate across async session/model/workspace boundaries; binding-generation ownership and decoration readiness |a9c229d,05d87ee,056a167,3f1a8cf |4author gates;3new reviewer races independently red before repair; successful skill-scope restart regression |
| Retry/settings/lineage6–8 | Current authorization at retry boundary, revisioned settings notices, durable observed-managed lineage restrictions |890fbac,c9dff2e,21ef01c,ac0cb7c,3938e19 |17original failing-first cases10red/7green, plus11resolver tests introduced with fix;6independent reviewer failures before repair |
| Repository lookup24 | Qualified URL lookup uses current validated repository config; local#12/12 shorthand preserved |8380697,809a9d1,a5c5b6f | Registry and actual candidateCard foreign-url misassociation2red before repair, scoped URL/current-config/plugin compatibility tests |

No claim of universal exactly-once remote effects. Framework session creation already executing has no cancellation input and is not rolled back. Unknown never-observed/pre-upgrade missing-parent ancestry cannot be classified as managed. See ADVERSARIAL_REVIEW.md and issue-specific reports for limits.

## Observability, not an optimization claim

Isolated collector integratedf50e2c3/6c77f15/10f3ff3/cd275f1, independent review196b41c/60fa899. Bounded process-local duration windows, exact configured-capacity slot-time integrals, queue uncertainty, separate failed samples and unknown billing.10reviewer failures independently reproduced;39collector+docs tests pass. Production hooks and dashboard remain pending review/integration. Their presence in a branch is not full Issue9/22 acceptance.

## Evaluation without speculative code adoption

Context/review boundary audit eab15d4/a5c5b6f retains existing bounded caches and source-backed resource pointers.5,000synthetic retrieval-oracle tasks measure bytes/API calls, not model cost or correctly completed tasks. Tail-only context reduction fails an older-correction counterexample and is rejected. Single-repository product limitation documented; no multi-repo control plane added. No human review-time reduction claimed.

## Live evidence class

Optional isolated published DSH provider adapter +actual Source/Store/Engine/settingsPolicy, synthetic executor and captured outbox. Not complete DSH service or real workspace execution. V1 failed strict leaf grammar and remains0/1. Prospective explicit-schema v2 baseline1/2eligible vs repaired2/2 on normal/30s-late seed11; six provider calls. Independently replayed all3raw successful ASTs through unchanged206-case oracle and rejected v1 again. No generated code ran. No speed/token/cost saving or production reliability-rate claim. Programme conservative observed cost$0.001021636 including rounded initial probe; additional calls frozen.

## Validation checkpoints

- Baseline:1196/1197tests, typecheck/build pass; PRE-1 pre-existing failure.
- Reviewed correctness code3f1a8cf:1319/1319tests73files +typecheck/build.
- Collector+context code a5c5b6f:1368/1368tests78files +typecheck/build.
- Independent optional local provider/SSE seam pass; optional v2 suite16/16.

Final performance/storage/hook/dashboard integrations, final broad adversarial review, final full check and unmerged PR are still pending. This is not the final status report.

## Integration checkpoint: lifecycle and measured storage

At `f675f71`, full suite **1442/1442 across92files**, typecheck passed; the combined command's build was interrupted by runner timeout and separately rerun successfully. Raw full run and standalone build are in evidence/integration/integration-full-lifecycle.log and lifecycle-build.log. These are local synthetic/fixture checks, not external deployment or full live service validation.

Lifecycle original e56e546, independent3red5dc223e, causal repair9f401a2, retained22focusedgreen062dcc7. Committed eval identities, afterCommit timeline starts and assignment-bound delivery/history correlation prevent cross-work attribution. Boundary names distinguish decision-to-ticket, step-to-first-settlement and queued-receipt-to-source acknowledgement from the stronger metrics not yet measured. Process snapshot excludes child processes. UI translates all added stage names and displays optional process resources(d70850d); wide/narrow server-rendered fixture pixels inspected. The supplementary fixture uses minimal CSS, not the deployed host shell, and narrow table requires sideways scroll. Original dashboard integration screenshots retain the real stylesheet/keyboard checks.

Slotwait ec99708 is launch enqueue to successful slot reservation, including effect scheduling. Independent injected-clock failure4b42ac4 repairedf675f71; fivefocused tests pass, disposal stamps now clear. Further independent rollback/afterCommit and complete-success proof remains pending, so this is not final acceptance.

Storage20 reviewed adoptiona69705d is separate from retention19. Independent paired100k query run has40paired windows/zero oracle differences; warm synthetic P95stats151.21→13.93ms,flow118.69→28.17ms. Migration/reconciliation is atomic; crashkillmarkers verify pre/postcommit. Disk/save/migration tradeoffs and dataset limits remain explicit in BENCHMARK_REPORT and storage evidence. No universal performance claim.

## Cross-scope checkpoint90e6d47

Full `pnpm check` passes1498/1498tests in102files plus typecheck/build, and normal tests now leave tracked benchmark evidence unchanged. StageD capture requires explicit STAGE_D_EVIDENCE_DIR. Independent final review found two additional real Runtime boundary defects: paused ordinary follow-up could commit after asynchronous worker resolution, and externally deleted worker recreation bypassed ensure authorization before create RPC. Own2red reproduced5639423, repair90e6d47 adds shared deliveryCurrent and passes it to both prompt and second ensure callsite.26focusedgreen then fullgreen. This is distinct from the residual unavoidable already-started framework create limitation.

Sourcequeue fe1105c/106359a/c9f952f now records application receipt to committed actual Evalqueue boundary with failure-isolated optional hooks; own1red before repair,153targetedgreenafter. Full lifecycle remains partial, not per-provider-attempt latency or task-correctness throughput.

Slotwake optimization remains unadopted because broad-profile evidence missed target or allows tail regression. Independent disposal defect separately reproduced2red/2green and repairedc25187b without slotFreed/kick/capacity changes. Reviewed experiment and cluster results retained, not enabled.


## Final code freeze and held candidates

Source/test/scripts/config at candidatea4f1812 are byte-equivalent to tested90e6d47 (git diff --exit-code over src/tests/scripts/package/lock/config returned0). Subsequent commits only add reports/raw evidence. Thus1498full/typecheck/build and independent1498full apply to the frozen implementation without inventing a rerun. Final report review and PR publication are separate completion steps.

No production source from optionalpoolb270676, retentionf921a28 or general slotwake15ed8e3 is adopted. Their reports and raw failures/repairs are retained with explicit held dispositions. Production has no retention module/tombstones, no subscription concurrency setting and no slotFreed/kick optimization. Minimal disposal guard from independent no-slotwake failure remains a correctness repair.
