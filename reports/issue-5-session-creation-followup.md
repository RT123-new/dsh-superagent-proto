# Issue 5 session-creation follow-up

The independent executor review left an unchecked Sessions.ensure boundary. Three failing-first tests on integration 8c20a1c showed cancellation during resolve/workspace creation/create-RPC still progressed to later calls. This follow-up adds an optional authorization callback to ensure and checks after every awaited boundary, before later mutations. Executor supplies its cancellation, assignment, pause and preparation-identity checks. Model initialization also checks after provider model resolution, before appending selection. Explicit decoration checks on skill-scope completion release registrations if authorization ended.

Four focused tests pass. The fourth (model-resolution cancellation) was added during implementation, not in the failing-first commit. Initial full check found only the required architecture test-table row missing; corrected separately. No paid calls.

## Explicit limitations

The pinned published session-controller create RPC has no AbortSignal argument. A request already executing inside that framework can complete its creation/attachment and trigger agent-created decoration. The callback prevents the caller from starting subsequent work, setting broad permission presets, renaming or delivering after the await returns; it cannot roll back framework internals already in flight. Existing or reused worker sessions must not be deleted as cleanup because later authorized assignments share them. Full interruption/atomic cancellation of framework creation remains NOT PROVEN and Issue 5 retains this residual gap.

Cancellation after a mutation has begun cannot undo it. The scope is commit-boundary prevention, not retroactive rollback. The optional callback preserves existing callers' interface; production executor passes it explicitly.
