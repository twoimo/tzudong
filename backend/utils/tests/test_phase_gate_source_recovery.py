"""Source contracts for the rebuilt current-input phase gates."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.bin.phase_gate import PHASE_IDS, validate_phase_assignment


ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "backend/deploy/phase-gates.v1.json"
PHASE_SOURCE_PATHS = (
    "backend/bin/phase_gate.py",
    *(f"backend/bin/run_p{number}_gate.py" for number in range(1, 8)),
    *(f"backend/bin/tests/test_run_p{number}_gate_unittest.py" for number in range(1, 8)),
    "backend/pipeline_control/test_phase_partition_pbt.py",
    "backend/pipeline_control/test_rollback_plan_pbt.py",
)
PHASE_TEST_MODULES = (
    "backend.utils.tests.test_phase_gate_source_recovery",
    "backend.bin.tests.test_phase_gate_unittest",
    *(f"backend.bin.tests.test_run_p{number}_gate_unittest" for number in range(1, 8)),
    "backend.pipeline_control.test_phase_partition_pbt",
    "backend.pipeline_control.test_rollback_plan_pbt",
)


class PhaseGateSourceRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    def test_every_historical_phase_path_is_rebuilt(self) -> None:
        self.assertEqual(len(PHASE_SOURCE_PATHS), 17)
        for relative in PHASE_SOURCE_PATHS:
            self.assertTrue((ROOT / relative).is_file(), relative)

    def test_catalog_is_current_complete_and_fail_closed(self) -> None:
        self.assertEqual(
            validate_phase_assignment(self.catalog),
            {"ok": True, "errorCode": None},
        )
        self.assertEqual(
            [phase["phaseId"] for phase in self.catalog["phases"]],
            list(PHASE_IDS),
        )
        assigned = [
            requirement
            for phase in self.catalog["phases"]
            for requirement in phase["assignedRequirements"]
        ]
        self.assertEqual(sorted(assigned), list(range(1, 15)))
        self.assertEqual(len(self.catalog["verificationCommands"]), 7)
        self.assertTrue(
            all(
                command["timeoutSeconds"] == 1800
                for command in self.catalog["verificationCommands"]
            )
        )

    def test_external_conditions_are_explicit_and_never_pre_satisfied(self) -> None:
        raw = CATALOG_PATH.read_text(encoding="utf-8")
        self.assertNotIn('"satisfied"', raw)
        self.assertNotIn('"evidenceRef"', raw)
        for phase in self.catalog["phases"]:
            conditions = [*phase["entryConditions"], *phase["exitConditions"]]
            if phase["sequence"] > 1:
                self.assertTrue(any(item["evidenceClass"] == "external" for item in conditions))
        p2 = self.catalog["phases"][1]
        self.assertTrue(all(item["evidenceClass"] == "external" for item in p2["entryConditions"]))

    def test_thin_runners_do_not_execute_or_contact_external_systems(self) -> None:
        for number in range(1, 8):
            source = (ROOT / f"backend/bin/run_p{number}_gate.py").read_text(encoding="utf-8")
            self.assertNotIn("subprocess", source)
            self.assertNotIn("requests", source)
            self.assertNotIn("supabase", source.lower())
            self.assertIn("run_configured_phase", source)
            self.assertIn("cli_for_phase", source)

    def test_generic_gate_has_opt_in_execution_and_non_destructive_rollback_allowlist(self) -> None:
        source = (ROOT / "backend/bin/phase_gate.py").read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--run-verification", action="store_true")', source)
        self.assertIn('parser.add_argument("--write-report", action="store_true")', source)
        self.assertIn("stdout=subprocess.DEVNULL", source)
        self.assertIn("stderr=subprocess.DEVNULL", source)
        self.assertIn('argv[1:3] == ["revert", "--no-edit"]', source)
        for forbidden in ("reset", "stash", "clean", "checkout", "switch", "restore"):
            self.assertIn(f'"{forbidden}"', source)

    def test_security_workflow_runs_all_phase_contracts(self) -> None:
        workflow = (ROOT / ".github/workflows/security-audit.yml").read_text(encoding="utf-8")
        for module in PHASE_TEST_MODULES:
            self.assertEqual(workflow.count(module), 1, module)
        self.assertIn("backend/deploy/phase-gates.v1.json", workflow)


if __name__ == "__main__":
    unittest.main()
