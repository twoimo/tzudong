"""Focused unit tests for the current generic phase-gate evaluator."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
import contextlib
import io
from unittest import mock
from pathlib import Path

from backend.bin import phase_gate
from backend.bin.tests.phase_gate_test_support import (
    OBSERVED_AT,
    TREE_ID,
    valid_inputs,
)


class PhaseGateEvaluatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = copy.deepcopy(phase_gate.load_phase_catalog())

    @staticmethod
    def _evaluate(phase_id: str, inputs: dict):
        catalog = inputs.pop("catalog")
        return phase_gate.evaluate_phase_gate(catalog, phase_id, **inputs)

    def test_stale_supplied_tree_is_rejected_before_verification_or_report(self) -> None:
        phase = "P1-local-foundation"
        with mock.patch.object(phase_gate, "candidate_tree_fingerprint", return_value="f" * 64), mock.patch.object(phase_gate, "run_verification_commands") as run:
            for extra in ([], ["--run-verification"]):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    status = phase_gate.cli_for_phase(phase, ["--candidate-tree-id", TREE_ID, "--json", "--write-report", *extra])
                self.assertEqual(status, 1)
                result = json.loads(output.getvalue())
                self.assertEqual(result["resultCode"], phase_gate.CANDIDATE_TREE_MISMATCH)
                self.assertEqual(result["candidateTreeId"], "f" * 64)
                self.assertIsNone(result["reportPath"])
            run.assert_not_called()
            result = phase_gate.run_configured_phase(phase, **valid_inputs(self.catalog, phase))
            self.assertEqual(result["resultCode"], phase_gate.CANDIDATE_TREE_MISMATCH)

    def test_invalid_catalog_and_unknown_phase_are_bounded(self) -> None:
        result = phase_gate.evaluate_phase_gate(
            {},
            "P1-local-foundation",
            evidence=None,
            rollback_plan=None,
            command_results=None,
            route_results=None,
            candidate_tree_id=TREE_ID,
            now=lambda: OBSERVED_AT,
        )
        self.assertEqual(result["resultCode"], phase_gate.CATALOG_INVALID)
        result = phase_gate.evaluate_phase_gate(
            self.catalog,
            "P9-unknown",
            evidence=None,
            rollback_plan=None,
            command_results=None,
            route_results=None,
            candidate_tree_id=TREE_ID,
            now=lambda: OBSERVED_AT,
        )
        self.assertEqual(result["resultCode"], phase_gate.PHASE_NOT_FOUND)

    def test_external_evidence_requires_reference_and_exact_tree(self) -> None:
        inputs = valid_inputs(self.catalog, "P2-publication")
        del inputs["evidence"]["P2-E1"]["evidenceRef"]
        result = self._evaluate("P2-publication", inputs)
        self.assertEqual(result["resultCode"], phase_gate.ENTRY_NOT_SATISFIED)
        self.assertEqual(result["unsatisfiedIds"], ["P2-E1"])

        inputs = valid_inputs(self.catalog, "P2-publication")
        inputs["evidence"]["P2-E1"]["treeId"] = "d" * 64
        result = self._evaluate("P2-publication", inputs)
        self.assertEqual(result["resultCode"], phase_gate.ENTRY_NOT_SATISFIED)

    def test_missing_rollback_commands_and_routes_fail_in_order(self) -> None:
        inputs = valid_inputs(self.catalog, "P1-local-foundation")
        inputs["rollback_plan"] = None
        result = self._evaluate("P1-local-foundation", inputs)
        self.assertEqual(result["resultCode"], phase_gate.ROLLBACK_PLAN_INVALID)

        inputs = valid_inputs(self.catalog, "P1-local-foundation")
        inputs["command_results"] = {}
        result = self._evaluate("P1-local-foundation", inputs)
        self.assertEqual(result["resultCode"], phase_gate.VERIFICATION_INCOMPLETE)

        inputs = valid_inputs(self.catalog, "P1-local-foundation")
        inputs["route_results"] = {}
        result = self._evaluate("P1-local-foundation", inputs)
        self.assertEqual(
            result["resultCode"], phase_gate.ROUTE_VERIFICATION_INCOMPLETE
        )

    def test_report_is_created_once_and_contains_only_bounded_fields(self) -> None:
        inputs = valid_inputs(self.catalog, "P1-local-foundation")
        inputs["write_report"] = True
        with tempfile.TemporaryDirectory() as directory:
            inputs["root"] = Path(directory)
            result = self._evaluate("P1-local-foundation", inputs)
            self.assertTrue(result["ok"])
            path = Path(directory) / result["reportPath"]
            document = json.loads(path.read_text())
            self.assertEqual(set(document), set(result))
            self.assertNotIn("commands", document)
            self.assertNotIn("evidence", document)
            second_inputs = valid_inputs(self.catalog, "P1-local-foundation")
            second_inputs["write_report"] = True
            second_inputs["root"] = Path(directory)
            second = self._evaluate("P1-local-foundation", second_inputs)
            self.assertEqual(second["resultCode"], phase_gate.REPORT_EXISTS)
            self.assertIsNone(second["reportPath"])

    def test_explicit_verification_runner_suppresses_results_to_booleans(self) -> None:
        calls = []

        def runner(cwd, argv, timeout):
            calls.append((cwd, tuple(argv), timeout))
            return True

        results = phase_gate.run_verification_commands(
            self.catalog,
            runner=runner,
            now=lambda: OBSERVED_AT,
        )
        self.assertEqual(len(calls), 7)
        self.assertEqual(set(results), {item["id"] for item in self.catalog["verificationCommands"]})
        self.assertTrue(all(record["passed"] is True for record in results.values()))
        self.assertTrue(all(set(record) == {"passed", "treeId", "ranAt"} for record in results.values()))

    def test_rollback_action_is_whitelisted_not_merely_non_forbidden(self) -> None:
        inputs = valid_inputs(self.catalog, "P1-local-foundation")
        plan = inputs["rollback_plan"]
        plan["commands"][0]["argv"] = ["curl", "https://example.invalid"]
        result = phase_gate.validate_rollback_plan(plan, catalog=self.catalog)
        self.assertEqual(
            result["errorCode"], phase_gate.ROLLBACK_COMMAND_NOT_ADMITTED
        )


if __name__ == "__main__":
    unittest.main()
