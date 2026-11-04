# Issues 4 and 5: workspace preparation state and cancellation — evidence

Workstream branch: `fix/issue-4-5-workspace-prep-cancellation`, from baseline `8c32a9d` (clean tree).
Harness: `tests/fixtures/executor.ts` (mock ExecutorHost, controllable subprocess runtime, deterministic cancellation).

## Issue 4 — Workspace preparation can be incorrectly considered successful

- **Classification: CONFIRMED.** `launch()` treated mere directory existence as prepared (`src/executor/dsh.ts`, pre-fix).
  Reproduction (failed pre-fix, passes post-fix):
  - `tests/issue-4-workspace-preparation.spec.ts > tries preparation again on retry after a failed prepare command left a partial directory`
    (pre-fix: `expected [] to have a length of 1` — the retry never re-ran the prepare command, contradicting docs/003).
  - `... > a changed prepare command invalidates a previously prepared workspace`
    (pre-fix: `expected [] to deeply equal ['make-v2']` — configuration changes did not invalidate).
- **Root cause:** no durable preparation state; the only signal was `stat(directory)`.
- **Repair:** `src/executor/workspace.ts` — atomic (temp + rename) per-workspace records under `<stateDir>/workspaces/`,
  states `preparing | prepared | failed | cancelled` (`unprepared` = no usable record). A workspace counts as
  prepared only when the command exited 0, `verifyDirectory` passed, and the assignment and configuration are still
  current at record time. Identity = SHA-256 of canonical JSON `{preparation_config_version, prepare_command, repository}`
  (no credentials; the execution environment is documented credential-free). A `preparing` record read at launch is a
  crash-interrupted preparation and is prepared again. Legacy directories (no record, or a record for another
  directory) keep their work: they pass `verifyDirectory` and are adopted with a `prepared` record noting the adoption.
- **Tests added (all passing):** successful preparation recorded and reused; retry after failure; partial-directory
  retry; empty-leftover removal; changed configuration invalidation; legacy adoption; crash-interrupted `preparing`
  record; foreign-identity record; prepare timeout (via a `prepareTimeoutMs` test override); record atomicity
  (no `.tmp` residue) and restart survival; identity stability/coverage.
- **Existing behavior preserved:** `tests/runtime.spec.ts > counts a ticket whose directory the host prepared before
  prepare commands existed as prepared` passes unchanged.
- **Remaining risk:** legacy adoption cannot retroactively prove completeness of a pre-existing directory (verified,
  not re-prepared) — documented in docs/003; a non-idempotent prepare command over a retained partial directory fails
  the ticket explicitly with the command's output rather than silently succeeding (intended: a person clears or fixes it).

## Issue 5 — Cancellation does not reliably stop preparation

- **Classification: CONFIRMED.** Pre-fix, `prepareDirectory` combined only host shutdown and the timeout
  (`AbortSignal.any([lifetime, timeout])`); assignment cancellation never reached the command, and nothing waited
  for a cancelled preparation to settle before a replacement assignment reused the workspace.
  Reproduction (failed pre-fix, passes post-fix):
  - `tests/issue-5-preparation-cancellation.spec.ts > cancelling an assignment aborts its running prepare command`
    (pre-fix: command signal never aborted).
  - `... > a replacement assignment waits for the cancelled preparation to settle before reusing the workspace`
    (pre-fix: replacement command spawned while the cancelled command still ran).
- **Boundary audit:** the other asynchronous boundaries were already guarded by `launch()`'s `current()` re-checks and
  the `sessions.prompt` authorize callback; pinned as invariant tests (ticket ended before launch; cancel during
  session creation; cancel immediately before worker delivery; command exiting 0 after losing the cancel race).
- **Repair:** assignment-scoped cancellation controller per launch, aborted by `stop()` inside the existing
  `afterCommit` (so a rolled-back end never cancels live work) and by `dispose()`; combined signal
  `[host lifetime, timeout, assignment cancel]` reaches the prepare command's managed process range through the
  subprocess runtime's abort (provider-side group termination; this repo has no provider implementation, so exact
  group semantics are the provider's documented contract — no unrelated user processes are touched from this repo).
  Cancellation is propagated to pending session creation and launch delivery by racing/rechecking, never by killing
  shared sessions. In-flight preparations are tracked per ticket; a replacement launch awaits the previous settle
  (process exit + record write) before preparing the same workspace. Cancelled preparations record state `cancelled`;
  partial output is kept, empty leftovers removed.
- **Tests added (all passing):** 7 boundary/settle tests listed in the spec file.
- **Remaining risk:** after a hard host crash (SIGKILL), a prepare command orphaned mid-flight is not observable from
  the new process; the `preparing` record is then treated as interrupted and preparation runs again, which a
  non-idempotent command may refuse explicitly. Cross-instance in-process restarts are covered by shutdown draining
  the effect queue before the new instance starts.

## Validation

- Failing-first commit `869db33` (tests only): 11 failing / 6 passing against the original code.
- Post-fix: `pnpm typecheck` clean; `pnpm build` clean; full suite 1213/1214 — the one failure is the pre-existing
  `tests/sources.spec.ts` Feishu event-consumer malformed-line health expectation, reproducible on the untouched
  baseline and owned by the integration session, not this workstream.
- No production-code changes outside `src/executor/` except one additive host-wiring line in `src/app/runtime.ts`
  (`repository: () => setup.deployment.repository`, mirrors the MasterAssessor's access), flagged to integration.
