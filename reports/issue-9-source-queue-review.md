# Application receipt to committed evaluation queue review

Reviewed8c65f4f (localf9a05e8). Core queued flag is the boolean result of the existing owners check and queueForEval call; no additional queueing, owner decision or FIFO change. DomainTimeline retains the decision.evalId resolver. Runtime observes domain events through Store.afterCommit.

Independent red21f2d2b: a custom arrival.note exception prevents engine.receive entirely; arrival.drop may also mask the engine exception. Narrow repair failure-isolates both hooks in Passes and counts metrics_error through Probe. Instrumentation failure cannot change stored/filtered/duplicate results or replace the original engine exception.

Independent executable proofs: actual Runtime outer transaction rollback produces no source queue sample and rolls back trigger storage; retry of same ID refreshes arrival (no stale huge duration); duplicates do not add samples; real accepted ticket owner followup does not add samples. Timeline proves missing receipt/restart, abandoned filtered receipt and non-intake requeue do not invent source queue duration. Existing source tests independently rerun.

Boundary caveats: source_to_eval_queue starts at Passes.receive, not provider event creation or network ingress. Its end is the committed trigger.received callback, not the queue write instruction, so includes the remainder of intake plus commit delay. A rolled-back outer transaction can leave an unused arrival stamp until same-ID retry overwrites or bounded map evicts it; no sample is emitted by rollback. Later queueForEval calls outside Intake are not new receipt observations. Unobserved pre-restart receipts stay unmeasured; no cross-process monotonic reconstruction.

Focused135/135 across4files and typecheck pass after repair. Whole-suite/build results reported separately.

Final validation: full1455/1455 across95files, typecheck/build pass. Initial full run failed only missing Architecture test index; added index then independently reran entire suite green.
