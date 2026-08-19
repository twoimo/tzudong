"""Frozen Slice 3 metric names. Overlay OTLP export is opt-in; default is off."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

CATALOG_PATH = (
    Path(__file__).resolve().parents[1] / "pipeline-control" / "metrics.v1.json"
)

FROZEN = (
    "tzudong_pipeline_runs_enqueued_total",
    "tzudong_pipeline_runs_claimed_total",
    "tzudong_pipeline_runs_succeeded_total",
    "tzudong_pipeline_runs_failed_total",
)

DEFERRED = (
    "tzudong_pipeline_kafka_lag",
    "tzudong_pipeline_es_rows_per_sec",
)

_GHA_TRUTHY = {"1", "true", "TRUE", "yes"}

_local_counts: dict[str, int] = {}
_counters: dict[str, Any] = {}
_meter_ready = False
_lock = threading.Lock()


class MetricsError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def load_catalog(path: Path | None = None) -> dict[str, Any]:
    payload = json.loads((path or CATALOG_PATH).read_text(encoding="utf-8"))
    if payload.get("metrics") != list(FROZEN):
        raise MetricsError("metrics_catalog_mismatch")
    if payload.get("deferred") != list(DEFERRED):
        raise MetricsError("metrics_catalog_mismatch")
    return payload


def assert_name(name: str) -> str:
    if name in DEFERRED:
        raise MetricsError("metrics_deferred")
    if name not in FROZEN:
        raise MetricsError("metrics_name_unknown")
    return name


def _export_endpoint() -> str:
    return (
        os.environ.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
        or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or ""
    ).strip()


def export_requested() -> bool:
    return bool(_export_endpoint())


def _gha_truthy() -> bool:
    return os.environ.get("GITHUB_ACTIONS", "").strip() in _GHA_TRUTHY


def assert_export_allowed() -> None:
    if export_requested() and _gha_truthy():
        raise MetricsError("metrics_export_forbidden_in_gha")


def _load_otlp() -> None:
    global _meter_ready, _counters
    if _meter_ready:
        return
    try:
        from opentelemetry import metrics as otel_metrics
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
    except ImportError as exc:
        raise MetricsError("metrics_otel_sdk_missing") from exc

    exporter = OTLPMetricExporter()
    reader = PeriodicExportingMetricReader(exporter)
    service_name = os.environ.get("OTEL_SERVICE_NAME", "tzudong-pipeline").strip() or "tzudong-pipeline"
    provider = MeterProvider(
        resource=Resource.create({"service.name": service_name}),
        metric_readers=[reader],
    )
    otel_metrics.set_meter_provider(provider)
    meter = otel_metrics.get_meter("tzudong.pipeline")
    _counters = {name: meter.create_counter(name) for name in FROZEN}
    _meter_ready = True


def reader_snapshot() -> dict[str, int]:
    return dict(_local_counts)


def reset_for_tests() -> None:
    global _meter_ready, _counters
    with _lock:
        _local_counts.clear()
        _counters = {}
        _meter_ready = False


def record(name: str, value: int = 1) -> str:
    frozen = assert_name(name)
    with _lock:
        _local_counts[frozen] = _local_counts.get(frozen, 0) + int(value)
        if not export_requested():
            return f"noop:{frozen}"
        assert_export_allowed()
        _load_otlp()
        counter = _counters[frozen]
        try:
            counter.add(int(value))
        except Exception:
            pass
        return f"otlp:{frozen}"
