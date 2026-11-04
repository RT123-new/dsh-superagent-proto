# Prospective prompt v2 qualification (offline only)

V1 remains a failed live task in its own evidence and denominator. V2 is a NEW prompt experiment, not a retrospective repair. No v2 provider call has been made.

## Exact changes

Only the worker prompt changes when PAIRED_PROMPT_VERSION=v2:

- Full recursive JSON Schema for an object with exactly expression, containing either the strings n/low/high or a binary min/max node with exactly op/args.
- Explicit instruction that leaves are literal strings, never objects; depth at most five, matching the unchanged validator.
- An incomplete grammar-only example, min(n,high). It deliberately does not solve both bounds. The example is marked incomplete so the model must still produce the task solution.
- Existing broken clamp code and fixture/test seed stay unchanged.

The exact serialized prompt fields for seed11 are in `reports/evidence/paired-v2-offline/exact-worker-prompt-seed11.json`; the construction is `scripts/paired-validation/prompts.mjs`.

Unchanged: task, 206 execution cases, leaf/operator acceptance, validation implementation, deterministic policy/Engine, fixture event delays/senders, outbox rules, model/model settings/output bound, coordinator prompt, and billing limits. No variant name enters the prompt. The original output remains rejected by the same parser. A SHA256 assertion pins the validator source against accidental changes.

## Offline proof

16/16 tests on baseline and repaired worktrees. Both use identical optional harness files and the same prompt bytes for paired workload identity/seed. Local provider/budget tests had passed previously and provider behavior is unchanged. These checks prove grammar consistency, byte limits and offline integration, NOT that the model now follows the grammar.

## Bounded proposed live trial

No automatic restart/clear of the stopped v1 ledger. After independent review and explicit clearance, create a distinct v2 ledger with only the remaining shared allocation ($0.9997723), retaining v1's $0.0002277 permanently in combined cost totals. Before each call reserve $0.6012288 exactly as v1. Sequential calls only, no automatic retry, stop on any malformed output/provider/billing error or unknown usage. Known usage settles normally; unknown usage keeps the full reservation. Combined v1+v2 cannot exceed the original $1 allocation. All other programme paid calls remain frozen.

First qualification pair: normal/seed11 baseline and repaired, two model calls per variant (four maximum). Keep both independent model outputs and score the same unchanged test cases. If either task fails, stop, retaining it as a v2 failure. Success would only qualify the explicit schema prompt for further exploratory pairs, not establish general reliability.

If the qualification pair completes with known billing and sufficient reservation, ask for the same originally approved conditional workload ceiling (remaining scenarios/seeds), rather than assume unlimited continuation. No additional statistical claims or paid scope are granted by this proposal.

Paired success indicators, model tokens and costs must be reported even when one source misses an event; missed eligible work stays in the denominator. No cost or latency improvement is claimed from doing less useful work. With this small exploratory sample there is no adoption-threshold evidence. Full DSH service/Agent loop and external effect guarantees remain untested.
