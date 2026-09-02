#!/usr/bin/env python3
"""Unit tests for the P6 Phase_Gate runner ``backend/bin/run_p6_gate.py`` (Task 47).

These verify the gate wiring's observable branches — precondition handling,
verification-command execution policy, exit-condition finalisation (per-slice
N=3 consecutive parity, regression-3-suites intact, Performance_Evidence_Set
valid), report shape, and the referenced Rollback_Plan's validity — with
injected fakes so no real processes, network, cargo, or operator secrets are
required. Following the ``backend/bin`` convention (no ``__init__.py``), both
modules are loaded by file path.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_RUNNER_PATH = _ROOT / "backend" / "bin" / "run_p6_gate.py"
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_p6_gate = _load("run_p6_gate", _RUNNER_PATH)
phase_gate = _load("phase_gate", _PHASE_GATE_PATH)

_FIXED_NOW = "2026-09-01T00:00:00.000Z"


def _clock() -> str:
    return _FIXED_NOW


def _additional_runner(*, env_ok: bool, tests_ok: bool, cargo_ok: bool = True):
    """Return a fake additional-command runner for the P6 verifications."""

    def runner(cwd, argv, timeout=None):
        joined = " ".join(argv)
        if "check_env_contract.py" in joined:
            payload = {
                "missingRequired": []
                if env_ok
                else ["SUPABASE_URL", "GEMINI_API_KEY"]
            }
            return (0 if env_ok else 1), json.dumps(payload)
        if argv and argv[0] == "cargo":
            return (0 if cargo_ok else 1), ""
        # The seven P6 PBTs: five via ``-m unittest <module>`` and two by path.
        if "unittest" in argv or any(a.endswith(".py") for a in argv):
            return (0 if tests_ok else 1), ""
        return 127, ""

    return runner


def _parity_ok():
    return {
        "satisfied": True,
        "sliceCount": 5,
        "slicesMeetingGate": 5,
        "gateCount": 3,
        "minConsecutiveMatchedCount": 3,
    }


def _perf_ok():
    return {
        "satisfied": True,
        "evidenceDirPresent": True,
        "evidenceSetPresent": True,
        "structureOk": True,
        "code": None,
    }


class RunP6GateTest(unittest.TestCase):
    def test_secrets_absent_fails_closed_and_web_commands_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p6_gate.run_p6_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                parity_evaluator=_parity_ok,
                performance_evaluator=_perf_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            self.assertFalse(result["precondition"]["operatorSecretsPresent"])
            self.assertEqual(result["precondition"]["missingRequiredCount"], 2)

            report = json.loads(
                (Path(tmp) / "P6-rust-report.json").read_text("utf-8")
            )
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["phaseId"], "P6-rust")
            self.assertEqual(report["sequence"], 6)
            self.assertEqual(report["assignedRequirements"], [1, 2, 3])
            self.assertEqual(report["rollbackPlanRef"], run_p6_gate.P6_ROLLBACK_PLAN_REF)
            self.assertIsInstance(report["unexplainedWorktreeChanges"], list)

            labels = {r["label"]: r for r in report["additionalVerificationCommands"]}
            self.assertIn("check_env_contract_daily", labels)
            self.assertIn("impl_selector_p6_pbt", labels)
            self.assertIn("ledger_integrity_p6_pbt", labels)
            self.assertIn("rust_parity_gate_p6_pbt", labels)
            self.assertIn("perf_noise_p6_pbt", labels)
            self.assertIn("perf_path_p6_pbt", labels)
            self.assertIn("parity_output_p6_pbt", labels)
            self.assertIn("parity_error_p6_pbt", labels)
            self.assertIn("cargo_test_rust_workspace", labels)
            self.assertFalse(labels["check_env_contract_daily"]["passed"])
            self.assertTrue(labels["cargo_test_rust_workspace"]["passed"])
            self.assertEqual(report["preconditionSummary"]["missingRequiredCount"], 2)
            self.assertTrue(report["sliceParityCheck"]["satisfied"])
            self.assertTrue(report["performanceEvidenceCheck"]["satisfied"])

    def test_report_route_checks_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_p6_gate.run_p6_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                parity_evaluator=_parity_ok,
                performance_evaluator=_perf_ok,
                log_dir=tmp,
                now=_clock,
            )
            report = json.loads(
                (Path(tmp) / "P6-rust-report.json").read_text("utf-8")
            )
            allowed_keys = {"route", "passed", "responseMs"}
            for check in report["publicRouteChecks"]:
                self.assertTrue(set(check).issubset(allowed_keys))
                self.assertNotIn("body", check)
                self.assertNotIn("headers", check)

    def test_all_pass_yields_satisfied_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p6_gate.run_p6_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                parity_evaluator=_parity_ok,
                performance_evaluator=_perf_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["resultCode"])
            report = json.loads(
                (Path(tmp) / "P6-rust-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            self.assertTrue(by_id["P6-X1"]["satisfied"])
            self.assertTrue(by_id["P6-X2"]["satisfied"])
            self.assertTrue(by_id["P6-X3"]["satisfied"])
            self.assertTrue(by_id["P6-X4"]["satisfied"])
            self.assertTrue(by_id["P6-X5"]["satisfied"])

    def test_parity_or_performance_unmet_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Commands/routes pass, but per-slice parity and performance-evidence
            # completion conditions are unmet.
            result = run_p6_gate.run_p6_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                parity_evaluator=lambda: {
                    "satisfied": False,
                    "sliceCount": 5,
                    "slicesMeetingGate": 0,
                    "gateCount": 3,
                    "minConsecutiveMatchedCount": 0,
                },
                performance_evaluator=lambda: {
                    "satisfied": False,
                    "evidenceDirPresent": False,
                    "evidenceSetPresent": False,
                    "structureOk": None,
                    "code": None,
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P6-X1", result["unsatisfiedConditionIds"])
            self.assertIn("P6-X3", result["unsatisfiedConditionIds"])

    def test_regression_suite_failure_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # One backend regression unittest fails => X2 unmet AND the command
            # set is incomplete => phase_verification_failed precedes X2.
            def command_runner(cwd, argv):
                joined = " ".join(argv)
                if "test_validators_unittest" in joined:
                    return {"passed": False, "treeId": "abc"}
                if cwd == "apps/web":
                    return {"passed": True, "treeId": "abc"}
                return {"passed": True, "treeId": "abc"}

            result = run_p6_gate.run_p6_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=command_runner,
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                parity_evaluator=_parity_ok,
                performance_evaluator=_perf_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            # A failing verification command yields phase_verification_failed
            # before exit conditions are consulted.
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            report = json.loads(
                (Path(tmp) / "P6-rust-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            # X2 (regression suites) is finalised false from the recorded result.
            self.assertFalse(by_id["P6-X2"]["satisfied"])

    def test_default_parity_evaluator_reflects_ledger(self):
        # The real static check reads the frozen Migration_Ledger. The current
        # ledger records consecutiveMatchedCount 0 for every slice, so N=3
        # per-slice parity is NOT satisfied — an honest, un-fabricated result.
        parity = run_p6_gate._default_parity_evaluator()
        self.assertEqual(parity["gateCount"], 3)
        self.assertIsInstance(parity["sliceCount"], int)
        self.assertGreater(parity["sliceCount"], 0)
        self.assertFalse(parity["satisfied"], parity)

    def test_default_performance_evaluator_reflects_tree(self):
        # No retained Performance_Evidence_Set under backend/performance/ yet, so
        # the performance completion condition is honestly NOT established.
        perf = run_p6_gate._default_performance_evaluator()
        self.assertIn("satisfied", perf)
        self.assertFalse(perf["satisfied"], perf)

    def test_referenced_rollback_plan_is_valid(self):
        plan = json.loads(
            (_ROOT / run_p6_gate.P6_ROLLBACK_PLAN_REF).read_text("utf-8")
        )
        outcome = phase_gate.validate_rollback_plan(plan)
        self.assertTrue(outcome["ok"], outcome)
        self.assertIsNone(outcome["errorCode"])


if __name__ == "__main__":
    unittest.main()
