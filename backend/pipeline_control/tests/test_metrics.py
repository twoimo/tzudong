"""Slice 3 frozen counters: OTel SDK OTLP export, default off."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control.metrics import (
    CATALOG_PATH,
    DEFERRED,
    EXTRA_COUNTERS,
    FROZEN,
    GAUGES,
    MetricsError,
    load_catalog,
    reader_snapshot,
    record,
    reset_for_tests,
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
GRAFANA_DASH = (
    ROOT / "pipeline-control" / "grafana" / "dashboards" / "pipeline-frozen-counters.json"
)
GRAFANA_DS = (
    ROOT
    / "pipeline-control"
    / "grafana"
    / "provisioning"
    / "datasources"
    / "datasource.yml"
)
DASHBOARD = (
    ROOT.parent
    / "apps"
    / "web"
    / "components"
    / "admin"
    / "pipeline"
    / "AdminPipelineDashboard.tsx"
)

PINNED_REQUIREMENTS = "\n".join(
    [
        "kafka-python==3.0.11",
        "opentelemetry-api==1.44.0",
        "opentelemetry-sdk==1.44.0",
        "opentelemetry-exporter-otlp-proto-http==1.44.0",
    ]
)


class MetricNameFreezeTests(unittest.TestCase):
    def test_catalog_matches_frozen_python_names(self) -> None:
        catalog = load_catalog()
        self.assertEqual(catalog["metrics"], list(FROZEN))
        self.assertEqual(catalog["gauges"], list(GAUGES))
        self.assertEqual(catalog["extraCounters"], list(EXTRA_COUNTERS))
        self.assertEqual(catalog["deferred"], list(DEFERRED))
        self.assertEqual(
            catalog["exporter"],
            "otlp_http; OpenTelemetry SDK in the pipeline image; default export off",
        )
        self.assertEqual(catalog["adminIframePolicy"], "loopback_admin_iframe_after_csp_auth_gate")
        self.assertTrue(set(DEFERRED).isdisjoint(FROZEN))
        self.assertTrue(set(GAUGES).isdisjoint(FROZEN))

    def test_record_is_noop_and_rejects_unknown_or_deferred(self) -> None:
        reset_for_tests()
        self.assertEqual(
            record("tzudong_pipeline_runs_enqueued_total"),
            "noop:tzudong_pipeline_runs_enqueued_total",
        )
        self.assertEqual(
            reader_snapshot().get("tzudong_pipeline_runs_enqueued_total"),
            1,
        )
        with self.assertRaises(MetricsError) as unknown:
            record("tzudong_pipeline_http_requests_total")
        self.assertEqual(unknown.exception.code, "metrics_name_unknown")
        with self.assertRaises(MetricsError) as deferred:
            record("tzudong_pipeline_kafka_lag")
        self.assertEqual(deferred.exception.code, "metrics_not_counter")
        with self.assertRaises(MetricsError):
            record("tzudong_pipeline_es_rows_per_sec")

    def test_image_pins_kafka_and_otel_sdk(self) -> None:
        requirements = REQUIREMENTS.read_text(encoding="utf-8")
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertEqual(requirements.strip(), PINNED_REQUIREMENTS)
        self.assertIn("opentelemetry-sdk==1.44.0", requirements)
        self.assertIn("opentelemetry-exporter-otlp-proto-http==1.44.0", requirements)
        self.assertIn("opentelemetry", requirements.lower())
        self.assertNotIn("prometheus_client", requirements)
        self.assertNotIn("opentelemetry-exporter-otlp\n", requirements)
        self.assertIn("OpenTelemetry SDK", dockerfile)
        self.assertIn("OTLP HTTP", dockerfile)
        self.assertNotIn("otherwise copy-only", dockerfile)
        self.assertIn(
            "pip install --no-cache-dir -r /workspace/backend/pipeline-control/requirements.txt",
            dockerfile,
        )

    def test_metrics_export_forbidden_in_gha(self) -> None:
        reset_for_tests()
        env = {
            "GITHUB_ACTIONS": "true",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-collector:4318",
        }
        with patch.dict(os.environ, env, clear=False):
            with patch(
                "backend.pipeline_control.metrics._load_otlp",
                side_effect=AssertionError("sdk must not load"),
            ) as load:
                with self.assertRaises(MetricsError) as ctx:
                    record("tzudong_pipeline_runs_enqueued_total")
                self.assertEqual(ctx.exception.code, "metrics_export_forbidden_in_gha")
                load.assert_not_called()

    def test_default_off_gha_does_not_load_sdk(self) -> None:
        reset_for_tests()
        env = {
            "GITHUB_ACTIONS": "true",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "",
            "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "",
        }
        with patch.dict(os.environ, env, clear=False):
            with patch(
                "backend.pipeline_control.metrics._load_otlp",
                side_effect=AssertionError("sdk must not load"),
            ) as load:
                self.assertEqual(
                    record("tzudong_pipeline_runs_claimed_total"),
                    "noop:tzudong_pipeline_runs_claimed_total",
                )
                load.assert_not_called()

    def test_export_on_returns_otlp_without_raising(self) -> None:
        reset_for_tests()

        class Dummy:
            def add(self, value: int) -> None:
                _ = value

        def fake_load() -> None:
            import backend.pipeline_control.metrics as metrics

            metrics._meter_ready = True
            metrics._counters = {name: Dummy() for name in FROZEN}

        env = {
            "GITHUB_ACTIONS": "0",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-collector:4318",
        }
        with patch.dict(os.environ, env, clear=False):
            with patch(
                "backend.pipeline_control.metrics._load_otlp",
                side_effect=fake_load,
            ) as load:
                self.assertEqual(
                    record("tzudong_pipeline_runs_succeeded_total"),
                    "otlp:tzudong_pipeline_runs_succeeded_total",
                )
                load.assert_called()

    def test_reader_snapshot_after_frozen_records(self) -> None:
        reset_for_tests()
        for name in FROZEN:
            record(name)
        snap = reader_snapshot()
        self.assertEqual(set(snap), set(FROZEN))
        self.assertTrue(all(snap[name] == 1 for name in FROZEN))

    def test_overlay_scrapes_collector_and_forbids_iframe_and_postgres(self) -> None:
        obs = OBS.read_text(encoding="utf-8")
        otel = OTEL.read_text(encoding="utf-8")
        prom = PROM.read_text(encoding="utf-8")
        pipeline = PIPELINE.read_text(encoding="utf-8")
        workflow = WORKFLOW.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        events = EVENTS.read_text(encoding="utf-8")
        dashboard = DASHBOARD.read_text(encoding="utf-8")
        grafana_dash = GRAFANA_DASH.read_text(encoding="utf-8")
        grafana_ds = GRAFANA_DS.read_text(encoding="utf-8")
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
        self.assertNotIn("pipeline-api:8091", prom)
        self.assertNotIn("pipeline-worker", prom)
        self.assertIn("OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318", pipeline)
        self.assertIn("OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf", pipeline)
        self.assertIn("OTEL_SERVICE_NAME: pipeline-api", pipeline)
        self.assertIn("OTEL_SERVICE_NAME: pipeline-worker", pipeline)
        self.assertNotIn("--metrics-bind", pipeline)
        self.assertNotIn("0.0.0.0", pipeline)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", obs)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", pipeline)
        self.assertNotIn("TZUDONG_PIPELINE_METRICS", workflow)
        self.assertNotIn("OTEL_EXPORTER_OTLP_ENDPOINT", workflow)
        self.assertNotIn("opentelemetry", workflow.lower())
        self.assertNotIn(
            "Start docker-compose.kafka.yml and docker-compose.elasticsearch.yml first.",
            obs,
        )
        self.assertIn("not required to see the four frozen pipeline counters", obs)
        self.assertIn("./grafana/provisioning:/etc/grafana/provisioning:ro", obs)
        self.assertIn("GF_SECURITY_ALLOW_EMBEDDING: \"true\"", obs)
        self.assertIn("http://prometheus:9090", grafana_ds)
        for name in FROZEN:
            self.assertIn(name, grafana_dash)
        self.assertNotIn("tzudong_pipeline_kafka_lag", grafana_dash)
        self.assertNotIn("tzudong_pipeline_es_rows_per_sec", grafana_dash)
        self.assertNotIn("iframe", grafana_dash.lower())
        self.assertIn("tzudong_pipeline_runs_enqueued_total", contract)
        self.assertIn("Gauges record queue depth/age, active jobs, step duration, Kafka consumer lag, Elasticsearch rows/sec, and process CPU/RSS", contract)
        self.assertIn("record() exports via SDK when overlay OTEL endpoint is set", contract)
        self.assertIn("image is no longer copy-only-only-kafka-python", contract)
        self.assertIn("loopback_admin_iframe_after_csp_auth_gate", events)
        self.assertIn("<iframe", dashboard)
        self.assertIn("data-admin-pipeline-grafana", dashboard)
        self.assertIn("http://127.0.0.1:3001/d/tzudong-pipeline-frozen-counters", dashboard)
        self.assertNotIn("kafka-ui", dashboard)
        self.assertEqual(CATALOG_PATH.name, "metrics.v1.json")
        store_src = (ROOT / "pipeline_control" / "store.py").read_text(encoding="utf-8")
        self.assertIn("from backend.pipeline_control.metrics import record", store_src)
        self.assertIn("tzudong_pipeline_runs_enqueued_total", store_src)
        self.assertIn("tzudong_pipeline_runs_claimed_total", store_src)
        self.assertIn("tzudong_pipeline_runs_succeeded_total", store_src)
        self.assertIn("tzudong_pipeline_runs_failed_total", store_src)
        self.assertNotIn("tzudong_pipeline_kafka_lag", store_src)
        self.assertNotIn("tzudong_pipeline_es_rows_per_sec", store_src)
        self.assertIn("MemoryStore enqueue/claim/Succeeded/Failed call record() as noop", contract)

    def test_inmemory_metric_reader_when_sdk_present(self) -> None:
        try:
            from opentelemetry.sdk.metrics.export import InMemoryMetricReader  # noqa: F401
        except ImportError:
            self.skipTest("OpenTelemetry SDK not installed in this interpreter")
        reset_for_tests()
        env = {
            "GITHUB_ACTIONS": "",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:9",
            "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
            "OTEL_TRACES_EXPORTER": "none",
            "OTEL_LOGS_EXPORTER": "none",
            "OTEL_SERVICE_NAME": "pipeline-test",
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertEqual(
                record("tzudong_pipeline_runs_failed_total"),
                "otlp:tzudong_pipeline_runs_failed_total",
            )


class MetricCallSiteTests(unittest.TestCase):
    def test_store_records_frozen_names_without_export(self) -> None:
        from backend.pipeline_control.store import MemoryStore
        from backend.pipeline_control.worker import process_one

        reset_for_tests()
        seen: list[str] = []

        def capture(name: str, value: int = 1) -> str:
            seen.append(name)
            return record(name, value)

        store = MemoryStore(clock=lambda: 1_000.0)
        with patch("backend.pipeline_control.store.record", side_effect=capture):
            first, created = store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="metrics01",
                payload={},
                actor="admin",
                request_id="req-m1",
            )
            self.assertTrue(created)
            replay, created_again = store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="metrics01",
                payload={},
                actor="admin",
                request_id="req-m1b",
            )
            self.assertFalse(created_again)
            self.assertEqual(first.id, replay.id)
            self.assertEqual(process_one(store), "Succeeded")

            failed, _ = store.create_run(
                target="tzuyang",
                profile="lite_gha",
                idempotency_key="metrics02",
                payload={},
                actor="admin",
                request_id="req-m2",
            )
            claimed = store.claim()
            self.assertEqual(claimed.id, failed.id)
            store.finish_failed(failed.id, "adapter_failed")

            cancelled, _ = store.create_run(
                target="meatcreator",
                profile="lite_gha",
                idempotency_key="metrics03",
                payload={},
                actor="admin",
                request_id="req-m3",
            )
            store.claim()
            store.control(cancelled.id, "cancel", actor="admin", request_id="req-m3c")
            store.finish_dry_run(cancelled.id)

            paused, _ = store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="metrics04",
                payload={},
                actor="admin",
                request_id="req-m4",
            )
            store.claim()
            store.control(paused.id, "pause", actor="admin", request_id="req-m4p")
            store.finish_dry_run(paused.id)

        self.assertEqual(
            seen,
            [
                "tzudong_pipeline_runs_enqueued_total",
                "tzudong_pipeline_runs_claimed_total",
                "tzudong_pipeline_runs_succeeded_total",
                "tzudong_pipeline_runs_enqueued_total",
                "tzudong_pipeline_runs_claimed_total",
                "tzudong_pipeline_runs_failed_total",
                "tzudong_pipeline_runs_enqueued_total",
                "tzudong_pipeline_runs_claimed_total",
                "tzudong_pipeline_runs_enqueued_total",
                "tzudong_pipeline_runs_claimed_total",
            ],
        )
        self.assertNotIn("tzudong_pipeline_kafka_lag", seen)
        self.assertNotIn("tzudong_pipeline_es_rows_per_sec", seen)
        self.assertEqual(
            record("tzudong_pipeline_runs_enqueued_total"),
            "noop:tzudong_pipeline_runs_enqueued_total",
        )


if __name__ == "__main__":
    unittest.main()
