import copy
import unittest
import local_evaluation_review as review


class EvidenceRecoveryTests(unittest.TestCase):
    def row(self):
        return {'id':'00000000-0000-4000-8000-000000000001', 'trace_id':'a'*64,
                'youtube_link':'https://www.youtube.com/watch?v=abcdefghijk',
                'row_sha256':'b'*64, **{field:None for field in review.EVIDENCE_FIELDS}}

    def test_recovers_only_missing_fields_preserving_local_edits(self):
        local = self.row()
        local['reasoning_basis'] = 'Locally reviewed evidence'
        source = {**local, 'evaluation_results':{'visit_authenticity':{'eval_value':1}},
                  'reasoning_basis':'Older source evidence'}
        change = review.evidence_plan([local],[source])[0]
        self.assertEqual(change['patch'], {'evaluation_results':source['evaluation_results']})
        review.validate_changes([change], 'evidence')

    def test_does_not_invent_absent_evidence(self):
        self.assertEqual(review.evidence_plan([self.row()],[self.row()]), [])

    def test_changed_video_or_trace_aborts_recovery(self):
        for field in ('trace_id','youtube_link'):
            source = {**self.row(), field:'changed'}
            with self.assertRaisesRegex(review.catalog.CatalogError,'source_identity_changed'):
                review.evidence_plan([self.row()],[source])

    def test_duplicate_source_identity_is_not_last_write_wins(self):
        with self.assertRaisesRegex(review.catalog.CatalogError,'source_duplicate_identity'):
            review.evidence_plan([self.row()],[self.row(),self.row()])

    def test_evidence_cannot_change_status_and_decisions_cannot_change_coordinates(self):
        change = {'id':self.row()['id'],'before_sha256':'a'*64,'patch':{'status':'approved'},
                  'reason':'SOURCE_EVIDENCE_RECOVERED','evidence_sha256':'c'*64}
        with self.assertRaisesRegex(review.catalog.CatalogError,'review_patch_invalid'):
            review.validate_changes([change], 'evidence')
        change.update(patch={'status':'approved','approved_name':'Example','lat':37.5}, reason='VERIFIED_RESTAURANT')
        with self.assertRaisesRegex(review.catalog.CatalogError,'review_patch_invalid'):
            review.validate_changes([change], 'decision')

    def test_approval_requires_name_and_verified_reason(self):
        change = {'id':self.row()['id'],'before_sha256':'a'*64,'patch':{'status':'approved'},
                  'reason':'INSUFFICIENT_SOURCE_EVIDENCE','evidence_sha256':'c'*64}
        with self.assertRaisesRegex(review.catalog.CatalogError,'review_approval_invalid'):
            review.validate_changes([change], 'decision')

    def test_duplicate_targets_rejected(self):
        change = {'id':self.row()['id'],'before_sha256':'a'*64,'patch':{'status':'deleted'},
                  'reason':'NOT_A_RESTAURANT_VISIT','evidence_sha256':'c'*64}
        with self.assertRaisesRegex(review.catalog.CatalogError,'review_identity_invalid'):
            review.validate_changes([change,copy.deepcopy(change)], 'decision')


if __name__ == '__main__':
    unittest.main()
