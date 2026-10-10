# Excluded snapshot experiment

The first seven-pair attempt is retained in `raw-failed-snapshot-symlink.json` and excluded from every reported timing. Its exact script is retained as `benchmark-failed-snapshot-symlink.py`; the script SHA-256 matches the value recorded in the failed raw file.

The failed script used `cp -cRL` for the app snapshot. That materialized the internal `node_modules/.bin/tsc` package shim as a regular file instead of preserving its relative symlink to the native compiler entry point. Every measured sequence therefore failed its `verify` command with `TOOLCHAIN_SHIM_RESOLUTION_INVALID`: 14 failed sequences and 14 failed verify commands. Compiler commands that happened to run afterward are not salvaged as timing evidence.

The valid setup changed only snapshot construction. It uses `cp -cR` to preserve internal symlinks, then materializes the one top-level shared `node_modules` symlink by cloning its resolved directory with `cp -cR`. A separate setup check of the corrected clone method returned exit code 0 before the valid run. In `raw.json`, all 14 measured sequences and all 42 commands returned exit code 0; the first timed operation in every sequence was the toolchain verifier. The shared dependency directory was never installed into, rewritten, or removed.
