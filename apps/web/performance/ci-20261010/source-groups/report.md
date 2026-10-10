# CI source-group bootstrap sensitivity

This is a descriptive sensitivity check on the existing nine-run observational baseline. The original per-run bootstrap and its artifacts remain unchanged.

## Source groups

The 9 successful runs contain 7 distinct heads and 3 exact-tree/fallback-head source groups. All retained heads resolved to exact trees in this artifact.

| Source group | Runs | Distinct heads | Run IDs |
| --- | ---: | ---: | --- |
| `tree:10396fb37745bfaff9fb3bff864f254afefaa745` | 1 | 1 | 38039467558 |
| `tree:11355dd1edd3845ef52d60b9926f5d901e0dc640` | 6 | 4 | 37974853501, 37975198548, 37975317691, 37975584201, 37975717229, 37976075302 |
| `tree:182af5df94bd32e545d134370fac94583bb343c8` | 2 | 2 | 37968902769, 37969263340 |

## Interval sensitivity

Each cluster-bootstrap draw samples three complete source groups with replacement, concatenates their run observations, and calculates the run-weighted statistic. Unequal group sizes make resampled run counts range from 3 to 18.

| Metric | Observed mean | Observed median | Per-run mean 95% interval | Source-group mean 95% interval | Per-run median 95% interval | Source-group median 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| criticalPathSeconds | 845.56 | 848.00 | 819.67–872.23 | 827.00–861.00 | 800.00–903.00 | 827.00–861.00 |
| runnerOccupiedSeconds | 3137.11 | 3125.00 | 3040.00–3222.33 | 3102.67–3337.00 | 3035.00–3285.00 | 3116.50–3337.00 |
| totalQueueSeconds | 25.00 | 18.00 | 16.56–39.67 | 16.00–48.50 | 16.00–25.00 | 16.00–48.50 |
| maxQueueSeconds | 9.44 | 3.00 | 3.56–19.45 | 3.00–25.50 | 3.00–10.00 | 3.00–25.50 |
| benchmarkReportSeconds | 1427.22 | 1438.00 | 1341.00–1503.44 | 1393.00–1576.00 | 1308.00–1573.00 | 1402.50–1576.00 |
| benchmarkContributionPercent | 45.43 | 45.84 | 43.77–46.94 | 44.81–47.23 | 42.08–48.03 | 45.44–47.23 |

## Interpretation limits

- Three source groups are too few for stable inferential uncertainty estimates. The source-group intervals are descriptive sensitivity ranges only.
- Repeated runs from an identical Git tree are kept together. Unresolved commits would remain explicit `head:<sha>` groups and would never be labeled as a shared tree.
- This invocation used retained job/step metadata and local Git objects. It made no GitHub workflow-run query and read no workflow logs.
- This does not measure a before/after change or prove a performance improvement. A later forecast must account for retained verification/parity/platform coverage, coverage timing changes, and added full-history checkout/classifier cost; gross removed time is not actual net savings.
