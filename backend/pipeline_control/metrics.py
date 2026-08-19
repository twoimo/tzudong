"""Frozen Slice 3 metric names. Export stays no-op; the pipeline image stays copy-only."""

from __future__ import annotations

import json
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


def record(name: str, value: int = 1) -> str:
    _ = value
    return f"noop:{assert_name(name)}"
