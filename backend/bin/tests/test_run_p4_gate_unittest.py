#!/usr/bin/env python3
"""Unit tests for the P4 Phase_Gate runner ``backend/bin/run_p4_gate.py`` (Task 33).

These verify the gate wiring's observable branches — precondition handling,
verification-command execution policy, exit-condition finalisation (12 tooling
categories recorded, Pin_Contract 6-item match, 7 dependency units confirmed),
report shape, and the referenced Rollback_Plan's validity — with injected fakes
so no real processes, network, node, bun, or operator secrets are required.
Following the ``backend/bin`` convention (no ``__init__.py``), both modules are
loaded by file path.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_RUNNER_PATH = _ROOT / "backend" / "bin" / "run_p4_gate.py"
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_p4_gate = _load("run_p4_gate", _RUNNER_PATH)
phase_gate = _load("phase_gate", _PHASE_GATE_PATH)

_FIXED_NOW = "2026-09-01T00:00:00.000Z"


def _clock() -> str:
    return _FIXED_NOW


def _additional_runner(*, env_ok: bool, web_ok: bool, evidence_ok: bool):
    """Return a fake additional-command runner for the three P4 verifications."""

    def runner(cwd, argv):
        joined = " ".join(argv)
        if "check_env_contract.py" in joined:
            payload = {
                "missingRequired": []
                if env_ok
                else ["SUPABASE_URL", "GEMINI_API_KEY"]
            }
            return (0 if env_ok else 1), json.dumps(payload)
        if argv[:2] == ("bun", "test") or list(argv[:2]) == ["bun", "test"]:
            return (0 if web_ok else 1), ""
        if "unittest" in argv and any("test_evidence_state_pbt" in a for a in argv):
            return (0 if evidence_ok else 1), ""
        return 127, ""

    return runner


def _tooling_ok():
    return {"satisfied": True, "categoryCount": 12, "mismatchCount": 0}


def _pin_ok():
    return {"satisfied": True, "ran": True, "code": None}


def _units_ok():
    return {"satisfied": True, "unitCount": 7}


class RunP4GateTest(unittest.TestCase):
    def test_secrets_absent_fails_closed_and_web_commands_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=False, web_ok=True, evidence_ok=True
                ),
                # command_runner default would spawn real processes; inject a
                # fake so backend commands do not actually run either.
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                tooling_evaluator=_tooling_ok,
                pin_contract_evaluator=_pin_ok,
                dependency_units_evaluator=_units_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            self.assertFalse(result["precondition"]["operatorSecretsPresent"])
            self.assertEqual(result["precondition"]["missingRequiredCount"], 2)

            report = json.loads(
                (Path(tmp) / "P4-supply-chain-report.json").read_text("utf-8")
            )
            # Well-formed D9 core.
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["phaseId"], "P4-supply-chain")
            self.assertEqual(report["sequence"], 4)
            self.assertEqual(report["assignedRequirements"], [4, 5, 11])
            self.assertEqual(report["rollbackPlanRef"], run_p4_gate.P4_ROLLBACK_PLAN_REF)
            self.assertIsInstance(report["unexplainedWorktreeChanges"], list)
            # Additional P4 verifications recorded, env-contract failed closed.
            labels = {r["label"]: r for r in report["additionalVerificationCommands"]}
            self.assertIn("check_env_contract_daily", labels)
            self.assertIn("supply_chain_p4_web_pbt", labels)
            self.assertIn("evidence_state_p4_pbt", labels)
            self.assertFalse(labels["check_env_contract_daily"]["passed"])
            self.assertTrue(labels["supply_chain_p4_web_pbt"]["passed"])
            self.assertTrue(labels["evidence_state_p4_pbt"]["passed"])
            # preconditionSummary carries only a bounded count, never names.
            self.assertEqual(report["preconditionSummary"]["missingRequiredCount"], 2)
            # Tooling-record, pin-contract and dependency-unit summaries recorded.
            self.assertTrue(report["toolingRecordCheck"]["satisfied"])
            self.assertEqual(report["toolingRecordCheck"]["categoryCount"], 12)
            self.assertTrue(report["pinContractCheck"]["satisfied"])
            self.assertTrue(report["dependencyUnitsCheck"]["satisfied"])
            self.assertEqual(report["dependencyUnitsCheck"]["unitCount"], 7)

    def test_report_route_checks_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=False, web_ok=True, evidence_ok=True
                ),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                tooling_evaluator=_tooling_ok,
                pin_contract_evaluator=_pin_ok,
                dependency_units_evaluator=_units_ok,
                log_dir=tmp,
                now=_clock,
            )
            report = json.loads(
                (Path(tmp) / "P4-supply-chain-report.json").read_text("utf-8")
            )
            allowed_keys = {"route", "passed", "responseMs"}
            for check in report["publicRouteChecks"]:
                self.assertTrue(set(check).issubset(allowed_keys))
                # No cookies/headers/local-storage/admin body/Supabase payloads.
                self.assertNotIn("body", check)
                self.assertNotIn("headers", check)

    def test_all_pass_yields_satisfied_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=True, web_ok=True, evidence_ok=True
                ),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                tooling_evaluator=_tooling_ok,
                pin_contract_evaluator=_pin_ok,
                dependency_units_evaluator=_units_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["resultCode"])
            report = json.loads(
                (Path(tmp) / "P4-supply-chain-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            self.assertTrue(by_id["P4-X1"]["satisfied"])
            self.assertTrue(by_id["P4-X2"]["satisfied"])
            self.assertTrue(by_id["P4-X3"]["satisfied"])
            self.assertTrue(by_id["P4-X4"]["satisfied"])
            self.assertTrue(by_id["P4-X5"]["satisfied"])

    def test_tooling_or_pin_unmet_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Tooling record incomplete and pin contract drifting: both
            # P4-specific completion conditions unmet, commands/routes pass.
            result = run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=True, web_ok=True, evidence_ok=True
                ),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                tooling_evaluator=lambda: {
                    "satisfied": False,
                    "categoryCount": 11,
                    "mismatchCount": 1,
                },
                pin_contract_evaluator=lambda: {
                    "satisfied": False,
                    "ran": True,
                    "code": "pin_contract_drift",
                },
                dependency_units_evaluator=_units_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P4-X1", result["unsatisfiedConditionIds"])
            self.assertIn("P4-X2", result["unsatisfiedConditionIds"])

    def test_pin_unverified_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # A null (unverified) pin outcome is not a pass: X2 stays unmet.
            result = run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=True, web_ok=True, evidence_ok=True
                ),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                tooling_evaluator=_tooling_ok,
                pin_contract_evaluator=lambda: {
                    "satisfied": None,
                    "ran": False,
                    "code": None,
                },
                dependency_units_evaluator=_units_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P4-X2", result["unsatisfiedConditionIds"])

    def test_dependency_units_mismatch_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p4_gate.run_p4_gate(
                additional_runner=_additional_runner(
                    env_ok=True, web_ok=True, evidence_ok=True
                ),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                tooling_evaluator=_tooling_ok,
                pin_contract_evaluator=_pin_ok,
                dependency_units_evaluator=lambda: {
                    "satisfied": False,
                    "unitCount": 6,
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P4-X3", result["unsatisfiedConditionIds"])

    def test_default_static_evaluators_report_twelve_categories_seven_units(self):
        # The real in-process static checks (no secrets/network/node) establish
        # X1 (12 coherent tooling categories) and X3 (7 dependency units).
        tooling = run_p4_gate._default_tooling_evaluator()
        units = run_p4_gate._default_dependency_units_evaluator()
        self.assertTrue(tooling["satisfied"], tooling)
        self.assertEqual(tooling["categoryCount"], 12)
        self.assertEqual(tooling["mismatchCount"], 0)
        self.assertTrue(units["satisfied"], units)
        self.assertEqual(units["unitCount"], 7)

    def test_referenced_rollback_plan_is_valid(self):
        plan = json.loads(
            (_ROOT / run_p4_gate.P4_ROLLBACK_PLAN_REF).read_text("utf-8")
        )
        outcome = phase_gate.validate_rollback_plan(plan)
        self.assertTrue(outcome["ok"], outcome)
        self.assertIsNone(outcome["errorCode"])


if __name__ == "__main__":
    unittest.main()
