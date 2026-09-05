"""Current P3 observability gate contract."""

import unittest

from backend.bin.phase_gate import load_phase_catalog
from backend.bin.run_p3_gate import PHASE_ID, run_p3_gate
from backend.bin.tests.phase_gate_test_support import exercise_runner, phase


class P3GateTests(unittest.TestCase):
    def test_runner_is_fail_closed_and_commit_bound(self) -> None:
        exercise_runner(self, run_p3_gate, PHASE_ID)

    def test_observability_requires_real_external_readback(self) -> None:
        selected = phase(load_phase_catalog(), PHASE_ID)
        self.assertEqual(selected["assignedRequirements"], [12])
        external = [item for item in selected["exitConditions"] if item["evidenceClass"] == "external"]
        self.assertEqual([item["conditionId"] for item in external], ["P3-X3"])


if __name__ == "__main__":
    unittest.main()
