import importlib.util
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "10-rule-evaluation.py"

spec = importlib.util.spec_from_file_location("rule_evaluation_precision", SCRIPT_PATH)
rule_eval = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(rule_eval)


class RuleEvaluationPrecisionLiftTests(unittest.TestCase):
    def test_build_location_result_requires_two_independent_families(self):
        result = rule_eval.build_location_result(
            origin_name="식당A",
            origin_address="서울특별시 강남구",
            eval_value=True,
            matched_provider="google",
            matched_name="식당A",
            google_name="식당A",
            evidence_families=[rule_eval.EVIDENCE_PROVIDER_CANDIDATE],
            false_message="증거 부족",
            match_status="pending",
        )

        self.assertFalse(result["eval_value"])
        self.assertEqual("pending", result["match_status"])
        self.assertEqual([rule_eval.EVIDENCE_PROVIDER_CANDIDATE], result["evidence_families"])

    def test_evaluate_category_validity_ignores_pending_provider_names(self):
        restaurants = [{"origin_name": "원본식당", "category": "한식"}]
        location_results = [
            {
                "origin_name": "원본식당",
                "eval_value": False,
                "google_name": "후보식당",
            }
        ]

        category_results, name_sources = rule_eval.evaluate_category_validity(restaurants, location_results)

        self.assertEqual("원본식당", category_results[0]["name"])
        self.assertEqual("origin_name", name_sources["원본식당"])

    def test_unique_exact_title_region_match_promotes_true(self):
        result = rule_eval.evaluate_with_unique_naver_title_match(
            "을밀대",
            "서울특별시 마포구",
            [
                {
                    "title": "을밀대",
                    "address": "서울특별시 마포구 숭문길 24",
                    "roadAddress": "서울특별시 마포구 숭문길 24",
                    "mapx": "",
                    "mapy": "",
                }
            ],
            source_lat=None,
            source_lng=None,
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result["eval_value"])
        self.assertEqual("matched", result["match_status"])
        self.assertEqual("을밀대", result["matched_name"])
        self.assertEqual(
            [rule_eval.EVIDENCE_PROVIDER_CANDIDATE, rule_eval.EVIDENCE_SOURCE_GEO],
            result["evidence_families"],
        )

    def test_unique_exact_title_region_match_avoids_multi_candidate_auto_true(self):
        result = rule_eval.evaluate_with_unique_naver_title_match(
            "김밥천국 방배점",
            "서울특별시 서초구 방배동",
            [
                {"title": "김밥천국 방배점", "address": "서울특별시 서초구 방배동 1", "roadAddress": ""},
                {"title": "김밥천국 방배점", "address": "서울특별시 서초구 방배동 2", "roadAddress": ""},
            ],
            source_lat=None,
            source_lng=None,
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertFalse(result["eval_value"])
        self.assertEqual("pending", result["match_status"])
        self.assertEqual(rule_eval.PENDING_REASON_MULTI_CANDIDATE, result["pending_reason"])

    def test_gemini_fallback_requires_address_alignment(self):
        original = rule_eval._run_gemini_fallback_query
        try:
            rule_eval._run_gemini_fallback_query = lambda name, addr: {
                "ok": True,
                "payload": {
                    "confident": True,
                    "matched_name": "Heart Attack Grill",
                    "matched_address": "450 Fremont St, Las Vegas, NV 89101",
                    "matched_country": "USA",
                    "evidence_summary": ["Verified from web search"],
                },
            }
            result = rule_eval.evaluate_with_gemini_fallback(
                "Heart Attack Grill",
                "450 Fremont St, Las Vegas, NV 89101-5623",
                "2단계 실패: 20m 이내 후보 없음",
            )
        finally:
            rule_eval._run_gemini_fallback_query = original

        self.assertTrue(result["eval_value"])
        self.assertEqual("matched", result["match_status"])
        self.assertEqual("gemini", result["matched_provider"])
        self.assertEqual(
            ["llm_verification", rule_eval.EVIDENCE_SOURCE_GEO],
            result["evidence_families"],
        )

    def test_gemini_fallback_rejects_cross_country_mismatch(self):
        original = rule_eval._run_gemini_fallback_query
        try:
            rule_eval._run_gemini_fallback_query = lambda name, addr: {
                "ok": True,
                "payload": {
                    "confident": True,
                    "matched_name": "Heart Attack Grill",
                    "matched_address": "450 Fremont St, Las Vegas, NV 89101",
                    "matched_country": "USA",
                    "evidence_summary": ["Verified from web search"],
                },
            }
            result = rule_eval.evaluate_with_gemini_fallback(
                "Heart Attack Grill",
                "No. 116, Guiyang St Sec 2, Wanhua District, Taipei City, Taiwan",
                "2단계 실패: 20m 이내 후보 없음",
            )
        finally:
            rule_eval._run_gemini_fallback_query = original

        self.assertFalse(result["eval_value"])
        self.assertEqual("pending", result["match_status"])
        self.assertEqual(rule_eval.PENDING_REASON_CROSS_COUNTRY, result["pending_reason"])

    def test_gemini_fallback_rejects_non_restaurant_candidate(self):
        original = rule_eval._run_gemini_fallback_query
        try:
            rule_eval._run_gemini_fallback_query = lambda name, addr: {
                "ok": True,
                "payload": {
                    "confident": True,
                    "matched_name": "세븐일레븐 종로청운점",
                    "matched_address": "서울특별시 종로구 자하문로 115",
                    "matched_country": "KR",
                    "evidence_summary": ["Convenience store listing found"],
                },
            }
            result = rule_eval.evaluate_with_gemini_fallback(
                "세븐일레븐 종로청운점",
                "서울특별시 종로구 자하문로 102",
                "2단계 실패: 20m 이내 후보 없음",
            )
        finally:
            rule_eval._run_gemini_fallback_query = original

        self.assertFalse(result["eval_value"])
        self.assertEqual("pending", result["match_status"])
        self.assertEqual(rule_eval.PENDING_REASON_INSUFFICIENT, result["pending_reason"])


if __name__ == "__main__":
    unittest.main()
