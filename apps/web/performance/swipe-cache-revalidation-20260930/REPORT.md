# Swipe cache revalidation, 2026-09-30

Isolated Chromium JavaScript helper; not page rendering, LCP, INP, production, or a release/G003 admission.

The frozen pre-v1.2.7 helper is compared with the unchanged released helper on Node 24 and isolated Chromium. All 752 equivalence cases match. Five warmup rounds and 31 alternating pairs per scenario are retained. This is a current revalidation, not a new source optimization.

| Scenario | Before ms | Current ms | Delta ms | Delta % | Noise ms | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| fresh-visible-order | 0.09100000 | 0.06475000 | -0.02625000 | -28.846% | 0.01091667 | local_improvement |
| new-search-same-visible | 0.03776250 | 0.00986250 | -0.02790000 | -73.883% | 0.00137500 | local_improvement |
| same-search-cache-hit | 0.00002067 | 0.00002933 | +0.00000867 | +41.936% | 0.00000133 | below_budget_or_noise |
| nearest-fallback | 0.16429167 | 0.03900000 | -0.12529167 | -76.262% | 0.00333333 | local_improvement |
| revisit-64-searches | 0.00002950 | 0.00005000 | +0.00002050 | +69.492% | 0.00000200 | below_budget_or_noise |
| revisit-128-searches-over-capacity | 0.00003050 | 0.00715600 | +0.00712550 | +23362.290% | 0.00056300 | local_regression |

Absolute budget: 0.001 ms/call. Relative budget: 5%. Noise: twice the larger MAD. The over-capacity regression is approximately 0.00713 ms/call, with 0.000563 ms noise. It is not erased or fixed by increasing the cache capacity. Baseline has unbounded search history while the released helper intentionally bounds it at 64; a 128-query cyclic working set continually evicts and rebuilds order. Any further tradeoff requires a bounded policy and its own measurements.

Detached artifact-map SHA-256: `1c3a393c6ef173277f7a99e99df1c35bbdeb32cf5ea5e591fad68f443893731d`.
