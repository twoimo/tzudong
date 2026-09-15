import copy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import local_catalog_workspace as catalog
import local_catalog_publish_plan as publish
from test_local_catalog_workspace import row


class PublishReviewTests(unittest.TestCase):
    def setUp(self):
        self.baseline = [row()]
        self.local = copy.deepcopy(self.baseline)
        self.hosted = copy.deepcopy(self.baseline)

    def plan(self, fields=('approved_name',)):
        return publish.build_plan(self.baseline, self.local, self.hosted,
                                  [{'id': self.baseline[0]['id'], 'fields': list(fields)}])

    def test_only_explicit_fields_are_candidates_and_hosted_changes_are_preserved(self):
        self.local[0].update(approved_name='새 상호', categories=['중식'])
        self.hosted[0]['tzuyang_review'] = '운영에서 수정'
        result = self.plan()
        self.assertEqual(result['records'][0]['patch'], {'approved_name': '새 상호'})
        self.assertEqual(result['records'][0]['expected_hosted_review_values']['tzuyang_review'], '운영에서 수정')
        self.assertEqual(result['counts'], {'candidate': 1, 'blocked': 0, 'no_change': 0})
        self.assertFalse(result['safe_to_apply'])
        self.assertEqual(self.hosted[0]['approved_name'], '식당')

    def test_conflict_blocks_the_entire_selected_record(self):
        self.local[0].update(approved_name='로컬 변경', categories=['중식'])
        self.hosted[0]['approved_name'] = '운영 변경'
        record = self.plan(('approved_name', 'categories'))['records'][0]
        self.assertEqual(record['state'], 'blocked')
        self.assertEqual(record['patch'], {})
        self.assertEqual(record['comparisons']['approved_name']['state'], 'conflict')

    def test_remote_only_and_already_current_are_not_reapplied(self):
        self.hosted[0]['approved_name'] = '운영 변경'
        result = self.plan()['records'][0]
        self.assertEqual(result['state'], 'no_change')
        self.assertEqual(result['comparisons']['approved_name']['state'], 'unchanged_local')
        self.local[0]['approved_name'] = '운영 변경'
        result = self.plan()['records'][0]
        self.assertEqual(result['comparisons']['approved_name']['state'], 'already_current')
        self.assertEqual(result['patch'], {})

    def test_membership_and_status_changes_never_infer_writes(self):
        self.local.clear()
        self.assertEqual(self.plan()['records'][0]['reason'], 'record_membership_changed')
        self.local = copy.deepcopy(self.baseline)
        self.local[0]['status'] = 'hold'
        self.assertEqual(self.plan()['records'][0]['reason'], 'status_review_required')
        self.local[0]['status'] = 'approved'
        self.hosted[0]['status'] = 'deleted'
        self.assertEqual(self.plan()['records'][0]['patch'], {})

    def test_location_selection_is_explicit_and_atomic(self):
        with self.assertRaisesRegex(catalog.CatalogError, 'location_selection_incomplete'):
            self.plan(('lat', 'lng'))
        self.baseline[0].update(lat=37.5, lng=127.0, road_address='기존 주소')
        self.local = copy.deepcopy(self.baseline)
        self.hosted = copy.deepcopy(self.baseline)
        self.local[0].update(lat=37.6, road_address='새 주소')
        result = self.plan(publish.LOCATION_FIELDS)['records'][0]
        self.assertEqual(result['patch'], {'lat': 37.6, 'lng': 127.0, 'road_address': '새 주소'})
        self.hosted[0]['jibun_address'] = '운영 지번 변경'
        result = self.plan(publish.LOCATION_FIELDS)['records'][0]
        self.assertEqual(result['state'], 'blocked')
        self.assertEqual(result['patch'], {})

    def test_invalid_values_and_sensitive_or_privileged_selections_are_rejected(self):
        for field in ('phone', 'status', 'updated_by_admin_id', 'youtube_meta'):
            with self.assertRaisesRegex(catalog.CatalogError, 'selection_invalid'):
                self.plan((field,))
        for value in ('', ' padded ', 123, None):
            self.local[0]['approved_name'] = value
            self.assertEqual(self.plan()['records'][0]['state'], 'blocked')
        self.assertFalse(publish.valid_value('lat', True))
        self.assertFalse(publish.valid_value('lat', float('nan')))

    def test_empty_selection_is_valid_and_duplicates_are_not(self):
        result = publish.build_plan(self.baseline, self.local, self.hosted, [])
        self.assertEqual(result['records'], [])
        item = {'id': self.baseline[0]['id'], 'fields': ['approved_name']}
        with self.assertRaises(catalog.CatalogError):
            publish.selection_rows([item, item])
        with self.assertRaises(catalog.CatalogError):
            publish.selection_rows([{**item, 'fields': ['approved_name', 'approved_name']}])

    def test_cli_binds_two_hosted_reads_local_readback_and_private_artifact(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root)
            directory = state / 'working-catalog'
            directory.mkdir(mode=0o700)
            selection = state / 'selection.json'
            catalog.private_write(selection, [{'id': self.baseline[0]['id'], 'fields': ['approved_name']}])
            self.local[0]['approved_name'] = '선택된 변경'
            class Executor:
                def _binding(self): return None, state, None
                def _expected_project(self): return 'fixture'
                def run(self, *_): raise AssertionError('No database writes permitted')
            argv = ['publish', '--baseline-sha256', 'a' * 64, '--selection-file', str(selection), '--source-env', '/fixture/private-env']
            with patch.object(publish.sys, 'argv', argv), \
                 patch.object(catalog, 'executor', return_value=(Executor(), None)), \
                 patch.object(catalog, 'load_baseline', return_value={'rows': self.baseline}), \
                 patch.object(catalog, 'credentials', return_value='injected-test-value'), \
                 patch.object(catalog, 'fetch', side_effect=[self.hosted, self.hosted]) as fetch, \
                 patch.object(catalog, 'local_state', side_effect=[{'rows': self.local, 'digest': 'same'}, {'digest': 'same'}]), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                publish.main()
            result = json.loads(output.getvalue())
            self.assertEqual(fetch.call_count, 2)
            artifact = directory / (result['publish_review_sha256'] + '.publish-review.json')
            self.assertEqual(catalog.sha(catalog.read_private_json(artifact)), result['publish_review_sha256'])
            self.assertEqual(artifact.stat().st_mode & 0o777, 0o600)
            self.assertFalse(result['safe_to_apply'])
            self.assertNotIn('선택된 변경', output.getvalue())

    def test_cli_refuses_source_or_local_changes_during_capture(self):
        for source_changed in (True, False):
            with self.subTest(source_changed=source_changed), tempfile.TemporaryDirectory() as root:
                state = Path(root)
                directory = state / 'working-catalog'
                directory.mkdir(mode=0o700)
                selection = state / 'selection.json'
                catalog.private_write(selection, [])
                class Executor:
                    def _binding(self): return None, state, None
                    def _expected_project(self): return 'fixture'
                later_hosted = copy.deepcopy(self.hosted)
                if source_changed:
                    later_hosted[0]['approved_name'] = '동시 변경'
                argv = ['publish', '--baseline-sha256', 'a' * 64, '--selection-file', str(selection), '--source-env', '/fixture/private-env']
                with patch.object(publish.sys, 'argv', argv), \
                     patch.object(catalog, 'executor', return_value=(Executor(), None)), \
                     patch.object(catalog, 'load_baseline', return_value={'rows': self.baseline}), \
                     patch.object(catalog, 'credentials', return_value='injected-test-value'), \
                     patch.object(catalog, 'fetch', side_effect=[self.hosted, later_hosted]), \
                     patch.object(catalog, 'local_state', side_effect=[{'rows': self.local, 'digest': 'before'}, {'digest': 'after'}]):
                    with self.assertRaisesRegex(catalog.CatalogError, 'source_changed' if source_changed else 'local_changed'):
                        publish.main()
                self.assertEqual(list(directory.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
