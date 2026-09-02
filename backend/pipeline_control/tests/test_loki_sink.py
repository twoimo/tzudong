"""Task 21 Loki default Log_Sink: URL admission reuse, redaction, OTel wiring.

Covers requirement 13.10 (search-store URL admission reused from
es_index.admit_es_url with ``loki`` added to the approved host set) and the
OTel Collector filelog->loki logs pipeline wiring that must not disturb the
existing otlp->prometheus metrics pipeline.
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

from backend.pipeline_control import loki_sink
from backend.pipeline_control.es_index import ALLOWED_ES_HOSTS
from backend.pipeline_control.loki_sink import (
    LokiSinkError,
    admit_loki_url,
    build_push_body,
    classify_loki_mode,
    push_records,
    redacted_document,
)

ROOT = Path(__file__).resolve().parents[2]
COMPOSE_DIR = ROOT / "deploy" / "pipeline-control"
OTEL_CONFIG = COMPOSE_DIR / "otel-collector.yaml"


def _record(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "type": "run.lifecycle",
        "component": "backend_runtime",
        "severity": "info",
        "job_id": "j1",
        "status": "Succeeded",
    }
    base.update(overrides)
    return base


class LokiUrlAdmissionTests(unittest.TestCase):
    def test_loki_host_in_shared_allowed_set(self) -> None:
        self.assertIn("loki", ALLOWED_ES_HOSTS)
        # Backward-compatible: the original ES hosts remain admitted.
        for host in ("127.0.0.1", "localhost", "::1", "elasticsearch"):
            self.assertIn(host, ALLOWED_ES_HOSTS)

    def test_loki_url_admitted(self) -> None:
        self.assertEqual(
            admit_loki_url(data_env="local_db", url="http://loki:3100/"),
            "http://loki:3100",
        )

    def test_loopback_host_admitted(self) -> None:
        self.assertEqual(
            admit_loki_url(data_env="local_db", url="http://127.0.0.1:3100"),
            "http://127.0.0.1:3100",
        )

    def test_missing_url_required(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="local_db", url=None)
        self.assertEqual(ctx.exception.code, "es_url_required")

    def test_remote_host_rejected(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="local_db", url="http://loki.example.com:3100")
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_non_local_db_rejected(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="hosting_db", url="http://loki:3100")
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_scheme_invalid(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="local_db", url="ftp://loki:3100")
        self.assertEqual(ctx.exception.code, "es_url_invalid")

    def test_userinfo_trick_rejected(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="local_db", url="http://loki@evil.example:3100")
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")


class LokiModeTests(unittest.TestCase):
    def test_default_mode_is_loki(self) -> None:
        self.assertEqual(classify_loki_mode(None), "loki")
        self.assertEqual(classify_loki_mode(""), "loki")
        self.assertEqual(classify_loki_mode("  "), "loki")

    def test_opt_out_noop(self) -> None:
        self.assertEqual(classify_loki_mode("noop"), "noop")

    def test_invalid_mode(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            classify_loki_mode("elastic")
        self.assertEqual(ctx.exception.code, "loki_mode_invalid")


class LokiRedactionTests(unittest.TestCase):
    def test_forbidden_fields_redacted(self) -> None:
        document = redacted_document(
            {
                "type": "step.progress",
                "component": "backend_runtime",
                "severity": "info",
                "password": "super-secret-value",
                "dsn": "postgresql://user:pw@host/db",
                "email": "person@example.com",
            }
        )
        blob = str(document)
        self.assertNotIn("super-secret-value", blob)
        self.assertNotIn("person@example.com", blob)
        self.assertNotIn("user:pw", blob)

    def test_push_body_groups_by_labels_and_is_deterministic(self) -> None:
        records = [
            _record(severity="info", component="backend_runtime"),
            _record(severity="error", component="publish_worker", status="Failed"),
        ]
        body = build_push_body(records)
        self.assertIn("streams", body)
        self.assertEqual(len(body["streams"]), 2)
        # Deterministic: identical input yields identical serialization.
        again = build_push_body(records)
        self.assertEqual(body, again)
        # Every stream carries at least the component label.
        for stream in body["streams"]:
            self.assertIn("component", stream["stream"])
            self.assertTrue(stream["values"])

    def test_push_body_line_excludes_forbidden_value(self) -> None:
        body = build_push_body([_record(token="ghp_" + "a" * 36)])
        line = body["streams"][0]["values"][0][1]
        self.assertNotIn("ghp_", line)


class LokiPushTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig = {
            key: os.environ.get(key)
            for key in ("TZUDONG_LOG_SINK", "TZUDONG_LOKI_URL", "TZUDONG_DATA_ENV")
        }
        self._orig_load = loki_sink._load_loki_client

    def tearDown(self) -> None:
        loki_sink._load_loki_client = self._orig_load
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_empty_records_noop(self) -> None:
        self.assertEqual(push_records([]), "noop:empty")

    def test_noop_mode_does_not_load_client(self) -> None:
        os.environ["TZUDONG_LOG_SINK"] = "noop"
        loads = {"n": 0}

        def boom() -> object:
            loads["n"] += 1
            raise ImportError("loki")

        loki_sink._load_loki_client = boom  # type: ignore[assignment]
        self.assertEqual(push_records([_record()]), "noop:1")
        self.assertEqual(loads["n"], 0)

    def test_default_mode_requires_url_fail_closed(self) -> None:
        os.environ.pop("TZUDONG_LOG_SINK", None)
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("TZUDONG_LOKI_URL", None)
        with self.assertRaises(LokiSinkError) as ctx:
            push_records([_record()])
        self.assertEqual(ctx.exception.code, "es_url_required")

    def test_remote_url_rejected_before_push(self) -> None:
        os.environ.pop("TZUDONG_LOG_SINK", None)
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_LOKI_URL"] = "http://loki.example.com:3100"
        with self.assertRaises(LokiSinkError) as ctx:
            push_records([_record()])
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_injected_client_receives_redacted_body(self) -> None:
        os.environ.pop("TZUDONG_LOG_SINK", None)
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_LOKI_URL"] = "http://loki:3100"
        sent: list[dict] = []

        class FakeClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def push(self, body: dict) -> None:
                sent.append(body)

        loki_sink._load_loki_client = lambda: FakeClient  # type: ignore[assignment]
        result = push_records(
            [_record(password="super-secret-value", step="01-collect-urls")]
        )
        self.assertEqual(result, "loki:1")
        self.assertEqual(len(sent), 1)
        self.assertNotIn("super-secret-value", str(sent[0]))

    def test_injected_redirect_fails_closed(self) -> None:
        os.environ.pop("TZUDONG_LOG_SINK", None)
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_LOKI_URL"] = "http://loki:3100"

        class RedirectClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def push(self, _body: dict) -> None:
                raise LokiSinkError("loki_push_failed")

        loki_sink._load_loki_client = lambda: RedirectClient  # type: ignore[assignment]
        with self.assertRaises(LokiSinkError) as ctx:
            push_records([_record()])
        self.assertEqual(ctx.exception.code, "loki_push_failed")

    def test_provider_exception_reduced_to_fixed_code(self) -> None:
        os.environ.pop("TZUDONG_LOG_SINK", None)
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_LOKI_URL"] = "http://loki:3100"

        class BoomClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def push(self, _body: dict) -> None:
                raise RuntimeError("loki connection string secret leak")

        loki_sink._load_loki_client = lambda: BoomClient  # type: ignore[assignment]
        with self.assertRaises(LokiSinkError) as ctx:
            push_records([_record()])
        self.assertEqual(ctx.exception.code, "loki_push_failed")


class OtelCollectorWiringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = OTEL_CONFIG.read_text(encoding="utf-8")

    def test_config_parses_and_has_both_pipelines(self) -> None:
        try:
            import yaml  # type: ignore
        except ImportError:
            self.skipTest("pyyaml not available")
        config = yaml.safe_load(self.text)
        pipelines = config["service"]["pipelines"]
        # Existing metrics pipeline intact.
        self.assertEqual(pipelines["metrics"]["receivers"], ["otlp"])
        self.assertEqual(pipelines["metrics"]["exporters"], ["prometheus"])
        # New logs pipeline: filelog -> loki.
        self.assertEqual(pipelines["logs"]["receivers"], ["filelog"])
        self.assertEqual(pipelines["logs"]["exporters"], ["loki"])
        # Receivers/exporters declared.
        self.assertIn("filelog", config["receivers"])
        self.assertIn("otlp", config["receivers"])
        self.assertIn("loki", config["exporters"])
        self.assertIn("prometheus", config["exporters"])

    def test_loki_exporter_targets_approved_local_host(self) -> None:
        self.assertIn("http://loki:3100/loki/api/v1/push", self.text)

    def test_metrics_pipeline_not_broken_textually(self) -> None:
        # The otlp receiver bind is unchanged.
        self.assertIn("0.0.0.0:4318", self.text)
        self.assertIn("0.0.0.0:8889", self.text)


if __name__ == "__main__":
    unittest.main()
