# Managed Storage single-delete admission investigation

Status: source analysis and isolated experiment design only. No production/provider/user-object requests, paid calls, managed provider patch, image pull, container creation/reconfiguration or source modification occurred. Existing v3 PG17 container/DB and other worker containers were preserved. Active candidate HEAD: b085e1d36ad8a8bc5626738b9921b194f50324a1.

## Conclusion before any implementation

Supported REST single DELETE is real in both pinned v1.33.0 and publisher v1.80.1: DELETE /object/{bucketName}/{objectPath}. It can avoid the bulk S3 DeleteObjects HTTP200 per-key Errors omission for **the current primary object** because it calls backend DeleteObjectCommand and awaits its result inside the metadata transaction.

It is not a complete replacement for the current general physical cleanup contract. Both versions' single path omit TUS .info deletion and multipart abortion. A single DELETE result therefore cannot attest absence of sidecars/incomplete uploads or every previous version. Unknown origin objects and uploads started before the cleanup fence are not safely classified as standard-only using storage.objects.list.

TUS termination also does not supply a complete workaround. The pinned @tus/s3-store 2.0.0 aborts multipart when upload metadata identifies an upload, then calls deleteObjects for original+.info and ignores fulfilled Errors. The v1.80.1 dependency 2.0.7 retains this omission. Thus routing standard object deletion through single DELETE and TUS cleanup through termination retains an unobserved partial-delete failure path.

Do not admit general managed deletion, mark metadata-only absence as physical completion, patch the managed provider, or weaken the retirement fence based on this source result. A narrowly scoped standard-only candidate can be investigated locally, but requires physical-backend failure tests and an explicit proven origin/sidecar/multipart scope. No such admission is claimed here.

## Source routing proof

| Version | HTTP and authorization | Storage class | S3 backend | Outcome |
| --- | --- | --- | --- | --- |
| v1.33.0 | app.ts mounts object routes; object/index.ts registers JWT, DB and Storage plugins; deleteObject.ts registers DELETE /:bucketName/* | find current object with FOR UPDATE, DB delete inside withTransaction, await backend.deleteObject, webhook only after transaction | DeleteObjectCommand using withOptionalVersion(current version), await client.send | Request rejection propagates before DB commit; no DeleteObjects response involved |
| v1.80.1 | same route, optional versionId query | same transaction boundary, optional exact version | same DeleteObjectCommand | Primary-object semantics remain; sidecar/multipart omission remains |
| both ordinary bulk routes | DELETE /object/{bucketName}, prefixes body | Storage.deleteObjects deletes metadata and original/version.info in a transaction per outer batch | general backend deleteObjects | v1.33 ignores response; v1.80 generic method only checks request rejection, not fulfilled Errors |
| both S3-compatible single routes | DELETE /:Bucket/* via S3 router/protocol | delegates to Storage.deleteObject | same backend single command | Same .info/multipart limitation; S3 compatibility is not direct access to the managed backing S3 bucket |

v1.80 S3 protocol catches NoSuchKey and returns 204 after bucket verification; v1.33 delegates without that catch. REST single deletion uses metadata lookup and does not make an absent row a physical deletion proof. v1.33 single HTTP query has no versionId support; newer OpenAPI/SDK version features must not be assumed on the pin.

Both classes send ObjectRemoved webhook after the single transaction. A webhook/response failure after successful physical deletion can yield a failed/uncertain client request; preserve readback and never blindly resend the deletion. Metadata DELETE itself remains subject to Storage authorization/RLS. The object's original retirement fence excludes DELETE and continues to reject INSERT/UPDATE/recreation; changing URL alone should not require any fence exception.

## Cleanup and fence boundaries

- Single Storage.deleteObject only removes the located current original/version key. It does not call deleteObjects, abortMultipartUpload, or remove .info.
- Bulk Storage.deleteObjects explicitly adds version.info. Its generic adapters in both sources lose per-key failures.
- TUS DELETE /upload/resumable/* is registered and calls tusServer.handle. Lifecycle authorization calls uploader.canUpload/testPermission. Pinned S3 store remove first reads .info metadata, aborts upload-id if present, then bulk-deletes original+.info. It clears cache after a fulfilled command without checking Errors.
- Both reviewed TUS server configurations set disableTerminationForFinishedUploads=true. A completed TUS upload is therefore not generally terminable through that supported route; the unexecuted design must observe the actual refusal and sidecar residue rather than assume termination is available.
- TUS removal is a store operation; no ordinary Storage.deleteObject metadata deletion callback was found in the route/lifecycle source. Do not infer it cleans the database row or replaces both operations atomically.
- The project permits only a transaction-rolled-back version='1' TUS DELETE permission probe in the BEFORE object fence. The deferred AFTER fence rejects any persistent forged probe. This must be retained and regression-tested on any candidate route change.
- Raw REST deletion of a guessed logical .info name cannot remove an internal physical sidecar with no matching metadata row. Do not fabricate rows or TUS upload IDs/URLs to expose it.
- An existing .info record or running multipart started before claim is a separate physical artifact. SQL metadata readback and metadata-aware Storage GET/list do not prove its removal.

## Official specification and installed interface

Current official self-hosted REST docs list the single object wildcard endpoint separately from bulk. Publisher Swagger initializer resolves api.json; acquired OpenAPI 3.0.3 lists bearerAuth and both DELETE paths. Its info.version is 0.0.0, so it is not an installed-version receipt. It currently includes versionId query and versioned bulk entries which v1.33 route does not support.

Actual installed storage-js is 2.117.2. StorageFileApi.remove(paths) always calls DELETE /object/{bucketId} with prefixes, including a one-element array. Calling .remove([path]) is **still bulk**, and there is no public single-delete method identified in that API. Current project createRecordMediaTransport uses this method and .list-based existence readback.

Project compose pins storage-api:v1.33.0. Cached local image digest 3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177 was inspected, without pulling/starting it. Image metadata returned no entrypoint/labels/architecture detail; executable HTTP-route behavior remains unverified in a new owned runtime. Publisher tag resolutions and exact source hashes are retained. No hosted installed Storage version was inspected.

Sources:
- https://supabase.com/docs/reference/self-hosting-storage/delete-an-object
- https://supabase.com/docs/reference/javascript/file-buckets-remove
- https://supabase.com/docs/guides/storage/management/delete-objects
- https://supabase.com/docs/guides/storage/s3/compatibility
- https://supabase.github.io/storage/api.json
- https://github.com/supabase/storage/tree/cce047b6dca69c987a16976af739175365b1edd5
- https://github.com/supabase/storage/tree/ba73b08b9b94b1d53fb14c8b34970e7121d4f09b
- https://github.com/tus/tus-node-server/blob/1abc10049de770cfc2a6c18db9e7b57356b667cb/packages/s3-store/src/index.ts

## Upstream requirements if the full contract must remain

1. General S3Backend.deleteObjects must fail on any per-key Errors, including missing Key, with safe fixed diagnostics. Preserve request rejection, batch settlement and current metadata transaction rollback. Do not describe rollback as restoring already-deleted physical objects or earlier committed outer batches.
2. TUS S3 store termination must check per-key Errors and preserve failure/unknown state; successful AbortMultipartUpload does not prove original/.info deletion.
3. A supported metadata-aware primary+sidecar+multipart cleanup path or authoritative per-object physical result is needed for unclassified existing managed objects. Preserve exact object version/fingerprint and no-recreation fence.
4. Merely upgrading to reviewed v1.80.1 is not a verified fix: generic bulk and bundled TUS removal still omit Errors. deleteObjectsDetailed exists, but ordinary Storage class deletion does not consume it; its detailed result also drops keyless Errors rather than proving all requested artifacts.

Implementation recommendation: wait for Root's scope decision and owned isolated experiment result. No production source edit or gate change is prepared in this directory.
