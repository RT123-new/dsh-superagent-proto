# PR final handoff (DRAFT)

## State at handoff
- PR #1 (programme/reliability -> main) on RT123-new/dsh-superagent-proto: OPEN, UNMERGED, for final human review. No merge, no automerge, no deploy, no upstream mutation performed by this review.
- Combined candidate: integ/scratch, currently 727f9eb (to be pushed to programme/reliability at freeze).
- Reports: this file plus PR_FINAL_REVIEW.md (requirement ledger), PR_FINAL_VALIDATION.md, PR_FINAL_BENCHMARKS.md on review/final-baseline, folded into the PR branch at freeze.

## Operating limits and held dispositions (travel with every related claim)
- Held experiments: subscription pool (no account-wide rate budget), retention optimisation, slotwake - evidence gates not met.
- Check-runs 16MiB cap: explicit operating limit + health visibility, not a large-response proof.
- Heuristic backoff in-memory; Feishu live-replay unverified; 14-day horizon unproved; live GitHub replay unverified (no live calls made).
- At-least-once delivery under tail damage (torn-log characterization); no exactly-once or power-loss claims.
- Workspace containment is application-level; TOCTOU swap-after-check not defended; no OS security boundary claimed.
- UI verified in real browser with a STAND-IN palette (not host theme); 28px touch-target risk documented, not changed.
- gate() scope-coupling residual: gate() alone is not scope-safe; safe today only because intake filters first. Documented, not a standalone defect; any new caller must preserve the ordering.

## Supply chain
- New test-only devDeps (exact pins, registry-verified): dsh-session-persistence-jsonl, dsh-agent-loop, dsh-session-projection (all 0.2.1-alpha.2). Native prebuilt transitives (koffi, node-addon-system binaries) install with --ignore-scripts; accepted as test-only.

## Known-pending at draft time (must resolve or carry open before freeze)
- Restart reconciliation of persisted orphan sessions: real-host proof in progress (resume behavior observed through the real controller; orphan verdict not yet in).
- Late tool registration after stop: not yet tested (real-host hook point being built).
- Production kind-registration order against the real loader: not yet tested.
- Real-loop status flip (idle->running at step boundary) and steer() re-entrancy: untested residuals of the NF-1 wake fix.
- Full agent-loop claim/append crash proof: prefix-sweep characterization done (one log shape, 2 real kill timings); not exhaustive.
