# Local TypeScript CI duplicate replay — not admitted

Measured 7 before/after pairs and 7 A/A pairs on a content-verified copy-on-write snapshot of clean private source tree `671a84d19c0a1a424daba802a3bb5094fbf683a0` at commit `215cb86185ce65246afdfbda8bb8fcbffb79d675`. Pair order alternated deterministically.

| Metric | Before | After | Paired reduction |
| --- | ---: | ---: | ---: |
| p50 | 48037.84 ms | 23740.35 ms | — |
| p75 | 49447.22 ms | 23797.12 ms | — |
| p95 | 53863.30 ms | 23856.00 ms | — |
| Mean | 48323.48 ms | 23128.20 ms | 25195.28 ms / 51.87% |

Mean paired absolute reduction bootstrap 95% CI: 22569.85–28105.21 ms. Mean paired relative reduction bootstrap 95% CI: 48.79–55.09%.

| Resource (descriptive) | Before | After |
| --- | ---: | ---: |
| Mean CPU | 75.52 s | 41.00 s |
| p75 CPU | 76.55 s | 41.71 s |
| p95 CPU | 77.85 s | 42.01 s |
| p75 max command RSS | 1961.70 MiB | 1908.52 MiB |
| p95 max command RSS | 1964.59 MiB | 1974.69 MiB |

A/A noise p95 absolute relative difference: 24.50%. A/A signed mean-difference bootstrap 95% CI: -3399.43–1450.95 ms.

Acceptance: absolute=True, relative=True, noise-p95=False, noise-mean-CI=True, integrity=True. Local evidence admitted=False; official approval remains false.

The before sequence ran `verify`, standalone `native`, standalone `compat`, then `parity`. The after sequence ran `verify` then `parity`; `parity` itself still executed both diagnostic compilers and both logical-input enumerations. This replay does not include or estimate the separately gated release benchmark.

All 28 measured sequences succeeded. `/usr/bin/time -l` CPU and maximum RSS are retained per command; maximum RSS is descriptive process data only and is not subprocess-tree memory.

This is a local macOS replay under shared-host load. It is not evidence of hosted GitHub runner latency, production behavior, billed-minute savings, a full CI speedup, or G003 approval.

The absolute, relative, and A/A budgets were frozen in the hashed experiment configuration before measurement. They originated as post hoc guardrails after the rejected historical run; they are prospective only for this new experiment.
