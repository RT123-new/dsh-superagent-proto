# Atomic slot metrics review

Base062dcc7, isolatedbranch review/issue-9-slot-atomic. Failing-first1129d39 independently proves Probe.slots uses three clock reads for one logical capacity/state observation. Narrow repair adds SlotIntegrator.transition(capacity,counts), validates all inputs before any clock read or state mutation, integrates once then replaces capacity plus ALL configured state counts. Existing setters remain for compatibility. Probe prefers optional atomic method; older custom collectors retain approximate sequential fallback. Counts must be disjoint, as WorkerSlots.states supplies; atomicity does not establish identity-level disjointness by itself.

Three tests verify one-read transition, no phantom occupancy/idle, all-or-nothing invalid input and legitimate capacity-decrease excess. Focused31/31, typecheckpass. No executor/free/kick edits. Full suite/build validation recorded below.

Independent source and execution review of separate a3aad17 slotwait: author4/4 pass on isolatedworktree. Metric is enqueue-to-reservation including scheduling/retry/pauses, not pure capacity-only waiting. Required follow-up: stamps after committed enqueue, injected clock not rawperformance, dispose cleanup. Originaltests swallow launch errors with incomplete mockhost, so scope is pre-launch reservation only, not fullsuccessfulworkerproof. No a3aad17 production change included in this branch.

Validation: full1440/1440 across92files, typecheck and buildpass.
