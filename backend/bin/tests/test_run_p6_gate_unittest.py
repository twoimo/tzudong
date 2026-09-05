"""Current P6 Rust/performance gate contract."""

import unittest

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p6_gate import PHASE_ID, run_p6_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase


class P6GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p6_gate, PHASE_ID)

    def test_live_parity_performance_and_retirement_remain_external(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [10, 11])
        self.assertTrue(all(item["evidenceClass"] == "external" for item in selected["exitConditions"]))


if __name__ == "__main__":
    unittest.main()
