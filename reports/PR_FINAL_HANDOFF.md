# PR final handoff (FINAL - frozen tree 85b5358)

## State at handoff (verified against the remote)
- PR #1 (programme/reliability -> main) on RT123-new/dsh-superagent-proto: OPEN, UNMERGED, for final human review. No merge, no automerge, no deploy, no upstream mutation performed by this review. This review integrated fixes onto the existing review branch only; a GitHub merge was and remains prohibited.
- programme/reliability: 85b5358 (accepted series pushed as a fast-forward de50174..85b5358). main: 8c32a9d, unchanged.
- CI state: this repository has NO GitHub CI. Every green in this review is a local or sandbox run (lead frozen run + adversary independent frozen refresh, both recorded in PR_FINAL_VALIDATION.md).
- Reports: this file plus PR_FINAL_REVIEW.md (requirement ledger), PR_FINAL_VALIDATION.md, PR_FINAL_BENCHMARKS.md on branch review/final-baseline in this repository.

## Operating limits and held dispositions (travel with every related claim)
- Held experiments: subscription pool (no account-wide rate budget), retention optimisation, slotwake - evidence gates not met.
- Check-runs 16MiB cap: explicit operating limit + health visibility, not a large-response proof.
- Heuristic backoff in-memory; Feishu live-replay unverified; 14-day horizon unproved; live GitHub replay unverified (no live calls made).
- At-least-once delivery under tail damage (torn-log characterization); no exactly-once or power-loss claims.
- Workspace containment is application-level; TOCTOU swap-after-check not defended; no OS security boundary claimed.
- UI verified in real browser with a STAND-IN palette (not host theme); 28px touch-target risk documented, not changed.
- gate() scope-coupling residual: gate() alone is not scope-safe; safe today only because intake filters first. Documented, not a standalone defect; any new caller must preserve the ordering.

## Supply chain
- New test-only devDeps (exact pins, registry-verified): dsh-session-persistence-jsonl, dsh-agent-loop, dsh-session-projection (all 0.2.1-alpha.2), tsx 4.23.15.
- Registry integrity vs lockfile confirmed for tsx@4.23.15, esbuild@0.28.2, @esbuild/linux-x64@0.28.2 (two independent compares); other platform optionals not compared - Linux-only scope.
- Install scripts: koffi and esbuild are explicitly DENIED via committed pnpm-workspace.yaml allowBuilds. No install script is enabled; the plain default 'pnpm install --frozen-lockfile' and 'pnpm build' are the verified commands (no flag variants). Other platforms untested.

## Draft-time pendings - final dispositions
- Restart reconciliation of persisted orphan sessions: resolved at the review's evidence standard - real-host observations (ended-ticket orphan gets no grant; kill-after-create persisted orphan on an ended ticket gets no grant) plus the in-process restart-ordering guard (reconcile before passes/effects, adversary-neutered RED). Authority-side question (cross-restart preset persistence on ended tickets) is host-owned state, documented, not proven.
- Late tool registration after stop: observed on the real host - stop cancels the in-flight turn before a late tool call runs, and aborts an already-executing tool mid-await (one fixture each; observations, not guarantees).
- Production kind-registration order: observed on two fresh enabled processes (register < policyKnown < grant < llm); one-fixture scratch-probe timestamps, not a general effects.start ordering proof.
- Real-loop status flip (idle->running at step boundary) and steer() re-entrancy: STILL UNTESTED residuals of the NF-1 wake fix - carried open.
- Full agent-loop claim/append crash proof: prefix-sweep characterization stands (one log shape, 2 real kill timings); not exhaustive - carried open.

## Open items carried verbatim from the adversary's final acceptance
B2 old-turn-after-replacement (not independently verified); kill inside the framework create's filesystem write (inaccessible); orchestrator session grant on ended tickets (pre-existing); registered-but-refusing tool bindings (documented residual); Source gates (live replay unverified); DB/perf computational only. This handoff is NOT a production-readiness certification.
