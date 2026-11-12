"""Local selection contracts plus native, daemon-free Compose render checks.

Source checks do not emulate Compose merging. The required Security CI job
sets REQUIRE_DOCKER_COMPOSE=1 so missing Compose cannot turn render proof into
a passing skip. No test starts a container, opens a DB, or applies a migration.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
COMPOSE_DIR = ROOT / "backend" / "pipeline-control"
BASE = "docker-compose.pipeline.yml"
EVENTS = "docker-compose.pipeline.events.yml"
SEARCH = "docker-compose.pipeline.search.yml"
TELEMETRY = "docker-compose.pipeline.telemetry.yml"
APPLICATIONS = {"pipeline-api", "pipeline-worker", "pipeline-publisher", "pipeline-indexer"}
OBSERVERS = {"otel-storage-init", "otel-collector", "loki", "prometheus", "grafana"}
DSN = "postgresql://postgres@db:5432/postgres"
ENDPOINT = "http://otel-collector:4318"


def source_services(name: str) -> dict:
    # Native render CI needs only the standard library. Source tests use the
    # repository's existing pinned backend/test-requirements.txt dependency.
    import yaml

    return yaml.safe_load((COMPOSE_DIR / name).read_text(encoding="utf-8"))["services"]


class ComposeSourceTests(unittest.TestCase):
    def test_default_is_api_with_explicit_batch_and_functional_optional_consumers(self) -> None:
        services = source_services(BASE)
        self.assertEqual({name for name, value in services.items() if not value.get("profiles")}, {"pipeline-api"})
        self.assertEqual(services["pipeline-worker"]["profiles"], ["batch"])
        self.assertIs(services["pipeline-worker"]["init"], True)
        self.assertNotIn("restart", services["pipeline-worker"])
        self.assertEqual(services["pipeline-publisher"]["profiles"], ["events"])
        self.assertEqual(services["pipeline-indexer"]["profiles"], ["search"])
        self.assertEqual(services["pipeline-publisher"]["environment"]["TZUDONG_PIPELINE_EVENTS"], "kafka")
        self.assertEqual(services["pipeline-indexer"]["environment"]["TZUDONG_PIPELINE_ES"], "es")
        for service in services.values():
            self.assertFalse(any(key.startswith("OTEL_EXPORTER_") for key in service["environment"]))

    def test_events_selects_shared_local_outbox_without_changing_job_or_live_modes(self) -> None:
        base = source_services(BASE)
        events = source_services(EVENTS)
        for name in ("pipeline-api", "pipeline-worker"):
            env = events[name]["environment"]
            self.assertEqual(env["TZUDONG_PIPELINE_OUTBOX"], "postgres")
            self.assertEqual(env["TZUDONG_PIPELINE_EVENTS"], "kafka")
            self.assertEqual(env["TZUDONG_KAFKA_BOOTSTRAP"], "kafka:9092")
            self.assertEqual(base[name]["environment"]["PIPELINE_CONTROL_DSN"], DSN)
            self.assertNotIn("TZUDONG_PIPELINE_OUTBOX", base[name]["environment"])
        self.assertEqual(base["pipeline-publisher"]["environment"]["TZUDONG_PIPELINE_OUTBOX"], "postgres")
        self.assertEqual(base["pipeline-publisher"]["environment"]["PIPELINE_CONTROL_DSN"], DSN)
        for filename in (BASE, EVENTS, SEARCH, TELEMETRY):
            for service in source_services(filename).values():
                for key in ("TZUDONG_PIPELINE_STORE", "TZUDONG_PIPELINE_PERSIST", "TZUDONG_PIPELINE_LIVE"):
                    self.assertNotIn(key, service.get("environment", {}))

    def test_exporter_layer_selects_its_collector_without_enabling_other_profiles(self) -> None:
        services = source_services(TELEMETRY)
        self.assertEqual(set(services), APPLICATIONS | OBSERVERS)
        for name in APPLICATIONS:
            self.assertEqual(services[name]["environment"]["OTEL_EXPORTER_OTLP_ENDPOINT"], ENDPOINT)
            self.assertEqual(services[name]["depends_on"], ["otel-collector"])
            self.assertNotIn("profiles", services[name])
        for name in OBSERVERS:
            self.assertEqual(services[name]["extends"], {"file": "docker-compose.observability.yml", "service": name})


class ComposeRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.docker = shutil.which("docker")
        available = False
        if cls.docker:
            try:
                result = subprocess.run(
                    [cls.docker, "compose", "version"],
                    capture_output=True, text=True, timeout=30, check=False,
                )
                available = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                pass
        if not available:
            if os.environ.get("REQUIRE_DOCKER_COMPOSE") == "1":
                raise AssertionError("docker_compose_required_for_render_validation")
            raise unittest.SkipTest("Docker Compose unavailable; native render validation not executed")

    def render(self, files: list[str], profiles: list[str], *, telemetry: bool = False, succeeds: bool = True) -> dict:
        # Do not read operator .env files or inherit COMPOSE_PROFILES. The
        # fixture password is only interpolated into this in-memory model;
        # config never starts a service and no rendered config is printed.
        env = {key: value for key, value in os.environ.items() if not key.startswith("COMPOSE_")}
        env["TZUDONG_LOCAL_SUPABASE_NETWORK"] = "fixture-local-supabase"
        env.pop("GRAFANA_ADMIN_PASSWORD", None)
        if telemetry:
            env["GRAFANA_ADMIN_PASSWORD"] = "compose-config-fixture-only"
        command = [self.docker, "compose", "--env-file", os.devnull]
        for filename in files:
            command += ["-f", str(COMPOSE_DIR / filename)]
        for profile in profiles:
            command += ["--profile", profile]
        command += ["config", "--format", "json"]
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=30, check=False)
        if not succeeds:
            self.assertNotEqual(result.returncode, 0, "incomplete_compose_selection_was_admitted")
            return {}
        self.assertEqual(result.returncode, 0, "compose_config_failed:" + ",".join(files + profiles))
        return json.loads(result.stdout)

    def assert_mode(self, model: dict, *, events: bool, search: bool, batch: bool, telemetry: bool) -> None:
        expected = {"pipeline-api"}
        if batch:
            expected.add("pipeline-worker")
        if events:
            expected |= {"pipeline-publisher", "kafka", "kafka-ui"}
        if search:
            expected |= {"pipeline-indexer", "elasticsearch"}
        if telemetry:
            expected |= OBSERVERS
        services = model["services"]
        self.assertEqual(set(services), expected)
        self.assertEqual(model["name"], "tzudong-pipeline-control")
        network = model["networks"]["supabase_network_local"]
        self.assertEqual(network["name"], "fixture-local-supabase")
        self.assertIs(network["external"], True)
        # Compose may materialize its default empty IPAM object. Any explicit
        # network allocation remains forbidden for this external local network.
        self.assertFalse(network.get("ipam"))
        for name, service in services.items():
            if name == "otel-storage-init":
                self.assertEqual(service["network_mode"], "none")
            else:
                self.assertEqual(set(service["networks"]), {"supabase_network_local"})
            for port in service.get("ports", []):
                self.assertEqual(port["host_ip"], "127.0.0.1")
            if name not in APPLICATIONS:
                continue
            env = service["environment"]
            self.assertEqual(env["TZUDONG_DATA_ENV"], "local_db")
            self.assertEqual(env["PIPELINE_CONTROL_DSN"], DSN)
            self.assertEqual(env["OTEL_SERVICE_NAME"], name)
            self.assertEqual(bool(env.get("OTEL_EXPORTER_OTLP_ENDPOINT")), telemetry)
            self.assertNotIn("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", env)
            for key in ("TZUDONG_PIPELINE_STORE", "TZUDONG_PIPELINE_PERSIST", "TZUDONG_PIPELINE_LIVE"):
                self.assertNotIn(key, env)
            self.assertEqual(Path(service["build"]["context"]), ROOT)
            self.assertEqual(service["build"]["dockerfile"], "backend/pipeline-control/Dockerfile")
            if telemetry:
                self.assertEqual(env["OTEL_EXPORTER_OTLP_ENDPOINT"], ENDPOINT)
                self.assertIn("otel-collector", service["depends_on"])
            if name in {"pipeline-api", "pipeline-worker"}:
                self.assertEqual(env.get("TZUDONG_PIPELINE_EVENTS", "noop"), "kafka" if events else "noop")
                self.assertEqual(env.get("TZUDONG_PIPELINE_OUTBOX", "none"), "postgres" if events else "none")
                mounts = {mount["target"]: mount for mount in service["volumes"]}
                self.assertEqual(mounts["/workspace"]["type"], "bind")
                self.assertEqual(Path(mounts["/workspace"]["source"]), ROOT)
                if events:
                    self.assertIn("pipeline-publisher", service["depends_on"])
                if search:
                    self.assertIn("pipeline-indexer", service["depends_on"])
        if batch:
            worker = services["pipeline-worker"]
            self.assertIs(worker["init"], True)
            self.assertNotIn("restart", worker)
            self.assertEqual(worker["command"], ["python", "-m", "backend.pipeline_control.worker"])
            self.assertEqual(worker["environment"].get("TZUDONG_PIPELINE_ES", "noop"), "es" if search else "noop")
        if events:
            publisher = services["pipeline-publisher"]
            self.assertEqual(publisher["environment"]["TZUDONG_PIPELINE_EVENTS"], "kafka")
            self.assertEqual(publisher["environment"]["TZUDONG_PIPELINE_OUTBOX"], "postgres")
            self.assertIn("kafka", publisher["depends_on"])
        if search:
            indexer = services["pipeline-indexer"]
            self.assertEqual(indexer["environment"]["TZUDONG_PIPELINE_ES"], "es")
            self.assertTrue({"kafka", "elasticsearch"} <= set(indexer["depends_on"]))
        if telemetry:
            self.assertIn("otel-storage", model["volumes"])
            for name in ("otel-storage-init", "otel-collector"):
                mounts = {mount["target"]: mount for mount in services[name]["volumes"]}
                self.assertEqual(mounts["/var/lib/otelcol"]["type"], "volume")
                self.assertEqual(mounts["/var/lib/otelcol"]["source"], "otel-storage")
            collector = services["otel-collector"]
            self.assertEqual(collector["depends_on"]["otel-storage-init"]["condition"], "service_completed_successfully")
            for service_name, target, source in (
                ("otel-collector", "/etc/otelcol/config.yaml", COMPOSE_DIR / "otel-collector.yaml"),
                ("otel-collector", "/var/log/tzudong", ROOT / "backend" / "log"),
                ("prometheus", "/etc/prometheus/prometheus.yml", COMPOSE_DIR / "prometheus.yml"),
                ("grafana", "/etc/grafana/provisioning", COMPOSE_DIR / "grafana" / "provisioning"),
            ):
                mount = next(item for item in services[service_name]["volumes"] if item["target"] == target)
                self.assertEqual(Path(mount["source"]), source)
                self.assertIs(mount["read_only"], True)
            self.assertEqual(services["grafana"]["environment"]["GF_AUTH_ANONYMOUS_ENABLED"], "false")
        else:
            self.assertFalse(model.get("volumes"))

    def test_supported_mode_matrix(self) -> None:
        for events, search in ((False, False), (True, False), (True, True)):
            for batch in (False, True):
                for telemetry in (False, True):
                    with self.subTest(events=events, search=search, batch=batch, telemetry=telemetry):
                        files, profiles = [BASE], []
                        if events:
                            files.append(EVENTS)
                            profiles.append("events")
                        if search:
                            files.append(SEARCH)
                            profiles.append("search")
                        if telemetry:
                            files.append(TELEMETRY)
                        if batch:
                            profiles.append("batch")
                        model = self.render(files, profiles, telemetry=telemetry)
                        self.assert_mode(model, events=events, search=search, batch=batch, telemetry=telemetry)

    def test_missing_feature_layers_or_profiles_are_rejected(self) -> None:
        for files, profiles in (
            ([BASE], ["events"]),
            ([BASE], ["search"]),
            ([BASE, EVENTS], []),
            ([BASE, SEARCH], ["search"]),
            ([BASE, EVENTS, SEARCH], ["events"]),
        ):
            with self.subTest(files=files, profiles=profiles):
                self.render(files, profiles, succeeds=False)

    def test_telemetry_keeps_required_dashboard_credential(self) -> None:
        self.render([BASE, TELEMETRY], [], telemetry=False, succeeds=False)


if __name__ == "__main__":
    unittest.main()
