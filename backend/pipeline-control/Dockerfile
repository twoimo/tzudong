# Harbor-ready multi-stage image. Tags: image.registry/tzudong/pipeline-{api,worker}:<gitsha>
# Bakes kafka-python==3.0.11 plus the pinned OpenTelemetry SDK and OTLP HTTP exporter from requirements.txt.
FROM python:3.12-slim AS base
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY backend/pipeline-control/requirements.txt /workspace/backend/pipeline-control/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/pipeline-control/requirements.txt
COPY backend/pipeline_control /workspace/backend/pipeline_control
COPY backend/utils /workspace/backend/utils
COPY backend/config /workspace/backend/config
COPY backend/pipeline-control/fixtures /workspace/backend/pipeline-control/fixtures

FROM base AS api
EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/healthz')"
CMD ["python", "-m", "backend.pipeline_control.api"]

FROM base AS worker
# heavy_local additionally bind-mounts numbered scripts, node, and ffmpeg from the repo.
CMD ["python", "-m", "backend.pipeline_control.worker"]
