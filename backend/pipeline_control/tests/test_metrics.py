"""Slice 3 metric-name freeze. No OTel SDK, no live Grafana, no export."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.pipeline_control.metrics import (
    CATALOG_PATH,
    DEFERRED,
    FROZEN,
    MetricsError,
    load_catalog,
    record,
)

ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = ROOT / "pipeline-control" / "requirements.txt"
DOCKERFILE = ROOT / "pipeline-control" / "Dockerfile"
OBS = ROOT / "pipeline-control" / "docker-compose.observability.yml"
OTEL = ROOT / "pipeline-control" / "otel-collector.yaml"
PROM = ROOT / "pipeline-control" / "prometheus.yml"
PIPELINE = ROOT / "pipeline-control" / "docker-compose.pipeline.yml"
WORKFLOW = ROOT.parent / ".github" / "workflows" / "daily-crawler.yml"
CONTRACT = ROOT / "DATA_CONTRACTS.md"
EVENTS = ROOT / "pipeline-control" / "events.v1.json"
DASHBOARD = (
    ROOT.parent
    / "apps"
    / "web"
    / "components"
    / "admin"
    / "pipeline"
    / "AdminPipelineDashboard.tsx"
)


class MetricNameFreezeTests(unittest.TestCase):
    def test_catalog_matches_frozen_python_names(self) -> None:
        catalog = load_catalog()
        self.assertEqual(catalog["metrics"], list(FROZEN))
        self.assertEqual(catalog["deferred"], list(DEFERRED))
        self.assertEqual(catalog["exporter"], "noop; no OpenTelemetry SDK in the pipeline image")
        self.assertEqual(catalog["adminIframePolicy"], "forbidden_until_csp_auth_gate")
        self.assertTrue(set(DEFERRED).isdisjoint(FROZEN))

    def test_record_is_noop_and_rejects_unknown_or_deferred(self) -> None:
        self.assertEqual(
            record("tzudong_pipeline_runs_enqueued_total"),
            "noop:tzudong_pipeline_runs_enqueued_total",
        )
        with self.assertRaises(MetricsError) as unknown:
            record("tzudong_pipeline_http_requests_total")
        self.assertEqual(unknown.exception.code, "metrics_name_unknown")
        with self.assertRaises(MetricsError) as deferred:
            record("tzudong_pipeline_kafka_lag")
        self.assertEqual(deferred.exception.code, "metrics_deferred")
        with self.assertRaises(MetricsError):
            record("tzudong_pipeline_es_rows_per_sec")

    def test_image_stays_copy_only_without_otel_sdk(self) -> None:
        requirements = REQUIREMENTS.read_text(encoding="utf-8")
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertEqual(requirements.strip(), "kafka-python==3.0.11")
        self.assertNotIn("opentelemetry", requirements.lower())
        self.assertNotIn("opentelemetry", dockerfile.lower())
        self.assertIn("otherwise copy-only", dockerfile)

    def test_overlay_scrapes_collector_and_forbids_iframe_and_postgres(self) -> None:
        obs = OBS.read_text(encoding="utf-8")
        otel = OTEL.read_text(encoding="utf-8")
        prom = PROM.read_text(encoding="utf-8")
        pipeline = PIPELINE.read_text(encoding="utf-8")
        workflow = WORKFLOW.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        events = EVENTS.read_text(encoding="utf-8")
        dashboard = DASHBOARD.read_text(encoding="utf-8")
        self.assertRegex(obs, r"(?m)^\s+otel-collector:")
        self.assertRegex(obs, r"(?m)^\s+prometheus:")
        self.assertRegex(obs, r"(?m)^\s+grafana:")
        self.assertNotRegex(obs, r"(?im)^\s+postgres:")
        self.assertNotRegex(obs, r"(?m)^\s+kafka:")
        self.assertNotRegex(obs, r"(?m)^\s+elasticsearch:")
        self.assertNotRegex(pipeline, r"(?im)^\s+postgres:")
        self.assertIn("127.0.0.1:4318:4318", obs)
        self.assertIn("127.0.0.1:9090:9090", obs)
        self.assertIn("127.0.0.1:3001:3000", obs)
        self.assertIn("endpoint: 0.0.0.0:4318", otel)
        self.assertIn('targets: ["otel-collector:8889"]', prom)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", obs)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", pipeline)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", workflow)
        self.assertIn("tzudong_pipeline_runs_enqueued_total", contract)
        self.assertIn("Kafka lag / ES rows/sec remain deferred", contract)
        self.assertIn("forbidden_until_csp_auth_gate", events)
        self.assertNotIn("<iframe", dashboard)
        self.assertEqual(CATALOG_PATH.name, "metrics.v1.json")


if __name__ == "__main__":
    unittest.main()
