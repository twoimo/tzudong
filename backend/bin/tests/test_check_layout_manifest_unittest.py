#!/usr/bin/env python3
"""Unit tests for the Layout_Manifest checker ``backend/bin/check_layout_manifest.py``.

These verify the checker's observable branches and error paths — tracked-dir
enumeration, entry shape / Requirement 6.2 content, bidirectional
correspondence, the deploy/pipeline_control ownership split, move-residual
counting, alias/symlink rejection, and stale-reference scanning — plus one
end-to-end assertion that the real committed manifest passes against the real
tree (task 34 landed the move and reconciled references). Following the
``backend/bin`` convention (no ``__init__.py``), the module is loaded by path.
"""

from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_CHECKER_PATH = _ROOT / "backend" / "bin" / "check_layout_manifest.py"
_MANIFEST_PATH = _ROOT / "backend" / "layout-manifest.v1.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


clm = _load("check_layout_manifest", _CHECKER_PATH)


def _entry(path, *, classification="source", vcs=True, ownership=None,
           allowed=None, forbidden=None):
    return {
        "path": path,
        "depth": 1 if "/" not in path else 2,
        "ownership": ownership if ownership is not None else f"{path} owner",
        "allowedContents": allowed if allowed is not None else ["allowed thing"],
        "forbiddenContents": forbidden if forbidden is not None else ["forbidden thing"],
        "classification": classification,
        "vcsTracked": vcs,
    }


def _minimal_valid_manifest():
    """A structurally valid manifest satisfying Requirement 6.2 pinned content."""

    return {
        "schemaVersion": 1,
        "entries": [
            _entry(
                "apps/web",
                ownership="Web_App 경계",
                forbidden=[
                    "장시간 크롤러 실행 소유",
                    "ffmpeg 처리 소유",
                    "Gemini 대량 평가 소유",
                    "GDrive 대량 업로드 소유",
                    "장시간 Supabase 배치 삽입 소유",
                ],
            ),
            _entry("backend", ownership="Backend_Runtime 경계"),
        ],
    }


class TrackedDirectoriesTest(unittest.TestCase):
    def test_derives_first_and_second_level_dirs_and_skips_top_files(self):
        files = [
            "apps/web/app/page.tsx",
            "backend/README.md",  # file directly under backend -> only 'backend'
            "backend/bin/x.py",
            ".github/workflows/ci.yml",
            "AGENTS.md",  # top-level file -> nothing
        ]
        dirs = clm.tracked_directories(files)
        self.assertIn("apps", dirs)
        self.assertIn("apps/web", dirs)
        self.assertIn("backend", dirs)
        self.assertIn("backend/bin", dirs)
        self.assertIn(".github", dirs)
        self.assertIn(".github/workflows", dirs)
        self.assertNotIn("backend/README.md", dirs)

    def test_excludes_tooling_and_spec_top_level_dirs(self):
        files = [".kiro/specs/x/design.md", ".cursor/scripts/a.sh", "docs/product/p.md"]
        dirs = clm.tracked_directories(files)
        self.assertNotIn(".kiro", dirs)
        self.assertNotIn(".cursor", dirs)
        self.assertIn("docs", dirs)
        self.assertIn("docs/product", dirs)


class ValidateEntriesTest(unittest.TestCase):
    def test_valid_manifest_accepted(self):
        result = clm.validate_entries(_minimal_valid_manifest())
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["errorCode"])

    def test_empty_ownership_rejected(self):
        m = _minimal_valid_manifest()
        m["entries"][1]["ownership"] = "  "
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.LAYOUT_MANIFEST_ENTRY_INVALID)

    def test_empty_allowed_or_forbidden_rejected(self):
        m = _minimal_valid_manifest()
        m["entries"][1]["forbiddenContents"] = []
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("forbidden_contents_empty", kinds)

    def test_invalid_classification_rejected(self):
        m = _minimal_valid_manifest()
        m["entries"][1]["classification"] = "unknown"
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.LAYOUT_MANIFEST_ENTRY_INVALID)

    def test_source_must_be_vcs_tracked_true(self):
        m = _minimal_valid_manifest()
        m["entries"][1]["vcsTracked"] = False
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("source_not_vcs_tracked", kinds)

    def test_non_source_must_record_vcs_excluded(self):
        m = _minimal_valid_manifest()
        m["entries"].append(_entry("backend/performance", classification="build_artifact", vcs=True))
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("excluded_not_vcs_excluded", kinds)

    def test_apps_web_ownership_and_forbidden_pinned(self):
        m = _minimal_valid_manifest()
        m["entries"][0]["ownership"] = "generic owner"  # drop Web_App
        m["entries"][0]["forbiddenContents"] = ["only one thing"]  # drop tokens
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("apps_web_ownership_not_web_app", kinds)
        self.assertIn("apps_web_forbidden_incomplete", kinds)

    def test_backend_ownership_pinned(self):
        m = _minimal_valid_manifest()
        m["entries"][1]["ownership"] = "not the boundary"
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("backend_ownership_not_backend_runtime", kinds)

    def test_duplicate_path_rejected(self):
        m = _minimal_valid_manifest()
        m["entries"].append(_entry("backend", ownership="Backend_Runtime dup"))
        result = clm.validate_entries(m)
        self.assertFalse(result["ok"])
        kinds = {i["kind"] for i in result["issues"]}
        self.assertIn("duplicate_path", kinds)


class CorrespondenceTest(unittest.TestCase):
    def _manifest(self):
        return {
            "entries": [
                _entry("apps"),
                _entry("apps/web"),
                _entry("backend/performance", classification="build_artifact", vcs=False),
            ]
        }

    def test_bidirectional_match_passes(self):
        tracked = {"apps", "apps/web"}
        result = clm.check_correspondence(self._manifest(), tracked)
        self.assertTrue(result["ok"], result)

    def test_tree_without_entry_flagged(self):
        tracked = {"apps", "apps/web", "backend", "backend/bin"}
        result = clm.check_correspondence(self._manifest(), tracked)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.LAYOUT_MANIFEST_MISSING_ENTRY)
        dirs = {(m["direction"], m["path"]) for m in result["missing"]}
        self.assertIn(("tree_without_entry", "backend"), dirs)
        self.assertIn(("tree_without_entry", "backend/bin"), dirs)

    def test_entry_without_tree_flagged(self):
        tracked = {"apps"}  # apps/web source entry has no tracked dir
        result = clm.check_correspondence(self._manifest(), tracked)
        self.assertFalse(result["ok"])
        dirs = {(m["direction"], m["path"]) for m in result["missing"]}
        self.assertIn(("entry_without_tree", "apps/web"), dirs)

    def test_vcs_excluded_entry_must_not_be_tracked(self):
        tracked = {"apps", "apps/web", "backend/performance"}
        result = clm.check_correspondence(self._manifest(), tracked)
        self.assertFalse(result["ok"])
        dirs = {(m["direction"], m["path"]) for m in result["missing"]}
        self.assertIn(("excluded_entry_tracked", "backend/performance"), dirs)


class OwnershipTest(unittest.TestCase):
    def test_clean_tree_passes(self):
        files = [
            "backend/deploy/pipeline-control/Dockerfile",
            "backend/deploy/tooling-selection.v1.json",
            "backend/pipeline_control/graph.py",
        ]
        result = clm.check_directory_ownership(files)
        self.assertTrue(result["ok"], result)

    def test_python_module_under_deploy_flagged(self):
        files = ["backend/deploy/helm/render.py"]
        result = clm.check_directory_ownership(files)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.DIRECTORY_OWNERSHIP_VIOLATION)
        self.assertEqual(result["violations"][0]["kind"], "python_module_under_deploy")

    def test_container_asset_under_pipeline_control_flagged(self):
        for offending in (
            "backend/pipeline_control/Dockerfile",
            "backend/pipeline_control/docker-compose.kafka.yml",
            "backend/pipeline_control/grafana/dashboard.json",
            "backend/pipeline_control/metrics.v1.json",
        ):
            result = clm.check_directory_ownership([offending])
            self.assertFalse(result["ok"], offending)
            self.assertEqual(result["errorCode"], clm.DIRECTORY_OWNERSHIP_VIOLATION)


class DirectoryMoveTest(unittest.TestCase):
    def test_completed_move_zero_one_passes(self):
        files = ["backend/deploy/pipeline-control/Dockerfile"]
        result = clm.check_directory_move(
            "backend/pipeline-control", "backend/deploy/pipeline-control", files
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["beforeMatchCount"], 0)
        self.assertEqual(result["afterMatchCount"], 1)

    def test_residual_before_path_flagged(self):
        files = [
            "backend/pipeline-control/Dockerfile",
            "backend/deploy/pipeline-control/Dockerfile",
        ]
        result = clm.check_directory_move(
            "backend/pipeline-control", "backend/deploy/pipeline-control", files
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.DIRECTORY_MOVE_RESIDUAL_PATH)
        self.assertEqual(result["beforeMatchCount"], 1)

    def test_missing_after_path_flagged(self):
        files = ["backend/other/thing.txt"]
        result = clm.check_directory_move(
            "backend/pipeline-control", "backend/deploy/pipeline-control", files
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["afterMatchCount"], 0)


class AliasPathTest(unittest.TestCase):
    def test_clean_tree_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "backend" / "deploy" / "pipeline-control").mkdir(parents=True)
            result = clm.check_alias_paths(root)
            self.assertTrue(result["ok"], result)

    def test_moved_from_alias_dir_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "backend" / "pipeline-control").mkdir(parents=True)
            result = clm.check_alias_paths(root)
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], clm.ALIAS_PATH_NOT_ADMITTED)
            kinds = {o["kind"] for o in result["offenders"]}
            self.assertIn("moved_from_alias_dir", kinds)

    def test_compat_symlink_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = root / "backend" / "deploy" / "pipeline-control"
            real.mkdir(parents=True)
            link = root / "backend" / "pipeline-control"
            os.symlink(real, link, target_is_directory=True)
            result = clm.check_alias_paths(root)
            self.assertFalse(result["ok"])
            kinds = {o["kind"] for o in result["offenders"]}
            # The moved-from symlink is caught directly.
            self.assertIn("moved_from_symlink", kinds)


class StaleReferenceTest(unittest.TestCase):
    def test_clean_tree_reports_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wf = root / ".github" / "workflows"
            wf.mkdir(parents=True)
            (wf / "ci.yml").write_text(
                "run: python backend/deploy/pipeline-control/x.py\n", encoding="utf-8"
            )
            result = clm.scan_stale_references(root)
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["unresolvedCount"], 0)

    def test_moved_from_reference_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wf = root / ".github" / "workflows"
            wf.mkdir(parents=True)
            (wf / "ci.yml").write_text(
                "run: docker build -f backend/pipeline-control/Dockerfile .\n",
                encoding="utf-8",
            )
            result = clm.scan_stale_references(root)
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], clm.STALE_PATH_REFERENCE)
            self.assertGreaterEqual(result["unresolvedCount"], 1)
            kinds = {u["kind"] for u in result["unresolved"]}
            self.assertIn("moved_from_reference", kinds)

    def test_dependabot_unresolved_directory_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".github").mkdir(parents=True)
            (root / ".github" / "dependabot.yml").write_text(
                'updates:\n  - package-ecosystem: "pip"\n'
                '    directory: "/backend/does-not-exist"\n',
                encoding="utf-8",
            )
            result = clm.scan_stale_references(root)
            self.assertFalse(result["ok"])
            kinds = {u["kind"] for u in result["unresolved"]}
            self.assertIn("dependabot_directory_unresolved", kinds)


class RealTreeTest(unittest.TestCase):
    def test_committed_manifest_passes_on_real_tree(self):
        # End-to-end: the real committed manifest + real git-tracked tree must
        # pass now that task 34 landed the move and reconciled references.
        result = clm.run_check(root=_ROOT, manifest_path=_MANIFEST_PATH)
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["errorCode"])
        self.assertIn(result["errorCode"], clm.LAYOUT_CHECK_RESULT_CODES)
        # 27 tracked in-scope 1st/2nd-level directories (includes backend/rust).
        self.assertEqual(result["trackedDirectoryCount"], 27)
        self.assertEqual(result["checks"]["staleReferences"]["unresolvedCount"], 0)
        move = result["checks"]["moves"][0]
        self.assertEqual(move["beforeMatchCount"], 0)
        self.assertEqual(move["afterMatchCount"], 1)

    def test_result_code_in_closed_set(self):
        result = clm.run_check(root=_ROOT, manifest_path=_MANIFEST_PATH)
        self.assertIn(result["errorCode"], clm.LAYOUT_CHECK_RESULT_CODES)


if __name__ == "__main__":
    unittest.main()
