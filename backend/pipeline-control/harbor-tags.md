# Harbor-ready tags

- `harbor.local/tzudong/pipeline-api:<gitsha>`
- `harbor.local/tzudong/pipeline-worker:<gitsha>`
- `harbor.local/tzudong/pipeline-indexer:<gitsha>`

Build:

```bash
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target api -t harbor.local/tzudong/pipeline-api:<gitsha> .
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target worker -t harbor.local/tzudong/pipeline-worker:<gitsha> .
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target indexer -t harbor.local/tzudong/pipeline-indexer:<gitsha> .
```

These are build-only examples. Harbor push needs a separate registry credential approval and is
not performed by repository verification.

`lite_gha` uses the worker target as a one-shot after a Postgres service is healthy.
`heavy_local` bind-mounts the repository so numbered scripts, node, and ffmpeg stay on the host tree.

crontab/GHA call `python3 -m backend.pipeline_control.worker`. Isolated cutover of leftover `run_daily.sh` / `run_local_heavy.sh` snapshots remains gated on a real N=3 `pipeline-parity-ledger.json`. `liveEvidenceEligible` stays false until those receipts exist. Hosted apply of `pipeline_control` is unauthorized and stays latched off. Legacy snapshots live under `backend/utils/tests/fixtures/`.
Hosted apply of `pipeline_control` is not authorized by this slice.
