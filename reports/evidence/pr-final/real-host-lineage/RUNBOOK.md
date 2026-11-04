# Single-lineage real-host replay (offline, no paid calls). One seed, one ticket, one lineage.
Host: @deepseek-ai/dsh@0.2.1-alpha.2 (--ignore-scripts), profile "superagent", repo linked from review branch.
Steps: seed-ticket.spec.ts (vitest in repo) -> boots via lib.sh `boot N` (overlay patch.yml, shims) -> `snap` -> `killhost` (SIGKILL) -> wait ~33s (stateDir lock stale window).
Boot 0 uses profile-feishu-default.yml (Source plugin disabled); boots 1-3 use profile-feishu-enabled.yml. End step: end-ticket.spec.ts.
Timeline (out/timeline.log, snapshots.jsonl, events.*.log all carry pids and UTC times):
 00 seeded: assignment running, no worker
 boot0 (Source disabled): assignment ended:hostRestarted->pending, NO worker, only orchestrator preset set. SIGKILL pid 53008
 boot1 (enabled): worker created, orchestrator+worker danger-full-access set, 1 llm request. SIGKILL pid 53088
 boot2 (enabled, open): adoption, new running assignment, worker set again (pid 53193). SIGKILL
 06 ticket ended (dropped), same worker file
 boot3 (enabled, ended): only orchestrator set; NO worker set (pid 53367). Worker sha 4a701eddec728ac7 unchanged across 06-08. SIGKILL
Caveats: instrument sees only permissionPresets.set wrapped by overlay; other grant routes outside this repo not enumerated.
In-repo grant sites: src/app/sessions.ts:216 (only danger-full-access set, after last authorize in ensureGuarded); :182 drop to default (ticket not live); agentPresets.select ~149-154 restores agent preset only.
Boot0 Later gate is shown by snapshot only; Later log not stored. Worker sha differs between boot1 (8d1649194dee8189) and boot2 (4a701eddec728ac7) with 1 event each; not investigated (header unchanged). Positive control is same worker, same lineage (boot2 vs boot3). Registration-order timestamps not done.
