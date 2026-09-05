# Harbor-ready multi-stage image. Tags: image.registry/tzudong/pipeline-{api,worker,indexer}:<gitsha>
# Bakes kafka-python==3.0.11 plus the pinned OpenTelemetry SDK and OTLP HTTP exporter from requirements.txt.
# Native arm64 and amd64 via buildx. Harbor push is out of this slice.
# Official Node 24.20.0 bookworm-slim multi-architecture index.
FROM node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS performance-node
FROM python:3.12-slim AS base
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --create-home --home-dir /home/tzudong --shell /usr/sbin/nologin tzudong
# The copied Node executable needs the destination architecture's runtime
# libraries, including libatomic on arm64. Validate loading at image build time.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY backend/pipeline-control/requirements.txt /workspace/backend/pipeline-control/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/pipeline-control/requirements.txt
COPY --chown=tzudong:tzudong backend/pipeline_control /workspace/backend/pipeline_control
COPY --chown=tzudong:tzudong backend/utils /workspace/backend/utils
COPY --chown=tzudong:tzudong backend/config /workspace/backend/config
COPY --chown=tzudong:tzudong backend/rust/migration-ledger.v1.json /workspace/backend/rust/migration-ledger.v1.json
# Immutable evidence and its fixed verifier travel with every runtime target.
# Git tree identity comes from a hashed retained commit object; no .git, Git
# credentials, or external source checkout is copied into the image.
COPY --from=performance-node /usr/local/bin/node /usr/local/bin/node
RUN node --version
# Worker preflights inspect these exact committed scheduler/checker sources.
COPY .github/workflows/daily-crawler.yml /workspace/.github/workflows/daily-crawler.yml
COPY backend/bin/install_mac_hosted_pipeline_launchd.sh backend/bin/check_env_contract.py /workspace/backend/bin/
COPY backend/rust/promotion-evidence /workspace/backend/rust/promotion-evidence
COPY apps/web/performance /workspace/apps/web/performance
COPY apps/web/scripts/validate-performance-backlog.mjs /workspace/apps/web/scripts/validate-performance-backlog.mjs
RUN chmod -R a+rX,a-w /workspace/backend/rust/promotion-evidence /workspace/apps/web/performance /workspace/apps/web/scripts
COPY --chown=tzudong:tzudong backend/pipeline-control/fixtures /workspace/backend/pipeline-control/fixtures
USER tzudong
STOPSIGNAL SIGTERM

FROM base AS api
ENV PIPELINE_API_HOST=0.0.0.0
EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/healthz')"
CMD ["python", "-m", "backend.pipeline_control.api"]

FROM base AS worker
# heavy_local additionally bind-mounts numbered scripts, node, and ffmpeg from the repo.
CMD ["python", "-m", "backend.pipeline_control.worker"]

FROM base AS indexer
CMD ["python", "-m", "backend.pipeline_control.es_index"]
