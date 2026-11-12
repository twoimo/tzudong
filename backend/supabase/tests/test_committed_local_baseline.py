"""The committed local baseline must stay usable and must report drift.

The baseline is what a provisioned stack boots from, so it is checked like any other
committed contract: the four captured files are present, each matches the manifest
digest, no scratch file slipped in, and a live capture that differs produces drift
rather than silence.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASELINE = ROOT / "backend/supabase/baselines/local/schema"
sys.path.insert(0, str(ROOT / "backend/supabase/scripts"))

import local_baseline as lb  # noqa: E402

EXPECTED_FILES = {"schema.sql", "objects.txt", "roles.sql", "manifest.json"}


class CommittedBaselineTests(unittest.TestCase):
    def test_the_baseline_loads_and_self_verifies(self) -> None:
        baseline = lb.load_baseline(BASELINE)
        self.assertGreater(baseline.manifest["objectCount"], 0)
        self.assertGreater(baseline.manifest["schemaBytes"], 0)

    def test_only_captured_files_are_committed(self) -> None:
        present = {path.name for path in BASELINE.iterdir() if path.is_file()}
        self.assertEqual(present, EXPECTED_FILES)

    def test_every_object_is_listed_once(self) -> None:
        names = [line for line in (BASELINE / "objects.txt").read_text().splitlines() if line]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(names), lb.load_baseline(BASELINE).manifest["objectCount"])

    def test_roles_cover_the_privacy_workflow_owner(self) -> None:
        # Measured: 119 restore errors were this role missing, so the baseline must
        # carry it rather than depending on the target cluster to have it.
        roles = (BASELINE / "roles.sql").read_text()
        self.assertIn("privacy_workflow_owner", roles)
        for line in roles.splitlines():
            if line.strip():
                self.assertTrue(line.endswith(";"), line)


class DriftTests(unittest.TestCase):
    def setUp(self) -> None:
        self.committed = lb.load_baseline(BASELINE)

    def test_an_identical_capture_has_no_drift(self) -> None:
        self.assertEqual(lb.drift(self.committed, dict(self.committed.manifest)), [])

    def test_a_changed_object_set_is_drift(self) -> None:
        live = dict(self.committed.manifest)
        live["objectCount"] = live["objectCount"] + 1
        live["objectNamesSha256"] = "0" * 64
        differences = lb.drift(self.committed, live)
        self.assertEqual(len(differences), 2)
        self.assertTrue(any("objectNamesSha256" in item for item in differences))

    def test_a_changed_role_set_is_drift(self) -> None:
        live = dict(self.committed.manifest)
        live["roleStatementCount"] = live["roleStatementCount"] + 1
        self.assertEqual(len(lb.drift(self.committed, live)), 1)

    def test_the_dump_hash_alone_is_not_a_gate(self) -> None:
        # pg_dump output can differ without the schema differing, so the gate reads the
        # object set. The dump hash stays in the manifest for information.
        live = dict(self.committed.manifest)
        live["schemaSha256"] = "f" * 64
        self.assertEqual(lb.drift(self.committed, live), [])

    def test_the_compare_command_exits_non_zero_on_drift(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            live = dict(self.committed.manifest)
            live["objectCount"] = 0
            record = Path(tmp) / "record.json"
            record.write_text(json.dumps({"baselineManifest": live}))
            code = lb.main(["compare", "--baseline", str(BASELINE), "--record", str(record)])
            self.assertEqual(code, 1)
            record.write_text(json.dumps({"baselineManifest": dict(self.committed.manifest)}))
            self.assertEqual(lb.main(["compare", "--baseline", str(BASELINE), "--record", str(record)]), 0)


if __name__ == "__main__":
    unittest.main()
