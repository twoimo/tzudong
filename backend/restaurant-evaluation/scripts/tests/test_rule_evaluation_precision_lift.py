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


if __name__ == "__main__":
    unittest.main()
