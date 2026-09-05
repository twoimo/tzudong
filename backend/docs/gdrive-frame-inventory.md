# Read-only GDrive frame inventory (task 8.12)

The `GDrive frame inventory` workflow only supports manual dispatch on protected
`main`, with `main_sha` exactly equal to the dispatch SHA and checked-out HEAD.
It uses `contents: read`, immutable action pins, Python 3.12.8, and the existing
`GDRIVE_RCLONE_CONFIG` repository secret. This change does not dispatch the workflow
or claim a remote readback. Integrate through the parent's coordinated promotion.

The workflow is deliberately independent of the G037 write freeze. It does not
invoke Backfill or change its `G037_WRITE_FREEZE == 'cleared'` write gate. Its only
rclone commands are:

- `cat gdrive:04_빠른공유/tzudong_tzuyang_data/status/main/current-upload-expected.json`
- `lsjson gdrive:04_빠른공유/tzudong_tzuyang_data/frames --recursive --files-only --hash`

Both use `--config /dev/null`, skip Drive shortcuts, disable progress output, have
bounded retries/timeouts and a 256 MiB output cap. The validator decodes base64
configuration in memory and passes only allowlisted `gdrive` remote settings plus
a fixed executable PATH to rclone. Other remotes, inherited flags, proxies, Actions
tokens, file-backed credentials, default sections and executable configuration
options are not forwarded. Unsupported configuration fails with `CONFIG_INVALID`.
No secret, raw inventory, expected manifest, path list, provider diagnostic or
configuration file is written or uploaded. Child stderr is discarded. The only
uploaded artifact is the small `summary.json`; it is retained on gap/error too.
No frame upload, remote lock, status update, reconciliation, delete, sync or remote
mutation is implemented. The credential itself may have broad OAuth permissions;
this workflow restricts operations, not the existing token's grants.

## Exact historical identity

The source is the operator's historical file
`gdrive-authentic-expected-20260905T101144Z-bf121913.json`.
Its exact local bytes have SHA-256:
`c7076254b4cef5757fd305ed50be57db8209c24715578f4394a9f11c96a1a65e`.
This is **not assumed to be the remote file's raw SHA**.

The pinned canonical expected identity is:
`a8df74b60b8e56f5438bcd9a038da4b410d5f586ec182a7bd9f29e4f74a94b1d`.
It is SHA-256 of UTF-8 JSON (sorted keys, no spaces or trailing newline,
`ensure_ascii=False`) containing `schemaVersion: 1`, the fixed `remoteRoot`,
`expectedCount`, and `items` sorted by `(relativePath, size, mtimeEpoch)`. Each item
contains those three fields plus lowercase `md5`, or null when absent. The source
must also validate its schema, root, count, remote path and `relativePath:size:mtime`
dedupe key. Source display formatting, property order, item order and operational
state metadata do not alter this identity. Path/size/mtime/hash drift does.
The receipt separately records the **actual fetched bytes'** `inputSha256`, raw
inventory digest, protected `sourceSha`, and validator source digest.

The historical 192,095 rows contain only 149,645 unique paths. There are 42,450
versioned duplicate paths (84,900 rows), including 917 paths with conflicting
sizes. Only 246 rows have an expected MD5; 191,849 do not. No historical manifest
or credential is checked into this patch.

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
