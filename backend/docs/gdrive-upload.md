# GDrive frame upload/backfill runbook

## Purpose

The daily crawler can emit thousands of frame files in one run. The upload path
must distinguish three outcomes:

1. no frame work was detected (`status=skipped`),
2. all expected frame bytes were remotely verified (`status=complete` or
   `status=backfill_complete`),
3. more upload/verification work is required (`status=partial` or
   `status=backfill_required`).

A zero-exit `rclone copy` is not a terminal proof by itself. Terminal success
requires `residualCount=0` and `completionProof=remote_size_check` or
`completionProof=remote_manifest_check`.

## Artifacts

Daily upload writes these artifacts under `backend/log/cron/` and uploads them
as GitHub Actions artifacts:

- `current-upload-expected.json`: schema v2 expected frame manifest.
- `current-upload-batches.json`: batch files-from manifest.
- `current-upload-verified-files.txt`: paths with strong remote proof.
- `current-upload-staging-manifest.json`: local/GDrive staging shard manifest.
- `current-upload-status.json`: canonical status and compatibility fields.
- `gdrive-upload-residual-queue.jsonl`: durable retry/control-plane queue.
- `gdrive-upload-staging/**`: tar.gz shards for unverified local residual bytes.

The remote status scope is `GDRIVE_STATUS_PATH/<scope>`, where production uses
`main` and validation branches use a sanitized branch name.

## Backfill operation

Use the `GDrive Frame Backfill` workflow with:

- `status_scope`: normally `main`.
- `max_batches`: staged shard limit for one run.
- `dry_run=true`: inspect staged shard work without mutating remote status.

The workflow uses GitHub Actions concurrency plus a remote
`backfill.lock.json` lease. It downloads staged shard archives, extracts them,
uploads the original relative paths to the frame remote, runs `rclone check`,
and only then marks paths verified through `write-gdrive-upload-status` with
`uploadMode=backfill` and `completionProof=remote_size_check`.

## Operator checklist

- `status=skipped`: safe only when `expectedCount=0` and `pendingBacklogCount=0`.
- `status=backfill_required`: inspect `missingLocalCount`,
  `stagedShardItemCount`, and `pendingLocalCount`.
- `completionProof=rclone_exit_zero`: delivery evidence exists, but backfill or
  verification must still run before declaring success.
- Do not delete staging shards until all covered queue items are
  `remote_verified` or the status is terminal with strong proof.
