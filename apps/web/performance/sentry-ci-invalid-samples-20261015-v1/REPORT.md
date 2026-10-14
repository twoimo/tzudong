# Invalid CI measurement retained

PR3208 run38617798185 Ubuntu Bun failed in SAMPLES, not compiler correctness or the application flow. Native/compat parity passed with diagnostics0. The RSS sampler rejected the first measured native attempts for sampling-gap-exceeded (lastgap100.460392ms vs predeclared60ms). Warmup rejected76.77138/68.457831ms then accepted52.890054ms; compatwarmup46.741867ms. These are invalid timing/memory evidence, not a measured UI regression or proof of improvement.

The complete9file artifact11920019337 was downloaded and preserved before a single focused same-source job re-run. Sampling interval10ms, gaplimit60ms, retry limits and acceptance rules remain unchanged. Existing hosted artifacts were not deleted/overwritten; no gate was waived. The re-run's outcome and any upload conflict remain separate and must be checked. Source PR3207 later showed all checks passing; that does not replace the data promotion's failed run.
