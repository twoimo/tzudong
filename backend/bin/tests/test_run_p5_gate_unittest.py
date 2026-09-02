#!/usr/bin/env python3
"""Unit tests for the P5 Phase_Gate runner ``backend/bin/run_p5_gate.py`` (Task 38).

These verify the gate wiring's observable branches — precondition handling,
verification-command execution policy, exit-condition finalisation (Layout_Manifest
all entries correspond + 0 stale references, Rename_Ledger valid with ≥3
verification items per entry), report shape, and the referenced Rollback_Plan's
validity — with injected fakes so no real processes, network, node, bun, or
operator secrets are required. Following the ``backend/bin`` convention (no
``__init__.py``), both modules are loaded by file path.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_RUNNER_PATH = _ROOT / "backend" / "bin" / "run_p5_gate.py"
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_p5_gate = _load("run_p5_gate", _RUNNER_PATH)
phase_gate = _load("phase_gate", _PHASE_GATE_PATH)

_FIXED_NOW = "2026-09-01T00:00:00.000Z"


def _clock() -> str:
    return _FIXED_NOW


def _additional_runner(*, env_ok: bool, tests_ok: bool):
    """Return a fake additional-command runner for the five P5 verifications."""

    def runner(cwd, argv):
        joined = " ".join(argv)
        if "check_env_contract.py" in joined:
            payload = {
                "missingRequired": []
                if env_ok
                else ["SUPABASE_URL", "GEMINI_API_KEY"]
            }
            return (0 if env_ok else 1), json.dumps(payload)
        # The two P5 PBTs and the two checker unit tests, invoked by file path.
        if any("backend/bin/tests/test_" in a for a in argv):
            return (0 if tests_ok else 1), ""
        return 127, ""

    return runner


def _layout_ok():
    return {
        "satisfied": True,
        "ok": True,
        "trackedDirectoryCount": 26,
        "staleReferenceCount": 0,
        "code": None,
    }


def _rename_ok():
    return {
        "satisfied": True,
        "ok": True,
        "shapeOk": True,
        "entryCount": 5,
        "minVerificationItems": 3,
        "code": None,
    }


class RunP5GateTest(unittest.TestCase):
    def test_secrets_absent_fails_closed_and_web_commands_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                # command_runner default would spawn real processes; inject a
                # fake so backend commands do not actually run either.
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                layout_evaluator=_layout_ok,
                rename_evaluator=_rename_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            self.assertFalse(result["precondition"]["operatorSecretsPresent"])
            self.assertEqual(result["precondition"]["missingRequiredCount"], 2)

            report = json.loads(
                (Path(tmp) / "P5-layout-naming-report.json").read_text("utf-8")
            )
            # Well-formed D9 core.
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["phaseId"], "P5-layout-naming")
            self.assertEqual(report["sequence"], 5)
            self.assertEqual(report["assignedRequirements"], [6, 7])
            self.assertEqual(report["rollbackPlanRef"], run_p5_gate.P5_ROLLBACK_PLAN_REF)
            self.assertIsInstance(report["unexplainedWorktreeChanges"], list)
            # Additional P5 verifications recorded, env-contract failed closed.
            labels = {r["label"]: r for r in report["additionalVerificationCommands"]}
            self.assertIn("check_env_contract_daily", labels)
            self.assertIn("layout_move_p5_pbt", labels)
            self.assertIn("rename_scope_p5_pbt", labels)
            self.assertIn("check_layout_manifest_unit", labels)
            self.assertIn("check_rename_ledger_unit", labels)
            self.assertFalse(labels["check_env_contract_daily"]["passed"])
            self.assertTrue(labels["layout_move_p5_pbt"]["passed"])
            self.assertTrue(labels["rename_scope_p5_pbt"]["passed"])
            self.assertTrue(labels["check_layout_manifest_unit"]["passed"])
            self.assertTrue(labels["check_rename_ledger_unit"]["passed"])
            # preconditionSummary carries only a bounded count, never names.
            self.assertEqual(report["preconditionSummary"]["missingRequiredCount"], 2)
            # Layout-manifest and rename-ledger summaries recorded.
            self.assertTrue(report["layoutManifestCheck"]["satisfied"])
            self.assertEqual(report["layoutManifestCheck"]["staleReferenceCount"], 0)
            self.assertTrue(report["renameLedgerCheck"]["satisfied"])
            self.assertEqual(report["renameLedgerCheck"]["minVerificationItems"], 3)

    def test_report_route_checks_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                layout_evaluator=_layout_ok,
                rename_evaluator=_rename_ok,
                log_dir=tmp,
                now=_clock,
            )
            report = json.loads(
                (Path(tmp) / "P5-layout-naming-report.json").read_text("utf-8")
            )
            allowed_keys = {"route", "passed", "responseMs"}
            for check in report["publicRouteChecks"]:
                self.assertTrue(set(check).issubset(allowed_keys))
                # No cookies/headers/local-storage/admin body/Supabase payloads.
                self.assertNotIn("body", check)
                self.assertNotIn("headers", check)

    def test_all_pass_yields_satisfied_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                layout_evaluator=_layout_ok,
                rename_evaluator=_rename_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["resultCode"])
            report = json.loads(
                (Path(tmp) / "P5-layout-naming-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            self.assertTrue(by_id["P5-X1"]["satisfied"])
            self.assertTrue(by_id["P5-X2"]["satisfied"])
            self.assertTrue(by_id["P5-X3"]["satisfied"])
            self.assertTrue(by_id["P5-X4"]["satisfied"])

    def test_layout_or_rename_unmet_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Layout has a stale reference and rename ledger is invalid: both
            # P5-specific completion conditions unmet, commands/routes pass.
            result = run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                layout_evaluator=lambda: {
                    "satisfied": False,
                    "ok": False,
                    "trackedDirectoryCount": 26,
                    "staleReferenceCount": 2,
                    "code": "stale_path_reference",
                },
                rename_evaluator=lambda: {
                    "satisfied": False,
                    "ok": False,
                    "shapeOk": False,
                    "entryCount": 5,
                    "minVerificationItems": 2,
                    "code": "rename_ledger_invalid",
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P5-X1", result["unsatisfiedConditionIds"])
            self.assertIn("P5-X2", result["unsatisfiedConditionIds"])

    def test_layout_unverified_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # A null (unverified) layout outcome is not a pass: X1 stays unmet.
            result = run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                layout_evaluator=lambda: {
                    "satisfied": None,
                    "ok": None,
                    "trackedDirectoryCount": None,
                    "staleReferenceCount": None,
                    "code": None,
                },
                rename_evaluator=_rename_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P5-X1", result["unsatisfiedConditionIds"])

    def test_rename_min_items_below_three_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p5_gate.run_p5_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                layout_evaluator=_layout_ok,
                rename_evaluator=lambda: {
                    "satisfied": False,
                    "ok": True,
                    "shapeOk": False,
                    "entryCount": 5,
                    "minVerificationItems": 2,
                    "code": None,
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P5-X2", result["unsatisfiedConditionIds"])

    def test_default_static_evaluators_pass_now(self):
        # The real in-process static checks (no secrets/network/node) establish
        # X1 (Layout_Manifest correspondence + 0 stale refs) and X2 (Rename_Ledger
        # valid with >=3 verification items/entry) now that Tasks 34/35/36 landed.
        layout = run_p5_gate._default_layout_evaluator()
        rename = run_p5_gate._default_rename_evaluator()
        self.assertTrue(layout["satisfied"], layout)
        self.assertEqual(layout["staleReferenceCount"], 0)
        self.assertTrue(rename["satisfied"], rename)
        self.assertIsInstance(rename["minVerificationItems"], int)
        self.assertGreaterEqual(rename["minVerificationItems"], 3)

    def test_referenced_rollback_plan_is_valid(self):
        plan = json.loads(
            (_ROOT / run_p5_gate.P5_ROLLBACK_PLAN_REF).read_text("utf-8")
        )
        outcome = phase_gate.validate_rollback_plan(plan)
        self.assertTrue(outcome["ok"], outcome)
        self.assertIsNone(outcome["errorCode"])


if __name__ == "__main__":
    unittest.main()
