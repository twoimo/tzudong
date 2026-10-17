# Local TypeScript CI duplicate replay — not admitted

The retained raw file contains 7 paired runs from a copy-on-write source snapshot. Pair order alternated deterministically: odd pairs `before -> after`, even pairs `after -> before`.

This result is **not admitted as performance evidence**. The measurement started from a dirty `apps/web` worktree (`gitStatusSha256` is non-empty), retained only five selected input hashes, and did not preserve the complete measured TypeScript input tree. The exact logical inputs therefore cannot be reconstructed from the retained artifact. The raw file is preserved unchanged as a historical observation; the values below must not be used as an accepted speedup, CI forecast, or official performance claim.

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

## Acceptance budgets added after this run

No absolute, relative, or noise acceptance budget was declared before the retained run. The following thresholds were written after seeing the old result, so they are **post hoc guardrails for a future clean rerun** and cannot retroactively admit this evidence or grant G003 approval:

- Absolute budget: the lower endpoint of the bootstrap 95% interval for mean paired reduction must be at least 2,000 ms.
- Relative budget: the lower endpoint of the bootstrap 95% interval for mean paired reduction must be at least 5%.
- Noise budget: a separate 7-pair alternating A/A control on the same frozen tree must have p95 absolute relative difference no greater than 5%, and its mean-difference 95% interval must include zero.
- Integrity budget: all measured sequences must succeed, their output hashes must satisfy the existing parity contract, and the benchmark must start from a clean exact `apps/web` Git tree. The complete source is bound by the retained tree SHA.

The updated benchmark rejects tracked or untracked `apps/web` changes and refuses to write its output inside the measured tree. A prospective clean-tree replacement with 7 before/after pairs and 7 A/A pairs is retained in [local-compiler-clean-20261011](../local-compiler-clean-20261011/report.md). It also remains unadmitted because A/A p95 relative noise was 28.28%, above the frozen 5% budget.
