import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "shadow_diff_address_match.py"

spec = importlib.util.spec_from_file_location("shadow_diff_address_match", SCRIPT_PATH)
shadow_diff = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(shadow_diff)


class ShadowDiffAddressMatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_jsonl(self, path: Path, rows: list[dict]) -> None:
        with open(path, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def test_load_rows_and_second_pass_counters_support_rule_and_transform_shapes(self):
        baseline = self.base / "baseline.jsonl"
        candidate = self.base / "candidate.jsonl"
        self._write_jsonl(
            baseline,
            [
                {
                    "youtube_link": "https://youtube.com/watch?v=aaa",
                    "trace_id_name_source": "original",
                    "evaluation_results": {
                        "location_match_TF": [
                            {"origin_name": "식당A", "eval_value": False, "pending_reason": "insufficient_evidence"}
                        ]
                    },
                }
            ],
        )
        self._write_jsonl(
            candidate,
            [
                {
                    "trace_id": "trace-1",
                    "origin_name": "식당A",
                    "trace_id_name_source": "google",
                    "evaluation_results": {
                        "location_match_TF": {
                            "origin_name": "식당A",
                            "eval_value": True,
                            "matched_provider": "google",
                            "matched_name": "식당A",
                            "google_name": "식당A",
                            "matched_address": {
                                "roadAddress": "서울특별시 강남구 테헤란로 1",
                                "jibunAddress": "서울특별시 강남구 역삼동 1",
                            },
                            "second_pass": {
                                "attempted": True,
                                "provider": "google",
                                "timed_out": False,
                                "rate_limited": False,
                                "duration_ms": 1200,
                            },
                        }
                    },
                }
            ],
        )

        baseline_rows = shadow_diff.load_location_rows(baseline)
        candidate_rows = shadow_diff.load_location_rows(candidate)
        counters = shadow_diff.compute_second_pass_counters(candidate_rows)

        self.assertEqual(1, len(baseline_rows))
        self.assertEqual(1, len(candidate_rows))
        self.assertEqual(1, counters["attempted"])
        self.assertEqual(1, counters["promoted_true"])
        self.assertEqual("google", candidate_rows[0]["matched_provider"])


if __name__ == "__main__":
    unittest.main()
