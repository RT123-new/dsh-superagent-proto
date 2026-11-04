# Follow-up review: uncertain outbound send after process restart

## Scope and provenance

Review of the current open PR #1 after the prior 85b5358 frozen checkpoint. This review directly inspected the current `src/app/effects.ts`, `src/app/outbox.ts`, the management HTTP blocked/rearm API, and the dedicated recovery tests. The earlier 1,710-pass checkpoint applies to **85b5358 only**, not to this follow-up.

**Classification:** Source-supported reliability defect in the old startup policy. Before this patch, `Effects.start()` converted a persisted `[attempt-started]` marker to `[attempt-unknown]` without blocking the effect. Its `due` timestamp remained eligible, and `Effects.dispatch()` excluded only `blocked:` errors. Consequently a reply interrupted after an external provider accepted it could be resent automatically after restart.

This is a possible duplicate external effect; the code inspection does not establish the frequency of that failure in a live provider. Provider-side idempotency is not guaranteed.

## Change

- On startup, a `reply` with a persisted `[attempt-started]` or legacy `[attempt-unknown]` suffix is placed in `blocked:unknown_outcome`, preserving the original row, receipt, and stable key.
- A blocked uncertain reply cannot run automatically, even if its original `due` timestamp has elapsed. The existing operator API explicitly rearms it; it preserves the sticky unknown-outcome marker.
- Other effect kinds retain existing retry behaviour. Replies with ordinary transient send errors during an uninterrupted process retain the previous retry policy.
- Operator API reports the safe class `unknown` with `attemptUnknown: true`; it does not reveal stored error text.
- The error/parked counters are surfaced via the existing health and metrics mechanisms. Documentation now explains the manual recovery requirement.

## Regression coverage added/updated

- `tests/review-phase2-effects-marker.spec.ts`: interrupted and legacy unknown rows cannot dispatch before explicit rearm, sticky unknown marker survives retries/restarts.
- `tests/review-phase2-outbox-kill.spec.ts`: process-kill recovery is expected to park rather than automatically retry.
- `tests/review-phase2-effects-routes.spec.ts`: blocked operator route exposes safe `unknown` metadata and accepts explicit rearm.

## Verification status

The changed paths were fetched back from GitHub after pushing to confirm their actual content. **The TypeScript test suite, typecheck, production build, and SIGKILL integration tests have not been executed on this follow-up tree** because the connected GitHub tool exposes repository file operations but not a runnable checked-out toolchain, and the local sandbox cannot fetch the repository/dependencies. This patch is therefore **not certified merge-ready** by this review.

Before merge, execute on the final HEAD:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test -- tests/review-phase2-effects-marker.spec.ts tests/review-phase2-outbox-kill.spec.ts tests/review-phase2-effects-routes.spec.ts
pnpm test
pnpm build
git diff --check
```

Also perform a real-host restart test: provider accepts outbound reply, process dies before durable settlement, startup leaves exactly one pending receipt and a blocked reply, no automatic second send occurs, operator rearm sends at most once per explicit action, and a successful acknowledged send deletes the effect row.

## Residual risks

- An uninterrupted running process may automatically retry a transient failure even if the provider accepted the request; this patch does not remove that known duplicate risk.
- Provider-side idempotency and distributed exactly-once effects remain unproven.
- All previously documented limits (live source replay, framework create cancellation, eligibility/correct-task measurement, destructive retention, concurrent polling pool and slotwake) remain unchanged.
- No paid model calls, deployment, merge, or changes to `main` were made.
