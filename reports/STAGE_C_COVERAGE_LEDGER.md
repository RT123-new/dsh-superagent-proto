# Stage C lifecycle coverage ledger (Issue 9)

Status: PARTIAL (revision 2, base 733691c). Each row says what is measured, how, and what is not. "Hooked" means a production seam records it; every figure is a local monotonic duration unless marked wall-clock. Not Issue 9 closure.

| Lifecycle stage | Metric key | Status | Measured as | Not claimed / gap |
| --- | --- | --- | --- | --- |
| Source event received (local) | trigger_intake, trigger_to_eval_start | HOOKED | Passes.receive duration (the first local point every Source reaches through `ctx.receive`); `trigger.received` stamps local monotonic time | `Trigger.at` is remote and unused; time inside a Source loop before `receive` is not measured |
| Trigger -> evaluation start | trigger_to_eval_start | HOOKED | local mono between `trigger.received` and `eval.started` | includes any batching or debounce the Engine applies; unobserved starts are counted `lifecycle_unmatched` |
| Evaluation run to decision | eval_run | HOOKED | `eval.started` -> `decision.recorded` by persisted decision.evalId, never thread coincidence | the assessor is the main Session, so this includes its model time |
| Assessor card delivery | assessment_card_delivery | HOOKED | card build + delivery to main Session inbox | not decision time, not model start |
| Decision -> ticket (Assignment created) | decision_to_ticket | HOOKED | committed `decision.recorded` -> committed `ticket.created` by decision id | resumed tickets have no decision |
| Assignment created -> started | assignment_launch | HOOKED | `ticket.created`/`ticket.resumed` -> `assignment.started`; includes slot wait, workspace prepare and Session creation | `slot_wait` alone is not separable without a new stamp; the reserved key stays unused |
| Ticket lifetime and outcome | ticket_lifetime, ticket_outcome_* counters | HOOKED | created/resumed -> ended; outcome counters by Engine outcome | lifetime is to the durable terminal event, not to correctness |
| Effect queue | effect_schedule_lateness, effect_total_age | HOOKED (wall-clock) | due->start and since->start, clamped 0, per all kinds | persisted wall-clock; not split by kind |
| Effect run | effect_run | HOOKED | handler duration; failure series; retry/later counters | |
| Effect outstanding count | queue effect | HOOKED | authoritative COUNT at snapshot (reviewed measure) | |
| Worker slot occupancy | slots worker | HOOKED | disjoint busy/preparing, capacity integral, sampled at reserve/free/agent status and the reviewed capacity commit | multi-state count setters are separate clock reads, so per-sample precision is approximate |
| Workspace prepare | workspace_prepare | HOOKED | success/failure/cancelled outcomes | |
| Delivery to worker | delivery_to_worker | HOOKED | first queued delivery per assignment -> `inputsDelivered` | in-process only; a delivery queued before a restart is not timed; not model start |
| Step open -> first settlement | step_to_settlement | HOOKED | `step/start` -> `assistant/message` (failure series on `assistant/attempt`) | DSH defines a step as one model call plus tools; step admission precedes system/prompt/prepared-call work. Only first settlement has this start; retries are unmatched, NOT per-provider-attempt latency |
| Model turn | worker_turn | HOOKED | `turn/start` -> `turn/end`; non-completed turn ends go to the failure series | |
| Tool execution | tool_run | HOOKED | `tool/call` -> `tool/result` by call id; `isError` to failure series | includes any permission or queue wait before the tool runs; worker Sessions only |
| Tokens / cost | tokens byComponent | HOOKED (usage only) | provider terminal usage on assistant/message, reviewed dedupe/scope | cost unknown without pricing and verified cache-write |
| Command subprocess latency | command_run | HOOKED | whole subprocess incl. startup/network, fixed label | not pure API latency |
| Report -> external response | receipt_to_response | HOOKED | new committed receipt queued -> Source send acknowledged (all receipt kinds, not report time); `reply_gone` counted apart | in-process only; unsent after restart not timed; settle of `channelIgnored` not counted |
| CPU / memory | snapshot `process` | HOOKED (process scope) | cumulative CPU micros, RSS, heap, event-loop utilization at snapshot time | whole Node process, excludes child processes; not per stage or ticket |
| Correct completion | none | NOT PROVIDED | | delivery or turn end is not correctness; `ticket_outcome_*` counts and `ticket_lifetime` are the observable terminal facts, ticket_created is accepted-ticket count, NOT an eligible-work denominator |
| Replay of restored session events | all session timeline stages | UNPROVEN | pairs only starts observed live | if DSH re-emits stored events on restore, replayed start/end pairs would record near-zero samples; no stable event id is exposed to the listener |

## Independent revision3 limits and causal repairs

Domain timestamps are observed after transaction commit so rolled-back events do not produce samples. Eval decisions resolve persisted decision.evalId; gate-only decisions cannot steal another active Eval timer. Decision-to-ticket is not decision-to-assignment and does not prove slot wait. Source receipt is still only Passes/committed intake observation, not an earlier external event boundary.

Receipt timing uses the injected monotonic clock and only newly committed receipt IDs. Duplicate/sent/withdrawn/ignored messages leave no bogus pending stamp. Missing timestamps after restart or bounded eviction produce no guessed duration. Eviction counters are visible. Delivery stamps are keyed by assignment, cleared at assignment stop and disposal; replacement cannot inherit an older assignment's wait.

worker_history_receipt separately records prompt dispatch beginning -> positively correlated managed user/message history entry, keyed by deterministic prompt/message ID plus assignment ownership. This is neither source receipt nor model/provider start. Assignment launch history may arrive synchronously before assignmentStarted, so current non-ended latest assignment ownership is checked rather than requiring already-running state. Prompt failures/cancellation clear pending correlation; entries are bounded with visible drops.

Interrupted assistant/message is failure. step_to_settlement is NOT model_call: installed DSH documents step/start before system prompt and prepareCall resolution, and retries may emit several settlements for one step. First observed settlement consumes the stamp; later retries count unmatched. Tool time includes permission/queue time after tool/call. Re-emission of restored start/end events is still unproven; none of these measures is unlimited exactly-once billing or correctness.

Launch scheduling wait (`launch_slot_wait`) is now observed from committed launch enqueue to successful slot reservation (includes effect scheduling, pause and retry). Injected monotonic clock, bounded stamps and stop/dispose cleanup; older/restarted enqueue is unknown.

Remaining gaps: actual provider request-start/individual retry intervals; local source receipt before processing; actual report-recorded -> related response; full end-to-end eligible/correct denominators and throughput/TPS/CPS. Process CPU/memory is process-scope only, excludes children. Bundled collector now samples capacity plus every configured slot state with one validated transition clock read (ea5035d); older optional third-party collectors retain sequential fallback and are not promised atomic precision. FullIssue9 remains PARTIAL.
