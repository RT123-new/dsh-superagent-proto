# Paired real-model validation: stopped exploratory run

## Scope and evidence class

This is a published DSH provider-adapter plus actual GitHub Source/SQLite Store/Engine/settingsPolicy integration. It is NOT complete DSH service, Session, Agent loop, workspace/process cancellation, production executor or live GitHub delivery evidence. Source HTTP responses, executor and outbound channel are synthetic. There are no live GitHub writes or deployed changes.

Baseline: `8c32a9d`. Repaired: reviewed tag `reviewed/correctness-stage-b`, exact commit `5752c4c99778ba5a0abe59ace4988270e4612855`. Branch starts from that reviewed tag, with no production source edits.

## Workload and preregistered limits

Planned ceiling: five scenarios (normal, 30-second late, 10-minute late requiring reconciliation, unauthorized sender, SQLite restart/duplicate replay), each with seeds 11 and 29, on both variants. Missing eligible events remain failures; unauthorized events are safety negatives and never removed from reporting. Maximum 32 model calls was conditional, not promised coverage.

A coordinator returns a routing decision. Actual Engine policy decides whether a Ticket/Assignment may exist. An authorized worker proposes an arithmetic AST to repair a synthetic clamp function. Only min/max and the literal string leaves `n`, `low`, `high` are accepted. A bounded, pure interpreter checks 206 boundary/generated cases. No generated executable code, shell, imports or dynamic calls run. A successful model reply alone is not task completion. An acknowledgement is captured as an outbound effect; only a passing repair can produce a result reply.

Model settings are identical across variants; event workload IDs and deterministic test seeds are paired. Seeds apply to fixture/test generation, NOT provider sampling: no claim of reproducible model random seed is made. Timing uses real current wall-clock anchors with identical relative delays, rather than pretending API calls happen at a fixed date. Initial design runs variants sequentially, so provider drift/order/cache effects remain uncontrolled.

## Budget safety

One shared programme ledger owner allocated at most $1 to this experiment, under the programme's $5 total ceiling. Other paid calls were frozen. Calls are sequential with no automatic retries.

Pricing verified 2026-11-04: https://api-docs.deepseek.com/quick_start/pricing.md

- `deepseek-flash`, 1M context.
- USD per 1M: uncached input $0.30, cached input $0.006, output $1.20 (peak rates).
- Before dispatch, reserve 2,000,000 uncached input plus 1024 output: **$0.6012288**. This deliberately doubles documented input context to avoid interpreting M or estimating tokens from bytes.
- Prompt cap 16 KiB, output cap 1024, thinking disabled. No tools, Search/Fetch, files, images or request extensions.
- Persist reservation before dispatch; settle only complete known usage. Unknown usage, failed stream/request, unexpected billing category or exceeded bound stops with reservation retained. Invalid task output also stops this initial suite. Restart preserves the stopped/pending ledger state.

## Executed results

### Offline integration

Published DSH `DeepSeekAdapter` 0.2.1-alpha.2 was exercised against a local HTTP SSE server. Assertions verified actual model, `max_tokens`, disabled thinking, no tools, credential header, text streaming and token usage translation. Budget tests cover concurrent reservation refusal, durable restart lockout, missing usage, unknown cache-write billing and exceeded output bounds.

Both variants executed ten deterministic fixture cases. Repaired completed 8/8 eligible cases; baseline completed 4/8, missing both late scenarios under both seeds. Both rejected 2/2 unauthorized cases. Replay/reopen tests show no extra logical executor start. These are offline oracle-output fixtures, not model success results. Small synthetic workload only; no performance adoption claim.

Final offline harness suite: 13/13. Local provider/budget test: PASS. Main repository typecheck passed before final script-only edits; the optional harness is outside its source include and has its own executed tests. Full repository suite was not rerun by this worker. Reviewed tag's 1319/1319 result was reported by integration, not independently reproduced here.

### Live run: FAILED task, then stopped

Only repaired normal/seed11 ran. Two real provider calls succeeded at transport level:

| Call | Uncached input | Cached input | Output | Total tokens | Peak cost USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Coordinator | 105 | 0 | 102 | 207 | 0.0001539 |
| Worker | 110 | 0 | 34 | 144 | 0.0000738 |
| Total | 215 | 0 | 136 | 351 | **0.0002277** |

Worker output (verbatim synthetic data):

```json
{"expression":{"op":"max","args":[{"op":"min","args":[{"n":"n"},{"n":"high"}]},{"n":"low"}]}}
```

This violates the declared leaf grammar by returning objects, not string leaves. The strict validator rejected it. The expression was not executed; no result reply was recorded. One acknowledgement, one Ticket and one Assignment existed. Completed tasks **0/1 attempted eligible**, forbidden executions 0. Nine repaired cases and all baseline cases were not executed live. No paired live comparison, cost per successful task, P95 gain or token savings can be computed. Raw model latency sums to about 2257ms, total first-task elapsed about 2276ms, but n=1 failed task cannot establish useful performance.

Ledger: observed sub-budget charge **$0.0002277**, pending reservation **$0**, stopped=true. Including the integrator's previous conservatively rounded $0.0001 probe yields **$0.0003277** known programme charge. No further paid calls occurred. API-key private file removed after stopping.

## Diagnosis and next decision

The actual output is a model/schema adherence failure, not evidence of a Superagent source/authorization defect. The arithmetic structure would be plausible if its leaves matched the contract, but accepting object leaves post hoc would change the acceptance grammar and hide the failure. The original prompt states the leaves but gives no complete example or machine-readable schema; a clearer prompt might reduce this failure. That is a HYPOTHESIS, not a proven repair.

Added exact-output executable regression: object leaves are rejected, valid declared string leaves pass, extra keys/unapproved operations/deep trees fail. Acceptance has not been weakened. No resumed paid testing is authorized by this report. A future v2 workload may add explicit JSON-schema/string-leaf examples while keeping the validator unchanged, but would need a separately recorded experiment and renewed run clearance. The failed v1 result must remain in the ledger and denominator.

## Evidence and reproduction

Evidence files in `reports/evidence/paired-live/` include raw synthetic prompts/chunks/outputs/usage, stopped ledger, live first-task record/run log, and separately named offline variant records. They contain no credentials or user repository code.

```sh
# Install optional, isolated published provider dependencies:
cd scripts/paired-validation && pnpm install --frozen-lockfile && cd ../..
node scripts/paired-validation/offline-provider.mjs
PAIRED_OUTPUT=/tmp/paired-offline pnpm exec vitest run --config scripts/paired-validation/vitest.config.mjs
```

For baseline reproduction, use a separate worktree at 8c32a9d, copy this optional script directory and `tests/fixtures/source-host.ts` unchanged, and run with `PAIRED_VARIANT=baseline`. Source fixture is transport-only and uses that worktree's actual Source/Engine/Store imports. No production file is replaced. Baseline needs the same pinned repository dependencies.

Live execution additionally requires a private credential-file path, recorded allocation marker and exact reviewed tag; it must not be rerun merely by following these offline instructions. Do not clear the stopped ledger without explicit review and renewed clearance.
