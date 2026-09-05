"""Current P4 supply-chain gate contract."""

import unittest

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p4_gate import PHASE_ID, run_p4_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase


class P4GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p4_gate, PHASE_ID)

    def test_branch_protection_remains_an_external_exit_condition(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [9])
        condition = next(item for item in selected["exitConditions"] if item["conditionId"] == "P4-X3")
        self.assertEqual(condition["evidenceClass"], "external")


if __name__ == "__main__":
    unittest.main()
