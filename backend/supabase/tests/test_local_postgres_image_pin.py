"""Keep every local PostgreSQL image pin on the same tag.

The local stack pins the database image in four places: the Compose service, the
volume helper in ``local-stack.py``, the nightly prefetch list and the nightly
readiness probe. ``volumes/db/BOOTSTRAP_SOURCES.v1.json`` records the same image
for the bootstrap manifest, and the PG15 replay adapters in ``local-migrate.py``
only accept server major 15.

A change to one pin without the others produces a stack that starts on one image
and is verified against another, or a nightly run that cannot create the database
at all. The transition plan in ``docs/operations/local-postgres17-transition.md``
describes what else has to move with a major bump; this test only guarantees that
the pins never drift apart silently.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
COMPOSE = ROOT / "backend/supabase/docker-compose.yml"
LOCAL_STACK = ROOT / "backend/supabase/scripts/local-stack.py"
NIGHTLY = ROOT / ".github/workflows/nightly-local-regression.yml"
BOOTSTRAP = ROOT / "backend/supabase/volumes/db/BOOTSTRAP_SOURCES.v1.json"

IMAGE = re.compile(r"supabase/postgres:(?P<tag>\d+\.\d+\.\d+\.\d+)")
DOCKER_HUB_PREFIX = "docker.io/"


def _tags(pattern: re.Pattern[str], text: str) -> list[str]:
    return [match.group("tag") for match in pattern.finditer(text)]


class LocalPostgresImagePinTests(unittest.TestCase):
    def test_the_application_stack_pins_seventeen(self) -> None:
        compose = COMPOSE.read_text(encoding="utf-8")
        self.assertIn("${POSTGRES_IMAGE:-supabase/postgres:17.11.0.018}", compose)
        stack = LOCAL_STACK.read_text(encoding="utf-8")
        self.assertIn('APPLICATION_IMAGE = "supabase/postgres:17.11.0.018"', stack)
        # The volume helper must run the image of the service it prepares.
        self.assertIn("                _postgres_image(),", stack)

    def test_the_replay_lane_pins_fifteen(self) -> None:
        stack = LOCAL_STACK.read_text(encoding="utf-8")
        self.assertIn('REPLAY_IMAGE = "supabase/postgres:15.8.1.085"', stack)
        self.assertIn('REPLAY_STACK_ENV = "LOCAL_STACK_REPLAY_STACK"', stack)
        local_job = NIGHTLY.read_text(encoding="utf-8").split("  pg17-provision:")[0]
        pins = _tags(IMAGE, local_job)
        self.assertTrue(pins, "the replay lane prefetches and probes the 15 image")
        self.assertEqual(set(pins), {"15.8.1.085"}, pins)

    def test_the_provisioning_lane_pins_the_application_image(self) -> None:
        workflow = NIGHTLY.read_text(encoding="utf-8")
        lane = workflow.split("  pg17-provision:")[1] if "  pg17-provision:" in workflow else ""
        self.assertEqual(set(_tags(IMAGE, lane)), {"17.11.0.018"}, lane[:200])

    def test_the_replay_switch_is_scoped_to_the_stack_step(self) -> None:
        # A job-level env leaks into the unnamed run blocks, which the lane aggregate
        # reads as the suite name (measured: the aggregate failed with the switch set).
        workflow = NIGHTLY.read_text(encoding="utf-8")
        job_env = workflow.split("jobs:")[0]
        self.assertNotIn("LOCAL_STACK_REPLAY_STACK", job_env)
        self.assertIn("LOCAL_STACK_REPLAY_STACK: '1'", workflow)

    def test_the_applier_accepts_only_these_two_images(self) -> None:
        migrate = (ROOT / "backend/supabase/scripts/local-migrate.py").read_text(encoding="utf-8")
        for image in ("supabase/postgres:17.11.0.018", "supabase/postgres:15.8.1.085"):
            self.assertIn(f'"{image}"', migrate)
    def test_the_bootstrap_inventory_describes_the_replay_image(self) -> None:
        bootstrap = json.loads(BOOTSTRAP.read_text(encoding="utf-8"))
        image = str(bootstrap["platformAuthBootstrap"]["ociImage"])
        self.assertTrue(image.startswith(DOCKER_HUB_PREFIX), image)
        self.assertEqual(
            image[len(DOCKER_HUB_PREFIX):],
            "supabase/postgres:15.8.1.085",
            "the bootstrap inventory records upstream sources of the 15 image; regenerate "
            "it before claiming it describes another tag",
        )

    def test_a_replay_pin_requires_the_adapter_layer(self) -> None:
        """The replay lane may only exist while the adapters it depends on do."""
        migrate = (ROOT / "backend/supabase/scripts/local-migrate.py").read_text(encoding="utf-8")
        stack = LOCAL_STACK.read_text(encoding="utf-8")
        replay = re.search(r'REPLAY_IMAGE = "supabase/postgres:(\d+\.\d+\.\d+\.\d+)"', stack).group(1)
        if "_canonical_source_replay_bodies" in migrate:
            self.assertEqual(int(replay.split(".")[0]), 15, "the replay adapters only accept 15")
        else:
            self.fail("the replay adapters are gone, so the replay image constant has nothing left to pin")


if __name__ == "__main__":
    unittest.main()
