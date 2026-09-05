"""Current P1 gate contract."""

import unittest

from backend.bin.run_p1_gate import PHASE_ID, run_p1_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase
from backend.bin.phase_gate import load_phase_catalog


class P1GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p1_gate, PHASE_ID)

    def test_current_foundation_requirement_partition(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["sequence"], 1)
        self.assertEqual(selected["assignedRequirements"], list(range(1, 9)))
        self.assertTrue(any(item["evidenceClass"] == "external" for item in selected["exitConditions"]))


if __name__ == "__main__":
    unittest.main()
