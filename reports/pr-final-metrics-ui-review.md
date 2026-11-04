# PR final review - metrics (phase 5) and dashboard (phase 10) workstream

Base: programme/reliability @ de50174f86cb5499f1c482a4bd432a77386737c9. Review branch: review/metrics-ui. Failure evidence: reports/evidence/pr-final/metrics-ui-before-fix.txt (run on the unmodified source with the new spec; M1, M2, M3 fail, M4 passes).

| ID | Sev | Class | Finding | Code | Result |
|---|---|---|---|---|---|
| M1 | Low | Confirmed defect | Counters add past MAX_SAFE_INTEGER and lose integer precision (9007199254740996 observed). | Metrics.count, src/infra/metrics.ts | Saturate at MAX_SAFE_INTEGER, count `counter_saturated`. |
| M2 | Medium | Confirmed defect | DomainTimeline and SessionTimeline clamped negative deltas with Math.max(0, ...), so a backwards clock became a 0 ms success sample (count 1, p50 0). Violates "never substitute zero for unknown". | src/infra/metrics-lifecycle.ts (since, arrived, eval.started, SessionTimeline.finish) | Pass raw delta; Metrics.observe rejects negatives and counts `invalid_duration`. |
| M3 | Medium | Confirmed defect | MetricsPanel threw RangeError (Date.toISOString) on non-finite wall bounds, crashing the whole panel. | src/client/metrics.tsx header | Invalid bounds render as "Not observed". |
| M4 | - | Refuted | nearestRank equals exact integer ceil(p*n/100) for p=50,95, n=1..10000. | metrics.ts nearestRank | NO CHANGE. |
| M5 | Low | Code-supported risk, unrepaired | Overview renders no panel when `data.metrics` is undefined, so "instrumentation off" and "snapshot failed" are indistinguishable from "no telemetry section". Needs an API field to tell them apart. | src/client/overview.tsx:103, runtime.metricsSnapshot | Tried a visible "unavailable" hint in overview.tsx; it breaks panel-overview.spec expectations that lock the section list when metrics are absent (a host without instrumentation). Reverted: NO CHANGE pending lead decision. Smallest option: a hint section only when the API says instrumentation is on but the snapshot failed (needs an additional field). |
| M8 | Low | Confirmed gap, repaired | Utilization above 100% (reservations above lowered capacity) rendered as e.g. 150% with no explanation. | src/client/metrics.tsx slots list | Marker "over capacity" shown when overLimitSlotMs > 0; value not clipped. |
| M6 | - | Platform limit | step_to_settlement covers step admission to first settlement event; DSH events carry no provider request-start, so provider latency stays unavailable. UI label already says "not API request". | metrics-lifecycle.ts SessionTimeline | Remains unavailable. |
| M7 | Info | Unrepaired | No correctness oracle exists; completion rate, correct completion rate and correct-task throughput are not computed anywhere (dashboard shows none). Not invented. | - | Remains unmeasured. |

## Update 2 (browser + taxonomy)

M8 before-fix proof on de50174 metrics.tsx: reports/evidence/pr-final/m8-before-fix.txt (fails: no "over capacity"). Earlier 360px screenshots predated the M8 UI; the screenshots slot-zh-dark-360.png and slot-en-light-1100.png in reports/evidence/pr-final render the latest code and show "150% ... [over capacity]".

M9 (Low, confirmed gap, repaired): the slot pool snapshot held only time integrals, so the panel could not show how many slots are busy or preparing now, although DshExecutor.slots.states() already supplies them to the probe. Added SlotIntegrator.current() and snapshot slots[k].counts, shown as "as last recorded: busy N, preparing N" (values as of the last transition, labelled). Failing proof: m9-before-fix.txt.

Browser checks (headless Chrome driven over the DevTools protocol, real Tab key events): Tab order is first button -> Successful attempts region -> Failed attempts region -> last button; the scroll regions take focus and show the focus outline; at 360px the page itself does not overflow horizontally (document width 345 < 360) while tables scroll inside their regions; the 1100px layout shows all columns. A 3000-sample window, 70 counters (overflow into "other"), and a 1.6k-character error line in a `dt-clamp` row were rendered (error clamped to 3 lines, counters list long but wrapped). Keyboard arrow scrolling of the region: the screenshot shows the table scrolled, but the scrollLeft readout I took was 0 (probably read before the scroll applied) so arrow-key scrolling is not independently proven. Chinese and English, light and dark inspected. Not verified: the real DSH host shell/theme variables (stand-in colours only), restart/reset in a live host (a fresh Metrics renders as empty/"Not observed", covered by existing tests).

State taxonomy, existing sources vs UI (from code):
- Paused: executor-paused problem row (overview) - shown.
- Waiting for a worker slot: store tickets queued (executorLoad.queued) - shown as "Queued".
- Preparing a workspace: slots.states().preparing - now shown (M9).
- Waiting for a person: data.person list - shown.
- Waiting for model capacity / retrying a temporary failure: health 'models' set by Sessions (model-budget retry) and effects health; shown only through the runtime-error problem row text when in error state. No dedicated state label.
- Blocked by a permanent error: ticket failed state and problems; no separate "permanent vs temporary" classification exists in the UI source data (retry classification belongs to the retry workstream).
- Unknown/incomplete telemetry: panel "Not observed" and partial labels; the Overview omits the panel completely when the host provides no snapshot (M5).
Remaining blockers to a full taxonomy: temporary-vs-permanent classification needs the retry workstream's data; model-capacity wait needs a runtime-level state, not durations. Nothing was built from durations.

Phase M5 option: add `metricsState: 'off' | 'ok' | 'failed'` to GET overview (http.ts line ~161 and api.ts line 22), set in Runtime.metricsSnapshot; panel-overview locks would need an updated case for 'failed' only. Not implemented; needs lead agreement because it touches API/runtime.

## Update 3

M5 repaired (lead-authorised, source-grounded): Runtime.metricsReading() returns off | ok | failed; GET overview adds `metricsState`; metricsSnapshot() is unchanged for callers and stays authoritative in the HTTP layer (hosts that override it, as existing tests do, keep working); metricsReading is consulted only to explain a missing snapshot. Overview shows a "snapshot failed ... not a healthy reading" hint only for `failed`; `off` renders as before (existing panel-overview section locks pass). Failing proof: reports/evidence/pr-final/m5-before-fix.txt (metricsState undefined on baseline). Tests: tests/pr-final-metrics-state.spec.tsx (ok/failed/off via the real runtime by swapping the private collector; legacy host without metricsReading). docs/007-architecture.md test table updated (docs.spec requires it).

Arrow-key scroll now proven in headless Chrome: after Tab to the Successful-attempts region and 20 ArrowRight key events, scrollLeft 0 -> 192 (max = 505-313). M9 adversarial test added (copy-not-reference counts, unknown state rejected, backwards clock keeps integrals non-negative, new collector resets to empty).
Still unverified: real DSH host shell/theme variables and live-host restart (no host available in this environment).

M5 single-read contract (supersedes the earlier two-call design, which the adversary showed ran effects.measure and counted metrics_error twice per failed overview; proof on 0d75c2d: reports/evidence/pr-final/m5-double-read-before-fix.txt, [snapshots, measures] = [2, 2]): Runtime.metricsSnapshot() performs exactly one read and records its outcome; Runtime.metricsState() only reports that recorded outcome and never recomputes. The HTTP layer reads metricsSnapshot() once (hosts may override it), and a missing snapshot is explained by the recorded state: failed -> failed, anything else -> off (a stale 'ok' without a snapshot is reported off, never ok). No second attempt can turn a failure into ok. Tests: real runtime + HTTP counts one snapshot, one measure and one metrics_error per failed request; override and legacy-host cases. Evidence of the keyboard run: reports/evidence/pr-final/cdp-keyboard-check.{mjs,log}.

## Blocked-effects rearm UI, real-browser check (combined candidate 191db58)

Real React `App` bundled for the browser and driven in headless Chrome over CDP with real key and touch events (harness and logs: `reports/evidence/pr-final/rearm-ui/`). The server is the repo's own fake panel server, so no live or paid action ran. Palette is a STAND-IN for the host `--dsw-*` tokens: this is not host-theme or full-host proof.

Confirmed working (en and zh; 360px touch and 1000px keyboard; light and dark): Tab reaches Rearm; Enter opens a dialog with focus inside; 6 Tabs and Shift+Tab stay inside; Escape and Cancel close it, focus returns to Rearm, and no POST is sent; Confirm sends exactly one `POST effects/relay/rearm {"key":"r1"}`; the unknown-outcome warning shows only on the row with `attemptUnknown`; the long key wraps with no horizontal overflow; no page errors. Touch tap at 360px opens the dialog. Touch targets are 72x28 and 88x28 CSS px (below the usual 44px guideline: a risk, not changed).

Finding: with no host tokens the modal is transparent and overlaps the page. This is a platform dependency, not a repo defect, and it cannot be settled without the real host.
Not verified: real host shell and tokens, real touch device, screen reader, live restart.
