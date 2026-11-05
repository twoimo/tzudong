# CI timing baseline

Captured: `2026-10-10T09:22:16Z`
Repository/workflow: `twoimo/tzudong` / `web-admin-ci.yml`

This is an unpaired observational baseline from recent successful CI runs. It is not a before/after comparison and makes no measured improvement claim.

## Run observations

| Run | Event | Critical job | Critical path (s) | Runner occupied (s) | Max queue (s) | Benchmark/report (s) | Contribution |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 38039467558 | pull_request | Ubuntu npm | 827 | 3337 | 3 | 1576 | 47.23% |
| 37976075302 | push | Ubuntu npm | 800 | 3108 | 4 | 1308 | 42.08% |
| 37975717229 | pull_request | Windows npm | 903 | 3035 | 8 | 1367 | 45.04% |
| 37975584201 | push | Windows npm | 811 | 3285 | 3 | 1506 | 45.84% |
| 37975317691 | pull_request | Windows npm | 848 | 3125 | 3 | 1438 | 46.02% |
| 37975198548 | push | Ubuntu npm | 787 | 2843 | 3 | 1166 | 41.01% |
| 37974853501 | pull_request | Windows Bun | 912 | 3220 | 10 | 1573 | 48.85% |
| 37969263340 | push | Windows npm | 866 | 3073 | 3 | 1476 | 48.03% |
| 37968902769 | pull_request | Windows npm | 856 | 3208 | 48 | 1435 | 44.73% |

## Run-level distributions

| Metric | n | Min | p25 | Median | p75 | Max | Mean | SD | Bootstrap mean 95% interval | Bootstrap median 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| criticalPathSeconds | 9 | 787.00 | 811.00 | 848.00 | 866.00 | 912.00 | 845.56 | 43.72 | 819.67–872.23 | 800.00–903.00 |
| runnerOccupiedSeconds | 9 | 2843.00 | 3073.00 | 3125.00 | 3220.00 | 3337.00 | 3137.11 | 148.22 | 3040.00–3222.33 | 3035.00–3285.00 |
| totalQueueSeconds | 9 | 14.00 | 16.00 | 18.00 | 20.00 | 81.00 | 25.00 | 21.23 | 16.56–39.67 | 16.00–25.00 |
| maxQueueSeconds | 9 | 3.00 | 3.00 | 3.00 | 8.00 | 48.00 | 9.44 | 14.69 | 3.56–19.45 | 3.00–10.00 |
| benchmarkReportSeconds | 9 | 1166.00 | 1367.00 | 1438.00 | 1506.00 | 1576.00 | 1427.22 | 131.45 | 1341.00–1503.44 | 1308.00–1573.00 |
| benchmarkContributionPercent | 9 | 41.01 | 44.73 | 45.84 | 47.23 | 48.85 | 45.43 | 2.59 | 43.77–46.94 | 42.08–48.03 |

## Job distributions

| Job | Runtime median (s) | Runtime mean 95% interval | Queue median (s) | Benchmark/report median (s) | Test median (s) | Build median (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Admin | 91.00 | 87.11–96.89 | 3.00 | 0.00 | 7.00 | 0.00 |
| Install | 384.00 | 331.89–396.33 | 3.00 | 0.00 | 0.00 | 0.00 |
| Ubuntu Bun | 469.00 | 399.22–482.11 | 3.00 | 310.00 | 65.00 | 0.00 |
| Ubuntu npm | 761.00 | 656.22–775.33 | 3.00 | 312.00 | 146.00 | 119.00 |
| Windows Bun | 710.00 | 615.22–772.78 | 3.00 | 405.00 | 114.00 | 0.00 |
| Windows npm | 807.00 | 768.56–844.78 | 3.00 | 433.00 | 115.00 | 0.00 |

## Excluded observations

Fetched but excluded: 1; censored: 1. Reasons: `{"run_conclusion_cancelled": 1}`.

The full sanitized job/step metadata for these observations is retained separately in `excluded-observations.json`.

## Interpretation limits

- Absolute change budget: not established.
- Relative change budget: not established.
- Noise budget: no acceptance threshold was predeclared; the observed distributions and bootstrap intervals describe natural variation in this sample.
- Counterfactual status: forecast only. No projected saving is treated as a measured result, and no source before/after comparison is included.
- Any later forecast must include retained verification/parity/platform-test coverage, coverage timing changes, and added full-history checkout/classifier time. Gross removed time is not actual net savings.
- Runner-occupied seconds sum parallel jobs; they are neither wall time nor billed-minute totals.
- The combined Install step bundles install, build, browser setup, and browser tests, so metadata alone cannot split its time.
