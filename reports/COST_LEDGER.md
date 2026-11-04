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
| — | — | no paid calls yet | — | — | — | $0.00 | $0.00 |
