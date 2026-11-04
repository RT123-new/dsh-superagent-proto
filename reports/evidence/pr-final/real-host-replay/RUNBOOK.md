# Real-host restart/orphan spike (scratch, offline, no paid calls)

Observations from one seeded ticket. Not exactly-once, not power loss, not a general claim.

Setup
1. `npm install @deepseek-ai/dsh@0.2.1-alpha.2 --ignore-scripts` in a scratch dir (exact pin). Repo scratch copy: `pnpm install --frozen-lockfile && pnpm build`.
2. `DSH_HOME=/tmp/dshhome dsh superagent --from-default-profile web --dump-config >/dev/null`; `dsh plugin --profile superagent add link:<repo>`.
3. Copy profile.cordis.patch.yml to $DSH_HOME/profiles/superagent/cordis.patch.yml (stateDir /tmp/dshstate2, webserver port 3991, Feishu entry enabled).
4. Put shims/gh and shims/lark at /tmp/shim/ (chmod +x). They answer only the setup probes (api user, repo access, auth status, strict-mode, bot info).
5. Copy seed-ticket.spec.ts to <repo>/tests/ and run `vitest run` on it. It accepts a real ticket via tests/fixtures/host.ts, points the Sources at the shims, and copies orchestrator.sqlite to /tmp/dshstate2. end-ticket.spec.ts marks the ticket ended through the real Store.
6. Boot: `dsh superagent --patch overlay/patch.yml --no-open` (put --patch BEFORE --no-open; after the first app arg the launcher rejects it). overlay/index.mjs logs every permissionPresets.set and every llm/stream request to /tmp/overlay/events.log; the model never answers.
7. After `kill -9`, wait about 33 s before the next boot (the stateDir lock goes stale after 30 s) or the plugin fails with "Lock file is already being held".

Observed
- logs/events.boot1.log: fresh open ticket: orchestrator and worker get danger-full-access, one model request.
- logs/events.A-ended.log: ticket ended, host SIGKILLed and restarted, persisted worker session on disk: NO permissionPresets.set for the worker; only the orchestrator.
- logs/events.B1.log and events.B2-restart-open.log: open ticket, SIGKILL, restart: resume() interrupts the running assignment (hostRestarted), the relaunch adopts the persisted worker session, grants danger-full-access, one model request.
- Without the Feishu entry enabled, the launch waits with Later("Source is not installed yet...") and creates no worker session (earlier boots; no log kept).
