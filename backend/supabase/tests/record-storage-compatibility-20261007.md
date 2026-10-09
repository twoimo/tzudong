# Guarded review photo cleanup: bounded Storage compatibility proof

## Result

External cleanup admission is now enforced before privileged client creation and again before service RPC/Storage work. The bundled evidence is **failed**, so ordinary database moderation remains available while physical cleanup stays pending. This is temporary staging, **not completion of end-to-end photo deletion**.

Pinned Storage HTTP/S3 checks produced five positive cases and one incompatible TUS case across two isolated runs. The earlier four passing cases were not repeated. Their original receipts remain byte-for-byte separate, with their original harness hashes; they are not represented as one passing final-harness run:

- `record-storage-evidence/20261007-standard.json`: standard upload → guarded delete/claim → Storage DELETE → physical S3 absence; changed object before claim retained; user/service upserts after claim denied with original bytes retained; copy into retired destination denied while fresh-path copy succeeds.
- `record-storage-evidence/20261007-tus-termination.json`: confirmed deletion prevents path recreation (passed); resumable upload started before claim cannot be terminated after claim (failed).

The final harness source hash in the second receipt is `7e70fd342681d34906dcf59bb77a0e8255becbb3ec05545bcf9090a5d102621c`. Both runs used unchanged draft SQL `97af1726a2e2b399388fcb617266378237893bbe868c25ffa19ee748b2c4833f`.

## Reproduced incompatibility and exact remaining work

1. Authenticated standard upload creates the original photo.
2. Authenticated TUS replacement session begins; its first 6 MiB PATCH succeeds with HTTP 204.
3. Guarded review deletion and cleanup claim commit successfully.
4. Final TUS PATCH is rejected, preserving the original downloadable bytes.
5. Authenticated TUS DELETE termination returns **HTTP 500**. Direct backend readback shows the original object, one `.info` object and one incomplete multipart upload. The listing reported zero bytes for the incomplete entry; it does **not** establish the amount of retained multipart payload.

The current `admin_record_object_fence` blocks INSERT/UPDATE once cleanup is inflight, uncertain or done (draft SQL lines 54–67). The pinned Storage TUS lifecycle calls `uploader.canUpload` for incoming methods other than OPTIONS/HEAD, including termination. That method probes INSERT/UPSERT permission using a rollback transaction. The fence rejects this probe, preventing the already-started session from terminating through the supported API. This is an actual HTTP/S3 failure, not an inference from a metadata-only fixture.

The required next change is a supported cleanup/admission design that allows termination of pre-existing resumable sessions without allowing new references or replacement uploads to bypass the deletion fence. Do not exempt arbitrary object versions or disable the fence. Coordinate the unapplied SQL boundary with the API/S3 owner before modifying it; then rerun this failed case and affected paths. A verified provider-side fix or supported session admission/termination contract is still needed. No such fix or provider upgrade is claimed here.

Separately, metadata `.list()` absence does not independently attest physical S3 absence. Source inspection of pinned `s3/adapter.ts` shows `deleteObjects` does not inspect the returned per-key `Errors` array. Backend partial-delete/error compatibility was not exercised by this bounded run and remains required before claiming robust physical deletion. No reproduced partial-delete failure is claimed.

## Activation and verification boundary

`record-media-admission.ts` requires the bundled complete passing case set plus matching server-only evidence digest, Storage image digest, SQL digest and exact endpoint origin (`ADMIN_RECORD_MEDIA_COMPATIBILITY_SHA256`, `ADMIN_RECORD_MEDIA_STORAGE_IMAGE`, `ADMIN_RECORD_MEDIA_SQL_SHA256`, `ADMIN_RECORD_MEDIA_VERIFIED_ENDPOINT`). None is a secret or proof by itself. The operator must first verify the deployed catalog/trigger privileges and supported Storage version. The pure policy factory permits synthetic unit fixtures; the production route uses only bundled evidence. A partial passing receipt cannot open admission.

Targeted Bun results: **15 passed / 0 failed, 86 assertions**. They exercise route and service admission before all privileged I/O, missing/mismatched/partial/failed evidence, unchanged database moderation, exact metadata readback, no automatic retry after uncertain deletion, and existing action controls. Targeted ESLint passed. The harness uses real signed JWTs verified by Storage and actual SQL triggers/RLS; it does not exercise Auth HTTP, the browser, the SDK over HTTP, hosted state, or full canonical replay. Root owns compiler parity, full replay and deployment checks.

The disposable database image is PostgreSQL 15.8.1.085, Storage is pinned v1.33.0, and MinIO/client are pinned digests recorded in the receipts. Domain prerequisites use canonical source; separate G014 registration is deliberately excluded. This does not replace the independent PG17 database-fence audit.

Only synthetic local data and ephemeral credentials were used. Evidence retains fixed codes, booleans, counts and hashes; no JWTs, URLs, object names, request bodies, user data or provider diagnostics. All harness-owned containers and the network were removed. The separate `tzudong-record-storage-20261007` Colima profile was stopped; existing Docker context `colima`, containers, volumes, configuration and original worktrees were preserved. Operating writes, paid provider calls and commits: **0**.

## Primary sources

- [Official Storage schema design](https://supabase.com/docs/guides/storage/schema/design): treat storage tables as metadata and perform object mutations through the API; schema changes may conflict with service changes.
- [Pinned TUS lifecycle](https://github.com/supabase/storage/blob/v1.33.0/src/http/routes/tus/lifecycle.ts)
- [Pinned uploader permission probe](https://github.com/supabase/storage/blob/v1.33.0/src/storage/uploader.ts)
- [Pinned S3 adapter](https://github.com/supabase/storage/blob/v1.33.0/src/storage/backend/s3/adapter.ts)

## Reproduction

Use only the task-owned Colima socket and pre-pulled pinned images; output must be a new path. The harness refuses other Docker endpoints and removes only its labeled resources. To rerun the failed case after an authorized fix:

```sh
python3 backend/supabase/tests/record_storage_http_fixture.py \
  --docker-host unix:///Users/twoimo/.colima/tzudong-record-storage-20261007/docker.sock \
  --output /tmp/record-storage-tus-after-fix.json \
  --case resumable_upload_started_before_claim_cannot_replace_after_claim
```

The failed receipt exits nonzero and remains failed. Never replace it with a fabricated passing receipt or activate by setting environment values alone.
