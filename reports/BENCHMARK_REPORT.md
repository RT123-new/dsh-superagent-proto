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

Storage20 query plan is adopted for its declared tested workload (below). Retry15 safety/jitter changes are reviewed correctness/operational repairs, not a demonstrated speed/cost improvement. Optional subscriptionpool and destructive retention remain under independent review. Webhooks, HTTP replacement, queue partition, generic background-slot release, capacity increase, extra caches and broad slotwake are not adopted. Production hooks/dashboard actual RuntimeHTTP proof now passes, but loaded runtime/panel overhead and full lifecycle completion denominators remain unmeasured.

## Accepted storage20 scope

Review repair06ad576 and strict crash proof71c1b8f were integrated before adoptiona69705d. Independent copied-baseline100k-row paired rerun:40windows,zero result mismatches; P95statistics151.21→13.93ms andflow118.69→28.17ms. Author200pairs/fivedatasets recomputed: P95statistics152.43→13.70ms,flow119.16→27.51ms; pair bootstrap (not clustered CI), warm synthetic only. The15% gate is met for these query workloads. Approximate tradeoffs:0.03ms additional save cost,16%disk,2.2s blocking1M upgrade, bulkload overhead. No retention optimization adopted. See reports/evidence/integration/storage/ for own raw results and storage review reports for crash/migration evidence.


## Completed StageD evaluations and excluded mechanisms

| Scope | Paired evidence | Result / disposition |
| --- | --- | --- |
|10 subscriptionpool experiment | ActualSource/Engine/SQLite,matched requestgates,80roundsx200conversations, virtual network/clock; independent11checks+script tsc | Slow profiles suggest benefit; low latency below15% and ratebound0. Separate reviewed production candidate still held, five-round-pair exploratory uncertainty. |
|11 signed wake |200eventsxfiveseeds/loss profile, stipulated60s polling fallback | ModeledP95poll57.08s vs2.11s nohookloss,30.94s at10%loss;50%loss below15%,total loss0gain. Not deployed, no observed reliable end-to-end claim. |
|12 CLI/HTTP |200alternating sequential pairs/profile, loopback60ms request service | Notification26.19%P95 gainCI25.39–28.01;issue26.39%CI25.84–27.20;threepage10.45%CI10.00–11.39 below15%. Auth/wrapper semantics not equivalent, retain CLI. |
|13–14 coordination |1/3/6/12workers, fiveseeds, Store+Effects virtualclock, two explicit benchcases independently rerun100s | Reports/notices/queue load conserved; isolated partition fixture improves an outage but violates current single-mainSession write semantics if adopted broadly. No partition/coordinator architecture. |
|15 retries | Seeded jitter/class/error-persistence and block/rearm tests; baseline frozen explicitly | No latency/cost claim. Jitter spreads50correlated retries; permanent/auth failures stop until explicit samekey enqueue, blocked head stays visible.36production plus current/frozenfixture44focused green; unknownTypeError remains transient. |
|16 background slots |14real executor fixture scenarios independently rerun on instrumented integration | Generic release unsafe without completion/ownership/cancel proof; no default capacity increase. Human+1 and existing handoff semantics preserved. |
|17 capacity/FIFO |3/6/12capacities, failure/starvation fixtures | Match offered concurrency;12adds no benefit in tested trickle/burst;FIFO retained. Full model cost unmeasured. |
|17 quiet-refill candidate |20paired seedruns,five/profile;25within-run refills atcap1;10k matched seed-cluster P95bootstrap | Cap1P951971→14ms,99.29%gainCI99.289–99.342. Cap3runP95gain11.48% below15%;6/12pointestimates worse withregression-allowingCIs. General slotwake deferred. Independent disposal correctness fix separated from optimization. |
|18 creation/recovery |15paired real shell/fs cold-warm runs,restartstorm,pure decoration timings | ColdP959.4ms/warm0.68;prep reuse alreadyworks. No extra cache justified; provider/session-controller/modelselection not fully benchmarked. |

Exact scope, oracle conservation, rejected fixtures and remaining checks live in stage-d-issues-10-12.md, issue-13-15-coordination-baseline.md, issue-16-18-executor-baseline.md and issue-17-independent-review.md. Raw own independent outputs are separated under evidence/integration; normal tests no longer overwrite archived evidence.

Latest collector single-process microbench rerun:1Mobserve143.1ns/call,1Mtimerpair216.7ns,50serializationP501.544ms/max2.247ms,3294bytes,heap9.3MB. Not loaded panel/API overhead and not an end-to-end improvement estimate.

### Production pool final evaluation: held

Independent4newred→repaired27fast checks/full1411 on candidateb270676 plus author fresh28check/80round rerun prove conditional fixture behavior. Exact repaired virtualclock80round/16kread paired data retained under pool-independent: lowlatency~13%belowtarget,ratebound0,slow~49/72/80% forC2/4/8, five independent seedpairs/profile exploratory only. Production integration DOES NOT adopt this code: restart loses known server embargo/rate budget, scope excludes other account phases, uncertain outcomes retain reservations and self-throttle. The safety/restart gates are not satisfied merely because optional/defaultabsent. Keep sequential path; candidate and review reports remain reviewable, no new persistence architecture or real-network speed claim.
