"""Task 41 Implementation_Selector: opt-in resolution, rust init budget, and the
merge-candidate gate.

Covers the requirement-1 execution-boundary contract:

- 1.5/1.11: ``resolve_implementation`` returns ``rust`` only when the opt-in
  names the slice, ``python`` otherwise, and ``migration_slice_unknown`` for a
  slice absent from the ledger.
- 1.6: ``load_rust`` fails closed with ``rust_component_unavailable`` on a
  >30s init or an init failure, with no retry and no python fallback.
- 1.2/1.4/1.9/1.8/1.10: ``check_merge_candidate`` records the ledger check and
  returns ``boundary_violation`` / ``migration_ledger_entry_missing`` /
  ``regression_suite_failed`` in priority order.
- 2.4/2.5: ``resolve_default_implementation`` flips the default to rust only
  after the N=3 parity gate.

The unit suite loads the committed ledger to confirm the real document resolves
and does not require a live rust build.
"""

from __future__ import annotations

import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import impl_selector as sel
from backend.pipeline_control.impl_selector import SelectorError

ROOT = Path(__file__).resolve().parents[2]
LEDGER_PATH = ROOT / "rust" / "migration-ledger.v1.json"


def _ledger(*, active="python", count=0):
    return {
        "schemaVersion": 1,
        "slices": [
            {
                "sliceId": "R1-validators",
                "replacedPythonPaths": ["backend/pipeline/validators.py"],
                "rustArtifactPaths": ["backend/rust/tzudong-validators/src/lib.rs"],
                "replacementScope": "partial_replacement",
                "activeImplementation": active,
                "consecutiveMatchedCount": count,
            }
        ],
    }


class ResolveImplementationTests(unittest.TestCase):
    def test_opt_in_names_slice_resolves_rust(self) -> None:
        env = {sel.SELECTOR_ENV: "R1-validators,R2-normalize"}
        self.assertEqual(
            sel.resolve_implementation("R1-validators", environment=env, ledger=_ledger()),
            sel.IMPL_RUST,
        )

    def test_no_opt_in_resolves_python(self) -> None:
        self.assertEqual(
            sel.resolve_implementation("R1-validators", environment={}, ledger=_ledger()),
            sel.IMPL_PYTHON,
        )

    def test_opt_in_not_naming_slice_resolves_python(self) -> None:
        env = {sel.SELECTOR_ENV: "R2-normalize"}
        self.assertEqual(
            sel.resolve_implementation("R1-validators", environment=env, ledger=_ledger()),
            sel.IMPL_PYTHON,
        )

    def test_whitespace_and_empty_tokens_are_ignored(self) -> None:
        env = {sel.SELECTOR_ENV: " , R1-validators , "}
        self.assertEqual(
            sel.resolve_implementation("R1-validators", environment=env, ledger=_ledger()),
            sel.IMPL_RUST,
        )

    def test_unknown_slice_raises_migration_slice_unknown(self) -> None:
        env = {sel.SELECTOR_ENV: "R9-nope"}
        with self.assertRaises(SelectorError) as ctx:
            sel.resolve_implementation("R9-nope", environment=env, ledger=_ledger())
        self.assertEqual(ctx.exception.code, sel.CODE_SLICE_UNKNOWN)

    def test_committed_ledger_resolves_all_slices_to_python_without_opt_in(self) -> None:
        ledger = sel.load_ledger(LEDGER_PATH)
        for slice_id in sel.slice_ids(ledger):
            self.assertEqual(
                sel.resolve_implementation(slice_id, environment={}, ledger=ledger),
                sel.IMPL_PYTHON,
            )


class DefaultImplementationTests(unittest.TestCase):
    def test_default_stays_python_until_parity_gate(self) -> None:
        self.assertEqual(
            sel.resolve_default_implementation("R1-validators", ledger=_ledger(active="rust", count=2)),
            sel.IMPL_PYTHON,
        )

    def test_default_flips_rust_when_gate_met(self) -> None:
        self.assertEqual(
            sel.resolve_default_implementation("R1-validators", ledger=_ledger(active="rust", count=3)),
            sel.IMPL_RUST,
        )

    def test_active_python_never_defaults_rust(self) -> None:
        self.assertEqual(
            sel.resolve_default_implementation("R1-validators", ledger=_ledger(active="python", count=9)),
            sel.IMPL_PYTHON,
        )

    def test_unknown_slice_raises(self) -> None:
        with self.assertRaises(SelectorError) as ctx:
            sel.resolve_default_implementation("R9-nope", ledger=_ledger())
        self.assertEqual(ctx.exception.code, sel.CODE_SLICE_UNKNOWN)


class LoadRustTests(unittest.TestCase):
    def test_successful_importer_returns_module(self) -> None:
        sentinel = object()
        module = sel.load_rust(
            "R1-validators", importer=lambda: sentinel, ledger=_ledger()
        )
        self.assertIs(module, sentinel)

    def test_import_failure_fails_closed(self) -> None:
        def _boom():
            raise ImportError("not built")

        with self.assertRaises(SelectorError) as ctx:
            sel.load_rust("R1-validators", importer=_boom, ledger=_ledger())
        self.assertEqual(ctx.exception.code, sel.CODE_RUST_UNAVAILABLE)

    def test_init_timeout_fails_closed(self) -> None:
        def _slow():
            time.sleep(1.0)
            return object()

        with self.assertRaises(SelectorError) as ctx:
            sel.load_rust(
                "R1-validators", importer=_slow, ledger=_ledger(), timeout_seconds=0.05
            )
        self.assertEqual(ctx.exception.code, sel.CODE_RUST_UNAVAILABLE)

    def test_unknown_slice_raises_before_import(self) -> None:
        def _should_not_run():  # pragma: no cover - must not be called
            raise AssertionError("importer must not run for unknown slice")

        with self.assertRaises(SelectorError) as ctx:
            sel.load_rust("R9-nope", importer=_should_not_run, ledger=_ledger())
        self.assertEqual(ctx.exception.code, sel.CODE_SLICE_UNKNOWN)

    def test_default_importer_failure_reports_unavailable(self) -> None:
        # The host may already have an unrelated extension installed. Simulate
        # the missing-build branch explicitly so no local build product can turn
        # this fail-closed contract into an environment-dependent assertion.
        with patch("importlib.import_module", side_effect=ImportError("not built")):
            with self.assertRaises(SelectorError) as ctx:
                sel.load_rust("R1-validators", ledger=_ledger())
        self.assertEqual(ctx.exception.code, sel.CODE_RUST_UNAVAILABLE)


def _passing_regression():
    return [
        {"suite": s, "failures": 0, "errors": 0, "elapsedSeconds": 12.0}
        for s in sel.REGRESSION_SUITES
    ]


class MergeCandidateTests(unittest.TestCase):
    def test_all_checks_pass(self) -> None:
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=_passing_regression(),
        )
        self.assertTrue(artifact["ok"])
        self.assertIsNone(artifact["resultCode"])
        self.assertTrue(artifact["ledgerEntryPresent"])
        self.assertTrue(artifact["ledgerFieldsComplete"])
        self.assertEqual(artifact["boundaryCheck"]["routeHandlerViolations"], 0)

    def test_boundary_violation_takes_priority(self) -> None:
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=["ffmpeg_processing"],
            regression_results=_passing_regression(),
        )
        self.assertFalse(artifact["ok"])
        self.assertEqual(artifact["resultCode"], sel.CODE_BOUNDARY_VIOLATION)
        self.assertEqual(artifact["boundaryCheck"]["routeHandlerViolations"], 1)

    def test_missing_ledger_entry(self) -> None:
        artifact = sel.check_merge_candidate(
            "R9-nope",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=_passing_regression(),
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_LEDGER_ENTRY_MISSING)
        self.assertFalse(artifact["ledgerEntryPresent"])

    def test_empty_field_is_ledger_entry_missing(self) -> None:
        led = _ledger()
        led["slices"][0]["rustArtifactPaths"] = []
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=led,
            route_handler_work_classes=[],
            regression_results=_passing_regression(),
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_LEDGER_ENTRY_MISSING)
        self.assertFalse(artifact["ledgerFieldsComplete"])

    def test_regression_failure_count(self) -> None:
        results = _passing_regression()
        results[0]["failures"] = 1
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=results,
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_REGRESSION_FAILED)

    def test_regression_over_budget(self) -> None:
        results = _passing_regression()
        results[1]["elapsedSeconds"] = sel.REGRESSION_TIME_BUDGET_SECONDS + 1
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=results,
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_REGRESSION_FAILED)

    def test_missing_regression_suite_fails_closed(self) -> None:
        # Only two of the three required suites recorded.
        results = _passing_regression()[:2]
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=results,
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_REGRESSION_FAILED)

    def test_no_regression_evidence_fails_closed(self) -> None:
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=[],
            regression_results=None,
        )
        self.assertEqual(artifact["resultCode"], sel.CODE_REGRESSION_FAILED)

    def test_all_fixed_codes_are_in_closed_set(self) -> None:
        artifact = sel.check_merge_candidate(
            "R1-validators",
            ledger=_ledger(),
            route_handler_work_classes=["crawler_execution"],
            regression_results=_passing_regression(),
        )
        self.assertIn(artifact["resultCode"], sel.SELECTOR_ERROR_CODES)


if __name__ == "__main__":
    unittest.main()
