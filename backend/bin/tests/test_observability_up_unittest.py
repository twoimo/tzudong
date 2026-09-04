#!/usr/bin/env python3
"""Unit tests for the Observability_Stack starter ``backend/bin/observability_up.py``
(Task 19; Requirement 12.1, 12.2, 12.3, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13).

These verify the observable branches of the starter — remote-context rejection,
loopback port and iframe-origin boundaries, env-only dashboard credential,
per-service readiness re-checking with its timeout, tag fixity, the compose
overlay wiring, and the startup artifact shape — with injected fakes so no real
Docker, network, or operator secrets are required. Following the ``backend/bin``
convention (no ``__init__.py``), the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
import urllib.error
import unittest
import shutil
import tempfile
from unittest import mock
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = _ROOT / "backend" / "bin" / "observability_up.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


obs = _load("observability_up", _MODULE_PATH)

_LOCAL_CTX = {"host": "unix:///var/run/docker.sock"}
# Inert fixture consumed only by injected runners, never a provider credential.
_GOOD_ENV = {"GRAFANA_ADMIN_PASSWORD": "fixture"}


class _FakeClock:
    """Monotonic clock whose ``sleep`` deterministically advances ``now``."""

    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


def _runner_ok(cwd, argv):
    return {"exitCode": 0}


def _always_ready(_service: str) -> bool:
    return True


# ---------------------------------------------------------------------------
# Tag fixity (12.10).
# ---------------------------------------------------------------------------


class TagFixityTests(unittest.TestCase):
    def test_exact_tags_are_pinned(self):
        for ref in obs.PINNED_IMAGES.values():
            self.assertTrue(obs.is_pinned_image_reference(ref), ref)

    def test_digest_is_pinned(self):
        digest = "grafana/grafana@sha256:" + ("a" * 64)
        self.assertTrue(obs.is_pinned_image_reference(digest))

    def test_latest_untagged_and_alias_rejected(self):
        for ref in (
            "grafana/grafana:latest",
            "grafana/grafana",
            "prom/prometheus:stable",
            "otel/opentelemetry-collector:edge",
            "",
            None,
        ):
            self.assertFalse(obs.is_pinned_image_reference(ref), ref)

    def test_bad_digest_rejected(self):
        self.assertFalse(obs.is_pinned_image_reference("x@sha256:short"))
        self.assertFalse(obs.is_pinned_image_reference("x@md5:" + "a" * 32))

    def test_registry_port_prefix_tolerated(self):
        self.assertTrue(
            obs.is_pinned_image_reference("harbor.local:443/tzudong/pipeline-api:1.2.3")
        )

    def test_validate_image_references_reports_offenders(self):
        res = obs.validate_image_references(
            {"grafana": "grafana/grafana:11.5.2", "x": "x:latest"}
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["notPinned"], ["x"])


# ---------------------------------------------------------------------------
# Loopback port boundary (12.2, 12.3).
# ---------------------------------------------------------------------------


class LoopbackPortTests(unittest.TestCase):
    def test_loopback_declaration_accepted(self):
        self.assertTrue(obs.is_loopback_port_declaration("127.0.0.1:4318:4318"))
        self.assertTrue(obs.is_loopback_port_declaration("127.0.0.1:9090:9090/tcp"))

    def test_non_loopback_declarations_rejected(self):
        for decl in (
            "0.0.0.0:4318:4318",
            "9090:9090",  # all interfaces
            "4318",  # all interfaces
            "192.168.1.10:9090:9090",
            "[::]:9090:9090",
            "[::1]:9090:9090",
            "localhost:9090:9090",
            "",
            None,
        ):
            self.assertFalse(obs.is_loopback_port_declaration(decl), decl)

    def test_validate_port_declarations_all_loopback(self):
        res = obs.validate_port_declarations(obs.CORE_PORT_DECLARATIONS)
        self.assertTrue(res["ok"])
        self.assertIsNone(res["errorCode"])

    def test_validate_port_declarations_rejects_non_loopback(self):
        res = obs.validate_port_declarations(
            {"grafana": "0.0.0.0:3001:3000", "prometheus": "127.0.0.1:9090:9090"}
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errorCode"], obs.NON_LOOPBACK_BIND_REJECTED)
        self.assertEqual(res["nonLoopback"], ["grafana"])

    def test_loki_port_is_loopback_3100(self):
        self.assertEqual(obs.CORE_PORT_DECLARATIONS["loki"], "127.0.0.1:3100:3100")
        self.assertTrue(
            obs.is_loopback_port_declaration(obs.CORE_PORT_DECLARATIONS["loki"])
        )


# ---------------------------------------------------------------------------
# iframe origin boundary (12.12).
# ---------------------------------------------------------------------------


class IframeOriginTests(unittest.TestCase):
    def test_approved_loopback_origin_accepted(self):
        res = obs.validate_iframe_origins(["http://127.0.0.1:3000"])
        self.assertTrue(res["ok"])

    def test_non_loopback_wildcard_and_unlisted_rejected(self):
        for origin in (
            "http://10.0.0.5:3000",  # non-loopback, not in list
            "http://*.example.com",  # wildcard
            "http://127.0.0.1:9999",  # loopback but not in approved list
            "https://evil.example",
        ):
            res = obs.validate_iframe_origins([origin])
            self.assertFalse(res["ok"], origin)
            self.assertEqual(res["errorCode"], obs.NON_LOOPBACK_BIND_REJECTED)

    def test_empty_allowlist_rejected(self):
        res = obs.validate_iframe_origins([])
        self.assertFalse(res["ok"])


# ---------------------------------------------------------------------------
# Dashboard credential (12.7, 12.8).
# ---------------------------------------------------------------------------


class DashboardCredentialTests(unittest.TestCase):
    def test_present_credential_accepted(self):
        self.assertTrue(obs.validate_dashboard_credential(_GOOD_ENV)["ok"])

    def test_missing_or_empty_rejected(self):
        for env in ({}, {"GRAFANA_ADMIN_PASSWORD": ""}):
            res = obs.validate_dashboard_credential(env)
            self.assertFalse(res["ok"])
            self.assertEqual(res["errorCode"], obs.DASHBOARD_CREDENTIAL_MISSING)


# ---------------------------------------------------------------------------
# Remote docker context (12.11).
# ---------------------------------------------------------------------------


class DockerContextTests(unittest.TestCase):
    def test_local_socket_accepted(self):
        self.assertTrue(obs.validate_docker_context({"host": "unix:///var/run/docker.sock"})["ok"])
        self.assertTrue(obs.validate_docker_context({"host": "npipe:////./pipe/docker_engine"})["ok"])

    def test_remote_endpoint_rejected(self):
        for host in ("ssh://user@remote", "tcp://10.0.0.9:2375", "https://cloud:2376", None):
            res = obs.validate_docker_context({"host": host})
            self.assertFalse(res["ok"], host)
            self.assertEqual(res["errorCode"], obs.REMOTE_CONTEXT_REJECTED)


# ---------------------------------------------------------------------------
# Readiness re-checking (12.1, 12.13).
# ---------------------------------------------------------------------------


class ReadinessTests(unittest.TestCase):
    def test_live_probe_uses_exact_otlp_metrics_method_boundary(self):
        error = urllib.error.HTTPError(
            "http://127.0.0.1:4318/v1/metrics",
            405,
            "method not allowed",
            {},
            None,
        )
        with mock.patch("urllib.request.urlopen", side_effect=error) as urlopen:
            self.assertTrue(obs._http_readiness_probe("otel-collector"))
        urlopen.assert_called_once_with(
            "http://127.0.0.1:4318/v1/metrics", timeout=2
        )
        error.close()

    def test_live_probe_rejects_405_for_non_otlp_services(self):
        error = urllib.error.HTTPError(
            "http://127.0.0.1:9090/-/ready",
            405,
            "method not allowed",
            {},
            None,
        )
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertFalse(obs._http_readiness_probe("prometheus"))
        error.close()

    def test_probe_requires_exact_success_for_each_fixed_endpoint(self):
        for service in ("prometheus", "grafana", "loki", "otel-collector"):
            for status in (200, 204, 301, 401, 404, 405, 429, 500):
                response = mock.MagicMock()
                response.__enter__.return_value.status = status
                with self.subTest(service=service, status=status), mock.patch("urllib.request.urlopen", return_value=response):
                    self.assertEqual(obs._http_readiness_probe(service), status == 200 or (service == "otel-collector" and status == 405))

    def test_all_ready_returns_ok(self):
        clock = _FakeClock()
        res = obs.check_service_readiness(
            obs.CORE_SERVICES,
            probe=_always_ready,
            now=clock.now,
            sleep=clock.sleep,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["notReady"], [])
        for service in obs.CORE_SERVICES:
            self.assertEqual(res["readiness"][service]["readyState"], "ready")

    def test_timeout_lists_not_ready(self):
        clock = _FakeClock()
        # grafana never becomes ready; the others are immediately ready.
        def probe(service: str) -> bool:
            return service != "grafana"

        res = obs.check_service_readiness(
            obs.CORE_SERVICES,
            probe=probe,
            now=clock.now,
            sleep=clock.sleep,
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errorCode"], obs.SERVICE_READINESS_TIMEOUT)
        self.assertEqual(res["notReady"], ["grafana"])
        self.assertEqual(res["readiness"]["grafana"]["readyState"], "not_ready")

    def test_becomes_ready_after_retries(self):
        clock = _FakeClock()
        calls = {"n": 0}

        def probe(_service: str) -> bool:
            calls["n"] += 1
            # Ready only on the 3rd probe of the single service.
            return calls["n"] >= 3

        res = obs.check_service_readiness(
            ["prometheus"],
            probe=probe,
            now=clock.now,
            sleep=clock.sleep,
        )
        self.assertTrue(res["ok"])
        # Two 5s waits happened before the 3rd successful probe.
        self.assertEqual(res["readiness"]["prometheus"]["elapsedSeconds"], 10.0)

    def test_readiness_does_not_overshoot_budget(self):
        clock = _FakeClock()
        res = obs.check_service_readiness(
            ["grafana"],
            probe=lambda _s: False,
            now=clock.now,
            sleep=clock.sleep,
            timeout_seconds=12,
            interval_seconds=5,
        )
        self.assertFalse(res["ok"])
        # Elapsed must not exceed the 12s budget (waits: 5,5,2).
        self.assertLessEqual(res["readiness"]["grafana"]["elapsedSeconds"], 12.0)


# ---------------------------------------------------------------------------
# Full orchestration (artifact shape + fail-closed precedence).
# ---------------------------------------------------------------------------


class StartupOrchestrationTests(unittest.TestCase):
    def _start(self, **overrides):
        clock = _FakeClock()
        kwargs = dict(
            env=_GOOD_ENV,
            docker_context=_LOCAL_CTX,
            probe=_always_ready,
            now=clock.now,
            sleep=clock.sleep,
            command_runner=_runner_ok,
        )
        kwargs.update(overrides)
        return obs.start_observability_stack(**kwargs)

    def test_actual_compose_port_drift_starts_nothing(self):
        for overlay, service in (("observability", "grafana"), ("kafka", "kafka"), ("elasticsearch", "elasticsearch")):
            for replacement in ("0.0.0.0:", "", "${BIND_HOST}:"):
                with tempfile.TemporaryDirectory() as tmp:
                    directory = Path(tmp)
                    for filename in obs.COMPOSE_FILES.values():
                        shutil.copyfile(obs._COMPOSE_DIR / filename, directory / filename)
                    path = directory / obs.COMPOSE_FILES[overlay]
                    path.write_text(path.read_text().replace('127.0.0.1:', replacement))
                    runner = mock.Mock(return_value={'exitCode': 0})
                    with mock.patch.object(obs, '_COMPOSE_DIR', directory):
                        result = self._start(command_runner=runner, enable_kafka=True, enable_elasticsearch=True)
                    self.assertFalse(result['ok'])
                    self.assertEqual(result['errorCode'], obs.NON_LOOPBACK_BIND_REJECTED)
                    runner.assert_not_called()

    def test_missing_or_composed_source_never_passes_constant_port_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            runner = mock.Mock(return_value={'exitCode': 0})
            with mock.patch.object(obs, '_COMPOSE_DIR', directory):
                self.assertFalse(self._start(command_runner=runner)['ok'])
                path = directory / obs.COMPOSE_FILES['observability']
                path.write_text('include: [remote.yaml]\nservices: {}\n')
                self.assertFalse(self._start(command_runner=runner)['ok'])
            runner.assert_not_called()

    def test_happy_path_artifact(self):
        art = self._start()
        self.assertTrue(art["ok"])
        self.assertIsNone(art["errorCode"])
        names = {row["name"] for row in art["services"]}
        self.assertEqual(names, set(obs.CORE_SERVICES) | {"loki"})
        for row in art["services"]:
            self.assertEqual(row["readyState"], "ready")
            self.assertEqual(row["imageTag"], obs.PINNED_IMAGES[row["name"]])
            self.assertIn("elapsedSeconds", row)

    def test_artifact_excludes_forbidden_fields(self):
        art = self._start()
        allowed_top = {
            "ok",
            "errorCode",
            "services",
            "notStartedComponents",
            "notReady",
            "nonLoopback",
            "rejectedOrigins",
            "notPinnedImages",
            "composeSourceSha256",
        }
        self.assertTrue(set(art).issubset(allowed_top), set(art) - allowed_top)
        allowed_row = {"name", "imageTag", "readyState", "elapsedSeconds"}
        for row in art["services"]:
            self.assertEqual(set(row), allowed_row)
        # No provider/credential/diagnostic leakage anywhere in the artifact.
        blob = repr(art)
        self.assertNotIn(_GOOD_ENV["GRAFANA_ADMIN_PASSWORD"], blob)

    def test_remote_context_short_circuits(self):
        art = self._start(docker_context={"host": "ssh://remote"})
        self.assertFalse(art["ok"])
        self.assertEqual(art["errorCode"], obs.REMOTE_CONTEXT_REJECTED)
        # No service rows recorded because nothing was started.
        self.assertEqual(art["services"], [])

    def test_non_loopback_iframe_rejected(self):
        art = self._start(iframe_allowlist=["http://10.0.0.1:3000"])
        self.assertFalse(art["ok"])
        self.assertEqual(art["errorCode"], obs.NON_LOOPBACK_BIND_REJECTED)
        self.assertEqual(art["services"], [])

    def test_missing_credential_starts_nothing(self):
        art = self._start(env={})
        self.assertFalse(art["ok"])
        self.assertEqual(art["errorCode"], obs.DASHBOARD_CREDENTIAL_MISSING)
        self.assertEqual(art["services"], [])

    def test_readiness_timeout_reports_not_ready(self):
        art = self._start(probe=lambda s: s != "grafana")
        self.assertFalse(art["ok"])
        self.assertEqual(art["errorCode"], obs.SERVICE_READINESS_TIMEOUT)
        self.assertEqual(art["notReady"], ["grafana"])

    def test_optional_components_recorded_as_not_started(self):
        art = self._start()
        components = {c["component"] for c in art["notStartedComponents"]}
        self.assertEqual(components, {"kafka", "elasticsearch"})
        for c in art["notStartedComponents"]:
            self.assertEqual(c["reasonCode"], obs.OPTIONAL_COMPONENT_NOT_STARTED)

    def test_no_loki_excludes_it_from_readiness_and_compose_services(self):
        calls = []

        def runner(cwd, argv):
            calls.append(tuple(argv))
            return {"exitCode": 0}

        art = self._start(command_runner=runner, enable_loki=False)
        self.assertTrue(art["ok"])
        self.assertNotIn("loki", {row["name"] for row in art["services"]})
        self.assertIn(
            {"component": "loki", "reasonCode": obs.OPTIONAL_COMPONENT_NOT_STARTED},
            art["notStartedComponents"],
        )
        self.assertEqual(
            calls[-1][-3:], ("otel-collector", "prometheus", "grafana")
        )

    def test_current_compose_declares_pinned_loopback_loki(self):
        compose = (
            _ROOT / "backend" / "pipeline-control" / "docker-compose.observability.yml"
        ).read_text(encoding="utf-8")
        self.assertRegex(compose, r"(?m)^  loki:")
        self.assertIn("image: grafana/loki:3.7.7", compose)
        self.assertIn('"127.0.0.1:3100:3100"', compose)
        self.assertIn("../log:/var/log/tzudong:ro", compose)
        self.assertIn("'strict-dynamic' $$NONCE", compose)
        self.assertNotIn("'strict-dynamic' $NONCE", compose)

    def test_collector_uses_contrib_filelog_and_native_loki_otlp(self):
        compose = (
            _ROOT / "backend" / "pipeline-control" / "docker-compose.observability.yml"
        ).read_text(encoding="utf-8")
        collector = (
            _ROOT / "backend" / "pipeline-control" / "otel-collector.yaml"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "image: otel/opentelemetry-collector-contrib:0.120.0", compose
        )
        self.assertNotIn("image: otel/opentelemetry-collector:0.120.0", compose)
        self.assertRegex(collector, r"(?m)^  filelog:")
        self.assertRegex(collector, r"(?m)^  otlphttp/loki:")
        self.assertIn("endpoint: http://loki:3100/otlp", collector)
        self.assertIn("exporters: [otlphttp/loki]", collector)
        self.assertNotIn("/loki/api/v1/push", collector)

    def test_compose_overlays_started_in_order(self):
        calls = []

        def runner(cwd, argv):
            calls.append(tuple(argv))
            return {"exitCode": 0}

        art = self._start(
            command_runner=runner,
            enable_kafka=True,
            enable_elasticsearch=True,
        )
        self.assertTrue(art["ok"])
        files = [a[3] for a in calls]  # -f <file>
        self.assertEqual(
            files,
            [
                "docker-compose.elasticsearch.yml",
                "docker-compose.kafka.yml",
                "docker-compose.observability.yml",
            ],
        )
        # Enabled optional components are no longer recorded as not started.
        self.assertEqual(art["notStartedComponents"], [])

    def test_compose_failure_fails_closed(self):
        def runner(cwd, argv):
            return {"exitCode": 1}

        art = self._start(command_runner=runner)
        self.assertFalse(art["ok"])
        self.assertEqual(art["errorCode"], obs.SERVICE_READINESS_TIMEOUT)

    def test_startup_result_codes_are_bounded(self):
        # Every reachable errorCode is in the closed set.
        for art in (
            self._start(),
            self._start(docker_context={"host": "ssh://x"}),
            self._start(env={}),
            self._start(iframe_allowlist=["*"]),
            self._start(probe=lambda _s: False),
        ):
            self.assertIn(art["errorCode"], obs.STARTUP_RESULT_CODES)


if __name__ == "__main__":
    unittest.main()
