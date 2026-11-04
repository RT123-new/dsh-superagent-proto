# Combined real-host harness (offline, no paid calls). One fixture, one lineage per run; not a general proof.
Prereqs: @deepseek-ai/dsh@0.2.1-alpha.2 installed with --ignore-scripts at /tmp/dshhost; profile "superagent" (from default profile "web") with the repo linked (dsh plugin --profile superagent add link:/tmp/rp3); DSH_HOME=/tmp/dshhome; paths in lib.sh/overlay/shim are the ones used.
Probes (scratch, never committed): `git apply probes.patch && pnpm build` logs PROBE lines (sources.register feishu, policyKnown sourceInstalled=...) to stderr. Revert and rebuild after.
Steps (source lib.sh; every step stamps UTC time and pid in out/timeline.log, state+worker hashes in out/snapshots.jsonl):
 00 seed: copy seed-ticket.spec.ts into tests/, vitest run it, remove it (accepts a ticket, re-points Sources to shim/, copies orchestrator.sqlite to $STATE). snap.
 01 profile-feishu-default.yml (Source plugin disabled) -> boot 0, 40 s, snap, killhost. Expect: pending launch, attempts 0, no worker; PROBE policyKnown sourceInstalled=false (stored in out/boot0.log).
 02 profile-feishu-enabled.yml -> boot 1 (20 s, still pending: durable Later retry delay), kill; wait 33 s (stateDir lock stale window); boot 2: register feishu < policyKnown true < worker grant < llm/stream; kill; boot 3 adoption of the same worker; kill.
 03 end-ticket.spec.ts then boot: no worker grant (earlier lineage run, ../lineage in the first archive).
Results in out/: worker decompressed sha identical before/after adoption (9539055596ec1ad1) while the compressed file sha changed (095454384ba8d106 -> 45fb4d3ba307eb95): the compressed bytes differ across a rewrite, content did not. Overlay wraps only permissionPresets.set; grant routes outside this repo are not enumerated (in-repo: src/app/sessions.ts:216 only).
All boot logs are redacted (token=REDACTED); verify with grep before sharing.
