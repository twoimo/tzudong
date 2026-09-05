"""The optional S3 overlay must not downgrade or expose the local stack."""
import unittest
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / "backend/supabase/docker-compose.s3.yml"


class OverlayLoader(yaml.SafeLoader):
    pass


OverlayLoader.add_constructor("!reset", lambda loader, node: loader.construct_sequence(node))


def load_overlay():
    return yaml.load(PATH.read_text(), Loader=OverlayLoader)


class OptionalS3OverlayTests(unittest.TestCase):
    def test_both_minio_images_are_immutable_and_storage_inherits_its_image(self):
        services = load_overlay()["services"]
        for name, image in (("minio", "minio"), ("minio-createbucket", "minio-client")):
            self.assertRegex(services[name]["image"], rf"^cgr\.dev/chainguard/{image}@sha256:[a-f0-9]{{64}}$")
        self.assertNotIn("image", services["storage"])
        self.assertEqual(services["imgproxy"], {"volumes": []})

    def test_no_host_ports_hardcoded_secrets_or_existing_storage_directory(self):
        source = PATH.read_text()
        services = load_overlay()["services"]
        for service in services.values():
            self.assertNotIn("ports", service)
            self.assertNotIn("container_name", service)
        self.assertNotIn("secret1234", source)
        self.assertNotIn("./volumes/storage", source)
        self.assertIn("${MINIO_ROOT_PASSWORD:?", source)
        self.assertEqual(services["minio"]["volumes"], ["minio-data:/data"])
        self.assertIs(services["minio"]["read_only"], True)

    def test_bucket_setup_is_idempotent_and_its_failure_blocks_storage(self):
        services = load_overlay()["services"]
        self.assertEqual(services["minio-createbucket"]["entrypoint"], ["mc"])
        self.assertEqual(services["minio-createbucket"]["command"], ["mb", "--ignore-existing", "storage/${GLOBAL_S3_BUCKET:-stub}"])
        self.assertEqual(services["storage"]["depends_on"]["minio-createbucket"]["condition"], "service_completed_successfully")
        self.assertEqual(services["minio"]["healthcheck"]["test"], ["CMD", "mc", "--config-dir", "/tmp/minio-health", "ready", "local"])
        self.assertNotIn("exit 0", PATH.read_text())

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose is required for merged-descriptor verification")
    def test_rendered_base_and_overlay_drop_both_filesystem_storage_mounts(self):
        # No daemon, credentials, env-file values or container writes are used.
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / "empty.env"
            env_file.write_text("")
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(env_file),
                 "-f", str(ROOT / "backend/supabase/docker-compose.yml"),
                 "-f", str(PATH), "config", "--no-interpolate",
                 "--no-env-resolution", "--format", "json"],
                cwd=ROOT, env={k: os.environ[k] for k in ("PATH", "HOME") if k in os.environ},
                capture_output=True, text=True, timeout=30,
            )
        self.assertEqual(result.returncode, 0, "compose_render_failed")
        services = json.loads(result.stdout)["services"]
        for name in ("storage", "imgproxy"):
            self.assertEqual(services[name].get("volumes", []), [], name)
        volumes = services["minio"]["volumes"]
        self.assertEqual(len(volumes), 1)
        self.assertEqual({k: volumes[0][k] for k in ("type", "source", "target")},
                         {"type": "volume", "source": "minio-data", "target": "/data"})
