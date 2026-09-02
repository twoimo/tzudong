#!/usr/bin/env python3
"""Unit tests for the P3 Phase_Gate runner ``backend/bin/run_p3_gate.py`` (Task 27).

These verify the gate wiring's observable branches — precondition handling,
verification-command execution policy, exit-condition finalisation (13-metrics
exposure, redaction property, loopback-only binding), report shape, and the
referenced Rollback_Plan's validity — with injected fakes so no real processes,
network, or operator secrets are required. Following the ``backend/bin``
convention (no ``__init__.py``), both modules are loaded by file path.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_RUNNER_PATH = _ROOT / "backend" / "bin" / "run_p3_gate.py"
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_p3_gate = _load("run_p3_gate", _RUNNER_PATH)
phase_gate = _load("phase_gate", _PHASE_GATE_PATH)

_FIXED_NOW = "2026-09-01T00:00:00.000Z"


def _clock() -> str:
    return _FIXED_NOW


def _additional_runner(*, env_ok: bool, pbt_ok: bool):
    """Return a fake additional-command runner for the two P3 verifications."""

    def runner(cwd, argv):
        joined = " ".join(argv)
        if "check_env_contract.py" in joined:
            payload = {"missingRequired": [] if env_ok else ["SUPABASE_URL", "GEMINI_API_KEY"]}
            return (0 if env_ok else 1), json.dumps(payload)
        if "unittest" in argv and any("test_log_" in a or "test_tag_" in a or "test_loopback_" in a for a in argv):
            return (0 if pbt_ok else 1), ""
        return 127, ""

    return runner


def _metrics_ok():
    return {"satisfied": True, "metricCount": 13, "missingCount": 0}


def _loopback_ok():
    return {"satisfied": True, "nonLoopbackCount": 0, "declarationCount": 7}


class RunP3GateTest(unittest.TestCase):
    def test_secrets_absent_fails_closed_and_web_commands_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p3_gate.run_p3_gate(
                additional_runner=_additional_runner(env_ok=False, pbt_ok=True),
                # command_runner default would spawn real processes; inject a
                # fake so backend commands do not actually run either.
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                metrics_evaluator=_metrics_ok,
                loopback_evaluator=_loopback_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            self.assertFalse(result["precondition"]["operatorSecretsPresent"])
            self.assertEqual(result["precondition"]["missingRequiredCount"], 2)

            report = json.loads(
                (Path(tmp) / "P3-observability-report.json").read_text("utf-8")
            )
            # Well-formed D9 core.
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["phaseId"], "P3-observability")
            self.assertEqual(report["sequence"], 3)
            self.assertEqual(report["assignedRequirements"], [12, 13])
            self.assertEqual(report["rollbackPlanRef"], run_p3_gate.P3_ROLLBACK_PLAN_REF)
            self.assertIsInstance(report["unexplainedWorktreeChanges"], list)
            # Additional P3 verifications recorded, env-contract failed closed.
            labels = {r["label"]: r for r in report["additionalVerificationCommands"]}
            self.assertIn("check_env_contract_daily", labels)
            self.assertIn("observability_p3_pbt", labels)
            self.assertFalse(labels["check_env_contract_daily"]["passed"])
            self.assertTrue(labels["observability_p3_pbt"]["passed"])
            # preconditionSummary carries only a bounded count, never names.
            self.assertEqual(report["preconditionSummary"]["missingRequiredCount"], 2)
            # Metric-contract and loopback-binding summaries are recorded.
            self.assertTrue(report["metricsContractCheck"]["satisfied"])
            self.assertEqual(report["metricsContractCheck"]["metricCount"], 13)
            self.assertTrue(report["loopbackBindingCheck"]["satisfied"])

    def test_report_route_checks_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_p3_gate.run_p3_gate(
                additional_runner=_additional_runner(env_ok=False, pbt_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                metrics_evaluator=_metrics_ok,
                loopback_evaluator=_loopback_ok,
                log_dir=tmp,
                now=_clock,
            )
            report = json.loads(
                (Path(tmp) / "P3-observability-report.json").read_text("utf-8")
            )
            allowed_keys = {"route", "passed", "responseMs"}
            for check in report["publicRouteChecks"]:
                self.assertTrue(set(check).issubset(allowed_keys))
                # No cookies/headers/local-storage/admin body/Supabase payloads.
                self.assertNotIn("body", check)
                self.assertNotIn("headers", check)

    def test_all_pass_yields_satisfied_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p3_gate.run_p3_gate(
                additional_runner=_additional_runner(env_ok=True, pbt_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                metrics_evaluator=_metrics_ok,
                loopback_evaluator=_loopback_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["resultCode"])
            report = json.loads(
                (Path(tmp) / "P3-observability-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            self.assertTrue(by_id["P3-X1"]["satisfied"])
            self.assertTrue(by_id["P3-X2"]["satisfied"])
            self.assertTrue(by_id["P3-X3"]["satisfied"])
            self.assertTrue(by_id["P3-X4"]["satisfied"])
            self.assertTrue(by_id["P3-X5"]["satisfied"])

    def test_metrics_or_redaction_unmet_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Metric contract incomplete and redaction property failing: both
            # P3-specific completion conditions unmet, commands/routes pass.
            result = run_p3_gate.run_p3_gate(
                additional_runner=_additional_runner(env_ok=True, pbt_ok=False),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                metrics_evaluator=lambda: {
                    "satisfied": False,
                    "metricCount": 12,
                    "missingCount": 1,
                },
                loopback_evaluator=_loopback_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P3-X1", result["unsatisfiedConditionIds"])
            self.assertIn("P3-X2", result["unsatisfiedConditionIds"])

    def test_loopback_non_loopback_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p3_gate.run_p3_gate(
                additional_runner=_additional_runner(env_ok=True, pbt_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                metrics_evaluator=_metrics_ok,
                loopback_evaluator=lambda: {
                    "satisfied": False,
                    "nonLoopbackCount": 1,
                    "declarationCount": 7,
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P3-X3", result["unsatisfiedConditionIds"])

    def test_default_evaluators_report_thirteen_loopback_metrics(self):
        # The real in-process static checks (no secrets/network) establish X1/X3.
        metrics = run_p3_gate._default_metrics_evaluator()
        loopback = run_p3_gate._default_loopback_evaluator()
        self.assertTrue(metrics["satisfied"])
        self.assertEqual(metrics["metricCount"], 13)
        self.assertTrue(loopback["satisfied"])
        self.assertEqual(loopback["nonLoopbackCount"], 0)

    def test_referenced_rollback_plan_is_valid(self):
        plan = json.loads(
            (_ROOT / run_p3_gate.P3_ROLLBACK_PLAN_REF).read_text("utf-8")
        )
        outcome = phase_gate.validate_rollback_plan(plan)
        self.assertTrue(outcome["ok"], outcome)
        self.assertIsNone(outcome["errorCode"])


if __name__ == "__main__":
    unittest.main()
