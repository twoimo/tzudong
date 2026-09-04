"""The optional S3 overlay must not downgrade or expose the local stack."""
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / "backend/supabase/docker-compose.s3.yml"


class OptionalS3OverlayTests(unittest.TestCase):
    def test_both_minio_images_are_immutable_and_storage_inherits_its_image(self):
        services = yaml.safe_load(PATH.read_text())["services"]
        for name, image in (("minio", "minio"), ("minio-createbucket", "minio-client")):
            self.assertRegex(services[name]["image"], rf"^cgr\.dev/chainguard/{image}@sha256:[a-f0-9]{{64}}$")
        self.assertNotIn("image", services["storage"])
        self.assertNotIn("imgproxy", services)

    def test_no_host_ports_hardcoded_secrets_or_existing_storage_directory(self):
        source = PATH.read_text()
        services = yaml.safe_load(source)["services"]
        for service in services.values():
            self.assertNotIn("ports", service)
            self.assertNotIn("container_name", service)
        self.assertNotIn("secret1234", source)
        self.assertNotIn("./volumes/storage", source)
        self.assertIn("${MINIO_ROOT_PASSWORD:?", source)
        self.assertEqual(services["minio"]["volumes"], ["minio-data:/data"])
        self.assertIs(services["minio"]["read_only"], True)

    def test_bucket_setup_is_idempotent_and_its_failure_blocks_storage(self):
        services = yaml.safe_load(PATH.read_text())["services"]
        self.assertEqual(services["minio-createbucket"]["entrypoint"], ["mc"])
        self.assertEqual(services["minio-createbucket"]["command"], ["mb", "--ignore-existing", "storage/${GLOBAL_S3_BUCKET:-stub}"])
        self.assertEqual(services["storage"]["depends_on"]["minio-createbucket"]["condition"], "service_completed_successfully")
        self.assertEqual(services["minio"]["healthcheck"]["test"], ["CMD", "mc", "--config-dir", "/tmp/minio-health", "ready", "local"])
        self.assertNotIn("exit 0", PATH.read_text())
