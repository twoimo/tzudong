from __future__ import annotations

import builtins
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "12-transform.py"

spec = importlib.util.spec_from_file_location("transform_rule_read_amplification", SCRIPT_PATH)
transform_mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(transform_mod)


RULE_RECORD = {
    "evaluation_results": {
        "location_match_TF": [
            {
                "origin_name": "정원분식",
                "eval_value": True,
                "matched_provider": "google",
                "google_name": "정원분식",
            }
        ],
        "category_validity_TF": [{"name": "정원분식", "eval_value": True}],
    },
    "evaluation_target": {"정원분식": True},
    "restaurants": [
        {
            "origin_name": "정원분식",
            "category": "분식",
            "reasoning_basis": "영상 초반 간판 노출",
            "youtuber_review": "리뷰",
            "lat": None,
            "lng": None,
        }
    ],
    "recollect_version": {},
}

LAAJ_LINE = {
    "youtube_link": "https://www.youtube.com/watch?v=abcdefghijk",
    "evaluation_results": {},
    "evaluation_target": {"정원분식": True},
    "restaurants": [],
    "recollect_version": {},
}


class TransformRuleMergeReadAmplificationTests(unittest.TestCase):
    def _run_transform(self, line_count: int) -> tuple[int, list[dict]]:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            crawling = root_path / "crawling"
            evaluation = root_path / "evaluation"
            (crawling / "meta").mkdir(parents=True)
            (crawling / "map_url_crawling").mkdir(parents=True)
            (evaluation / "evaluation" / "notSelection").mkdir(parents=True)
            rule_dir = evaluation / "evaluation" / "rule_results"
            laaj_dir = evaluation / "evaluation" / "laaj_results"
            rule_dir.mkdir(parents=True)
            laaj_dir.mkdir(parents=True)

            rule_file = rule_dir / "videoA.jsonl"
            rule_file.write_text(
                json.dumps(RULE_RECORD, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            laaj_file = laaj_dir / "videoA.jsonl"
            laaj_file.write_text(
                "".join(
                    json.dumps(LAAJ_LINE, ensure_ascii=False) + "\n"
                    for _ in range(line_count)
                ),
                encoding="utf-8",
            )

            original_open = builtins.open
            rule_opens = 0

            def counting_open(file, *args, **kwargs):
                nonlocal rule_opens
                if Path(file) == rule_file:
                    rule_opens += 1
                return original_open(file, *args, **kwargs)

            previous_argv = sys.argv
            sys.argv = [
                str(SCRIPT_PATH),
                "--channel",
                "tzuyang",
                "--crawling-path",
                str(crawling),
                "--evaluation-path",
                str(evaluation),
            ]
            builtins.open = counting_open
            try:
                transform_mod.main()
            finally:
                builtins.open = original_open
                sys.argv = previous_argv

            output = evaluation / "evaluation" / "transforms.jsonl"
            rows = [
                json.loads(line)
                for line in output.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            return rule_opens, rows

    def test_rule_payload_is_read_once_per_file_instead_of_once_per_line(self):
        rule_opens, rows = self._run_transform(line_count=40)

        # 40 laaj lines used to reopen and reparse the same rule file 40 times.
        self.assertEqual(1, rule_opens)
        # The per-line merge still runs, so the merged restaurants reach the output.
        self.assertEqual(1, len(rows))
        self.assertEqual("정원분식", rows[0]["origin_name"])
        self.assertEqual(True, rows[0]["evaluation_results"]["category_validity_TF"]["eval_value"])

    def test_single_line_input_keeps_the_same_merge_result(self):
        rule_opens, rows = self._run_transform(line_count=1)

        self.assertEqual(1, rule_opens)
        self.assertEqual(1, len(rows))
        self.assertEqual("정원분식", rows[0]["origin_name"])


if __name__ == "__main__":
    unittest.main()
