# Runtime bindings

The existing Python functions are the public entry points. `TZUDONG_RUST_SLICES`
selects comma-separated slice IDs for experiments. Without opt-in, the committed
ledger keeps every slice on Python; a Rust default additionally requires the
ledger's existing N=3 admission. No default has been changed.

| Slice | Actual call sites |
| --- | --- |
| R1-validators | Public validators and initial pipeline state |
| R2-normalize | Date-folder parsing used by directory selection |
| R3-upsert-payload | Stable payload hashing, batch size guard, fixed DB-error classification |
| R4-media-compute | Chunk planning and its pure transcript/time helpers |
| R5-pipeline-graph | Step classification, pure graph assertions, state decisions and lease eligibility |

File traversal, CLI handling, database RPC execution, state-object updates,
ffmpeg and provider work remain Python responsibilities. The graph's Python
filesystem and current-source checks still run after native pure assertions.

Selected native initialization and computation run in private POSIX processes.
Initialization has a 30-second budget; a call has a 600-second budget. A joined
watchdog kills and reaps timed-out work; it never performs the computation.
The public call site closes the process after each call. Missing modules,
unknown functions, unsupported wire values, initialization failure and timeout
fail closed without Python fallback. The worker must be single-threaded on a
host that supports `fork`; unsupported contexts fail closed. Raw outputs and
provider errors are not persisted or forwarded to stdout/stderr.

The Python side of `run_parity` explicitly bypasses opt-in routing, preventing
an accidental Rust-versus-Rust comparison. These bindings preserve the Python
reference functions and do not retire shims or claim live N=3 evidence.

CI builds all five extensions with the pinned Rust/maturin toolchain, then runs
`TZUDONG_REQUIRE_RUST_CALL_SITES=1 python -m unittest
backend.pipeline_control.tests.test_rust_runtime_bindings` and the R1 property
suites. Local callable routing tests alone are not native-build or live evidence.
Per-call process isolation has overhead; no performance improvement is claimed.
