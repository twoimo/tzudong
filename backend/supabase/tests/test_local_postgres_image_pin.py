"""Keep each local PostgreSQL image pin on the tag its lane actually needs.

There are two axes now, and they must not drift:

* the **application** stack pins 17 in the Compose service and in the volume helper
  of ``local-stack.py``; it is provisioned from ``baselines/local/schema``;
* the **replay** lane pins 15 in the committed replay override, in the nightly
  prefetch list and readiness probe, and in ``BOOTSTRAP_SOURCES.v1.json``, whose
  upstream digests describe the 15 image the auth bootstrap was generated from.

The PG15 replay adapters in ``local-migrate.py`` only accept major 15, which is why
the replay lane keeps 15 rather than the application moving backwards. A change to
one pin without its lane produces a stack that starts on one image and is verified
against another. The ordering of a major move is described in
``docs/operations/local-postgres17-transition.md``.
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
REPLAY_OVERRIDE = ROOT / "backend/supabase/docker-compose.replay.yml"
DOCKER_HUB_PREFIX = "docker.io/"


def _tags(pattern: re.Pattern[str], text: str) -> list[str]:
    return [match.group("tag") for match in pattern.finditer(text)]


class LocalPostgresImagePinTests(unittest.TestCase):
    def test_the_application_stack_pins_one_tag(self) -> None:
        compose = _tags(IMAGE, COMPOSE.read_text(encoding="utf-8"))
        helper = _tags(IMAGE, LOCAL_STACK.read_text(encoding="utf-8"))
        self.assertTrue(compose, "docker-compose.yml must pin supabase/postgres")
        self.assertEqual(len(set(compose)), 1, compose)
        self.assertEqual(len(set(helper)), 1, helper)
        self.assertEqual(
            set(compose) | set(helper),
            {"17.11.0.018"},
            "the application stack pins PostgreSQL 17 in Compose and in the volume helper",
        )

    def test_the_replay_lane_pins_one_tag(self) -> None:
        override = _tags(IMAGE, REPLAY_OVERRIDE.read_text(encoding="utf-8"))
        self.assertEqual(set(override), {"15.8.1.085"}, override)
        # The local job is the replay lane; the provisioning job is the application one.
        local_job = NIGHTLY.read_text(encoding="utf-8").split("  pg17-provision:")[0]
        pins = _tags(IMAGE, local_job)
        self.assertTrue(pins, "the nightly must pin the prefetch list and readiness probe")
        self.assertEqual(set(pins), {"15.8.1.085"}, pins)

    def test_the_provisioning_lane_pins_the_application_image(self) -> None:
        workflow = NIGHTLY.read_text(encoding="utf-8")
        lane = workflow.split("  pg17-provision:")[1] if "  pg17-provision:" in workflow else ""
        self.assertEqual(set(_tags(IMAGE, lane)), {"17.11.0.018"}, lane[:200])

    def test_the_bootstrap_inventory_still_describes_the_replay_image(self) -> None:
        bootstrap = json.loads(BOOTSTRAP.read_text(encoding="utf-8"))
        image = str(bootstrap["platformAuthBootstrap"]["ociImage"])
        self.assertTrue(image.startswith(DOCKER_HUB_PREFIX), image)
        self.assertEqual(
            image[len(DOCKER_HUB_PREFIX):],
            "supabase/postgres:15.8.1.085",
            "the bootstrap inventory records upstream sources of the 15 image; regenerate "
            "it before claiming it describes another tag",
        )

    def test_the_nightly_pins_both_the_prefetch_and_the_probe(self) -> None:
        nightly = NIGHTLY.read_text(encoding="utf-8")
        self.assertGreaterEqual(
            len(_tags(IMAGE, nightly)),
            2,
            "nightly-local-regression.yml must pin the prefetch list and the readiness probe",
        )

    def test_a_replay_pin_requires_the_adapter_layer(self) -> None:
        """The replay lane may only exist while the adapters it depends on do."""
        migrate = (ROOT / "backend/supabase/scripts/local-migrate.py").read_text(encoding="utf-8")
        has_adapters = "_canonical_source_replay_bodies" in migrate
        replay_tag = _tags(IMAGE, REPLAY_OVERRIDE.read_text(encoding="utf-8"))[0]
        if has_adapters:
            self.assertEqual(
                int(replay_tag.split(".")[0]),
                15,
                "the replay adapters only accept server major 15",
            )
        else:
            self.fail(
                "the replay adapters are gone, so backend/supabase/docker-compose.replay.yml "
                "and the nightly replay lane have nothing left to pin"
            )


if __name__ == "__main__":
    unittest.main()
