"""
Unit tests for review_admission_check.py
Covers positive admission cases and negative regression cases
(admin lock, timestamp stripping, particle collision, entity clash, scope creep).
"""
import unittest
from review_admission_check import check_admission, compute_sha256

class TestReviewAdmissionCheck(unittest.TestCase):

    def test_eligible_editorial_draft(self):
        orig = "공주에서 가장 매운 짬뽕으로 유명함. 해산물이 푸짐하게 들어있음."
        after = "공주에서 가장 매운 짬뽕으로 유명하다고 소개되었습니다. 해산물이 푸짐하게 들어 있다고 설명했습니다."
        ok, code, issues = check_admission("r0409", "editorial", orig, after, admin_locked=False)
        self.assertTrue(ok)
        self.assertEqual(code, "ADMISSION_PASSED")
        self.assertEqual(issues, [])

    def test_eligible_source_correction(self):
        orig = "단, 하루 딱 2시간(11:00 ~ 13:00)만 영업하여 재료 소진이 빠르므로 반드시 오픈런을 해야 합니다."
        after = "촬영 당시에는 11시부터 13시까지 하루 2시간 영업한다고 소개되었습니다."
        ok, code, issues = check_admission("r0607", "source_correction", orig, after, admin_locked=False)
        self.assertTrue(ok)
        self.assertEqual(code, "ADMISSION_PASSED")

    def test_admin_locked_rejection(self):
        orig = "원문 리뷰"
        after = "수정 리뷰"
        ok, code, issues = check_admission("r0012", "editorial", orig, after, admin_locked=True)
        self.assertFalse(ok)
        self.assertEqual(code, "ADMIN_LOCK_ACTIVE")

    def test_preimage_hash_mismatch(self):
        orig = "원문 리뷰"
        after = "수정 리뷰"
        wrong_hash = "0" * 64
        ok, code, issues = check_admission("r0409", "editorial", orig, after, admin_locked=False, expected_before_sha=wrong_hash)
        self.assertFalse(ok)
        self.assertEqual(code, "PREIMAGE_HASH_MISMATCH")

    def test_timestamp_deletion_rejection_r0999(self):
        orig = "소아식을 개편하여 식사 순응도를 높이려 노력했다는 설명을 듣습니다{ts:598-ts:615}."
        after = "소아식을 개편하여 식사 순응도를 높이려 노력했다는 설명을 듣습니다."
        ok, code, issues = check_admission("r0999", "editorial", orig, after, admin_locked=False)
        self.assertFalse(ok)
        self.assertEqual(code, "TIMESTAMP_DELETED")

    def test_spacing_collision_rejection_r1138(self):
        orig = "성게알(우니)은店家만의 양념으로 상쾌한 맛을 낸다고 설명했습니다."
        after = "성게알(우니)은가게만의 양념으로 상쾌한 맛을 낸다고 설명했습니다."
        ok, code, issues = check_admission("r1138", "editorial", orig, after, admin_locked=False)
        self.assertFalse(ok)
        self.assertEqual(code, "SPACING_COLLISION")

    def test_entity_inconsistency_rejection_r1294(self):
        orig = "유튜버 쯔양의 10년 단골집입니다. 유튜버가 추천하는 히든 메뉴인 제육덮밥은..."
        after = "쯔양이 고등학생 때 자주 찾던 곳입니다. 유튜버가 추천하는 히든 메뉴인 제육덮밥은..."
        ok, code, issues = check_admission("r1294", "source_correction", orig, after, admin_locked=False)
        self.assertFalse(ok)
        self.assertEqual(code, "ENTITY_INCONSISTENCY")

    def test_scope_creep_rejection_r1300(self):
        orig = "모든 메뉴가 '역대급'이라는 극찬을 받았습니다."
        after = "모든 메뉴가 '역대급'이라는 극찬을 받았습니다. 다만 쯔양은 한국에서 온 손님이라면 소금을 덜 짜게 해달라고 요청하면 좋겠다고 덧붙였으며, 치즈케이크는 매우 맛있지만 매우 달다고 평가했습니다."
        ok, code, issues = check_admission("r1300", "source_correction", orig, after, admin_locked=False)
        self.assertFalse(ok)
        self.assertEqual(code, "SCOPE_CREEP")

if __name__ == '__main__':
    unittest.main()

