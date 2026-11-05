# Superagent repair handoff — 5 November 2026

**Repository:** `RT123-new/dsh-superagent-proto`  
**Base:** `programme/reliability` at `f5be68c5f17d02b0b0a5a5aeb795a192b4e4e890`  
**Implementation branch:** `fix/worker-evidence-closure-20261105`  
**Merge/deployment:** NOT DONE. This is an incremental, reviewable repair, not a production certification.

## Evidence and hypothesis

The independent 5 November handoff observed (a) full worker context reaching approximately 200–245 KB before first source edit, (b) a real coding task requiring three worker rounds, and (c) no worker-issued terminal `orchestrator_report` before call allowance exhaustion. Independent local verification of the final uncommitted version-route patch found 1,774 passing, 2 skipped, zero failing tests. This did not prove independent completion, acknowledgement, branch creation, push or PR creation.

**Hypothesis under evaluation:** Smaller, targeted source reads plus unambiguous report handling will improve autonomous completion without reducing correctness or authorization safety. The current changes have **not** yet established that hypothesis.

## Implemented on this branch

1. `src/executor/file-slice.ts`: new line-addressed `readWorkspaceSlice` with default 160 lines, absolute cap 200 lines, 12 KiB captured text, 4 KiB streaming read buffer, UTF-8 boundary handling, safe path validation, and a clear incomplete-result flag. Source files are not materialized whole in the model-facing response. Uses application-level workspace containment, **not** an OS sandbox or defense against malicious concurrent directory swaps.
2. `src/app/tools/executor.ts`: `orchestrator_file_slice` tool limited to the current live ticket workspace, with bounded arguments; emits failure-isolated metrics counters `worker_slice_reads` and `worker_slice_bytes`. Caller must follow `next_line`; single-line byte caps intentionally return no non-progressing cursor.
3. `prompts/worker.md`: concise grep/glob-first and slice-reading instruction; prefer inspecting changes instead of repeating whole-file reads; reserve calls for validation and `orchestrator_report`. This is a behavioral instruction, not enforcement of native DSH `read` output limits.
4. `src/executor/dsh.ts`: provider error messages are no longer reflected into worker retry prompts; the typed `healthErrorDetail` is used. A `worker_report_missing` counter records idle worker turns without terminal reporting. The existing waiting-report and queue-wake contract remains unchanged; **automatic terminal-report recovery is NOT implemented**.
5. `src/app/runtime.ts`: passes the existing optional, failure-isolated Probe to the executor tool host.
6. `tests/file-slice.spec.ts`: deterministic range, UTF-8, byte cap, path escape, symlink and cancellation regression cases.
7. `tests/model-surface.spec.ts`, `docs/007-architecture.md`: register and document the new tool and test inventory.
8. `.github/workflows/validate.yml`: run the existing canonical CI for `fix/**` push branches and stacked PRs against `programme/reliability`.

### Failed checkpoint (preserve)

Initial CI run `42054191875` on `d3347a0d` was **RED**: 7 failures, 1,771 passing, 2 skipped; dedicated Stage D was green. Causes included exceeding the worker-prompt length contract, omitting the new tool in model-surface expectations, changed existing waiting summaries, and changing the queue-kick behavior that a Stage D test explicitly distinguishes. These were corrected by shortening the worker prompt and retaining the original waiting/relay behavior, without weakening timing or prompt constraints. This initial failed run is not evidence of candidate correctness. Subsequent runs must be evaluated against their exact SHA.

## Exact mathematical definitions (proposed evaluation, NOT measured results)

Let `t_first_edit,i` be the first source edit in run `i`, and `r_ij` the text of tool response `j` admitted into the model context before that edit.

```text
B_preedit,i = sum_j UTF8ByteLength(r_ij), for response_time_ij < t_first_edit,i
R_context = 1 - median(B_preedit,candidate) / median(B_preedit,baseline)
```

Compare the **same tasks in clean independent workspaces**. Do not equate UTF-8 bytes with provider tokens. Actual provider-reported tokens must be recorded separately, with unknown usage shown as unknown.

For a fixed, preregistered cohort:

```text
N_e = count(eligible, authorized requests received)
N_c = count(independently verified correct completions)
N_d = count(correct completions with verified required delivery receipt)

Q_execution = N_c / N_e
Q_end_to_end = N_d / N_e
```

Both ratios are **undefined** for `N_e = 0`. Unknown, failed and timed-out eligible requests remain in the denominator; do not count local code edits as completed delivery.

For a valid terminal task `i`:

```text
T_i = t_terminal,i - t_received,i
p95(T) = sorted(T)[ceil(0.95 * count(T)) - 1]  // zero-based index
C_correct = sum(measured_provider_cost_i for all cohort tasks) / N_c
```

Do not insert a fabricated latency for tasks that never completed. `C_correct` is undefined when `N_c = 0`, and cannot be claimed fully measured if some billing data are missing.

The established retry formula (already implemented in the codebase, not introduced here) is:

```text
a_n = min(d_max, d_base * 2^n)
u_n ~ Uniform(0, 1)
j_n = a_n * (0.5 + 0.5*u_n)
d_n = max(j_n, t_server_not_before - t_now, 0)
```

`n` begins at zero. Only trusted typed transport metadata may set `t_server_not_before`. A server embargo beyond the supported maximum must fail closed, not be shortened.

## Still open — do these in order

| Priority | Item | Evidence status | Next most valuable proof |
| --- | --- | --- | --- |
| P0 | Measure whether slice-first inspection actually reduces context and call usage | **Unproven**: new tool exists, native host reads are not intercepted | Run baseline/candidate paired code tasks and capture full tool calls, bytes, tokens and first-edit timestamps |
| P0 | Worker independently reports `ready` on the version-route coding task | **Failed in handoff**: worker exhausted calls | Repeat in a fresh workspace; require worker's own `orchestrator_report`, not an operator-issued or inferred ready |
| P0 | Complete remote GitHub delivery (acknowledge → commit/push → PR) | **Untested** against remote write API; local stand-in acknowledgement failed seven times | Fault-injected local tests, then explicit approval for least-privilege write token scoped to `RTinst/dsh-superagent-proto`; verify URLs and receipts |
| P1 | Attribute tool calls from stale turns after assignment replacement | **Known unresolved** framework provenance limitation | Barrier test that demonstrates stale call; implement a proven invocation identity fence or fail closed on ambiguity |
| P1 | Establish safe handling of budget exhaustion and context compaction | **Unproven**; host-supported call-budget and transcript-compaction APIs must be inspected | Identify exact DSH support and build minimal bounded reproducer; no synthetic `ready` or unbounded retry |
| P1 | Confirm session privilege lifecycle including orchestrator privileges | **Partial** real-host observations, not universal safety claim | Reproduce multi-boot and late-tool tests with authorization boundaries, including obsolete session grants |
| P1 | Identify and repair any genuinely flaky timing/race failures | **Open hypothesis**; initial Stage D failure on this branch was caused by altered queue semantics, not a confirmed race | Deterministic scheduling probe, preserving strict dedicated Stage D benchmark criteria |
| P2 | Add adversarial request corpus and measured correct-completion Q | **Untested** at representative scale | Frozen labeled corpus with unauthorized, ambiguous and prompt-injection cases; count false accepts and false rejects |
| P2 | Unattended restart/outage/crash test matrix | **Partial** historical tests | Controlled failure-injection trial, record terminal states and unknown delivery outcomes |
| P2 | Split PR #1 into safe merge units | **Not done**; original PR remains huge | Human-reviewed dependency map; start with already proven CI and safety fixes |
| HELD | Polling pool, retention deletion, slot-refill optimization, speculative orchestration | **Deliberately deferred** by previous safety/performance gates | Reopen only if a new measured bottleneck justifies an isolated experiment |

## Critical implementation constraints

- Do not merge either PR automatically.
- Do not deploy or issue external GitHub writes using the user's identity without explicit permission.
- The fork-only token recorded in the 5 November handoff is read-only and expires on 12 November 2026. Its GitHub permissions are insufficient for pushing branches or opening PRs.
- No provider credentials, balance, or external remote write test were used by this incremental repair.
- Do not claim that all requested repairs are implemented: this branch addresses bounded inspection and missing-report observability, not a complete autonomous workflow.
- Preserve all failing-first checkpoints, exact SHAs and skipped-test counts.
- Avoid performance/cost conclusions from a single successful example.

## Verdict

**NOT READY — end-to-end completion and delivery are unproven.**

**Single highest-value next experiment:** Repeat the exact version-route task twice under clean baseline/candidate workspaces, record pre-edit context and worker report state, and determine whether the bounded-reader path is actually used and whether the worker completes without manual continuation.
