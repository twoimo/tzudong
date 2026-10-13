import unittest
from prepare_minimal_v2 import corrected_spec, preserve_markers


class CorrectionTests(unittest.TestCase):
    def test_source_marker_only_change_is_removed_from_write_plan(self):
        self.assertEqual(corrected_spec('r0999', {'replacements': [['{ts:598-ts:615}', '']]}),
                         (None, 'PRESERVE_VIDEO_MARKER_DISPLAY_ONLY'))

    def test_expansion_is_held_without_rewriting_the_old_spec(self):
        old = {'replacements': [['x', 'expanded']]}
        self.assertEqual(corrected_spec('r1300', old), (None, 'SOURCE_EXPANSION_HELD'))
        self.assertEqual(old['replacements'], [['x', 'expanded']])

    def test_spacing_change_owns_the_particle_boundary(self):
        next_spec, _ = corrected_spec('r1138', {'replacements': [['店家', '가게']]})
        before, after = next_spec['replacements'][0]
        self.assertEqual('성게알(우니)은店家만의 양념'.replace(before, after), '성게알(우니)은 가게만의 양념')

    def test_referent_fix_preserves_existing_citations_and_prior_correction(self):
        old = {'replacements': [['before', 'after']], 'evidence': [{'segment': 1, 'quote': 'source'}]}
        next_spec, _ = corrected_spec('r1294', old)
        self.assertEqual(next_spec['evidence'], old['evidence'])
        self.assertEqual(next_spec['replacements'], [['before', 'after'], ['유튜버가 추천하는', '쯔양이 추천하는']])
        self.assertEqual(len(old['replacements']), 1)

    def test_marker_numbers_and_duplicate_identity_are_preserved(self):
        preserve_markers('원문 [ts:4] {ts:5} [ts:4]', '수정 [ts:4] [ts:4] {ts:5}')
        for after in ['수정 [ts:4] {ts:6} [ts:4]', '수정 [ts:4] {ts:5] [ts:5]', '수정 {ts:5} [ts:4]']:
            with self.assertRaisesRegex(ValueError, 'SOURCE_TIMESTAMP_MULTISET_DRIFT'):
                preserve_markers('원문 [ts:4] {ts:5} [ts:4]', after)


if __name__ == '__main__':
    unittest.main()
