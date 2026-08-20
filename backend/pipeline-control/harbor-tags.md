# Harbor-ready tags

- `image.registry/tzudong/pipeline-api:<gitsha>`
- `image.registry/tzudong/pipeline-worker:<gitsha>`
- `image.registry/tzudong/pipeline-indexer:<gitsha>`

Build (do not push in this slice):

```
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target api -t image.registry/tzudong/pipeline-api:local .
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target worker -t image.registry/tzudong/pipeline-worker:local .
docker buildx build --platform linux/arm64,linux/amd64 -f backend/pipeline-control/Dockerfile --target indexer -t image.registry/tzudong/pipeline-indexer:local .
```

Images run as uid 10001. API binds `0.0.0.0:8091` inside the container; Compose publishes `127.0.0.1:8091` on the host. Compose `db` hostname is on the local DSN allowlist; hosted ref `aqlcofblfxdrjhhdmarw` stays rejected.

`lite_gha` uses the worker target as a one-shot after a Postgres service is healthy.
`heavy_local` bind-mounts the repository so numbered scripts, node, and ffmpeg stay on the host tree.

`run_daily.sh` / `run_local_heavy.sh` operator paths were removed after N=3 healthy live parity. Legacy snapshots live under `backend/utils/tests/fixtures/`.
Hosted apply of `pipeline_control` is not authorized by this slice. Harbor push needs a separate registry credential approval and digest receipt.
