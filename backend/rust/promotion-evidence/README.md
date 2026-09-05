# Retained Rust promotion evidence

Store reviewed receipts as `<sha256>.json` here; the filename hashes the exact
receipt bytes. No live promotion receipts have been established in this tree.
Runtime images copy this directory and canonical `apps/web/performance` inputs
as root-owned read-only files, together with the fixed independent validator and
Node 24. They do not require a Git checkout or Git credentials.

The performance admission receipt includes `candidateCommitObject`, a canonical
path/hash reference to JSON with `kind: git_commit_object_v1` and `contentBase64`
containing the exact bytes from `git cat-file commit <candidate-sha>`. Admission
recomputes the Git commit object ID and extracts its tree, independently binding
the frozen commit/tree even in an image without Git.

`runtimeCaptures` maps each of the three backend metric keys to a canonical
path/hash reference. A `rust_measurement_execution_v1` capture records `sliceId`,
`implementation: rust`, `rustArtifactId`, `compiledArtifactSha256` (the loaded
extension's actual digest), `key`, `candidate`, `releaseId`, `configSha256`,
`dataProfileSha256`, and the exact candidate `observations`. The canonical
measurement's candidate `benchmark_summary` (`rss_ndjson` for peak RSS)
attestation must contain this
capture's SHA in `sourceSha256`. Capture these identities during the measured
execution; changing an outer admission label cannot authorize a Python run or
another slice/artifact. Do not manufacture captures from old measurements.

Full validation runs once per immutable receipt/slice/artifact/commit binding
per process. Only successful verdicts are cached (bounded to 128 bindings),
including simultaneous callers. New evidence needs a new content hash; updates
to an installed evidence set require a new image/process. Failed validation is
not cached and continues to deny promotion. Native extension installation is a
separate runtime requirement; missing selected extensions fail closed.
