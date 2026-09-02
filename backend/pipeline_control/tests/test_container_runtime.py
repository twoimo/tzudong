"""P5 container runtime: split images, loopback publish, non-root, multi-arch docs."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "deploy" / "pipeline-control" / "Dockerfile"
COMPOSE = ROOT / "deploy" / "pipeline-control" / "docker-compose.pipeline.yml"
HARBOR = ROOT / "deploy" / "pipeline-control" / "harbor-tags.md"
CONTRACTS = ROOT / "DATA_CONTRACTS.md"
API = ROOT / "pipeline_control" / "api.py"
FIXTURE = ROOT / "deploy" / "pipeline-control" / "fixtures" / "pg-host-classes.v1.json"


class ContainerRuntimeContractTests(unittest.TestCase):
    def test_dockerfile_splits_api_worker_indexer_as_nonroot(self) -> None:
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn("FROM base AS api", dockerfile)
        self.assertIn("FROM base AS worker", dockerfile)
        self.assertIn("FROM base AS indexer", dockerfile)
        self.assertIn("USER tzudong", dockerfile)
        self.assertIn("useradd --system --uid 10001", dockerfile)
        self.assertIn("ENV PIPELINE_API_HOST=0.0.0.0", dockerfile)
        self.assertIn("STOPSIGNAL SIGTERM", dockerfile)
        self.assertIn('"backend.pipeline_control.api"', dockerfile)
        self.assertIn('"backend.pipeline_control.worker"', dockerfile)
        self.assertIn('"backend.pipeline_control.es_index"', dockerfile)
        self.assertIn(
            "pip install --no-cache-dir -r /workspace/backend/deploy/pipeline-control/requirements.txt",
            dockerfile,
        )

    def test_compose_publishes_loopback_only_and_keeps_db_allowlisted(self) -> None:
        compose = COMPOSE.read_text(encoding="utf-8")
        fixture = FIXTURE.read_text(encoding="utf-8")
        self.assertIn("127.0.0.1:8091:8091", compose)
        self.assertNotIn("0.0.0.0", compose)
        self.assertNotRegex(compose, r"(?im)^\s+postgres:")
        self.assertIn("target: api", compose)
        self.assertIn("target: worker", compose)
        self.assertIn("target: indexer", compose)
        self.assertIn("PIPELINE_CONTROL_DSN: postgresql://postgres@db:5432/postgres", compose)
        self.assertIn('"db"', fixture)
        self.assertIn("aqlcofblfxdrjhhdmarw", fixture)

    def test_harbor_tags_document_multiarch_without_push(self) -> None:
        harbor = HARBOR.read_text(encoding="utf-8")
        self.assertIn("pipeline-api:<gitsha>", harbor)
        self.assertIn("pipeline-worker:<gitsha>", harbor)
        self.assertIn("pipeline-indexer:<gitsha>", harbor)
        self.assertIn("--platform linux/arm64,linux/amd64", harbor)
        self.assertIn("Harbor push needs a separate registry credential approval", harbor)
        self.assertNotIn("docker push", harbor)

    def test_data_contracts_row(self) -> None:
        text = CONTRACTS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control container runtime", text)
        self.assertIn("uid 10001", text)
        self.assertIn("127.0.0.1:8091", text)

    def test_api_bind_host_fail_closed(self) -> None:
        from backend.pipeline_control.api import api_bind_host

        self.assertEqual(api_bind_host("127.0.0.1"), "127.0.0.1")
        self.assertEqual(api_bind_host("0.0.0.0"), "0.0.0.0")
        with self.assertRaises(ValueError) as ctx:
            api_bind_host("1.2.3.4")
        self.assertEqual(str(ctx.exception), "pipeline_api_host_rejected")

    def test_api_reads_pipeline_api_host_env(self) -> None:
        from backend.pipeline_control.api import api_bind_host

        os.environ["PIPELINE_API_HOST"] = "0.0.0.0"
        try:
            self.assertEqual(api_bind_host(), "0.0.0.0")
        finally:
            os.environ.pop("PIPELINE_API_HOST", None)
            self.assertEqual(api_bind_host(), "127.0.0.1")

    def test_api_source_handles_sigterm(self) -> None:
        source = API.read_text(encoding="utf-8")
        self.assertIn("signal.SIGTERM", source)
        self.assertIn("server.shutdown", source)
        self.assertIn('globals()["STORE"] = build_store()', source)


if __name__ == "__main__":
    unittest.main()
