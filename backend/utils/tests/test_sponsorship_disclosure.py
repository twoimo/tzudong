import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.utils.sponsorship_disclosure import analyze_disclosure, supplement_ads, VERSION

FIXTURE = Path(__file__).parent / "fixtures" / "sponsorship-disclosure.json"


class DisclosureTests(unittest.TestCase):
    def test_shared_golden_cases(self):
        for case in json.loads(FIXTURE.read_text()):
            with self.subTest(case=case["id"]):
                result = analyze_disclosure(case["description"])
                self.assertEqual(result["sponsor_analysis"]["outcome"], case["outcome"])
                self.assertEqual(result["what_ads"], case["names"])
                self.assertEqual(result["is_ads"], {"unknown": None, "confirmed_none": False, "detected": True}[case["outcome"]])
                self.assertEqual(result["sponsor_analysis"]["version"], VERSION)
                if isinstance(case["description"], str):
                    self.assertEqual(result["sponsor_analysis"]["source_sha256"], hashlib.sha256(case["description"].encode()).hexdigest())

    def test_unknown_changed_description_preserves_positive_and_negative_without_claiming_completion(self):
        for prior in [{"is_ads": True, "what_ads": ["SavedCo"]}, {"is_ads": False, "what_ads": None},
                      {"is_ads": True, "what_ads": None}]:
            result = supplement_ads("광고 문의: arbitrary", prior, "old")
            self.assertEqual(result["is_ads"], prior["is_ads"])
            self.assertEqual(result["what_ads"], prior["what_ads"])
            self.assertEqual(result["sponsor_analysis"]["status"], "unknown")
            self.assertTrue(result["sponsor_analysis"]["retained_previous"])
            self.assertEqual(result["sponsor_analysis"]["retained_version"], "legacy")

    def test_unchanged_saved_decision_is_not_rewritten_as_rules_evidence(self):
        for prior in [{"is_ads": True, "what_ads": ["SavedCo"]}, {"is_ads": False, "what_ads": None}]:
            with patch('backend.utils.sponsorship_disclosure.analyze_disclosure', side_effect=AssertionError('replayed')):
                self.assertEqual(supplement_ads("same", prior, "same"), prior)

    def test_known_replacement_and_disabled_state(self):
        prior = {"is_ads": True, "what_ads": ["OldCo"]}
        result = supplement_ads("본 영상은 광고가 아닙니다.", prior, "old")
        self.assertFalse(result["is_ads"])
        self.assertEqual(result["sponsor_analysis"]["outcome"], "confirmed_none")
        with patch('backend.utils.sponsorship_disclosure.analyze_disclosure', side_effect=AssertionError('disabled')):
            result = supplement_ads("본 영상은 NewCo의 유료광고를 포함합니다.", prior, "old", enabled=False)
        self.assertEqual(result["what_ads"], ["OldCo"])
        self.assertEqual(result["sponsor_analysis"]["reason"], "analysis_disabled")


if __name__ == "__main__":
    unittest.main()
