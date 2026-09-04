"""Current P2 publication gate contract."""

import json
import unittest
from pathlib import Path

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p2_gate import PHASE_ID, run_p2_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase

ROOT = Path(__file__).resolve().parents[3]


class P2GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p2_gate, PHASE_ID)

    def test_publication_requires_external_approval_and_readback(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [14])
        self.assertTrue(all(item["evidenceClass"] == "external" for item in selected["entryConditions"]))
        for path in (
            ROOT / "backend/deploy/publication-set.v1.json",
            ROOT / "backend/deploy/publish-schedule.approved.json",
        ):
            self.assertEqual(json.loads(path.read_text())["approval"]["status"], "unresolved")


if __name__ == "__main__":
    unittest.main()
