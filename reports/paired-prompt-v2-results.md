# Prospective prompt v2: two exploratory live pairs

## Disposition

Executed only the cleared normal and 30-second-late scenarios, seed11, baseline8c32a9d and repaired5752c4c. Six calls total, sequential processes sharing one locked ledger; stopped for review afterward. Exact source HEAD and clean tracked-file checks passed before credential use. No other scenarios/seeds or model retries ran. Credential file removed.

Scope remains published DSH provider adapter + actual GitHub Source, SQLite Store, Engine/settingsPolicy, synthetic executor and captured outbox. NOT complete DSH service, actual Session/Agent loop or remote external-effect proof. The pure arithmetic interpreter and 206 test cases are unchanged. No generated code runs.

V1 remains a distinct failed grammar-adherence task (0/1 completed, $0.0002277), not reclassified as success. V2 supplies a recursive complete schema and an unrelated max(low,high) syntax example. Same v2 worker prompt bytes were independently confirmed in the actual baseline/repaired normal call records. Seeds are workload generation, not provider sampling control.

## Actual outcomes

| Variant | Scenario | Eligible | Received | Correctly completed | Tickets/assignments/starts | Captured outbound effects | Task elapsed ms |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| Baseline | normal | yes | yes | yes | 1/1/1 | 2 | 2431 |
| Baseline | 30s late | yes | no | no | 0/0/0 | 0 | 3 |
| Repaired | normal | yes | yes | yes | 1/1/1 | 2 | 1990 |
| Repaired | 30s late | yes | yes | yes | 1/1/1 | 2 | 2021 |

Rounded timings in this table are descriptive only; exact values are in raw result records. Baseline missed-event elapsed time is a poll duration, NOT a task completion latency. It cannot enter a successful-task latency distribution.

V2 success: baseline1/2 eligible, repaired2/2. All three executed worker outputs used valid string-leaf min/max expressions and passed206 independent checks. Model-reported success was not accepted as evidence. Each completed task produced one acknowledgement and one result reply, captured locally. No duplicate logical executor starts or forbidden execution in these cases. Unauthorized/restart/reconciliation/deeper fault paths were not rerun live in v2.

## Usage and ledger

Peak pricing source verified: https://api-docs.deepseek.com/quick_start/pricing.md

| Call | Uncached input | Cached input | Output | Total | Cost USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline normal coordinator | 105 | 0 | 94 | 199 | 0.0001443 |
| baseline normal worker | 319 | 0 | 26 | 345 | 0.0001269 |
| repaired normal coordinator | 105 | 0 | 76 | 181 | 0.0001227 |
| repaired normal worker | 191 | 128 | 26 | 345 | 0.000089268 |
| repaired late coordinator | 105 | 0 | 75 | 180 | 0.0001215 |
| repaired late worker | 191 | 128 | 26 | 345 | 0.000089268 |
| Total | 1016 | 256 | 323 | 1595 | **0.000693936** |

All usage complete and known, cache-write explicitly0. No pending reservation. Ledger is stopped=true after the bounded run.

- V1 + V2 allocation charge: **$0.000921636**.
- Programme known total including prior rounded $0.0001 probe: **$0.001021636**.
- Remaining from this worker's original $1 allocation: **$0.999078364**.
- No authority for additional runs is implied.

## Interpretation and limits

This is evidence that the repaired Source can deliver the tested late eligible request through a real-model proposal and actual deterministic Engine authorization into a locally validated result, while baseline missed it. It is a tiny synthetic integration check, not a reliability-rate estimate for production.

No speed, token-saving or cost-saving claim is supported. The repaired worker calls had128 cached input tokens while baseline had none; call ordering/cache/provider drift and different response lengths confound comparisons. Baseline pays less overall by missing work. Do not describe that as efficiency. Observed component cost per completed synthetic task can be calculated, but these are not full runtime CPS/TPS and cannot justify adoption thresholds.

No P95 or bootstrap gain is reported for two pairs. The mandate's200tasks/five-seeds target is not met, and two correlated scenarios cannot establish a useful population interval. Results remain exploratory. Failure-based stop rules and explicit budget reservations remain in force for any newly approved experiment.

Raw prompts, chunks, exact usage, result records and logs are under `reports/evidence/paired-v2-live/`. Prior v1 evidence is under its separate directory. The original stopped v1 ledger was not reset.
