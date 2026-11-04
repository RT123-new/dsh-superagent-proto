# Issue 17 follow-up: the slot-free wake (quiet-turn refill)

## Finding (baseline, e50b32b)

A worker whose turn ends quietly (its end relays nothing) frees its worker slot without kicking the effects queue.
The queue dispatches on kicks (enqueue, effect task completion, the 2-second Passes interval), so a queued launch
then waits up to one pass interval. Measured on the base: refill 1960-1976 ms (three scenarios; see
`evidence/stage-d/issue-17-slot-refill-kick-red.txt`), matching the earlier single-case 1983 ms in
`issue-17-slot-refill-latency`. When the turn end happens to relay, the relay's enqueue kicks the queue and the same
refill takes ~11 ms.

## Candidate fix (integrator-cleared seam)

Minimal free-wake only: when a slot-free completes in `workerIdle` (handoff to a person; settle of a quiet turn end;
settle that finds the worker reported meanwhile) and launch effects are waiting, kick the effects queue
(`src/executor/dsh.ts`, `slotFreed()`). Guarded by `Effects.pending('launch')`, so it fires only when a launch waits;
`kick` coalesces, so repeated wakes cannot spin; while paused the launch handler limit is 0, so the wake dispatches
nothing; `launchQueued` re-validates its ticket, so a stale or cancelled queued launch is skipped. No change to FIFO,
defaults, capacity, or background ownership; no auto slot release. Adjacent-surface note: the collector's d980249
(deliver()/inputsDelivered/session-listener instrumentation) touches different hunks of the same file; the seam here
does not overlap it.

## Failing-first evidence

`tests/stage-d/issue-17-slot-refill-kick.spec.ts` was committed red (45b4561) against the base:

- quiet turn end: refill 1960 ms (assertion: < 500)
- handoff freeing the slot: refill 1976 ms (< 500)
- queued launch behind a cancelled one: refill 1966 ms (< 500)
- paused guard: passed already on the base (no wake existed)

With the wake the same spec is green (4/4): quiet refill 8-15 ms, handoff refill prompt, the cancelled queued launch
is never started (its worker session is never created) and the next queued launch refills promptly, and while paused
the wake fires at most one coalesced kick without dispatching.

## Paired baseline/variant benchmark

`tests/stage-d/issue-17-slot-refill-bench.spec.ts` runs seeded workloads in which every worker reports progress and
then ends its turn quietly, so every refill is a quiet turn end. Full grid: capacities 1/3/6/12 (n = 6/12/18/24),
5 seeds; both arms ran the identical bench code (raw: `evidence/stage-d/issue-17-slot-refill-kick-bench-{baseline,variant}-full.json`;
analysis: `issue-17-slot-refill-kick-paired.json`, percentile bootstrap, 10,000 resamples).

- Capacity 1, per-refill latency (25 pairs): baseline P95 1972 ms, variant P95 13 ms; mean paired delta 1939 ms,
  95% CI [1927, 1951].
- Capacity 1, makespan (5 pairs): 10076 -> 379 ms; mean delta 9697 ms, 95% CI [9638, 9750].
- Capacity 3, makespan: mean delta 63 ms, 95% CI [42, 87] (overlapping workers' relays already kicked most refills;
  the wake removes the remaining stalls).
- Capacity 6 and 12, makespan: mean deltas -14 ms [-61, 29] and -12 ms [-56, 25]; CI spans zero: no measurable
  regression or benefit where incidental relay kicks already refill promptly.

The wake's benefit is concentrated where concurrency is low or a workload drains its tail (no other worker's relay
happens to kick); there it removes a full pass interval per refill, and it does not measurably change behavior
elsewhere.

## Regression posture

Full `pnpm check` green: typecheck, 1416/1416 tests (89 files), build. The prior Issue 16/17 scenario suites run
unchanged against the wake (person +1 slot priority, cancellation in background-wait, crash backoff, 30-minute
background limit, capacity matrix, FIFO, failure injection); their evidence JSONs were re-generated under the wake
by the check run. `issue-17-concurrency.spec.ts`'s refill-latency scenario pinned the pre-fix behavior
(`refillWithoutKickMs > 1000`) and was updated to the new expectation with the baseline preserved in its note.
Invariants asserted under the wake: no oversubscription (peakUsed <= capacity in every run), no dispatch or spin
while paused, no resurrection of a cancelled queued launch.

## Not tested / out of scope

- Token cost and provider-side startup: NOT TESTED (paid model calls frozen; live-validation workstream owns the real
  model path). Turns here are ended by the harness; this measures scheduling machinery only.
- Cancellation and crash slot-frees are untouched by the seam: both already end with their own notices/relays, which
  kick the queue (issue-16 scenarios C and D cover their refill behavior).
