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

`run_daily.sh` / `run_local_heavy.sh` operator paths were removed after N=3 healthy live parity. Legacy snapshots live under `backend/utils/tests/fixtures/`.
Hosted apply of `pipeline_control` is not authorized by this slice.
