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
    def test_every_pin_uses_the_same_image_tag(self) -> None:
        compose = _tags(IMAGE, COMPOSE.read_text(encoding="utf-8"))
        helper = _tags(IMAGE, LOCAL_STACK.read_text(encoding="utf-8"))
        nightly = _tags(IMAGE, NIGHTLY.read_text(encoding="utf-8"))
        bootstrap = json.loads(BOOTSTRAP.read_text(encoding="utf-8"))
        bootstrap_image = str(bootstrap["platformAuthBootstrap"]["ociImage"])

        self.assertTrue(compose, "docker-compose.yml must pin supabase/postgres")
        self.assertEqual(len(set(compose)), 1, compose)
        self.assertEqual(len(set(helper)), 1, helper)
        self.assertEqual(len(set(nightly)), 1, nightly)
        self.assertTrue(bootstrap_image.startswith(DOCKER_HUB_PREFIX), bootstrap_image)
        bootstrap_tag = bootstrap_image[len(DOCKER_HUB_PREFIX):]

        pinned = f"supabase/postgres:{compose[0]}"
        pins = {
            "backend/supabase/docker-compose.yml": pinned,
            "backend/supabase/scripts/local-stack.py": f"supabase/postgres:{helper[0]}",
            ".github/workflows/nightly-local-regression.yml (prefetch + readiness probe)": f"supabase/postgres:{nightly[0]}",
            "backend/supabase/volumes/db/BOOTSTRAP_SOURCES.v1.json": bootstrap_tag,
        }
        self.assertEqual(
            set(pins.values()),
            {pinned},
            "Update every local PostgreSQL pin together: " + json.dumps(pins, sort_keys=True),
        )

    def test_the_nightly_pins_both_the_prefetch_and_the_probe(self) -> None:
        nightly = NIGHTLY.read_text(encoding="utf-8")
        self.assertGreaterEqual(
            len(_tags(IMAGE, nightly)),
            2,
            "nightly-local-regression.yml must pin the prefetch list and the readiness probe",
        )

    def test_a_major_change_is_declared_with_its_adapter_layer(self) -> None:
        """A PG17 pin only works after the PG15 replay adapters are retired.

        This documents the coupling rather than enforcing a version: the plan
        document owns the ordering, and the guard above keeps the pins aligned.
        """
        migrate = (ROOT / "backend/supabase/scripts/local-migrate.py").read_text(encoding="utf-8")
        has_adapters = "_canonical_source_replay_bodies" in migrate
        tag = _tags(IMAGE, COMPOSE.read_text(encoding="utf-8"))[0]
        major = int(tag.split(".")[0])
        if has_adapters:
            self.assertEqual(
                major,
                15,
                "PG15 replay adapters are still wired in local-migrate.py; retire them "
                "(and regenerate the BOOTSTRAP_SOURCES hashes) before pinning a newer major",
            )
        else:
            self.assertNotEqual(major, 15, "the PG15 adapter layer is gone, so the pin must move off 15")


if __name__ == "__main__":
    unittest.main()
