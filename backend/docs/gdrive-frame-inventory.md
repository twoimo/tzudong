# Read-only GDrive frame inventory (task 8.12)

The `GDrive frame inventory` workflow only supports manual dispatch on protected
`main`, with `main_sha` exactly equal to the dispatch SHA and checked-out HEAD.
An unconditional first step rejects invalid dispatch bindings before checkout or
credential access and retains a fixed `SOURCE_BINDING_FAILED` summary; it does
not skip the only job and report apparent success.
It uses `contents: read`, immutable action pins, Python 3.12.8, and the existing
`GDRIVE_RCLONE_CONFIG` repository secret. This change does not dispatch the workflow
or claim a remote readback. Integrate through the parent's coordinated promotion.

The workflow is deliberately independent of the G037 write freeze. It does not
invoke Backfill or change its `G037_WRITE_FREEZE == 'cleared'` write gate. Its only
rclone command is:

- `lsjson gdrive:04_빠른공유/tzudong_tzuyang_data/frames --recursive --files-only --hash`

It uses `--config /dev/null`, skips Drive shortcuts, disables progress output, and has
bounded retries/timeouts and a 256 MiB output cap. The validator decodes base64
configuration in memory and passes only allowlisted `gdrive` remote settings plus
a fixed executable PATH to rclone. Other remotes, inherited flags, proxies, Actions
tokens, file-backed credentials, default sections and executable configuration
options are not forwarded. Unsupported configuration fails with `CONFIG_INVALID`.
No secret, raw inventory, runtime path list, provider diagnostic or configuration
file is written or uploaded. The minimized expected bindings are versioned in Git
as described below; runtime reads them in memory. Child stderr is discarded. The only
uploaded artifact is the small `summary.json`; it is retained on gap/error too.
No frame upload, remote lock, status update, reconciliation, delete, sync or remote
mutation is implemented. The credential itself may have broad OAuth permissions;
this workflow restricts operations, not the existing token's grants.

## Exact historical identity

The source is the operator's historical file
`gdrive-authentic-expected-20260905T101144Z-bf121913.json`.
Its exact local bytes have SHA-256:
`c7076254b4cef5757fd305ed50be57db8209c24715578f4394a9f11c96a1a65e`.
The historical source is 127,229,868 bytes and is not included in the repository.
Its raw SHA, schema, root, count, remote paths and `relativePath:size:mtime` dedupe
bindings were checked before extracting the compact fixture.

`backend/data/gdrive-frame-inventory/expected-b5.v1.json.gz` is the immutable
expected source in the exact reviewed Git tree. The protected dispatch SHA and
checked-out HEAD bind both the validator's pins and this fixture. The mutable
`status/main/current-upload-expected.json` is never fetched or consulted. There
is no remote-expected fallback and no fixture path override.

The gzip contains 1,026,505 bytes, SHA-256
`4d5f757ca08eb8754f175ccabed1bb83bb15cc94f93311090672e98069901b6b`.
Its header has no filename and an mtime of zero. Uncompressed canonical JSON is
22,915,062 bytes. Reads are limited to each pinned length plus one byte; the loader
checks compressed length/hash before bounded decompression, gzip integrity, then
uncompressed length/hash and the canonical identity/count before accessing credentials
or starting rclone. Missing, corrupt, truncated, oversized or drifted fixtures fail
closed with fixed codes. Operational metadata is absent and rejected by the compact
schema. The full historical source is not needed at runtime.

The pinned canonical expected identity is:
`a8df74b60b8e56f5438bcd9a038da4b410d5f586ec182a7bd9f29e4f74a94b1d`.
It is SHA-256 of UTF-8 JSON (sorted keys, no spaces or trailing newline,
`ensure_ascii=False`) containing `schemaVersion: 1`, the fixed `remoteRoot`,
`expectedCount`, and `items` sorted by `(relativePath, size, mtimeEpoch)`. Each item
contains those three fields plus lowercase `md5`, or null when absent. The source
uses only those root and item fields. Historical source formatting, property order,
item order and operational metadata were excluded from the identity; all path,
size, mtime and available MD5 bindings are preserved. Runtime additionally enforces
the exact compact and compressed bytes, so reformatting the fixture is rejected.
The receipt records the decompressed fixture's `inputSha256`,
`expectedGzipSha256`, raw inventory digest, protected `sourceSha`, and validator
source digest. The compact raw hash equals the pinned canonical identity hash.

The historical 192,095 rows contain only 149,645 unique paths. There are 42,450
versioned duplicate paths (84,900 rows), including 917 paths with conflicting
sizes. Only 246 rows have an expected MD5; 191,849 do not. Only the compact identity
bindings are included; credentials and operational metadata are excluded.

## Interpretation and completion

Expected duplicate identities are invalid; distinct historical versions of the
same path remain counted and are **unverified**, never silently deduplicated or
counted as independently verified remote files. Duplicate remote paths are invalid
even if one has no hash. Invalid paths, malformed hashes/sizes, duplicate JSON
keys, non-finite numbers, oversized inventories and identity drift fail closed.

For nonduplicate expected paths, an absent remote is missing, a wrong size or MD5
is a mismatch, and a missing expected or remote MD5 is unverified. Only both matching
MD5 **and** size yield verified. Directory/shortcut substitution is not admitted.
`verified + missing + mismatch + unverified == expectedCount` must hold; remote
extras, duplicate-path rows, size conflicts and missing hashes have separate counts.
Each outcome's `manifestHashes` value hashes the canonical list of expected item
identities in that bucket; no paths or inventories are published.

Exit 0 / `complete` requires every one of the pinned expected rows verified.
Exit 2 / `gap` is an honest inventory result, not completion. Exit 1 / `failed`
contains a fixed error code, never provider or parser details. Readback uses Drive's
reported MD5 and size, not a fresh download of every frame. It is a bounded
observation during a listing, not an atomic snapshot of concurrent remote writers.

**The current pinned historical identity cannot close 8.12**: duplicate versions
and missing expected hashes require separately authorized provenance reconciliation
before all rows can be verified. A run can still quantify current missing/mismatch
and unverified gaps. Do not update expected identities from the observed remote
hashes merely to produce success. This workflow does not repair or reconcile state.

Offline tests (no service calls):

```sh
python -m unittest backend.utils.tests.test_gdrive_frame_inventory
```
