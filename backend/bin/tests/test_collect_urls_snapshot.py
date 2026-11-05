"""Offline provider-envelope, newest-first and non-deletion regression tests."""
import importlib.util
import sys
import types
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'backend/restaurant-crawling/scripts/01-collect-urls.py'
sys.path.insert(0, str(ROOT / 'backend'))
api = types.ModuleType('googleapiclient')
api.__path__ = []
discovery = types.ModuleType('googleapiclient.discovery')
discovery.build = Mock(side_effect=AssertionError('provider call not mocked'))
errors = types.ModuleType('googleapiclient.errors')
errors.HttpError = type('HttpError', (Exception,), {})
with patch.dict(sys.modules, {'googleapiclient': api, 'googleapiclient.discovery': discovery,
                              'googleapiclient.errors': errors}), patch('utils.runtime_paths.load_backend_env'):
    spec = importlib.util.spec_from_file_location('collect_urls_snapshot', SCRIPT)
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)


def url(video):
    return f'https://www.youtube.com/watch?v={video}'


def page(*videos, **extra):
    return {'items': [{'contentDetails': {'videoId': v}} for v in videos], **extra}


class CollectUrlsSnapshotTests(TestCase):
    def logger(self):
        logger = Mock()
        logger.timer.side_effect = lambda *args: nullcontext()
        return logger

    def client(self, pages):
        client = Mock()
        client.channels.return_value.list.return_value.execute.return_value = {
            'items': [{'contentDetails': {'relatedPlaylists': {'uploads': 'fixture'}}}]}
        client.playlistItems.return_value.list.return_value.execute.side_effect = pages
        return client

    def collect(self, root, pages, dry_run=False):
        client = self.client(pages)
        with patch.object(collector, 'build', return_value=client), patch.object(
            collector, 'get_channel_info', return_value={'channel_id': 'fixture'}
        ), patch.object(collector, 'get_channel_data_path', return_value=root), patch.object(
            collector, 'get_collection_config', return_value={'batch_size': 50}
        ):
            return collector.collect_channel_urls('fixture', 'synthetic', self.logger(), dry_run)

    def test_fresh_snapshot_precedes_old_failed_prefix_and_retains_absent_history(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            old, shared, newest = map(url, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
            (root / 'urls.txt').write_text(f'{old}\n{shared}\n{old}\n')
            ledger = root / 'deleted_urls.txt'
            ledger.write_bytes(b'existing ledger bytes\n')
            result = self.collect(root, [page('ccccccccccc', 'bbbbbbbbbbb', 'ccccccccccc')])
            self.assertEqual((root / 'urls.txt').read_text().splitlines(), [newest, shared, old])
            self.assertEqual(result['new_saved'], 1)
            self.assertEqual(result['deleted_count'], 0)
            self.assertEqual(result['absent_count'], 1)
            self.assertEqual(ledger.read_bytes(), b'existing ledger bytes\n')

    def test_explicit_empty_final_token_is_valid(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = self.collect(root, [page('aaaaaaaaaaa', nextPageToken='later'),
                                         page('bbbbbbbbbbb', nextPageToken='')])
            self.assertEqual(result['total_fetched'], 2)
            self.assertEqual((root / 'urls.txt').read_text().splitlines(),
                             [url('aaaaaaaaaaa'), url('bbbbbbbbbbb')])

    def test_actual_publication_dates_rank_with_stable_undated_provider_fallback(self):
        response = page('aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee')
        for item, stamp in zip(response['items'], [None, '2026-11-01T00:00:00Z',
                                                  '2026-11-03T09:00:00+09:00',
                                                  'invalid', '2026-11-03T00:00:00Z']):
            if stamp is not None:
                item['contentDetails']['videoPublishedAt'] = stamp
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.collect(root, [response])
            self.assertEqual((root / 'urls.txt').read_text().splitlines(),
                             list(map(url, ['ccccccccccc', 'eeeeeeeeeee', 'bbbbbbbbbbb',
                                            'aaaaaaaaaaa', 'ddddddddddd'])))
        self.assertIsNone(collector._publication_time('2026-11-03T00:00:00'))
        self.assertIsNone(collector._publication_time(True))

    def test_valid_empty_snapshot_keeps_history_and_does_not_create_skip_ledger(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            before = url('aaaaaaaaaaa') + '\n'
            (root / 'urls.txt').write_text(before)
            self.assertEqual(self.collect(root, [page()])['deleted_count'], 0)
            self.assertEqual((root / 'urls.txt').read_text(), before)
            self.assertFalse((root / 'deleted_urls.txt').exists())

    def test_malformed_first_and_later_pages_leave_both_files_unchanged(self):
        invalid = [None, {}, {'items': None}, {'items': {}}, {'items': [None]},
                   {'items': [{}]}, page('invalid'), page('aaaaaaaaaaa', nextPageToken=' '),
                   page(nextPageToken='later')]
        for bad in invalid:
            for prefix in ([], [page('bbbbbbbbbbb', nextPageToken='later')]):
                with self.subTest(bad=bad, later=bool(prefix)), TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    for name in ('urls.txt', 'deleted_urls.txt'):
                        (root / name).write_bytes(b'original\n')
                    with self.assertRaises(collector.InvalidPlaylistSnapshot) as caught:
                        self.collect(root, prefix + [bad])
                    self.assertEqual(collector.classify_youtube_failure(caught.exception), 'youtube_snapshot_invalid')
                    for name in ('urls.txt', 'deleted_urls.txt'):
                        self.assertEqual((root / name).read_bytes(), b'original\n')

    def test_repeated_pagination_token_rejects_snapshot(self):
        with TemporaryDirectory() as tmp:
            with self.assertRaises(collector.InvalidPlaylistSnapshot):
                self.collect(Path(tmp), [page('aaaaaaaaaaa', nextPageToken='same'),
                                         page('bbbbbbbbbbb', nextPageToken='same')])
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_failed_atomic_index_replace_preserves_original_and_removes_temporary(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'urls.txt'
            path.write_bytes(b'original history\n')
            with patch.object(collector.os, 'replace', side_effect=OSError('synthetic')):
                with self.assertRaises(OSError):
                    collector.save_urls([url('aaaaaaaaaaa')], path, set(), self.logger())
            self.assertEqual(path.read_bytes(), b'original history\n')
            self.assertEqual([item.name for item in root.iterdir()], ['urls.txt'])

    def test_channel_envelope_validation_and_dry_run_do_not_write(self):
        for envelope in (None, {}, {'items': [{}]}):
            with TemporaryDirectory() as tmp:
                root = Path(tmp)
                client = self.client([])
                client.channels.return_value.list.return_value.execute.return_value = envelope
                with patch.object(collector, 'build', return_value=client):
                    with self.assertRaises(collector.InvalidPlaylistSnapshot):
                        collector.fetch_all_video_urls('synthetic', 'fixture', self.logger())
                self.assertEqual(list(root.iterdir()), [])
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'urls.txt').write_text(url('aaaaaaaaaaa') + '\n')
            before = (root / 'urls.txt').read_bytes()
            self.collect(root, [page('bbbbbbbbbbb')], dry_run=True)
            self.assertEqual((root / 'urls.txt').read_bytes(), before)
