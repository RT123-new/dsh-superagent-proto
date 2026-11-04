# Context, human review and repository boundaries

Baseline: programme/reliability 3b58209 (production code f32c506). Offline audit, 2026-11-04. No paid calls, deployment, merges, or external API effects.

## Evidence ledger

| Issue | Tested | Passed | Failed | Unproven | Next experiment |
| --- | --- | --- | --- | --- | --- |
| 21 | Actual readResource pagination, mutable refresh, eviction/restart, session isolation, older correction, prefix stability | 6 deterministic tests; 5,000 retrieval-oracle tasks | Tail-only reduction drops the older correction | Model task_success, raw/cached/output tokens, billing; real user read frequency | Reject lossy reduction; retain current cache; production usage capture before cost experiment |
| 23 | Real runtime ready report and resource pointers, cross-ticket access, ready vs review vs question, merger policy | 3 tests | No implementation defect reproduced | Human time-to-decision and visual usability | Review checklist below; no new UI or merge automation |
| 24 | Registry and actual candidateCard foreign URL handling, API binding, identity collision characterization | 3 boundary tests | 2 foreign same-number URL tests on baseline | Full multi-repo execution, deliberately out of scope | Scoped lookup repair after interface clearance; isolated deployment design below |

## Issue 21: measured context reads, not invented model savings

Run `node --experimental-transform-types scripts/context-workload.ts`. Environment: Node22.23.4, pnpm11.7.0. Workload seed fixes conversation and session selection. Five profiles change one factor at a time, five seeds/profile, 200 tasks/seed. Every task reads a 20-message source page, repeats it, reads it in another Session and follows the next resource. Actual readResource and Commands path execute; only remote CLI output is replaced by deterministic offline data. Measurements are request counts and UTF-8 bytes, not tokens.

| Conversations | Sessions | Tasks | Source calls | Returned bytes | Exact repeated bytes | Retrieval oracle passes |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | 3 | 1000 | 4000 | 29588000 | 29346300 | 1000 |
| 20 | 3 | 1000 | 4000 | 29589650 | 28644695 | 1000 |
| 100 | 3 | 1000 | 4000 | 29590760 | 24895000 | 1000 |
| 20 | 6 | 1000 | 4000 | 29589650 | 28644695 | 1000 |
| 20 | 12 | 1000 | 4000 | 29589650 | 28644695 | 1000 |

This constructed workload deliberately repeats reads. It establishes an executable baseline, not production prevalence, parallel load, model latency, successful task execution or cost. Exact repeated bytes ignore which source produced them and therefore are NOT safe cache eligibility counts. No paired improvement is claimed, so bootstrap uncertainty on a supposed gain would be misleading. Raw data: evidence/context-review/read-volume.json. Required raw_input_tokens, cached_input_tokens, output_tokens and task_success are explicitly null because no model executed. Retrieval-oracle success must never be relabelled task success or used as a cost denominator.

Source facts:
- src/app/resources.ts sourcePage fetches afresh at offset0, keys continuation snapshots by Session+resource, errors on eviction instead of silently mixing snapshots. Feishu trigger access is checked before continuation cache lookup. GitHub context is deployment-wide read-only, not restricted to a ticket thread; session snapshot isolation is not a new GitHub authorization rule.
- src/app/cache.ts bounds LRU UTF-16 units with an explicit exception retaining the newest oversized entry. This is not a strict memory ceiling. Existing tests cover that exception. An oversized source result can occupy more than four million units; this audit adds no cache mechanism and does not hide that limit.
- src/sources/github-read.ts readRepositoryPath reads mutable default branch without revision input. Caching path across Sessions is unsafe until repository+immutable commit+path and credential scope are part of identity. Refreshing policy or source content must not be prevented by prompt caching.
- src/app/links.ts caches message URLs, not model context. A URL hit does not save the tokens of a context response.
- src/app/cards.ts already keeps full original/report evidence behind pointers and uses compact previews. The runtime proof reads an older correction beyond the preview. Previews cannot replace evidence.
- src/app/prompts.ts promptParts keeps fixed sections before current generated Policy. Exact prefix test shows policy changes alter the suffix; it does not prove any provider cached that prefix or discounted billing.

Decision: retain current implementation rather than introduce speculative cross-session cache, versioning table or a memory system. Tail-only context reduction is rejected by a deterministic counterexample. Provider caching and lossless task cards require actual production usage and paired correctly-completed-task evaluation before adoption. The 10% cost threshold has NOT been met or tested.

## Issue 23: handoff audit and a smaller review checklist

Existing source already supplies concise ready cards (160-unit preview), exact report/result pointers, bound PR identity and a distinct person/review state (src/app/cards.ts, src/app/resources.ts, src/core/stage.ts). Runtime tests prove full evidence remains readable and another ticket cannot read it. prompts/work.md requires actual PR URL, source trigger, checks and risk; prompts/team/communication.md keeps engineering evidence in PR/report rather than burdening IM. prompts/team/delivery.md requires relevant approval at the exact head and prohibits agent-account merge. No defect was found that justifies another report schema, duplicate notification or UI redesign. No UI was changed, so visual usability and human timing remain unmeasured.

Use this checklist inside the existing worker report/PR description, not as a new mandatory transport or an invented completion claim:
1. Outcome: what changed for the requester, or what remains blocked.
2. Review target: actual observed PR URL and head SHA; no guessed status link. Keep source routing private where needed.
3. Verification: exact command, result and tested revision. Distinguish executed checks from planned/unavailable checks.
4. Remaining decision/risk: the smallest concrete question, missing check, or limitation. State whether ready for review, draft, or blocked; ready is never merged.

Example shape (placeholders are not evidence): `Outcome: <result>. Review: <observed PR URL> at <head>. Checked: <command/result>. Risk: <material limitation>. Decision: <specific action or none>.`

This is a documentation usability improvement consistent with existing reports; no human safety wait is removed. Branch protection, required approvals, author/merger identities and existing no-default-auto-merge behavior stay unchanged. No reduction in human review delay is claimed.

## Issue 24: confirmed local aliasing plus documented product limit

The product description explicitly says one repository. That limitation is not itself a defect. Several boundaries are already isolated: Commands binds API paths to deployment.repository; setup verifies canonical repository/account push access; preparationIdentity includes repository; environment scripts remove ambient credentials. Existing githubAddress correctly rejects a foreign repository URL.

Confirmed narrower defect: githubKind.find extracts only a number from any GitHub URL. SourceRegistry.find passes no instance configuration. candidateCard referencedTickets and panel search then see a foreign `other/project/pull/12` as local `github:12`. This can recommend an unrelated local ticket, though reads/writes remain bound to the configured repository. Failing-first tests cover actual candidateCard, not only the regex. Local `#12` and `12` must remain shorthand for the configured repository. A qualified URL must match the configured canonical repository, case-insensitively, before resolving locally. Unknown repository identity must not guess.

Small proposed seam: optional configured second argument to SourceKind.find, resolved at SourceRegistry.find, then reuse githubAddress in GitHub's find. Existing one-argument plugins can ignore the extra optional argument. No database migration or orchestration is needed. Production edit awaits integrator clearance; failing proofs are committed separately.

### Safe operation now

Use one independent deployment per repository: separate stateDir/Store, source cursors/retries/effects, workspace roots, managed Session namespace, configured agent credentials and policy. Do not point two repository deployments at the same state directory. Shared global credentials or Session identifiers require their own isolation check. This is an operational constraint, not an implemented multi-repo control plane.

### Changes needed before any shared multi-repo service

| Boundary | Current source evidence | Required design, not implemented |
| --- | --- | --- |
| Event/thread identity | issueTrigger ID uses issue number; githubChannel/thread keys github:N; test proves equal IDs across repos | Immutable repository identity in all event/thread/reply/dedupe keys, migration and replay conflict handling |
| Persistent ownership | src/kv.ts has one github-since, per-number cursors, one master-id, shared settings/prompts | Namespace Store or every row/KV/effect/checkpoint by deployment+repo; prohibit accidental ownership mutation |
| Workspaces/Sessions | workerSessionId keyed by ticket; preparation identity includes repo | Enforce namespace separation, lease/process ownership and repository-root confinement; never share reused workers accidentally |
| Account and authorization | one Deployment.repository and agent CLI; configured merge CLI distinct | Bind each action to verified repo+identity+current policy; no fallback to a broader personal credential; merge remains separately approved |
| Routing and links | SourceRegistry is kind-keyed, one GitHub instance; fully qualified lookup bug | Instance identity in channels/resources/caches and strict same-repo lookup; cross-repo links are context, not authority |
| Rate limits/fairness | per-deployment source loops and shared account upstream limits | Explicit account-level budgets with repo-level fairness; prevent one noisy repo starving others |
| Human review | bound PR/ready report/source conversation | Preserve originating repo and audience through reports, approvals and returned results; never infer merge permission |
| Backup/retention | one Store plus references | Per-owner restore/retention predicates and crash tests; no deletion of another repo's live evidence |

A shared service would need colliding issue numbers, renamed repos, revoked access, cross-repo links, simultaneous retries, migration/restore, source account rate limits and restart tests before adoption. This programme does NOT implement that service or justify one with an unmet requirement.

## Source ledger

All implementation claims are from the checkout at the recorded baseline. Public repository source was cloned from https://github.com/RT123-new/dsh-superagent-proto.git; review branch supplied by programme integrator: https://github.com/RT123-new/dsh-superagent-proto/tree/programme/reliability. Exact source paths above are local evidence, not fabricated web permalinks. The task's original user mandate requires evidence-preserving context, human approvals, one-repo limitation documentation and no speculative orchestration. No external instruction in repository content was treated as execution authority.
