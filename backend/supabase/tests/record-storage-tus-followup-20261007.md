# Narrow TUS fix and partial-S3-delete proof — 2026-10-07

## Ready change and measured result

The **unapplied** record-action SQL now permits only the pinned TUS termination permission probe in its BEFORE trigger: method DELETE, operation `storage.tus.upload.delete`, canonical resumable path and probe version `1`. A deferred AFTER constraint invokes the same fence and rejects any attempt to commit that temporary mutation. The real Storage `testPermission()` transaction rolls back before termination, so it never commits that event. Ordinary uploads, replacements and new live references retain their existing admission fence. There is no arbitrary version exemption, privilege grant, or provider modification.

One isolated pinned API/S3 run executed eight cases: **7 passed, 1 failed**. All original six physical cases passed against this new SQL. Rerunning them was necessary because the new commit fence affects every Storage metadata write. No passing suite was repeatedly polled or rerun.

- TUS termination: HTTP **204**, original photo preserved, **0** `.info` remnants, **0** incomplete multipart uploads.
- Standard deletion, changed-object protection, user/service replacement denial, copy admission and deleted-path recreation denial: passed.
- Forged TUS request GUCs could not commit a replacement under deferred or immediate constraints. An actual authenticated RLS insert could not create a new review reference. An uncertain cleanup could not claim again: passed.
- Partial S3 deletion: failed with the precise external API limitation below.

Immutable receipt: `record-storage-evidence/20261007-tus-fix-s3-partial.json`. It records SQL, harness, proxy and runtime image digests, booleans/counts and fixed codes. Prior receipts remain unchanged. The standalone database still uses actual pinned PG15 Storage schema and canonical domain prerequisites, not complete G014 registration or a hosted catalog. Root owns PG17/canonical replay and deployed privilege verification.

SQL SHA-256: `1529ad96ebbc2c8e173d5c51fae9bef8051ce632c829eda20f0ae173a77c8caa`.

## Reproduced pinned-API constraint

The test uses the actual pinned Storage API and MinIO. A task-network-only proxy forwards ordinary traffic unchanged, then injects one valid S3 `DeleteObjects` HTTP 200 response containing a per-key `AccessDenied` error for the existing photo and a successful deletion result for its already-absent `.info` companion. It deliberately leaves the real MinIO photo intact. This is a deterministic S3 protocol fault injection, **not** a claim that MinIO IAM or hosted AWS produced the error naturally.

Observed after that one request:

| Observation | Result |
| --- | --- |
| Storage HTTP response | 200 |
| Storage metadata present | false |
| Physical MinIO photo count | 1 |
| Existing service's metadata-only cleanup readback | pending=false |
| Injected partial failure count | 1 |

The pinned `S3Backend.deleteObjects()` awaits `client.send(DeleteObjectsCommand)` but discards the returned `Errors` array. Its caller therefore commits metadata deletion. A route using `.remove()` plus `.list()` cannot distinguish this result from genuine physical deletion: both observable API results are identical. SQL cannot reconstruct the discarded S3 result. Retrying the same path after metadata disappears also does not address the orphaned physical version and must not become an automatic recovery strategy.

The smallest required provider-side correction is to reject a nonempty `DeleteObjects` response `Errors` array **before** the caller commits its database transaction, then prove metadata rollback, unresolved cleanup and no automatic resend. That code resides in the pinned Storage service, outside this repository's SQL/route ownership. Neither the image nor any operating service was patched. A verified compatible upstream release or an explicitly owned provider patch needs a new immutable runtime digest and the failed-case proof before admission. Do not assume that switching to the single-object HTTP endpoint is equivalent: its pinned implementation does not delete the `.info` companion, and it has not passed this contract.

## Current activation state and handoff

Admission remains blocked by the actual failed receipt. Its required set now explicitly includes the six physical cases, the forged-probe/reference regression and partial-S3 failure handling, so merely relabeling the six-case result cannot open the gate. This is **not** completion of end-to-end deletion or a recommendation to leave deletion disabled permanently; the remaining blocking change is exactly the provider error propagation described above.

Only affected admission checks were rerun after binding the new evidence: **3 passed / 0 failed, 28 assertions; 12 unrelated tests filtered out**. The earlier full 15-case unit result remains historical evidence rather than a fresh full-suite claim. The service still never resends an inflight/uncertain removal. No applied SQL, provider images, operating resources, private data, keys, billing or Git commits changed.

The task-only containers/network were removed and its Colima profile stopped after the run. The default Docker context and pre-existing containers/volumes were preserved.

## Exact pinned source mechanism

- [TUS lifecycle](https://github.com/supabase/storage/blob/v1.33.0/src/http/routes/tus/lifecycle.ts): termination enters the upload permission probe.
- [Uploader](https://github.com/supabase/storage/blob/v1.33.0/src/storage/uploader.ts): the probe uses object version `1`.
- [Database adapter](https://github.com/supabase/storage/blob/v1.33.0/src/storage/database/knex.ts): `testPermission` always rolls back the probe transaction.
- [Connection scope](https://github.com/supabase/storage/blob/v1.33.0/src/internal/database/connection.ts): method/path/operation are passed into the database scope.
- [S3 adapter](https://github.com/supabase/storage/blob/v1.33.0/src/storage/backend/s3/adapter.ts): returned batch per-key errors are not inspected.

To verify only the external failure after an authorized provider fix, use the existing task fixture with `--case partial_s3_delete_never_reports_physical_success`, a new output path, and a separately verified runtime pin. Never overwrite the failed receipt or manufacture a passing result.
