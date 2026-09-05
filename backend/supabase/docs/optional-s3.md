# Optional local S3 backend

The default stack uses filesystem storage. The separate `docker-compose.s3.yml`
overlay now pins Chainguard MinIO and client images by multi-platform digest,
following the [Supabase legacy MinIO configuration](https://supabase.com/docs/guides/self-hosting/self-hosted-s3).
It inherits the base stack's Storage and imgproxy versions instead of downgrading
them. No hosted project or current local stack is switched by this source change.

For an explicitly selected disposable or new local S3 setup, provide dedicated
`MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` values through the local environment.
Use URI-safe random alphanumeric/hex values because the one-shot client receives
its endpoint through `MC_HOST_storage`. Missing values stop Compose interpolation.
Do not print rendered environments or reuse operator/provider credentials.
`GLOBAL_S3_BUCKET` defaults to `stub`; `S3_REGION` defaults to `us-east-1`.

The overlay publishes no MinIO host ports. Its named `minio-data` volume is
separate from the existing filesystem storage directory. Enabling S3 does not
retain the base Storage or imgproxy filesystem mounts: both use Compose's
`volumes: !reset []`, and a real merged-descriptor test verifies their removal.
An omitted or plain empty list would retain the inherited bind mounts. S3 does not
copy existing objects; any actual backend migration needs an explicit copy,
readback and rollback procedure. The normal managed `local-stack.py` workflow
continues to use its existing filesystem overlay.

`optional-s3-compatibility.v1.json` binds the real linux/arm64 proof: health,
idempotent bucket creation, the actual Supabase Storage v1.33.0 adapter's small
and multipart uploads, metadata, range reads, copy, signed access, anonymous and
wrong-secret rejection, list/delete readback, and named-volume persistence after
restart. All disposable containers, network and volume were removed. The indexes
also contain amd64 images, whose runtime was not tested here.

The [vendor vulnerability page](https://images.chainguard.dev/directory/image/minio/vulnerabilities)
still reports findings. This compatibility evidence is not a security certificate.
Recheck the exact image digests and repeat the isolated compatibility proof when
updating either image.
