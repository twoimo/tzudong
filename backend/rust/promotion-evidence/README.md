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

Full validation runs once per unchanged receipt/slice/artifact/commit binding
per process. Only successful verdicts are cached (bounded to 128 bindings),
including simultaneous callers. Every reuse fingerprints all nested evidence,
schema/budget pins and validator files, including inode/device, size, nanosecond
mtime/ctime and file mode. Missing files, aliases, atomic replacement, and
same-size edits with restored mtime invalidate the verdict, including writable
Compose checkouts. The entire file set must also remain unchanged across initial
validation. Changed evidence requires valid pinned hashes and full revalidation.
JSON with duplicate keys, non-finite numbers or non-UTF-8 encoding is rejected.
Failed validation is not cached and continues to deny promotion. The operating
system and running verifier code remain trusted. Native extension installation is a
separate runtime requirement; missing selected extensions fail closed.


Default switching separates apply authorization from activation. A
`rust_promotion_evidence_v2` proposal retains live runs, performance and exact
operator approval, with no precomputed `readbackRef`. `evaluate_default_switch`
returns a `proposedLedgerUpdate` and keeps `defaultImplementation: python`.
The authorized apply writes that update to the migration ledger. An independent
post-apply observation then creates a `rust_promotion_readback_v2` receipt with
`promotionEvidenceRef`, approval/job receipt bindings, `observedAt`, and
`appliedLedgerStateSha256`. Attach its content-addressed reference in the ledger's
`promotionReadbackRef` only after observation.

The state digest covers the entire parsed ledger except per-slice
`promotionReadbackRef` links, avoiding a self-referential hash. All activation and
Python-removal paths independently reopen the actual canonical ledger file;
receipt-loader data cannot substitute for that read. The applied slice must
select Rust with the exact artifact/proposal/readback references, and the entire
applied state must match the retained digest. Missing, reverted or changed files
keep Python selected. Matching proposed objects alone do not constitute readback.
No live receipts or real switch are established by the synthetic tests here.
