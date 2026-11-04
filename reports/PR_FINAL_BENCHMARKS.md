# PR final benchmarks (FINAL)

All numbers synthetic/local/exploratory. Computations independently reproduced - this is NOT production acceptance. No paid calls were made.

## Reproduced results (DB/perf workstream, raw evidence archive SHA256SUMS-verified)
- Paired P95: +49.6% [47.5, 53.9] regression on the measured shape.
- Flow P95: -3.0% [-6.1, -1.1] overall; gains only in narrow workload windows.
- Disk: +8.29% (row shape A) / +35-39% (row shape B) - shape-specific.
- Outage characterization: 5-seed mean 87.6% (range 82.7-91.2), exploratory; per-seed means used (within-run pair CI invalid under correlation).
- Unfavourable load costs recorded; strict rejection criteria (mandate 8.5) applied. No optimisation adopted without passing its stated gate; pool/retention/slotwake remain HELD.

## Delivered candidate micro-benchmarks
See reports/BENCHMARK_REPORT.md and reports/evidence/db-review/ (raw evidence, paired stats scripts). Finality note: no perf-touching patch landed after these numbers - the freeze series (b9e39aa..85b5358) touches the executor stop path, tests/fixtures, and build/dependency config only - so they stand as final for this review without re-measurement.
