#!/usr/bin/env python3
"""Unit tests for the Rename_Ledger checker ``backend/bin/check_rename_ledger.py``.

These verify the checker's observable branches and error paths for
platform-modernization Requirement 7 -- ledger shape (7.1, 7.2, 7.7), rename
scope (7.4), canonical-privacy contract (7.5, 7.8), applied-rename verification
(7.3, 7.6, 7.9), and target-test success (7.10) -- plus one end-to-end
assertion that the real committed ``backend/naming-renames.v1.json`` passes
against the real tracked tree (the five existing entries are already applied:
old paths absent, new paths unique). Following the ``backend/bin`` convention
(no ``__init__.py``), the module is loaded by path.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_CHECKER_PATH = _ROOT / "backend" / "bin" / "check_rename_ledger.py"
_MANIFEST_PATH = _ROOT / "backend" / "naming-renames.v1.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


crl = _load("check_rename_ledger", _CHECKER_PATH)


def _entry(
    *,
    old_path="backend/x/scripts/02.1-foo.py",
    new_path="backend/x/scripts/02-1-foo.py",
    rationale="Normalize the substage prefix.",
    classification=None,
    verification=None,
):
    return {
        "oldPath": old_path,
        "newPath": new_path,
        "rationale": rationale,
        "contractClassification": (
            classification if classification is not None else ["internal-path"]
        ),
        "verification": (
            verification
            if verification is not None
            else ["old path absent", "canonical path unique", "suite 3/3"]
        ),
    }


def _minimal_valid_ledger():
    return {
        "schemaVersion": 1,
        "entries": [_entry()],
        "nonGoals": [
            "public route or API renames",
            "applied migration renames",
            "aliases or compatibility wrappers",
        ],
    }


class LedgerShapeTests(unittest.TestCase):
    # Requirements 7.1, 7.2, 7.7 -> rename_ledger_invalid.

    def test_minimal_valid_ledger_passes(self):
        result = crl.validate_ledger_shape(_minimal_valid_ledger())
        self.assertTrue(result["ok"], msg=result)
        self.assertIsNone(result["errorCode"])

    def test_wrong_schema_version_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["schemaVersion"] = 2
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_missing_non_goals_rejected(self):
        ledger = _minimal_valid_ledger()
        del ledger["nonGoals"]
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_empty_required_field_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"][0]["rationale"] = "   "
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_classification_out_of_closed_set_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"][0]["contractClassification"] = ["internal-path", "bogus"]
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_empty_classification_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"][0]["contractClassification"] = []
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_all_five_classification_values_accepted(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"][0]["contractClassification"] = sorted(
            crl.RENAME_CONTRACT_CLASSES
        )
        result = crl.validate_ledger_shape(ledger)
        self.assertTrue(result["ok"], msg=result)

    def test_fewer_than_three_verification_items_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"][0]["verification"] = ["only one", "two"]
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)

    def test_duplicate_old_path_rejected(self):
        ledger = _minimal_valid_ledger()
        ledger["entries"].append(_entry())  # same old/new paths
        result = crl.validate_ledger_shape(ledger)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_LEDGER_INVALID)


class RenameScopeTests(unittest.TestCase):
    # Requirements 7.4, 7.5, 7.8 -> rename_scope_violation / privacy_contract_violation.

    def test_internal_path_rename_accepted(self):
        target = {
            "oldName": "backend/x/scripts/02.1-foo.py",
            "newName": "backend/x/scripts/02-1-foo.py",
            "path": "backend/x/scripts/02-1-foo.py",
        }
        result = crl.classify_rename_scope(target)
        self.assertTrue(result["ok"], msg=result)
        self.assertIsNone(result["errorCode"])

    def test_public_route_path_rejected(self):
        target = {
            "oldName": "old",
            "newName": "new",
            "path": "apps/web/app/global-map/page.tsx",
        }
        result = crl.classify_rename_scope(target)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_SCOPE_VIOLATION)

    def test_public_api_route_file_rejected(self):
        target = {"oldName": "o", "newName": "n", "path": "apps/web/app/api/x/route.ts"}
        result = crl.classify_rename_scope(target)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_SCOPE_VIOLATION)

    def test_private_folder_route_is_not_public(self):
        target = {"oldName": "o", "newName": "n", "path": "apps/web/app/_lib/page.tsx"}
        result = crl.classify_rename_scope(target)
        self.assertTrue(result["ok"], msg=result)

    def test_persistent_data_path_rejected(self):
        target = {
            "oldName": "o",
            "newName": "n",
            "path": "backend/supabase/migrations/20260820040000_pipeline_batch_upsert.sql",
        }
        result = crl.classify_rename_scope(target)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_SCOPE_VIOLATION)

    def test_rpc_name_rejected(self):
        target = {"oldName": "batch_upsert_restaurants", "newName": "batch_upsert_v2"}
        result = crl.classify_rename_scope(target)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_SCOPE_VIOLATION)

    def test_injected_migration_object_and_api_field_rejected(self):
        refs = crl.RenameScopeRefs(
            migration_objects=frozenset({"pipeline_control"}),
            public_api_fields=frozenset({"approved_name"}),
        )
        for name in ("pipeline_control", "approved_name"):
            result = crl.classify_rename_scope(
                {"oldName": name, "newName": "renamed"}, refs=refs
            )
            self.assertFalse(result["ok"], msg=name)
            self.assertEqual(result["errorCode"], crl.RENAME_SCOPE_VIOLATION)

    def test_all_canonical_privacy_names_rejected(self):
        for name in crl.CANONICAL_PRIVACY_NAMES:
            result = crl.classify_rename_scope({"oldName": name, "newName": "renamed"})
            self.assertFalse(result["ok"], msg=name)
            self.assertEqual(result["errorCode"], crl.PRIVACY_CONTRACT_VIOLATION)

    def test_privacy_takes_precedence_over_scope(self):
        # A privacy RPC is also an RPC name; privacy wins.
        result = crl.classify_rename_scope(
            {"oldName": "submit_privacy_consent", "newName": "n"}
        )
        self.assertEqual(result["errorCode"], crl.PRIVACY_CONTRACT_VIOLATION)

    def test_alias_for_privacy_name_rejected(self):
        result = crl.classify_rename_scope(
            {"oldName": "safe_a", "newName": "safe_b", "aliasFor": "privacy_consent_state"}
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.PRIVACY_CONTRACT_VIOLATION)

    def test_seven_objects_and_five_rpcs_counts(self):
        self.assertEqual(len(crl.CANONICAL_PRIVACY_OBJECTS), 7)
        self.assertEqual(len(crl.CANONICAL_PRIVACY_RPCS), 5)


class RenameVerificationTests(unittest.TestCase):
    # Requirements 7.3, 7.6, 7.9 -> rename_verification_failed.

    def test_zero_old_one_new_passes(self):
        result = crl.evaluate_rename_verification(0, 1)
        self.assertTrue(result["ok"], msg=result)
        self.assertIsNone(result["errorCode"])

    def test_old_reference_present_rejected(self):
        result = crl.evaluate_rename_verification(1, 1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_VERIFICATION_FAILED)

    def test_new_definition_not_exactly_one_rejected(self):
        for new_count in (0, 2, 3):
            result = crl.evaluate_rename_verification(0, new_count)
            self.assertFalse(result["ok"], msg=new_count)
            self.assertEqual(result["errorCode"], crl.RENAME_VERIFICATION_FAILED)

    def test_verify_entry_paths_passes_when_old_absent_new_present(self):
        entry = _entry(old_path="a/old.py", new_path="a/new.py")
        result = crl.verify_entry_paths(entry, ["a/new.py", "b/other.py"])
        self.assertTrue(result["ok"], msg=result)

    def test_verify_entry_paths_fails_when_old_present(self):
        entry = _entry(old_path="a/old.py", new_path="a/new.py")
        result = crl.verify_entry_paths(entry, ["a/old.py", "a/new.py"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_VERIFICATION_FAILED)

    def test_verify_entry_paths_ignores_local_archive(self):
        # An old-path copy under .local-archive/ does not count as a reference.
        entry = _entry(old_path="a/old.py", new_path="a/new.py")
        result = crl.verify_entry_paths(
            entry, [".local-archive/a/old.py", "a/new.py"]
        )
        self.assertTrue(result["ok"], msg=result)


class RenameTestSuiteTests(unittest.TestCase):
    # Requirement 7.10 -> rename_test_failure.

    def test_ran_zero_failures_passes(self):
        result = crl.evaluate_rename_test_result(True, 0)
        self.assertTrue(result["ok"], msg=result)

    def test_not_run_rejected(self):
        result = crl.evaluate_rename_test_result(False, 0)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_TEST_FAILURE)

    def test_failures_rejected(self):
        result = crl.evaluate_rename_test_result(True, 2)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_TEST_FAILURE)

    def test_injected_runner_reporting_failure(self):
        entry = _entry()
        result = crl.check_entry_tests(entry, lambda e: {"ran": True, "failures": 1})
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_TEST_FAILURE)

    def test_injected_runner_success(self):
        entry = _entry()
        result = crl.check_entry_tests(entry, lambda e: {"ran": True, "failures": 0})
        self.assertTrue(result["ok"], msg=result)


class AggregateRunTests(unittest.TestCase):
    def test_committed_ledger_passes_against_real_tree(self):
        # The five committed entries are already applied: old paths absent, new
        # paths unique. run_check uses the default git enumerator over the tree.
        result = crl.run_check()
        self.assertTrue(result["ok"], msg=result)
        self.assertIsNone(result["errorCode"])
        self.assertGreaterEqual(result["entryCount"], 5)

    def test_committed_ledger_shape_valid(self):
        manifest = crl.load_manifest()
        self.assertEqual(manifest["schemaVersion"], 1)
        shape = crl.validate_ledger_shape(manifest)
        self.assertTrue(shape["ok"], msg=shape)

    def test_run_check_reports_verification_failure_with_stale_tree(self):
        # Feed an enumerator that still contains an old path -> verification fails.
        manifest = crl.load_manifest()
        old_path = manifest["entries"][0]["oldPath"]
        new_paths = [e["newPath"] for e in manifest["entries"]]

        def enumerator(_root):
            return new_paths + [old_path]

        result = crl.run_check(git_enumerator=enumerator)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.RENAME_VERIFICATION_FAILED)

    def test_run_check_with_test_runner_dimension(self):
        result = crl.run_check(
            test_runner=lambda e: {"ran": True, "failures": 0}
        )
        self.assertTrue(result["ok"], msg=result)
        self.assertNotEqual(result["checks"]["tests"], "skipped")

    def test_error_codes_are_bounded(self):
        # No emitted code is outside the closed set.
        result = crl.run_check()
        self.assertIn(result["errorCode"], crl.RENAME_CHECK_RESULT_CODES)


if __name__ == "__main__":
    unittest.main()
