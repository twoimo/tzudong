#!/usr/bin/env python3
"""Unit tests for the P7 Phase_Gate runner ``backend/bin/run_p7_gate.py`` (Task 53).

These verify the gate wiring's observable branches — precondition handling,
verification-command execution policy, exit-condition finalisation (descriptor
secret literals = 0, 2+ cluster identifiers render with derived-only diffs and
zero remote apply attempts, Ops_Agent allowlist-external actions = 0), report
shape and evidence hygiene, and the referenced Rollback_Plan's validity — with
injected fakes so no real processes, network, or operator secrets are required.
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
_RUNNER_PATH = _ROOT / "backend" / "bin" / "run_p7_gate.py"
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_p7_gate = _load("run_p7_gate", _RUNNER_PATH)
phase_gate = _load("phase_gate", _PHASE_GATE_PATH)

_FIXED_NOW = "2026-10-01T00:00:00.000Z"


def _clock() -> str:
    return _FIXED_NOW


def _additional_runner(*, env_ok: bool, tests_ok: bool):
    """Return a fake additional-command runner for the P7 verifications."""

    def runner(cwd, argv, timeout=None):
        joined = " ".join(argv)
        if "check_env_contract.py" in joined:
            payload = {
                "missingRequired": []
                if env_ok
                else ["SUPABASE_URL", "GEMINI_API_KEY"]
            }
            return (0 if env_ok else 1), json.dumps(payload)
        # The four P7 PBTs (via ``-m unittest``) and the descriptor checker.
        if "unittest" in argv or joined.endswith("--json"):
            return (0 if tests_ok else 1), ""
        return 127, ""

    return runner


def _descriptor_ok():
    return {
        "secretLiteralsZero": True,
        "findingCount": 0,
        "scannedFileCount": 8,
        "structuralOk": True,
        "clusterRenderOk": True,
        "clusterIdCount": 2,
        "differingFields": ["clusterLabel", "fullname", "namespace", "releaseName"],
        "differingFieldsSubsetDerived": True,
        "remoteApplyAttemptCount": 0,
    }


def _agent_ok():
    return {
        "satisfied": True,
        "performedExternalCount": 0,
        "allowlistedPerformed": True,
        "refusedNotAllowlisted": True,
        "refusedHighRiskNoApproval": True,
        "refusedNeverPerformed": True,
        "committedAllowlistActive": False,
        "allowlistKindCount": 6,
    }


class RunP7GateTest(unittest.TestCase):
    def test_secrets_absent_fails_closed_and_web_commands_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p7_gate.run_p7_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                descriptor_evaluator=_descriptor_ok,
                agent_boundary_evaluator=_agent_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_VERIFICATION_FAILED)
            self.assertFalse(result["precondition"]["operatorSecretsPresent"])
            self.assertEqual(result["precondition"]["missingRequiredCount"], 2)

            report = json.loads(
                (Path(tmp) / "P7-readiness-agent-report.json").read_text("utf-8")
            )
            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["phaseId"], "P7-readiness-agent")
            self.assertEqual(report["sequence"], 7)
            self.assertEqual(report["assignedRequirements"], [14, 15])
            self.assertEqual(report["rollbackPlanRef"], run_p7_gate.P7_ROLLBACK_PLAN_REF)
            self.assertIsInstance(report["unexplainedWorktreeChanges"], list)

            labels = {r["label"]: r for r in report["additionalVerificationCommands"]}
            self.assertIn("check_env_contract_daily", labels)
            self.assertIn("descriptor_secret_p7_pbt", labels)
            self.assertIn("cluster_render_p7_pbt", labels)
            self.assertIn("agent_boundary_p7_pbt", labels)
            self.assertIn("agent_rate_p7_pbt", labels)
            self.assertIn("deployment_descriptor_set_check", labels)
            self.assertFalse(labels["check_env_contract_daily"]["passed"])
            self.assertTrue(labels["deployment_descriptor_set_check"]["passed"])
            self.assertEqual(report["preconditionSummary"]["missingRequiredCount"], 2)
            self.assertTrue(report["descriptorCheck"]["secretLiteralsZero"])
            self.assertTrue(report["descriptorCheck"]["clusterRenderOk"])
            self.assertTrue(report["agentBoundaryCheck"]["satisfied"])

    def test_report_route_checks_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_p7_gate.run_p7_gate(
                additional_runner=_additional_runner(env_ok=False, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": None},
                route_checker=None,
                descriptor_evaluator=_descriptor_ok,
                agent_boundary_evaluator=_agent_ok,
                log_dir=tmp,
                now=_clock,
            )
            report = json.loads(
                (Path(tmp) / "P7-readiness-agent-report.json").read_text("utf-8")
            )
            allowed_keys = {"route", "passed", "responseMs"}
            for check in report["publicRouteChecks"]:
                self.assertTrue(set(check).issubset(allowed_keys))
                self.assertNotIn("body", check)
                self.assertNotIn("headers", check)

    def test_all_pass_yields_satisfied_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p7_gate.run_p7_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                descriptor_evaluator=_descriptor_ok,
                agent_boundary_evaluator=_agent_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["resultCode"])
            report = json.loads(
                (Path(tmp) / "P7-readiness-agent-report.json").read_text("utf-8")
            )
            by_id = {c["conditionId"]: c for c in report["exitConditions"]}
            self.assertTrue(by_id["P7-X1"]["satisfied"])
            self.assertTrue(by_id["P7-X2"]["satisfied"])
            self.assertTrue(by_id["P7-X3"]["satisfied"])
            self.assertTrue(by_id["P7-X4"]["satisfied"])
            self.assertTrue(by_id["P7-X5"]["satisfied"])

    def test_descriptor_or_agent_unmet_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Commands/routes pass, but the descriptor render and the Ops_Agent
            # boundary completion conditions are unmet.
            result = run_p7_gate.run_p7_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                descriptor_evaluator=lambda: {
                    "secretLiteralsZero": True,
                    "findingCount": 0,
                    "scannedFileCount": 8,
                    "structuralOk": True,
                    "clusterRenderOk": False,
                    "clusterIdCount": 1,
                    "differingFields": ["base"],
                    "differingFieldsSubsetDerived": False,
                    "remoteApplyAttemptCount": 0,
                },
                agent_boundary_evaluator=lambda: {
                    "satisfied": False,
                    "performedExternalCount": 1,
                    "allowlistedPerformed": True,
                    "refusedNotAllowlisted": False,
                    "refusedHighRiskNoApproval": True,
                    "refusedNeverPerformed": True,
                    "committedAllowlistActive": False,
                    "allowlistKindCount": 6,
                },
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P7-X2", result["unsatisfiedConditionIds"])
            self.assertIn("P7-X3", result["unsatisfiedConditionIds"])
            # X1 (secret literals zero) stays satisfied.
            self.assertNotIn("P7-X1", result["unsatisfiedConditionIds"])

    def test_secret_literal_detected_yields_not_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_p7_gate.run_p7_gate(
                additional_runner=_additional_runner(env_ok=True, tests_ok=True),
                command_runner=lambda cwd, argv: {"passed": True, "treeId": "abc"},
                route_checker=lambda route: {"passed": True, "responseMs": 12.0},
                descriptor_evaluator=lambda: {
                    "secretLiteralsZero": False,
                    "findingCount": 2,
                    "scannedFileCount": 8,
                    "structuralOk": True,
                    "clusterRenderOk": False,
                    "clusterIdCount": 0,
                    "differingFields": [],
                    "differingFieldsSubsetDerived": False,
                    "remoteApplyAttemptCount": 0,
                },
                agent_boundary_evaluator=_agent_ok,
                log_dir=tmp,
                now=_clock,
            )

            self.assertFalse(result["ok"])
            self.assertEqual(result["resultCode"], phase_gate.PHASE_GATE_NOT_SATISFIED)
            self.assertIn("P7-X1", result["unsatisfiedConditionIds"])
            self.assertIn("P7-X2", result["unsatisfiedConditionIds"])

    def test_default_descriptor_evaluator_reflects_tree(self):
        # The real static check scans the committed Deployment_Descriptor_Set
        # (Helm chart, OpenTofu configs, JSON catalog): zero secret literals and
        # a derived-only two-cluster render with zero remote apply attempts.
        descriptor = run_p7_gate._default_descriptor_evaluator()
        self.assertTrue(descriptor["secretLiteralsZero"], descriptor)
        self.assertEqual(descriptor["findingCount"], 0)
        self.assertGreater(descriptor["scannedFileCount"], 0)
        self.assertTrue(descriptor["structuralOk"], descriptor)
        self.assertTrue(descriptor["clusterRenderOk"], descriptor)
        self.assertGreaterEqual(descriptor["clusterIdCount"], 2)
        self.assertTrue(descriptor["differingFieldsSubsetDerived"], descriptor)
        self.assertEqual(descriptor["remoteApplyAttemptCount"], 0)

    def test_default_agent_boundary_evaluator_reflects_boundary(self):
        # The real in-process boundary check: the committed allowlist is
        # fail-closed (operator approval unresolved), and the Ops_Agent boundary
        # performs zero allowlist-external actions across the candidate battery.
        agent = run_p7_gate._default_agent_boundary_evaluator()
        self.assertTrue(agent["satisfied"], agent)
        self.assertEqual(agent["performedExternalCount"], 0)
        self.assertTrue(agent["allowlistedPerformed"])
        self.assertTrue(agent["refusedNotAllowlisted"])
        self.assertTrue(agent["refusedHighRiskNoApproval"])
        self.assertTrue(agent["refusedNeverPerformed"])
        # The committed operator approval is unresolved by design (fail closed).
        self.assertFalse(agent["committedAllowlistActive"])

    def test_referenced_rollback_plan_is_valid(self):
        plan = json.loads(
            (_ROOT / run_p7_gate.P7_ROLLBACK_PLAN_REF).read_text("utf-8")
        )
        outcome = phase_gate.validate_rollback_plan(plan)
        self.assertTrue(outcome["ok"], outcome)
        self.assertIsNone(outcome["errorCode"])


if __name__ == "__main__":
    unittest.main()
