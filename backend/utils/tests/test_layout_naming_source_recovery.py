"""Source contracts for the current-layout and rename-ledger recovery."""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
LAYOUT_CHECKER = ROOT / "backend/bin/check_layout_manifest.py"
RENAME_CHECKER = ROOT / "backend/bin/check_rename_ledger.py"
LAYOUT_MANIFEST = ROOT / "backend/layout-manifest.v1.json"
RENAME_LEDGER = ROOT / "backend/naming-renames.v1.json"
WORKFLOW = ROOT / ".github/workflows/security-audit.yml"
HISTORICAL_DUPLICATE = ROOT / "backend/deploy/pipeline-control"

LAYOUT_MODULES = (
    "backend.utils.tests.test_layout_naming_source_recovery",
    "backend.bin.tests.test_check_layout_manifest_unittest",
    "backend.bin.tests.test_check_rename_ledger_unittest",
    "backend.bin.tests.test_layout_move_pbt",
    "backend.bin.tests.test_rename_scope_pbt",
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


layout = _load("current_layout_checker", LAYOUT_CHECKER)
rename = _load("current_rename_checker", RENAME_CHECKER)


class LayoutNamingSourceRecoveryTests(unittest.TestCase):
    def test_all_adapted_checker_and_test_paths_exist(self) -> None:
        paths = (
            LAYOUT_CHECKER,
            RENAME_CHECKER,
            LAYOUT_MANIFEST,
            ROOT / "backend/bin/tests/test_check_layout_manifest_unittest.py",
            ROOT / "backend/bin/tests/test_check_rename_ledger_unittest.py",
            ROOT / "backend/bin/tests/test_layout_move_pbt.py",
            ROOT / "backend/bin/tests/test_rename_scope_pbt.py",
        )
        self.assertEqual(len(paths), 7)
        for path in paths:
            self.assertTrue(path.is_file(), path)

    def test_current_tree_has_one_operational_asset_owner_and_no_historical_copy(self) -> None:
        document = json.loads(LAYOUT_MANIFEST.read_text(encoding="utf-8"))
        entries = {entry["path"]: entry for entry in document["entries"]}
        self.assertIn("backend/pipeline-control", entries)
        self.assertIn("backend/pipeline_control", entries)
        self.assertIn("backend/deploy", entries)
        self.assertIn("backend/rust", entries)
        self.assertFalse(HISTORICAL_DUPLICATE.exists())
        self.assertEqual(layout.DEFAULT_MOVES, ())
        self.assertIn("관측성", entries["backend/pipeline-control"]["ownership"])
        self.assertIn("파이썬", entries["backend/pipeline_control"]["ownership"])

    def test_layout_manifest_matches_versioned_and_candidate_files(self) -> None:
        result = layout.run_check(root=ROOT, manifest_path=LAYOUT_MANIFEST)
        self.assertEqual(result["errorCode"], None, result)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["trackedDirectoryCount"], 28)
        self.assertEqual(result["checks"]["moves"], [])

    def test_existing_rename_ledger_is_complete_without_aliases(self) -> None:
        result = rename.run_check(root=ROOT, manifest_path=RENAME_LEDGER)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["entryCount"], 5)
        self.assertTrue(all(item["oldReferenceCount"] == 0 for item in result["checks"]["verification"]))
        self.assertTrue(all(item["newDefinitionCount"] == 1 for item in result["checks"]["verification"]))

    def test_checkers_are_read_only_and_have_bounded_codes(self) -> None:
        layout_source = LAYOUT_CHECKER.read_text(encoding="utf-8")
        rename_source = RENAME_CHECKER.read_text(encoding="utf-8")
        for source in (layout_source, rename_source):
            self.assertNotIn("requests", source)
            self.assertNotIn("create_client", source)
            self.assertNotIn("git mv", source)
            self.assertNotIn("shutil.move", source)
        self.assertEqual(len(layout.LAYOUT_CHECK_RESULT_CODES), 7)
        self.assertEqual(len(rename.RENAME_CHECK_RESULT_CODES), 6)

    def test_security_workflow_runs_all_layout_contracts_once(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8")
        for module in LAYOUT_MODULES:
            self.assertEqual(source.count(module), 1, module)
        for trigger in (
            "backend/layout-manifest.v1.json",
            "backend/naming-renames.v1.json",
            "backend/bin/check_layout_manifest.py",
            "backend/bin/check_rename_ledger.py",
        ):
            self.assertIn(trigger, source)


if __name__ == "__main__":
    unittest.main()
