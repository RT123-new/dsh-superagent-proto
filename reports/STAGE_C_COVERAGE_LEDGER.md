# Stage C lifecycle coverage ledger (Issue 9)

Status: PARTIAL. Each row says what is measured, how, and what is not. "Hooked" means a production seam records it; every figure is a local monotonic duration unless marked wall-clock. Not Issue 9 closure.

| Lifecycle stage | Metric key | Status | Measured as | Not claimed / gap |
| --- | --- | --- | --- | --- |
| Source event received (local) | none | GAP | no local receipt stamp at source loops | `Trigger.at` is remote time and is unused |
| Intake into Engine | trigger_intake | HOOKED | Passes.receive duration, outcome counters stored/duplicate/filtered | not source-to-queue latency |
| Eval enqueued -> assessor card sent | assessment_card_delivery | HOOKED | card build + delivery to main Session inbox, failures in failure series | not decision time, not model start |
| Eval decision latency | eval_run, eval_queue_wait | GAP | stage names reserved, no hook | needs Engine decide/enqueue stamps |
| Decision -> Assignment | decision_to_assignment | GAP | reserved | |
| Effect queue | effect_schedule_lateness, effect_total_age | HOOKED (wall-clock) | due->start and since->start, clamped 0 | persisted wall-clock, not monotonic; not pure wait |
| Effect run | effect_run | HOOKED | handler duration; failures in failure series; retry/later counters | |
| Effect queue depth | queue effect | HOOKED | authoritative COUNT at snapshot (label per reviewer: outstanding vs waiting) | |
| Slot wait | slot_wait | GAP | reserved | |
| Worker slot occupancy | slots worker | HOOKED | disjoint busy/preparing, capacity integral | capacity-change timing per reviewer repair |
| Workspace prepare | workspace_prepare | HOOKED | success/failure/cancelled outcomes | |
| Delivery to worker | delivery_to_worker | GAP | reserved | delivery ack is not model start |
| Model turn start / turn | worker_turn | GAP | reserved | no model-start event identified |
| Tool execution | tool_run | GAP | reserved | |
| Tokens/cost | tokens byComponent | HOOKED (usage only) | provider terminal usage on assistant/message | cost unknown without pricing/cache-write; dedupe and scope per reviewer repair |
| Command subprocess latency | command_run | HOOKED | whole subprocess incl. startup/network, fixed label | not pure API latency |
| Report -> external response | report_to_response | GAP | reserved | outbox send ack unhooked |
| CPU / memory | none | GAP | | no collection |
| Correct completion | none | NOT PROVIDED | | delivery or turn end is not correctness |
