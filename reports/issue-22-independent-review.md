# Issue22 independent dashboard review

Reviewed candidate b0d9957 with corrected collector41af4a6, then reconciled repairs onto author refinement5b3cf9e. Main untouched; no paid calls, deployment, live polling or external effects. Only local synthetic fixtures were rendered.

## Findings and disposition

1. Original candidate hid failedDurations while preparation/effect labels said failures were included in successful series. Three independent new tests initially failed; original three passed. Author5b3cf9e independently added failure rendering. Review reconciles that change into explicitly labelled successful vs failed/cancelled attempt tables, with column/row scope, focusable named scroll regions, and an explicit no-observations state. These are attempt outcomes, not proof of task correctness.
2. Observed collector `other` stage data was silently omitted by the hard-coded twelve-stage UI. Fixed by retaining twelve mandated placeholders and appending actually observed additional collector stages. Executable regression passes.
3. Main usage unknown counters exist, but cache-write/reasoning coverage counts do not exist in the corrected collector snapshot. Rather than invent them, the UI explicitly says these coverage counts are unavailable and values are known component subtotals. Known cost is a subtotal; missing pricing is unknown, not zero. No collector fields were changed concurrently.
4. Incomplete queue depth can be a lower bound; oldest age covers tracked waiting items only. Added explicit distinction. The queue collector owner must reconcile immediately before publication; UI cannot repair stale source gauges.
5. Optional HTTP seam works through an explicitly supplied HttpHost callback and remains compatible without one. Real Runtime composition independently FAILS if only runtime.metricsSnapshot is added: Runtime.httpHost constructs a separate adapter and omitted the callback. Failing proof is on review/issue-22-runtime-proof1ae49a9; collector owns the production fix. This review does not claim deployed end-to-end Runtime integration.
6. Candidate omitted src/client/metrics.tsx and its new dashboard test from architecture tables. Both docs regressions reproduced and repaired, including new independent HTTP/payload tests.

## Verification ledger

- Initial independent component cases:3 new failures,3 existing passes against b0d9957 plus corrected collector.
- Final focused:32/32 (dashboard7, HTTP/payload2, existing HTTP4, panel overview13, docs6).
- Full suite:1269/1269,66 files, local53.91seconds.
- Typecheck PASS, build PASS.
- Corrected collector compatibility verified for separate failedDurations, unknown pricing, partial queues and optional host callback serialization.
- Real Runtime method-to-adapter failing proof retained separately for collector integration, not hidden by adapter-level passing test.

## Poll overhead

No new usePoll, timer, request, websocket or push loop was added. Overview uses existing serialized5-second visible/30-second hidden polling. A saturated local snapshot with48 successful and48 failed stage/source series,1024 samples each, and3000 queued IDs serialized to11296bytes. Mean serialization over100 local iterations was about1.15ms. At a5-second interval this is2259.2snapshot payload bytes/second before transport/compression. Raw queue IDs were absent. This is an indicative local synthetic serialization measurement, not a production load benchmark or proof of whole overview latency; no optimization claim is made.

## Actual pixels and accessibility

Fresh actual Chrome renders of React output inspected at1100px desktop and440px narrow, with project CSS and a simple synthetic host theme. Separate success/failure tables, unknown stages, queue limitation text and subtotal/unknown usage labels are readable. Wide screenshot shows all columns. Narrow table intentionally scrolls horizontally, rather than shrinking numbers beyond readability. Focused region and real ArrowRight key events move scrollLeft0→62 for400px client/462px scroll width, exposing the P95 column. Right-scrolled screenshot shows visible focus outline and scrollbar. Column and row headers are scoped; regions have distinct accessible labels. No external links, login or live site is involved.

Files: evidence/issue-22-independent/dashboard-wide.png, dashboard-narrow.png, dashboard-narrow-keyboard.png, keyboard-scroll.txt. Screenshots are synthetic fixture evidence, not deployed panel or screen-reader audit. Production Runtime hooks and broader metrics coverage remain collector/integrator responsibility.
