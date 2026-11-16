"""Source contracts for the current-layout and rename-ledger recovery."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path, PurePosixPath

import yaml

from backend.utils.tests.ci_scope_assertions import assert_security_scope


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
        self.assertEqual(entries["backend/data"]["classification"], "source")
        self.assertTrue(entries["backend/data"]["vcsTracked"])
        self.assertIn("개인정보", entries["backend/data"]["forbiddenContents"])
        self.assertFalse(HISTORICAL_DUPLICATE.exists())
        self.assertEqual(layout.DEFAULT_MOVES, ())
        self.assertIn("관측성", entries["backend/pipeline-control"]["ownership"])
        self.assertIn("파이썬", entries["backend/pipeline_control"]["ownership"])

    def test_taste_skill_direction_has_an_owned_source_entry(self) -> None:
        document = json.loads(LAYOUT_MANIFEST.read_text(encoding="utf-8"))
        entry = {item["path"]: item for item in document["entries"]}[".taste-skill"]
        self.assertEqual(entry["depth"], 1)
        self.assertEqual(entry["classification"], "source")
        self.assertTrue(entry["vcsTracked"])
        self.assertIn("direction.json", " ".join(entry["allowedContents"]))
        self.assertIn("실행 소스", entry["forbiddenContents"])

    def test_layout_manifest_matches_versioned_and_candidate_files(self) -> None:
        result = layout.run_check(root=ROOT, manifest_path=LAYOUT_MANIFEST)
        self.assertEqual(result["errorCode"], None, result)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["trackedDirectoryCount"], 48)
        self.assertEqual(result["checks"]["moves"], [])

    def test_existing_rename_ledger_is_complete_without_aliases(self) -> None:
        result = rename.run_check(root=ROOT, manifest_path=RENAME_LEDGER)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["entryCount"], 5)
        self.assertTrue(all(item["oldReferenceCount"] == 0 for item in result["checks"]["verification"]))
        self.assertTrue(all(item["newDefinitionCount"] == 1 for item in result["checks"]["verification"]))

    @unittest.skipUnless(hasattr(sys, "stdlib_module_names"), "needs Python 3.10+")
    def test_no_tracked_python_module_shadows_the_standard_library(self) -> None:
        tracked = subprocess.run(
            ["git", "ls-files", "-z", "--", "*.py"],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout.decode("utf-8").split("\0")
        shadows = []
        for raw in filter(None, tracked):
            path = PurePosixPath(raw)
            name = path.parent.name if path.name == "__init__.py" else path.stem
            if name in sys.stdlib_module_names:
                shadows.append(f"{raw} shadows stdlib '{name}'")
        self.assertEqual(
            shadows,
            [],
            "A script run from that directory, or `unittest discover -s <dir>` "
            "without `-t .`, puts the directory first on sys.path, so "
            "`import <name>` in the stdlib or in hypothesis loads the local file. "
            "Rename the module, as backend/pipeline_control/queue.py became "
            "file_queue.py.",
        )

    def test_no_tracked_claude_md_hides_agents_md(self) -> None:
        tracked = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout.decode("utf-8").split("\0")
        hiding = []
        for raw in filter(None, tracked):
            path = PurePosixPath(raw)
            if path.name not in {"CLAUDE.md", "CLAUDE.local.md"}:
                continue
            at_root = str(path.parent) in {".", ".claude"}
            in_web = raw.startswith("apps/web/") and not raw.startswith("apps/web/performance/")
            if at_root or in_web:
                hiding.append(raw)
        self.assertEqual(
            hiding,
            [],
            "Claude Code stops reading AGENTS.md once a CLAUDE.md exists at or above "
            "its working directory. Keep guidance in AGENTS.md and delete these files.",
        )

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
        workflow = yaml.safe_load(source)
        events = workflow.get("on", workflow.get(True))
        self.assertIn("pull_request", events)
        self.assertIsNone(events["pull_request"])
        paths = (
            "backend/layout-manifest.v1.json",
            "backend/naming-renames.v1.json",
            "backend/bin/check_layout_manifest.py",
            "backend/bin/check_rename_ledger.py",
        )
        assert_security_scope(self, paths)
        job = workflow["jobs"]["orchestration-readiness"]
        self.assertEqual(job["needs"], "scope")
        self.assertEqual(job["if"], "needs.scope.outputs.security == 'true'")
        self.assertIsNot(job.get("continue-on-error"), True)
        for module in LAYOUT_MODULES:
            self.assertTrue(any(
                module in step.get("run", "") and "if" not in step
                and step.get("continue-on-error") is not True
                for step in job["steps"]
            ), module)
        result = workflow["jobs"]["security-result"]
        self.assertEqual(result["if"], "${{ always() }}")
        self.assertIn("orchestration-readiness", result["needs"])


if __name__ == "__main__":
    unittest.main()
