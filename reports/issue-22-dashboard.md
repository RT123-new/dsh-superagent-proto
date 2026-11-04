# Issue22: process-local runtime observations

Candidate UI and optional HTTP seam based on the isolated Issue9 collector. Production Runtime hook must supply metricsSnapshot() before the section appears. No extra browser poll, websocket, server push or external deployment was added. GET overview retains its existing serialized5-second visible/30-second hidden cadence. The snapshot is optional, so older hosts and fixtures retain the old view.

Displays all12 required stage keys, with unobserved stages labelled rather than invented zero latency. Shows recent-window nearest-rank P50/P95, lifetime sample counts, process restart scope, queue incompleteness, slot capacity/utilization, observed component token categories, known cost subtotal and unknown report counts. It does not treat acknowledgements, reports or idle as correctly completed tasks. Failed prep/effect attempt duration labels explicitly include failures.

Executed targeted tests:20/20 across dashboard, existing overview and HTTP tests; typecheck passes. Three new tests cover no-data/unknown values, partial queue/component usage, quantile display and Chinese labels. This is new observability, not a failing-first correctness repair. No live frontend benchmark or production API load measurement yet. No push architecture adopted without such evidence.

Visual inspection: actual Chrome-rendered React static markup at1100px and440px. Desktop hierarchy and narrow-panel wrapping readable; duration table intentionally scrolls horizontally to retain numeric columns. Added keyboard-focusable labelled scroll region and explicit narrow-panel hint after first preview. Final screenshots must be refreshed and inspected after collector contract and independent review settle. Synthetic fixture screenshots are not a deployed dashboard.

Pending acceptance: independent review; merged collector shape and actual Runtime snapshot; full integrated pnpm check; refreshed visual evidence; actual snapshot payload/serialization and panel-cost measurement. Collector/hook coverage remains Issue9's authority, not inferred from the presence of UI rows.
