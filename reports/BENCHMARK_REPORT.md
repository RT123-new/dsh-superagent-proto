# Benchmark report (running evidence, not final adoption)

Baseline commit8c32a9d; correctness-reviewed tag5752c4c. Experiments use deterministic fixtures first. No paid test outside the recorded$5programme cap. No lower cost from missed work is an efficiency gain. Required adoption rule: relevant paired P95≥15%with uncertainty supporting gain; cost per correctly completed task≥10%without reduced correctness. Other architecture changes need gains across multiple workload conditions. Unproven experiments remain disabled/unadopted.

## Evidence currently integrated

| Experiment | Workload/sample | Executed result | Interpretation |
| --- | --- | --- | --- |
| Collector overhead |1Mobserve calls,1Mtimer start/stop,50serializations; unloaded local process |144.1ns/observe;214.2ns/timer pair;1781bytes snapshot; serializationP50 0.653ms,max1.29ms;heap8.1MB | Isolated collector overhead, single run; not loaded runtime/API/panel overhead or paired adoption proof |
| Context retrieval |25profiles/seeds×200tasks=5000retrieval-oracle tasks;5/20/100conversations and3/6/12sessions varied one factor at a time | Full source-backed reads preserve corrections; tail-only proposal fails; deterministic bytes/API-count report | Not model tokens, provider cost, execution success or production frequency. Retain existing cache/read design |
| Livev1 | One eligible repaired synthetic task,2calls |0/1completed; invalid AST leaf grammar safely rejected;cost$0.0002277 | Failed exploratory prompt, retained in denominator |
| Livev2 prospective | Normal+30s-late seed11,2paired eligible tasks/variant;6calls | Baseline1/2completed, repaired2/2;3worker ASTs each pass206checks;cost$0.000693936 | Source/Engine/provider-adapter evidence only, synthetic executor/outbox. Not full DSH service or production reliability estimate |

Collector raw: evidence/integration/metrics-overhead.json. Context integration rerun exact testedcommit8243a97 is annotated in evidence/integration/context-retrieval-rerun.json; original script hardcodes3b58209metadata, so that field was not accepted as runtime revision evidence. Original context report/evidence retains its actual author baseline. Live raw usage/prompts/results remain in paired-live/andpaired-v2-live/; independent AST replay in integration/live-ast-replay.json.

## Live usage caveats

V2normal worker prompt bytes identical between source variants. Provider sampling not controlled by workload seed. Variant order is sequential and not randomized; repaired worker calls had128cached input tokens each, baseline none. Output lengths differ. No attributable token/cost savings, P95 gain, bootstrap population interval or adoption threshold can be claimed from two pairs. Baseline missed-event poll time is not completion latency and is excluded from successful-task latency distributions. V1failure is not relabelled after prospective prompt clarification. Conservative programme observed cost$0.001021636inclroundedprobe, pending reservation0, further calls frozen.

## Not yet accepted

Independent StageDmeasurements10–18 and storage19–20 are still in flight. No concurrency/webhook/HTTPtransport/queuepartition/retry/workerpool/index/retention optimization is accepted by this report. Production metrics hooks/dashboard coverage, serialization payload cost and actual panel poll work remain pending. Every unsuccessful/refuted/not-tested experiment must survive into the final report. This file will be extended from returned raw paired evidence rather than inventing missing metrics.
