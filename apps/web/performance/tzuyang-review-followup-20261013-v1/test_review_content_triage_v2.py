"""
Unit tests for review_content_triage_v2.py
Tests exact multiset TS preservation, compound vs standalone narrator referent,
particle-noun collision, unprompted advisory expansion separation,
and enforcement of applyReady: False.
"""
import unittest
from review_content_triage_v2 import triage_review_content_v2

class TestReviewContentTriageV2(unittest.TestCase):

    def test_eligible_editorial_draft(self):
        orig = "공주에서 가장 매운 짬뽕으로 유명함. 해산물이 푸짐하게 들어있음."
        after = "공주에서 가장 매운 짬뽕으로 유명하다고 소개되었습니다. 해산물이 푸짐하게 들어 있다고 설명했습니다."
        res = triage_review_content_v2("r0409", "editorial", orig, after)
        self.assertEqual(res["triageStatus"], "CONTENT_TRIAGE_ELIGIBLE")
        self.assertFalse(res["applyReady"])
        self.assertEqual(res["hardErrors"], [])

    def test_valid_compound_youtuber_tzuyang_not_failed(self):
        # '유튜버 쯔양' is valid Korean compound noun phrase and should not fail
        orig = "유튜버 쯔양이 자주 방문하는 곱창집입니다."
        after = "유튜버 쯔양이 자주 방문하는 곱창집으로 소개되었습니다."
        res = triage_review_content_v2("test_compound", "editorial", orig, after)
        self.assertEqual(res["triageStatus"], "CONTENT_TRIAGE_ELIGIBLE")
        self.assertFalse(res["applyReady"])
        self.assertEqual(res["hardErrors"], [])

    def test_standalone_referent_collision_r1294(self):
        # Standalone '유튜버가' coexisting with '쯔양' is an inconsistent referent
        orig = "유튜버 쯔양의 10년 단골집입니다. 유튜버가 추천하는 히든 메뉴는 제육덮밥입니다."
        after = "쯔양이 고등학생 때 찾던 단골집입니다. 유튜버가 추천하는 히든 메뉴는 제육덮밥입니다."
        res = triage_review_content_v2("r1294", "source_correction", orig, after)
        self.assertEqual(res["triageStatus"], "SOURCE_INTEGRITY_VIOLATION")
        self.assertFalse(res["applyReady"])
        codes = [e["code"] for e in res["hardErrors"]]
        self.assertIn("STANDALONE_REFERENT_COLLISION", codes)

    def test_ts_multiset_deletion_r0999(self):
        orig = "소아식을 개편하여 노력했다는 설명을 듣습니다{ts:598-ts:615}."
        after = "소아식을 개편하여 노력했다는 설명을 듣습니다."
        res = triage_review_content_v2("r0999", "editorial", orig, after)
        self.assertEqual(res["triageStatus"], "SOURCE_INTEGRITY_VIOLATION")
        self.assertFalse(res["applyReady"])
        codes = [e["code"] for e in res["hardErrors"]]
        self.assertIn("TS_MARKER_MULTISET_MISMATCH", codes)
        self.assertIn("{ts:598-ts:615}", res["hardErrors"][0]["details"]["removed"])

    def test_ts_multiset_number_altered(self):
        # Count is same (1 == 1), but string is altered -> multiset mismatch!
        orig = "메뉴를 소개합니다{ts:100}."
        after = "메뉴를 소개합니다{ts:200}."
        res = triage_review_content_v2("test_ts_alter", "source_correction", orig, after)
        self.assertEqual(res["triageStatus"], "SOURCE_INTEGRITY_VIOLATION")
        codes = [e["code"] for e in res["hardErrors"]]
        self.assertIn("TS_MARKER_MULTISET_MISMATCH", codes)

    def test_ts_multiset_duplicate_substitution(self):
        orig = "메뉴를 소개합니다{ts:100}."
        after = "메뉴를 소개합니다{ts:100}{ts:100}."
        res = triage_review_content_v2("test_ts_dup", "source_correction", orig, after)
        self.assertEqual(res["triageStatus"], "SOURCE_INTEGRITY_VIOLATION")
        codes = [e["code"] for e in res["hardErrors"]]
        self.assertIn("TS_MARKER_MULTISET_MISMATCH", codes)

    def test_particle_spacing_collision_r1138(self):
        orig = "성게알(우니)은店家만의 양념으로 상쾌한 맛을 낸다고 설명했습니다."
        after = "성게알(우니)은가게만의 양념으로 상쾌한 맛을 낸다고 설명했습니다."
        res = triage_review_content_v2("r1138", "editorial", orig, after)
        self.assertEqual(res["triageStatus"], "SOURCE_INTEGRITY_VIOLATION")
        codes = [e["code"] for e in res["hardErrors"]]
        self.assertIn("PARTICLE_SPACING_COLLISION", codes)

    def test_unprompted_advisory_expansion_r1300(self):
        orig = "모든 메뉴가 '역대급'이라는 극찬을 받았습니다."
        after = "모든 메뉴가 '역대급'이라는 극찬을 받았습니다. 다만 쯔양은 한국에서 온 손님이라면 소금을 덜 짜게 해달라고 요청하면 좋겠다고 덧붙였으며, 치즈케이크는 매우 맛있지만 매우 달다고 평가했습니다."
        res = triage_review_content_v2("r1300", "source_correction", orig, after)
        self.assertEqual(res["triageStatus"], "EDITORIAL_ADVISORY_HELD")
        self.assertFalse(res["applyReady"])
        advisory_codes = [a["code"] for a in res["advisoryHints"]]
        self.assertIn("UNPROMPTED_ADVISORY_EXPANSION", advisory_codes)

if __name__ == '__main__':
    unittest.main()

