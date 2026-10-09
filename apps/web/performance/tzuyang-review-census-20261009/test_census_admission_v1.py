import unittest
from census_admission_v1 import classify, presentation_only, sha, assert_fresh_preimage


class CensusAdmissionTests(unittest.TestCase):
    def row(self, text):
        return {"id": "fixture", "status": "approved", "channel_name": "tzuyang",
                "tzuyang_review": text, "reviewSha256": sha(text),
                "recordSha256": "a" * 64, "adminLocked": True, "updated_at": "revision-1"}

    def item(self, proposal, issues=None):
        return {"key": "r0001", "status": "fix", "issues": issues or ["RAW_FORMATTING"],
                "revisedReview": proposal}

    def test_format_only_preserves_quantities_criticism_and_quotation(self):
        text = '쯔양은 **2인분**(30,000원)이 "제 취향에는 짜다"고 했습니다 . [ts:534, ts:571]'
        fixed = '쯔양은 2인분(30,000원)이 "제 취향에는 짜다"고 했습니다.'
        self.assertEqual(presentation_only(text), fixed)
        self.assertEqual(classify(self.row(text), self.item(fixed))['decision'], 'local_plan')

    def test_global_time_cleanup_is_not_allowed(self):
        text = '12:20에 열고 (12:20)에 도착했습니다. 영상에서는 맛있다고 했습니다(1:00).'
        self.assertEqual(presentation_only(text), text)
        self.assertNotEqual(presentation_only('맛있었습니다(1:99).', allow_video_parentheses=True), '맛있었습니다.')
        self.assertEqual(presentation_only('2 . 5인분과 [일반 설명]입니다.'), '2 . 5인분과 [일반 설명]입니다.')

    def test_parenthetic_video_reference_requires_explicit_record_review(self):
        text = '쯔양은 1++ 등급을 칭찬했습니다(0:46, 5:11).'
        proposed = '쯔양은 1++ 등급을 칭찬했습니다.'
        item = self.item(proposed, ['INTERNAL_MARKER'])
        self.assertEqual(classify(self.row(text), item)['decision'], 'deferred')
        self.assertEqual(classify(self.row(text), item, reviewed_video_parentheses=True)['decision'], 'local_plan')

    def test_language_rewrite_and_number_changes_are_not_format_proof(self):
        row = self.row('쯔양은 2인분이 짜다고 했습니다.')
        for proposed in ['쯔양은 3인분이 짜다고 했습니다.', '쯔양은 2인분을 추천했습니다.']:
            self.assertEqual(classify(row, self.item(proposed))['decision'], 'deferred')

    def test_deleted_empty_unknown_channel_and_semantic_issue_stay_deferred(self):
        row = self.row('**맛**이 강했습니다.')
        item = self.item('맛이 강했습니다.')
        for field, value in [('status', 'deleted'), ('status', 'hold'), ('channel_name', None)]:
            bad = {**row, field: value}
            self.assertEqual(classify(bad, item)['decision'], 'deferred')
        self.assertEqual(classify(row, self.item('맛이 강했습니다.', ['CONTRADICTION']))['decision'], 'deferred')
        self.assertEqual(classify(self.row(''), self.item('맛있었습니다.'))['decision'], 'deferred')

    def test_fresh_source_drift_is_refused_before_guarded_preview(self):
        source = self.row('원문')
        fresh = {**source, 'updated_by_admin_id': 'fixture-owner'}
        assert_fresh_preimage(source, fresh, fresh_record_sha256=source['recordSha256'])
        for key, value in [('id', 'other'), ('status', 'deleted'), ('tzuyang_review', '수정 원문'),
                           ('updated_at', 'revision-2'), ('updated_by_admin_id', None)]:
            with self.assertRaisesRegex(ValueError, 'CENSUS_FRESH_PREIMAGE_DENIED'):
                assert_fresh_preimage(source, {**fresh, key: value}, fresh_record_sha256=source['recordSha256'])
        with self.assertRaisesRegex(ValueError, 'CENSUS_FRESH_PREIMAGE_DENIED'):
            assert_fresh_preimage(source, fresh, fresh_record_sha256='b' * 64)

    def test_original_hash_tampering_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'CENSUS_REVIEW_PREIMAGE_HASH_DENIED'):
            classify({**self.row('원문'), 'reviewSha256': 'b' * 64}, self.item('원문'))


if __name__ == '__main__':
    unittest.main()
