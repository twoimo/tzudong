"""Current P7 readiness-agent gate contract."""

import json
import unittest
from pathlib import Path

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p7_gate import PHASE_ID, run_p7_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase

ROOT = Path(__file__).resolve().parents[3]


class P7GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p7_gate, PHASE_ID)

    def test_release_evidence_remains_unresolved(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [13])
        readiness = json.loads((ROOT / "backend/deploy/migration-readiness.v1.json").read_text())
        self.assertTrue(all(item["status"] == "unresolved" for item in readiness["releaseGates"]))


if __name__ == "__main__":
    unittest.main()
