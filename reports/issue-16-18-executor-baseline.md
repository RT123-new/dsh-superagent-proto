# Stage D baseline: Issues 16-18 (worker slots, concurrency, startup/recovery)

Branch `perf/issue-16-18-executor`, based on `reviewed/correctness-stage-b` (5752c4c, 1319/1319 green).
Deterministic, offline measurement against the real Effects queue, WorkerSlots and DshExecutor in the in-memory
runtime harness (`tests/stage-d/host.ts`, extended from `tests/fixtures/host.ts` with reopen support) plus the
Issue 4/5 `ExecutorFixture` with a real `sh` subprocess where process cost matters. No production code changed.
No paid model calls; no live GitHub effects. Worker turns are ended by the harness after scripted durations, so
turn-time numbers measure the scheduling machinery, not model latency.

Environment: Node v22.23.4, x86_64 Linux (sandbox), pnpm 11.7.0. Evidence JSON per scenario: `reports/evidence/stage-d/`.
Probe: `tests/stage-d/probe.ts` records every WorkerSlots reserve/free, worker status transition and Engine turn
boundary, then integrates per-state slot-seconds. Occupancy fraction = state slot-seconds / (capacity x window),
the mandate's formula. Probe limitation: reasoning, in-turn tool use and in-turn external waits are inside `turn`;
separating them needs the Issue 9 in-Session hooks. Probe samples at event boundaries, so sub-millisecond states
between a status event and the Executor's own bookkeeping are approximated.

## ISSUE 16 — Worker slots remain occupied during background work: CONFIRMED, quantified

- **Background work holds its slot until quiet** (scenario A, capacity 3, 6 tickets): 35.0% of capacity slot-seconds
  were spent in `background-wait` (794 of 2277 slot-ms from ~250/600ms jobs after two turns ended). Queued launches
  were measurably blocked: t6 waited 660ms and t5 303ms for slots held by finished turns' jobs, while t4, freed by a
  quiet turn end, waited 40ms. Pumps of the effects queue admitted no launch while all slots were turns or
  background-wait.
- **The 30-minute background limit works and is the whole cost when it bites** (scenario F, fake timers): a job left
  running held 1 slot for the full 31 minutes (occupancy ~1.0 of one capacity slot), then was killed, the worker told
  at its next turn, and the slot released. State after: ticket `waiting`, no jobs running, `activeCount() === 0`.
- **Handoff to a person frees the slot without losing ownership, completion or cancellation** (scenario B, capacity 1):
  a worker reporting blocked with a live server job handed off; a second ticket launched immediately (queue wait <500ms,
  peak usage 1) while the job ran on. The job's end was collected and injected into the worker's Session without a turn
  or a slot. Ending the second ticket's Assignment killed the job it had left: cancellation authority preserved.
- **Cancellation in background-wait is prompt** (scenario C): stop-to-next-launch 11ms, jobs killed, peak usage 1.
- **A crashed turn frees its slot during retry backoff** (scenario D, 15s backoff on fake timers): `activeCount() === 0`
  during the backoff; another ticket launched into the freed slot; the retry was delivered after the backoff.
- **Human follow-up priority holds** (scenario E, capacity 3 full + queued launch): a person's message woke its worker
  in the +1 person slot (peak usage 4 = max+1) while the ordinary launch stayed queued.

Distribution (scenario A occupancy of capacity slot-seconds): starting 3.6%, turn 52.8%, background-wait 35.0%,
idle 94.4% (ticket-seconds, no slot held). Peak concurrent usage never exceeded capacity in any scenario (max+1 only
for a person's wake). No oversubscription, orphaned job, or missed wake-up observed in any scenario.

**Evaluation of releasing slots for safe background jobs** (mandate question): background-wait is 35% of capacity
slot-seconds under a job-heavy mix, so a safe-release mechanism has real headroom, but the invariants are subtle:
handoff already releases slots safely by transferring jobs to a person with collected ends and preserved cancellation;
an automated equivalent would need the same three properties (ownership, collected completion, cancellation reach)
plus a wake-suppression story. Recommendation: keep current behavior; revisit only after Issue 9 hooks can break
`turn` down further and real workload occupancy is measured. Do not raise the default worker count: peak usage
never approached capacity from background-wait alone in the crash/cancel/handoff scenarios.

## ISSUE 17 — Worker concurrency and scheduling: measured, FIFO retained

Capacity matrix, 24 tickets, seeded mix 60/30/10 of 30/100/400ms turns, 3 seeds, harness pumps after turn ends
(token cost NOT TESTED - paid calls frozen):

| capacity | seed | makespan ms | ideal ms | completion P50/P95 ms | queue-wait P50/P95 ms | peak used |
|---|---|---|---|---|---|---|
| 3 | 11 | 775 | 380 | 336/450 | 273/420 | 3 |
| 3 | 29 | 1020 | 626 | 369/743 | 276/680 | 3 |
| 3 | 47 | 813 | 426 | 315/524 | 281/461 | 3 |
| 6 | 11 | 502 | 190 | 30/107 | 0/0 | 6 |
| 6 | 29 | 840 | 313 | 41/398 | 0/22 | 6 |
| 6 | 47 | 568 | 213 | 31/108 | 0/0 | 6 |
| 12 | 11 | 510 | 95 | 31/107 | 0/0 | 6 |
| 12 | 29 | 882 | 156 | 30/398 | 0/0 | 7 |
| 12 | 47 | 573 | 106 | 32/110 | 0/0 | 6 |

- 3 to 6 roughly halves makespan and eliminates queueing; **12 adds nothing** because a serially accepted 24-ticket
  workload never offers more than ~7 concurrent tickets (peak used 6-7). Higher concurrency is not automatically
  better: capacity should track offered concurrency, not a guess.
- Makespan overhead over the capacity lower bound is ~2x at capacity 3 and grows with capacity (dispatch and
  accept-loop serialization dominate when turns are trivial). With realistic (model-speed) turns this overhead
  share shrinks; do not optimize the executor loop for millisecond turns.
- Memory: RSS delta over a 24-ticket run 10-30MB, no growth with capacity (indicative; no forced GC in-process).
- **Failure injection** (capacity 6, hard failures at turns 5 and 10): exactly those 2 tickets failed; the other 10
  completed (makespan 315ms); no stall, no oversubscription.
- **FIFO starvation, measured**: with nine 300ms tasks ahead of three 30ms tasks at capacity 3, short tasks' queue
  waits reached 849ms (P95 849, median 282 over all 12). This is ordinary FIFO behavior at saturation, not
  starvation of older tasks - older queued tasks always launched first. Person priority over queued launches is
  covered by Issue 16 scenario E. **No alternative scheduler is justified by these measurements; FIFO stays.**
- **Slot-refill latency after a turn end** (new related finding): a turn end does not itself kick the effects queue.
  When the end relays a summary (the common path), the relay effect's enqueue kicks dispatch and the refill took
  **11ms**; a quiet turn end after a non-empty prior summary relays nothing, and the refill waited **1983ms** for the
  2-second Passes interval. Source: `src/app/effects.ts` dispatch triggers (enqueue, task completion, pass pump).
  Candidate micro-fix (NOT implemented): kick the effects queue when WorkerSlots frees a slot with launches waiting.

## ISSUE 18 — Worker creation and recovery overhead: measured, mostly REFUTED as bottlenecks

- **Cold vs warm launch, paired R=15** (real `sh -c 'mkdir -p .cache && dd ... 64KB'` prepare, real fs): cold median
  4.9ms (P95 9.4), warm median 0.33ms (P95 0.68); paired saving mean 4.92ms (CI95 +/-0.56). Exactly one prepare spawn
  per ticket: the durable preparation record makes every warm launch skip re-preparation. Executor-side overhead is
  sub-millisecond; the cost is the user's prepare command itself, which is workload-defined. No caching opportunity
  beyond the existing record: at these costs none is justified.
- **Partial preparation recovery**: a prepare killed mid-flight (terminated process range) fails the launch without
  retry, marks the ticket failed, and the next launch re-prepares from the failed record and succeeds (failed 3.7ms,
  recovered 4.0ms). Recovery is idempotent; no leftover state blocked reuse.
- **Restart storm**: 4 tickets (2 running turns, 2 queued) through 5 sequential host restarts on one SQLite store:
  ready (open + resume reconciliation) 16-28ms per restart, relaunch to turns running 24-37ms. Interrupted running
  assignments were reconciled in place (ended, then re-pended); pending ones re-launched. Final state: every ticket
  has exactly one live assignment, none ended, none lost, none duplicated (3-4 assignments per ticket = one per
  restart that found it running, plus the original). Recovery is idempotent across the storm.
- **Prompt decoration microbenchmarks** (pure functions, in-process): triggerMessage 350ns, long-text capped variant
  188ns, with-reply-preview 175us (regex over a 10k-char replied-to text - the only notable cost, still negligible
  per delivery), batchLine ~1us per trigger, inputMessage 76ns-2.2us, ticketExecution 3.5us. Decoration is not a
  bottleneck at any plausible fan-out: REFUTED as an optimization target.
- **NOT TESTED**: real DSH session-controller creation cost, model selection, provider resolution (mocked here;
  needs the real provider path, which is under the paid-call freeze) and warm/cold model-side startup.

## Dispositions

- Issue 16: CONFIRMED and quantified. Behavior preserved: no slot release without ownership/completion/cancellation
  proof exists today except the handoff path, which already has all three. No code change proposed now; revisit with
  Issue 9 hooks and real workload data. Default worker count unchanged.
- Issue 17: capacity guidance measured (match offered concurrency; 3 is right-sized for serial trickle, 6 for bursts);
  FIFO retained (no unjustified scheduler); one candidate micro-fix recorded (kick on slot free) for integrator
  triage. Token-cost dimension NOT TESTED (paid calls frozen).
- Issue 18: preparation reuse, recovery and decoration measured; no optimization justified (hypotheses REFUTED as
  bottlenecks at executor scale); provider-side session/model startup NOT TESTED.

All scenarios assert invariants: no oversubscription beyond the person +1, no orphaned jobs, no lost or duplicated
assignments, correct wake-ups. Reproduce: `npx vitest run tests/stage-d/`.

Evidence regeneration is now explicit: normal `pnpm test`/`pnpm check` preserves the recorded benchmark JSON. To capture fresh StageD scenario output, run `STAGE_D_EVIDENCE_DIR=/tmp/stage-d-new pnpm exec vitest run tests/stage-d/`, then inspect and deliberately publish selected evidence. Original measurements remain immutable unless explicitly replaced with provenance.
