from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "12-transform.py"

spec = importlib.util.spec_from_file_location("transform_address_match", SCRIPT_PATH)
transform_mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(transform_mod)


class TransformAddressMatchRegressionTests(unittest.TestCase):
    def test_get_location_data_reads_canonical_matched_address(self):
        eval_results = {
            "location_match_TF": [
                {
                    "origin_name": "식당A",
                    "eval_value": True,
                    "matched_provider": "google",
                    "matched_name": "식당A",
                    "google_name": "식당A",
                    "matched_address": {
                        "roadAddress": "서울특별시 강남구 테헤란로 1",
                        "jibunAddress": "서울특별시 강남구 역삼동 1",
                        "englishAddress": "1, Teheran-ro, Gangnam-gu, Seoul",
                        "addressElements": [],
                        "x": "127.0",
                        "y": "37.5",
                    },
                }
            ]
        }

        loc_data = transform_mod.get_location_data(eval_results, "식당A", False, "results")

        self.assertTrue(loc_data["geocoding_success"])
        self.assertEqual("google", loc_data["matched_provider"])
        self.assertEqual("식당A", loc_data["google_name"])
        self.assertEqual("서울특별시 강남구 테헤란로 1", loc_data["roadAddress"])
        self.assertEqual(37.5, loc_data["lat"])
        self.assertEqual(127.0, loc_data["lng"])

    def test_transform_keeps_trace_id_name_source_original_for_pending_candidate(self):
        original_data = {
            "youtube_link": "https://www.youtube.com/watch?v=test1234567",
            "evaluation_results": {
                "location_match_TF": [
                    {
                        "origin_name": "식당A",
                        "eval_value": False,
                        "matched_provider": "google",
                        "matched_name": "후보식당",
                        "google_name": "후보식당",
                        "pending_reason": "insufficient_evidence",
                        "falseMessage": "증거 부족",
                    }
                ],
                "category_validity_TF": [{"name": "식당A", "eval_value": True}],
            },
            "restaurants": [
                {
                    "origin_name": "식당A",
                    "address": "서울특별시 강남구",
                    "category": "한식",
                    "reasoning_basis": "근거",
                    "youtuber_review": "리뷰",
                    "lat": None,
                    "lng": None,
                }
            ],
            "evaluation_target": {"식당A": True},
            "recollect_version": {},
        }

        rows = transform_mod.transform_json_object(original_data, "results", "tzuyang", meta_cache=None, video_id=None)

        self.assertEqual(1, len(rows))
        self.assertEqual("original", rows[0]["trace_id_name_source"])
        self.assertEqual("후보식당", rows[0]["google_name"])


if __name__ == "__main__":
    unittest.main()
