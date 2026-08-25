# Harbor-ready tags

- `harbor.local/tzudong/pipeline-api:<gitsha>`
- `harbor.local/tzudong/pipeline-worker:<gitsha>`

Build:

```
docker build -f backend/pipeline-control/Dockerfile --target api -t harbor.local/tzudong/pipeline-api:local .
docker build -f backend/pipeline-control/Dockerfile --target worker -t harbor.local/tzudong/pipeline-worker:local .
```

`lite_gha` uses the worker target as a one-shot after a Postgres service is healthy.
`heavy_local` bind-mounts the repository so numbered scripts, node, and ffmpeg stay on the host tree.

crontab/GHA call `python3 -m backend.pipeline_control.worker`. Isolated cutover of leftover `run_daily.sh` / `run_local_heavy.sh` snapshots remains gated on a real N=3 `pipeline-parity-ledger.json`. `liveEvidenceEligible` stays false until those receipts exist. Hosted apply of `pipeline_control` is unauthorized and stays latched off. Legacy snapshots live under `backend/utils/tests/fixtures/`.
Hosted apply of `pipeline_control` is not authorized by this slice.
