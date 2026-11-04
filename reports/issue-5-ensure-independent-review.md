# Independent ensure follow-up review

Base: programme/reliability f32c506 (follow-up a9c229d / 05d87ee). Independently ran the author's four race tests plus six docs tests: all pass. Inspected the actual Sessions.ensure, initializeRoleModel and executor callsite.

Three additional tests fail before repair (4df4e32):

- A pending skill-service injection callback runs bindSkills after assignment cancellation, before the post-await check. Registration disposal afterwards does not mean the cancelled mutation was prevented.
- Old cancelled decorate releases by agent identity and removes a newer binding on a reused worker after replacement.
- Concurrent ensure treats bindings.has as completed decoration and sets broad permission presets before pending tool restrictions are installed.

## Narrow repair

SessionBinding gains optional readiness. Reused binding callers await its completion, then re-check their own authorization and binding generation. Subagent bindings without a promise remain synchronously complete and their durable provenance is not removed.

Decoration setup is split into a generation-owned helper. The delayed skills callback checks generation before mutation, and initial authorization before registering skills. Failed setup releases only its exact binding instance. Scope callbacks after successful initialization no longer retain a stale assignment lifetime: a fourth test verifies skill-service restart can rebind a successfully initialized shared session after the original assignment's callback expires. Existing prompt/tools bindings remain available across legitimate assignment changes.

Only sessions.ts changes production behavior. No ancestry resolution, notice delivery, model retry or durable provenance logic is changed. No session deletion or framework rollback is attempted.

## Executed evidence

- Author tests + docs: 10/10 on original follow-up.
- Added failing-first: 3/3 behavioral failures.
- Full suite after initial repair: 1274/1274, 68 files, all pass.
- Latest focused after adding successful-scope-rebind semantics: 99/99 (four independent decoration races, four author creation gates, 91 runtime cases).
- Latest typecheck: pass.
- Build: pass before final successful-scope-rebind refinement. Integrator must rerun build/full suite after integration.
- Raw logs committed under reports/evidence/issue-5-ensure-review.

## Limits preserved

The session-controller create RPC still has no cancellation input. Framework creation and agent-created decoration already in flight can complete, but caller-owned later stages and delivery are gated. This review does not claim atomic cancellation or rollback of that framework RPC, and does not delete a shared session. Skill registration before initialization is guarded at callback boundaries, not retroactively undone after synchronous operations have already started. Cancellation does not dispose a fully established shared worker's durable guard merely because the assignment that originally initialized it ended.
