# Local TypeScript CI duplicate replay — not admitted

Measured 7 before/after pairs and 7 A/A pairs on a content-verified copy-on-write snapshot of clean private source tree `24e0a272dc0fab99351890337ef10fe28f3ae88c` at commit `6098055f2d8d141625a216a99d6c8f99956de2a0`. Pair order alternated deterministically.

| Metric | Before | After | Paired reduction |
| --- | ---: | ---: | ---: |
| p50 | 35365.70 ms | 18393.87 ms | — |
| p75 | 37434.45 ms | 20150.07 ms | — |
| p95 | 39292.45 ms | 21636.09 ms | — |
| Mean | 35073.01 ms | 18688.48 ms | 16384.52 ms / 46.61% |

Mean paired absolute reduction bootstrap 95% CI: 14527.15–18362.34 ms. Mean paired relative reduction bootstrap 95% CI: 43.31–50.24%.

The ratio of aggregate means, `1 - 18688.48/35073.01`, is 46.72%. The 46.61% value above is the mean of the seven within-pair relative reductions. These are different estimators; neither is admitted because the predeclared A/A noise budget failed.

| Resource (descriptive) | Before | After |
| --- | ---: | ---: |
| Mean CPU | 63.92 s | 36.45 s |
| p75 CPU | 66.69 s | 38.08 s |
| p95 CPU | 68.95 s | 40.00 s |
| p75 max command RSS | 1957.79 MiB | 1846.95 MiB |
| p95 max command RSS | 1962.91 MiB | 1856.37 MiB |

A/A noise p95 absolute relative difference: 28.28%. A/A signed mean-difference bootstrap 95% CI: -884.20–4666.54 ms.

Acceptance: absolute=True, relative=True, noise-p95=False, noise-mean-CI=True, integrity=True. Local evidence admitted=False; official approval remains false.

The before sequence ran `verify`, standalone `native`, standalone `compat`, then `parity`. The after sequence ran `verify` then `parity`; `parity` itself still executed both diagnostic compilers and both logical-input enumerations. This replay does not include or estimate the separately gated release benchmark.

All 28 measured sequences succeeded. `/usr/bin/time -l` CPU and maximum RSS are retained per command; maximum RSS is descriptive process data only and is not subprocess-tree memory.

This is a local macOS replay under shared-host load. It is not evidence of hosted GitHub runner latency, production behavior, billed-minute savings, a full CI speedup, or G003 approval.

The absolute, relative, and A/A budgets were frozen in the hashed experiment configuration before measurement. They originated as post hoc guardrails after the rejected historical run; they are prospective only for this new experiment.
