# Stage C lifecycle coverage ledger (Issue 9)

Status: PARTIAL (revision 2, base 733691c). Each row says what is measured, how, and what is not. "Hooked" means a production seam records it; every figure is a local monotonic duration unless marked wall-clock. Not Issue 9 closure.

| Lifecycle stage | Metric key | Status | Measured as | Not claimed / gap |
| --- | --- | --- | --- | --- |
| Source event received (local) | trigger_intake, trigger_to_eval_start | HOOKED | Passes.receive duration (the first local point every Source reaches through `ctx.receive`); `trigger.received` stamps local monotonic time | `Trigger.at` is remote and unused; time inside a Source loop before `receive` is not measured |
| Trigger -> evaluation start | trigger_to_eval_start | HOOKED | local mono between `trigger.received` and `eval.started` | includes any batching or debounce the Engine applies; unobserved starts are counted `lifecycle_unmatched` |
| Evaluation run to decision | eval_run | HOOKED | `eval.started` -> `decision.recorded` per thread | the assessor is the main Session, so this includes its model time |
| Assessor card delivery | assessment_card_delivery | HOOKED | card build + delivery to main Session inbox | not decision time, not model start |
| Decision -> ticket (Assignment created) | decision_to_assignment | HOOKED | `decision.recorded` -> `ticket.created` by decision id | resumed tickets have no decision |
| Assignment created -> started | assignment_launch | HOOKED | `ticket.created`/`ticket.resumed` -> `assignment.started`; includes slot wait, workspace prepare and Session creation | `slot_wait` alone is not separable without a new stamp; the reserved key stays unused |
| Ticket lifetime and outcome | ticket_lifetime, ticket_outcome_* counters | HOOKED | created/resumed -> ended; outcome counters by Engine outcome | lifetime is to the durable terminal event, not to correctness |
| Effect queue | effect_schedule_lateness, effect_total_age | HOOKED (wall-clock) | due->start and since->start, clamped 0, per all kinds | persisted wall-clock; not split by kind |
| Effect run | effect_run | HOOKED | handler duration; failure series; retry/later counters | |
| Effect outstanding count | queue effect | HOOKED | authoritative COUNT at snapshot (reviewed measure) | |
| Worker slot occupancy | slots worker | HOOKED | disjoint busy/preparing, capacity integral, sampled at reserve/free/agent status and the reviewed capacity commit | multi-state count setters are separate clock reads, so per-sample precision is approximate |
| Workspace prepare | workspace_prepare | HOOKED | success/failure/cancelled outcomes | |
| Delivery to worker | delivery_to_worker | HOOKED | first queued delivery per ticket -> `inputsDelivered` | in-process only; a delivery queued before a restart is not timed; not model start |
| Model call | model_call | HOOKED | `step/start` -> `assistant/message` (failure series on `assistant/attempt`) | DSH defines a step as one model call plus tools; this is the model call interval from step open, not the HTTP request start |
| Model turn | worker_turn | HOOKED | `turn/start` -> `turn/end`; non-completed turn ends go to the failure series | |
| Tool execution | tool_run | HOOKED | `tool/call` -> `tool/result` by call id; `isError` to failure series | includes any permission or queue wait before the tool runs; worker Sessions only |
| Tokens / cost | tokens byComponent | HOOKED (usage only) | provider terminal usage on assistant/message, reviewed dedupe/scope | cost unknown without pricing and verified cache-write |
| Command subprocess latency | command_run | HOOKED | whole subprocess incl. startup/network, fixed label | not pure API latency |
| Report -> external response | report_to_response | HOOKED | Outbox receipt queued -> Source send acknowledged; `reply_gone` counted apart | in-process only; unsent after restart not timed; settle of `channelIgnored` not counted |
| CPU / memory | snapshot `process` | HOOKED (process scope) | cumulative CPU micros, RSS, heap, event-loop utilization at snapshot time | whole Node process, excludes child processes; not per stage or ticket |
| Correct completion | none | NOT PROVIDED | | delivery or turn end is not correctness; `ticket_outcome_*` counts and `ticket_lifetime` are the observable terminal facts, with eligible (`ticket_created`) as denominator |
| Replay of restored session events | all session timeline stages | UNPROVEN | pairs only starts observed live | if DSH re-emits stored events on restore, replayed start/end pairs would record near-zero samples; no stable event id is exposed to the listener |
