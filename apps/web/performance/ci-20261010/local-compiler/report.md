# Local TypeScript CI duplicate replay

Measured 7 paired runs on a fixed copy-on-write source snapshot. Pair order alternated deterministically: odd pairs `before -> after`, even pairs `after -> before`.

| Metric | Before | After | Paired reduction |
| --- | ---: | ---: | ---: |
| p50 | 40468.01 ms | 21722.93 ms | — |
| p75 | 48309.75 ms | 27192.56 ms | — |
| p95 | 54375.17 ms | 28472.94 ms | — |
| Mean | 43763.94 ms | 22166.33 ms | 21597.61 ms / 49.00% |

Mean paired absolute reduction bootstrap 95% CI: 16917.89–26704.16 ms. Mean paired relative reduction bootstrap 95% CI: 40.42–56.72%.

The before sequence ran `verify`, standalone `native`, standalone `compat`, then `parity`. The after sequence ran `verify` then `parity`; `parity` itself still executed both diagnostic compilers and both logical-input enumerations. This replay does not include or estimate the separately gated release benchmark.

All 14 measured sequences succeeded. `/usr/bin/time -l` maximum RSS is retained per command as descriptive process data only; subprocess-tree accounting is not treated as a memory-performance result.

This is a local macOS replay under shared-host load, with 7 pairs from one source snapshot. It is not evidence of hosted GitHub runner latency, production behavior, billed-minute savings, or a full CI speedup.
