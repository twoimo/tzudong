import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "sync_verified_place_corrections_to_supabase.py"
SPEC = importlib.util.spec_from_file_location("sync_verified_place_corrections_to_supabase", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(module)


class VerifiedPlaceCorrectionPayloadTests(unittest.TestCase):
    def test_flatten_categories_removes_nested_arrays_and_duplicates(self):
        self.assertEqual(["한식", "분식"], module.flatten_categories([["한식", "분식"], "한식", None, ""]))

    def test_build_payload_guards_approved_name_and_normalizes_metadata(self):
        existing = {
            "approved_name": "춘천냉면",
            "origin_name": "청량리할머니냉면",
            "naver_name": "할머니냉면",
            "categories": [["한식", "분식"]],
            "evaluation_results": {"old": True},
            "jibun_address": "서울특별시 동대문구 청량리동 733",
        }
        correction = {
            "restaurants": [{
                "origin_name": "춘천냉면",
                "address": "서울특별시 동대문구 왕산로37길 50",
                "lat": 37.5821845,
                "lng": 127.0439578,
                "category": ["한식", "분식"],
            }]
        }

        payload = module.build_payload(existing, correction)

        self.assertEqual("춘천냉면", payload["origin_name"])
        self.assertEqual("춘천냉면", payload["naver_name"])
        self.assertEqual(["한식", "분식"], payload["categories"])
        self.assertTrue(payload["evaluation_results"]["location_match_TF"]["eval_value"])
        self.assertEqual("manual_place_correction_supabase_sync", payload["evaluation_results"]["category_validity_TF"]["projection_source"])

    def test_build_payload_rejects_non_matching_approved_name(self):
        self.assertIsNone(module.build_payload(
            {"approved_name": "다른집"},
            {"restaurants": [{"origin_name": "춘천냉면", "category": ["한식"]}]},
        ))


if __name__ == "__main__":
    unittest.main()
