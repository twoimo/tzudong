# Harbor-ready multi-stage image. Tags: image.registry/tzudong/pipeline-{api,worker,indexer}:<gitsha>
# Bakes kafka-python==3.0.11 plus the pinned OpenTelemetry SDK and OTLP HTTP exporter from requirements.txt.
# Native arm64 and amd64 via buildx. Harbor push is out of this slice.
FROM python:3.12-slim AS base
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --create-home --home-dir /home/tzudong --shell /usr/sbin/nologin tzudong
COPY backend/deploy/pipeline-control/requirements.txt /workspace/backend/deploy/pipeline-control/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/deploy/pipeline-control/requirements.txt
COPY --chown=tzudong:tzudong backend/pipeline_control /workspace/backend/pipeline_control
COPY --chown=tzudong:tzudong backend/utils /workspace/backend/utils
COPY --chown=tzudong:tzudong backend/config /workspace/backend/config
COPY --chown=tzudong:tzudong backend/deploy/pipeline-control/fixtures /workspace/backend/deploy/pipeline-control/fixtures
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
