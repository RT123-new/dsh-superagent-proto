# COST LEDGER — live model spend

Budget: **$5.00 TOTAL** for the whole programme (Reg, iMessage 2026-11-04 ~06:18 UTC). Not per run.

Model: `deepseek-flash` (DeepSeek-V4.1-Flash-1017), base URL https://api.deepseek.com.
Pricing per 1M tokens (https://api-docs.deepseek.com/quick_start/pricing.md, fetched 2026-11-04):

| | Peak | Off-peak |
| --- | --- | --- |
| Input (cache miss) | $0.30 | $0.15 |
| Input (cache hit) | $0.006 | $0.003 |
| Output | $1.20 | $0.60 |

Peak = 01:00-04:00 and 06:00-10:00 UTC Mon-Fri. **Prefer off-peak runs (after 10:00 UTC / weekends): half price.**

Ledger convention: conservative — every call is logged at PEAK rates when the exact window is ambiguous; retries and failed calls count. Search/Fetch server-side tool calls bill at $0.75/1000 requests from 2026-11-01; avoid enabling them.

| # | Date (UTC) | Purpose | Model | Input tok (hit/miss) | Output tok | Assumed cost (USD) | Cumulative |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-04 06:30 (peak) | Direct API probe: key + model verification, "Reply with exactly: ok", max_tokens 16 | deepseek-flash | 35 (0 hit / 35 miss) | 12 (10 reasoning) | $0.0001 (peak assumed: 35×$0.30/M + 12×$1.20/M = $0.0000249, rounded up) | $0.0001 |

Probe evidence: reports/evidence/probe-001-deepseek-flash.json (HTTP 200, 1265 ms). /models listing (free) confirmed deepseek-flash + deepseek-v4-pro available on the key. Probe type: DIRECT PROVIDER PROBE, not end-to-end harness validation.

## Allocation state (2026-11-04 06:51 UTC)

- Spent, conservative: $0.0001.
- Conditional live-integration worker allocation: $1.00 TOTAL, including retries/failures. Activation requires exact rates/context reservation verification, affordable workload confirmation, and reviewed correctness baseline. All other paid calls frozen.
- Unallocated conservative reserve: $3.9999. Allocation is not spend and may be released when the worker closes its ledger.
- Unknown usage preserves the full pre-call reservation and stops the worker. No automatic retry after unknown usage. Per-call reservations and actual usage must be reconciled into this ledger before expanding the allocation.

## Exploratory provider-adapter integration v1 (stopped)

| # | Date UTC | Purpose | Input miss/hit | Output | Cost USD | Conservative programme cumulative |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 2026-11-04 ~06:53 | Repaired normal/seed11 coordinator | 105 /0 | 102 | 0.0001539 | 0.0002539 |
| 3 | 2026-11-04 ~06:53 | Repaired normal/seed11 arithmetic AST worker | 110 /0 | 34 | 0.0000738 | 0.0003277 |

Independently inspected raw successful terminal usage and stopped ledger. Known worker charge0.0002277; pending reservation0; stopped=true. Initial$1 allocation remains reserved for this worker; unused allocation0.9997723, programme unallocated reserve3.9999. All other paid calls frozen. Failed model grammar task0/1, no result effect. Nine repaired and all baseline scenarios NOT TESTED live. No paired live improvement claim. See reports/paired-real-model-validation.md and evidence/paired-live/. Offline adapter seam and13-test harness independently rerun by integration; these are synthetic-output tests, not live success.

## Prospective v2 bounded run (stopped after six calls)

Independent integration recalculated every raw usage report at verified peak rates using decimal arithmetic: v2 cost **$0.000693936** (1016uncached input,256cached input,323output;1595total tokens). Six successful terminal records, explicit cache-write0. Normal paired worker prompt bytes identical (SHA256 e5d85819d5dd245585ac546dd35c6b827110af05d3275cfff44b51070f2ea359). V1 grammar failure retained separately. V2 baseline1/2eligible completed, repaired2/2; tiny synthetic Source/Engine/provider-adapter result, not full-service or speed/cost evidence. Independent offline v2 suite16/16 passes.

Combined worker charge **$0.000921636**; conservative programme cumulative including rounded probe **$0.001021636**. Pending reservation0; v2stopped=true. Remaining original$1allocation **$0.999078364**, unallocated reserve still$3.9999. All additional paid calls frozen. Evidence: paired-v2-live/budget.json and six raw call records; reports/paired-prompt-v2-results.md.
