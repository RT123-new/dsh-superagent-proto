# Independent adversarial review: Issues 4-5

Reviewed original fix 4fc0ecc against the user mandate, baseline 8c32a9d. Original 17 workspace tests passed, but did not establish the full invariants.

## Reproduced independently

Failing-first commit a12608c adds five behavioral tests, all failing against 4fc0ecc:

1. Non-empty partial legacy workspace adopted on a credential-config check alone.
2. Corrupt marker treated as legacy, allowing partial work to launch.
3. Assignment cancellation not reaching directory verification's subprocess.
4. Preparation configuration changing during session creation still allowing launch delivery.
5. Replacement preparation starting after direct shell exit while its managed descendant range remains alive. `waitForExit()` was never called.

Additional review found an ended assignment on a live ticket could pass `current()` with no replacement yet. A new regression pins this boundary.

## Repairs

- Missing/corrupt/foreign record plus non-empty directory plus configured command: preserve files, do not run a possibly destructive generic command, fail with actionable offline remediation. No automatic adoption UI is implied. Empty directory permits preparation. Commandless flow still verifies credential safety.
- Cancellation reaches verification via the same combined signal.
- Preparation identity is pinned across every launch revalidation, including delivery's final authorization callback.
- `current()` explicitly rejects ended assignments.
- New executor-local `runPreparationCommand` waits for provider-managed-range quiescence, not only direct command exit. Shared `runAsWorker` semantics are unchanged.
- A failed quiescence proof blocks workspace reuse, with an in-memory latch and persisted `quiescence: unknown` record. Retry/restart behavior is tested when persistence succeeds.
- Mock subprocess fixtures now implement the actual quiescence/termination seam. ControlledSpawn has an independent range latch, rather than defining range proof as direct exit.

## Compatibility decisions

The prior runtime invariant that an old workspace can bypass a newly configured command is intentionally changed: git credential checks and directory presence cannot establish arbitrary command completion. Its revised test requires preserving files and blocking. Healthy known-success records still reuse preparation; known failed/cancelled/interrupted preparation still retries as mandated. Operators must back up/inspect unknown legacy workspaces and move them aside or reconcile preparation state offline. Generic readiness cannot safely be inferred.

## Executed evidence

- Original author tests: 17/17 pass on original fix.
- Independent failing-first: 5/5 fail on original fix, with concrete behavior assertions.
- Full suite after initial repair: 1224/1225 pass. Only the separately known Feishu malformed-line health race fails.
- Latest targeted executor/runtime suite after ended-assignment and in-memory uncertainty latch: 176/176 pass, including 12 independent adversarial tests.
- Typecheck: pass on latest tree.
- Build: pass before the final ended-assignment/latch refinement; integrator should rerun on final integration.
- No paid model calls or deployment.

Raw logs are in `reports/evidence/issue-4-5-review/`.

## Actual local provider experiment

Published `@deepseek-ai/dsh-subprocess-local@0.2.1-alpha.2` was installed into an isolated temporary directory, not added as a project dependency. The included `provider-probe.mjs` spawns a real shell with a SIGTERM-resistant child writing heartbeat bytes, plus an unrelated sleep. Cancellation produced:

```
{"outcome":{"exitCode":null,"signal":"SIGTERM"},"empty":true,"childAlive":false,"heartbeatStopped":true,"unrelatedAlive":true}
```

This verifies the local provider path available on this Linux host, not all platform containment modes. Run the script from an isolated directory with that provider and its peer dependencies installed. The script cleans up its own processes only.

## Remaining limits / not yet closed

- Sessions.ensure does not accept an assignment cancellation signal or authorization callback. Existing launch guards prevent worker delivery after cancellation, but an in-progress ensure can still create/decorate a session after cancellation. The existing author test rejects its own promise artificially rather than proving real interruption. This needs a small app-owned API extension or an explicit scoped acceptance decision; do not call Issue 5 fully closed yet.
- Provider quiescence may wait indefinitely if a provider hangs. This favors safety over replacement liveness. Provider fallback visibility cannot prove escaped unobserved descendants on every platform.
- Atomic rename is tested at the state-machine level, not fault-injected across a power loss; no fsync/power-loss durability claim is made.
- If the provider loses observability AND persistence of the failure record fails, the current process stays blocked via the in-memory latch, but crash/restart loses that latch. A preexisting `preparing` record can then be retried. This compound disk-failure/crash case remains a recovery risk.
- A prepared record establishes completion at preparation time, not readiness after arbitrary user edits/removal of workspace files.
