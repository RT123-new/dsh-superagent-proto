# BASELINE REPORT

Programme baseline for RT123-new/dsh-superagent-proto, recorded before any modification.

## Starting point

- Repository: https://github.com/RT123-new/dsh-superagent-proto (fork of deepseek-ai/dsh-superagent-prototype)
- Baseline commit: `8c32a9d` ("feat: add the dsh-superagent research prototype", 2026-10-31), the sole upstream commit
- Tag: `baseline/programme-start` at that commit; integration branch: `programme/reliability`
- Working tree at start: clean; no pre-existing user changes
- Recorded: 2026-11-04 ~06:20 UTC

## Environment

- Node v22.23.4 (requirement 22.19+/24: met)
- pnpm 11.7.0 via corepack (packageManager pin honoured)
- git 2.34.1 (requirement 2.32+: met)
- Linux x86_64 sandbox; tmux NOT available (service-level run of scripts/dsh-superagent not possible here; unit/integration tests do not require it)
- No Feishu/lark-cli, no live GitHub agent account, no model provider configured at baseline time
- `pnpm install --frozen-lockfile`: OK

## Check results (baseline commit, unmodified)

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` (tsc --noEmit) | PASS | clean, ~10s |
| `pnpm test` (vitest run) | 1196 passed / 1197 (59 files: 58 passed, 1 failed), 50.4s | 1 reproducible failure, below |
| `pnpm build` (tsdown) | PASS | lib/ emitted, 693.5 kB over 11 files, 2.6s |

### Pre-existing failure (reproduced twice: full suite and isolated file)

- Test: `tests/sources.spec.ts` > "feishu event consumer" > "takes in the event lines it reads, records each chat as direct or not, and reports a malformed line without stopping"
- Expected: `health.feishu` matches `{ state: 'error', detail: stringContaining("JSON") }`
- Actual: `{ state: 'ready', detail: 'Listening for bot events' }`
- Preliminary read (src/sources/feishu-loops.ts:70-104): the stderr `[event] ready` handler reports `{state:'ready'}` and the stdout malformed-line catch reports `{state:'error'}`; the two reports race across independent streams, so a later ready report can overwrite the malformed-line error. Final health depends on stream interleaving. Classification: SOURCE-SUPPORTED race; owned by the Issue 3 (Feishu recovery) workstream. Register entry PRE-1.

## Metrics that could NOT be baselined (NOT TESTED, with reason)

- Task throughput/latency, worker utilisation, queue delays, GitHub polling behaviour, model requests/token consumption, failure/retry/recovery behaviour: were not measured at the initial baseline. Deterministic offline fixtures can measure local lifecycle behavior without a deployed service; live end-to-end provider workflows need separate setup. tmux is a service-launch convenience, not proof that direct harness execution is impossible. To be baselined with deterministic offline fixtures in Stage C/D, and with the live-model rig (DeepSeek `deepseek-flash`, $5 total cap) once the key arrives.
- CPU/memory/database performance: offline fixtures planned in Stage E (Issue 19/20 harness).

## Methodology notes

- No check is described as passing unless executed; all commands above were run in this environment on the baseline commit.
- Test count method: vitest summary line of `pnpm test`.

## Later comparison baselines and replication

The original unmodified baseline above is preserved, including its failing diagnostic race. Later performance experiments use the reviewed correctness baseline5752c4c or the exact instrumented integration indicated in each report, not an silently changing branch name. Storage paired query comparisons retain original measured source and reviewer repair; slotwake includes matched-current-instrumentation arms that disable only the proposed wake. Polling comparisons use the same request gate/headers and conversation latency draws in both arms, not an ungated baseline. These are separate evidence classes, not upgrades of the original baseline.

Latest integrated source checkpoint90e6d47: Node22.23.4/pnpm11.7.0, full1498tests in102files/typecheck/build pass. Independent full check replicated the result and verified clean tracked evidence. Paid adapter tests remain tiny synthetic workflows; no full deployed DSH/Feishu end-to-end baseline or model-cost-per-correct-task estimate was established. No additional paid calls are running.
