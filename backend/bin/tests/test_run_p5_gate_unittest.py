"""Current P5 layout/naming gate contract."""

import unittest
from pathlib import Path

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p5_gate import PHASE_ID, run_p5_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase

ROOT = Path(__file__).resolve().parents[3]


class P5GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p5_gate, PHASE_ID)

    def test_layout_phase_is_unassigned_and_duplicate_tree_is_absent(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [])
        self.assertFalse((ROOT / "backend/deploy/pipeline-control").exists())
        self.assertTrue(any(item["conditionId"] == "P5-E2" for item in selected["entryConditions"]))


if __name__ == "__main__":
    unittest.main()
