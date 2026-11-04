# Lifecycle independent review

Base d980249 on733691c. Failing-first557adf6 contains3 independently reproduced defects; author7 lifecycle tests pass baseline. Repair adds7 adversarial tests. Full1408/1408 across85files; typecheck/build pass. No paid calls, deployment or main change.

Repaired eval causal correlation by persisted decision.evalId, not thread key; observe domain events after transaction commit. Gate-only decisions can occur while a different evaluation remains active on the same thread. Renamed decision_to_assignment to decision_to_ticket because that is the actual boundary.

Interrupted assistant/message now records failure. Renamed model_call to step_to_settlement: DSH runtime-types docs state step/start precedes system prompt and prepareCall. This measures first settlement from step admission, not pure provider request or individual retries. Later attempt settlements are unmatched, explicitly not invented zero samples.

Outbox timers only register new receipts after commit, use injected monotonic clock, and clear on withdrawal/ignored/already-settled. Renamed report_to_response to receipt_to_response: acknowledgements and other receipt kinds are timed, not report creation. Bounded eviction now increments visible drop counter.

Delivery queue timers are assignment-keyed, cleared on stop/dispose, with visible eviction. New worker_history_receipt stamps deterministic prompt IDs before launch/input prompt dispatch and consumes matching managed user/message once. It checks current non-ended assignment ownership, including synchronous history arrival before assignmentStarted. A real Runtime fixture test verifies once-only sample across repeated event. Failed prompts clean pending stamp. This is worker-history receipt, neither source nor model start.

Timeline capacities validated1..10000. Probe.now safely exposes injected clock. Process resource scope is correctly declared wholeNode excluding children. Slot setter transition approximation remains; no atomic state API added here.

FullIssue9 remains PARTIAL. Ledger now rejects ticket_created as eligible denominator and documents missing real source receipt/provider-attempt/report-record boundaries, correctness/eligibility/throughput/TPS/CPS, retry/replay semantics and separate slotwait author work. No successful status implies correctness. UI/dashboard label translations for renamed stages require integration follow-through.
