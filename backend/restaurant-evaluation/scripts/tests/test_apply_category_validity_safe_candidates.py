from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "apply_category_validity_safe_candidates.py"
spec = importlib.util.spec_from_file_location("apply_category_validity_safe_candidates", SCRIPT)
apply_script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(apply_script)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class ApplyCategoryValiditySafeCandidatesTest(unittest.TestCase):
    def target_row(self, **overrides):
        row = {
            "trace_id": "trace-safe",
            "youtube_link": "https://www.youtube.com/watch?v=safe",
            "origin_name": "복합식당",
            "category": ["한식", "고기"],
            "evaluation_results": {"category_validity_TF": {"eval_value": False}, "location_match_TF": {"eval_value": False}},
        }
        row.update(overrides)
        return row

    def candidate(self, **overrides):
        row = {
            "safe_apply_id": "CVSA-0001-trace-safe",
            "category_diff_id": "CVD-0001-trace-safe",
            "safe_apply_status": "ready_for_operator_approved_apply",
            "review_queue": "safe_category_validity_projection",
            "diff_status": "false_to_true",
            "before_category_validity": False,
            "after_category_validity": True,
            "blocked_reasons": [],
            "source_line": 1,
            "trace_id": "trace-safe",
            "youtube_link": "https://www.youtube.com/watch?v=safe",
            "origin_name": "복합식당",
            "category": ["한식", "고기"],
            "projected_category_validity_TF": {
                "eval_value": True,
                "normalized_categories": ["한식", "고기"],
                "projection_source": "category_multilabel_validator_fix",
            },
        }
        row.update(overrides)
        return row

    def test_dry_run_writes_report_without_mutating_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            candidates = root / "candidates.jsonl"
            out = root / "out"
            original = self.target_row()
            write_jsonl(target, [original])
            write_jsonl(candidates, [self.candidate()])

            report = apply_script.apply_safe_candidates(target, candidates, out, apply=False)

            self.assertEqual("dry-run", report["mode"])
            self.assertEqual(1, report["planned_or_applied_changes"])
            self.assertIsNone(report["backup_path"])
            self.assertEqual(original, json.loads(target.read_text(encoding="utf-8")))
            self.assertTrue((out / "category-validity-safe-apply-dry-run-changes.jsonl").exists())

    def test_apply_mutates_only_category_validity_tf_and_creates_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            candidates = root / "candidates.jsonl"
            out = root / "out"
            write_jsonl(target, [self.target_row()])
            write_jsonl(candidates, [self.candidate()])

            report = apply_script.apply_safe_candidates(target, candidates, out, apply=True)
            row = json.loads(target.read_text(encoding="utf-8"))

            self.assertEqual("apply", report["mode"])
            self.assertTrue(Path(report["backup_path"]).exists())
            self.assertEqual({"eval_value": False}, row["evaluation_results"]["location_match_TF"])
            self.assertEqual(True, row["evaluation_results"]["category_validity_TF"]["eval_value"])
            self.assertEqual("category_multilabel_validator_fix", row["evaluation_results"]["category_validity_TF"]["projection_source"])

    def test_rejects_candidate_when_target_guard_does_not_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            candidates = root / "candidates.jsonl"
            write_jsonl(target, [self.target_row(trace_id="different")])
            write_jsonl(candidates, [self.candidate()])

            with self.assertRaises(apply_script.SafeApplyError):
                apply_script.apply_safe_candidates(target, candidates, root / "out", apply=False)

    def test_rejects_blocked_or_non_false_to_true_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            candidates = root / "candidates.jsonl"
            write_jsonl(target, [self.target_row()])
            write_jsonl(candidates, [self.candidate(safe_apply_status="blocked_from_safe_apply")])

            with self.assertRaises(apply_script.SafeApplyError):
                apply_script.apply_safe_candidates(target, candidates, root / "out", apply=False)


if __name__ == "__main__":
    unittest.main()
