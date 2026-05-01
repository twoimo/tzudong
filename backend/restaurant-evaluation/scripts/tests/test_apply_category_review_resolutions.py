from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "apply_category_review_resolutions.py"
spec = importlib.util.spec_from_file_location("apply_category_review_resolutions", SCRIPT)
resolver = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(resolver)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class ApplyCategoryReviewResolutionsTest(unittest.TestCase):
    def setUp(self):
        self.original_decisions = resolver.CATEGORY_REVIEW_DECISIONS
        resolver.CATEGORY_REVIEW_DECISIONS = {
            1: {"categories": ["아시안"], "reason": "canonicalize 일식"},
            2: {"categories": ["중식"], "reason": "missing 짜장"},
        }

    def tearDown(self):
        resolver.CATEGORY_REVIEW_DECISIONS = self.original_decisions

    def target_row(self, line: int):
        if line == 1:
            return {
                "trace_id": "trace-taxonomy",
                "youtube_link": "https://youtu.be/taxonomy",
                "origin_name": "일식당",
                "category": ["일식"],
                "evaluation_results": {"category_validity_TF": {"eval_value": False}},
            }
        return {
            "trace_id": "trace-missing",
            "youtube_link": "https://youtu.be/missing",
            "origin_name": "옛날맛짜장",
            "category": None,
            "evaluation_results": None,
        }

    def blocked_rows(self):
        return [
            {
                "source_line": 1,
                "trace_id": "trace-taxonomy",
                "youtube_link": "https://youtu.be/taxonomy",
                "origin_name": "일식당",
                "review_queue": "taxonomy_review_required",
            },
            {
                "source_line": 2,
                "trace_id": "trace-missing",
                "youtube_link": "https://youtu.be/missing",
                "origin_name": "옛날맛짜장",
                "review_queue": "missing_category_review",
            },
        ]

    def test_dry_run_reports_without_mutating_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            blocked = root / "blocked.jsonl"
            original_rows = [self.target_row(1), self.target_row(2)]
            write_jsonl(target, original_rows)
            write_jsonl(blocked, self.blocked_rows())

            report = resolver.apply_category_review_resolutions(target, blocked, root / "out", apply=False)

            self.assertEqual("dry-run", report["mode"])
            self.assertEqual(2, report["planned_or_applied_changes"])
            self.assertEqual(original_rows, [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()])

    def test_apply_updates_category_and_category_validity_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "transforms.jsonl"
            blocked = root / "blocked.jsonl"
            write_jsonl(target, [self.target_row(1), self.target_row(2)])
            write_jsonl(blocked, self.blocked_rows())

            report = resolver.apply_category_review_resolutions(target, blocked, root / "out", apply=True)
            rows = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]

            self.assertEqual("apply", report["mode"])
            self.assertTrue(Path(report["backup_path"]).exists())
            self.assertEqual("아시안", rows[0]["category"])
            self.assertEqual("중식", rows[1]["category"])
            self.assertTrue(rows[0]["evaluation_results"]["category_validity_TF"]["eval_value"])
            self.assertEqual("category_review_resolution", rows[1]["evaluation_results"]["category_validity_TF"]["projection_source"])

    def test_rejects_incomplete_decision_coverage(self):
        resolver.CATEGORY_REVIEW_DECISIONS = {1: {"categories": ["아시안"], "reason": "only one"}}
        with self.assertRaises(resolver.CategoryReviewResolutionError):
            resolver.build_changes([json.dumps(self.target_row(1)), json.dumps(self.target_row(2))], self.blocked_rows())

    def test_rejects_invalid_decision_category(self):
        resolver.CATEGORY_REVIEW_DECISIONS = {
            1: {"categories": ["일식"], "reason": "invalid"},
            2: {"categories": ["중식"], "reason": "ok"},
        }
        with self.assertRaises(resolver.CategoryReviewResolutionError):
            resolver.build_changes([json.dumps(self.target_row(1)), json.dumps(self.target_row(2))], self.blocked_rows())


if __name__ == "__main__":
    unittest.main()
