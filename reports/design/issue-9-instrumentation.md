# Issue 9 instrumentation design (Stage C draft)

Draft for review before Stage C. Grounded in the baseline code at 8c32a9d; revalidate after Stage B integrations land.

## What already exists (do not duplicate)

| Lifecycle moment | Existing carrier |
| --- | --- |
| Source event received | `Trigger.at` (src/core/model.ts:33) |
| Decision recorded | `Decision.at` (model.ts:192) + `Decision.evalId` |
| Assignment created (accepted) | `Assignment.createdAt` (model.ts:218) |
| Worker started | `Assignment.startedAt` |
| Inputs delivered to worker | `Assignment.deliveredAt` |
| Worker turn idle / handed off | `Assignment.idleAt`, `report.at` |
| Assignment ended | `Assignment.endedAt`, `endedReason` |
| Ticket created/updated/ended | `Ticket.createdAt` / `updatedAt` / `ended.at` |
| Trigger routing outcome | `TriggerDisposition` (filtered/evalId/decisionId/fanout/handbacks/acked, model.ts:41) |
| Health of parts | HealthBoard entries with `at` (runtime, evals, delivery, reply, github, feishu, ...) |
| Retry attempts | DshExecutor transient map (in-memory only, lost on restart) |

## Gaps vs the mandate's 12-stage lifecycle

| Stage | Status today |
| --- | --- |
| event received → evaluation queued | no timestamp on eval enqueue (Evaluation exists but check its fields at Stage C) |
| evaluation delivered → decision recorded | assessor latency not separated from queue wait |
| assignment queued → worker slot acquired | only createdAt→startedAt delta; slot-wait not separated from prepare |
| workspace prepared | no timing (prepareDirectory) |
| model turn started / tools executed | no per-turn timing; no tool-duration capture |
| result reported → external response delivered | outbox/delivery latency not measured |
| model tokens / cost | NOTHING captures usage; no token counters anywhere (grep: only prompt caps) |
| worker-slot utilisation over time | WorkerSlots has reservations; no state-time accounting |

## Proposed design (smallest sufficient)

1. **Lifecycle event record** appended to a bounded in-memory ring + persisted table `metric_events`:
   `{ at_wall: string, at_mono: number, kind: LifecycleKind, ticket?: id-hash, source?: string }`.
   Bounded cardinality: `kind` and `source` are the only labels; NO raw ticket ids or message text as labels (mandate). Per-ticket correlation stays in the ticket record itself.
2. **Hooks** (one-line each, placed in existing seams):
   - Engine.receive (trigger in), Eval enqueue/deliver (core/evals.ts + app/assessment.ts),
   - effects.enqueue / launchQueued slot reserve/free (executor/dsh.ts),
   - prepareDirectory start/end, sessions.prompt send/resolve,
   - outbox send success/fail (app/outbox.ts), delivery effect completion (app/delivery.ts).
3. **Slot occupancy**: WorkerSlots emits a transition record on every reserve/free with the reservation reason; occupancy_fraction_s computed by interval summation between transitions (exact, per mandate formula).
4. **Tokens/cost**: capture usage from DSH session model responses where the framework exposes it (verify dsh-agent API at Stage C); store raw_input/cached_input/output per assignment. Cost computed at report time with provider rates from reports/COST_LEDGER.md — never hardcode rates into metrics records.
5. **Clock discipline**: monotonic (performance.now) for durations; wall-clock ISO for persisted events — per mandate.
6. **Metrics endpoint/panel**: aggregate reads compute P50/P95 with nearest-rank (ceil(0.95*n)) — one shared quantile helper, used for every comparison (mandate).
7. **Overhead budget**: instrumentation itself must be measured; target <1% added wall time on the no-op path (validate in Stage C).

## What this design deliberately does NOT do

- No new database engine, no external metrics service, no high-cardinality labels.
- No change to Ticket/Assignment domain state machines — instrumentation observes, never gates.
