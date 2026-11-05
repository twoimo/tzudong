import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import unittest

from test_collect_meta_thumbnail_security import collect_meta, VALID_URL, VALID_VIDEO_ID


CHANNEL_ID = 'UC' + 'a' * 22
VIDEO = VALID_VIDEO_ID


class Logger:
    def __getattr__(self, name): return lambda *a, **k: None


class ReviewMetadataRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.scratch = Path(self.tmp.name).resolve()
        (self.scratch / 'urls.txt').write_text(f'https://www.youtube.com/watch?v={VIDEO}\n')
        self.youtube = Mock()
        self.response = {'items': [{'id': VIDEO, 'snippet': {
            'channelId': CHANNEL_ID, 'title': 'fixture', 'description': 'public fixture description',
            'thumbnails': {'high': {'url': VALID_URL}},
        }, 'contentDetails': {'duration': 'PT5M'}, 'statistics': {}}]}
        self.youtube.videos.return_value.list.return_value.execute.return_value = self.response

    def collect(self):
        with patch.object(collect_meta, 'get_channel_info', return_value={
                'channel_id': CHANNEL_ID, 'data_path': 'restaurant-crawling/data/fixture'}), \
             patch.object(collect_meta, 'get_api_key', return_value='synthetic'), \
             patch.object(collect_meta, 'build', return_value=self.youtube), \
             patch.object(collect_meta, 'get_image_hash', return_value='a' * 32), \
             patch.object(collect_meta, 'save_thumbnail_file', return_value=True):
            return collect_meta.collect_channel_meta('fixture', None, None, Logger(),
                video_id=VIDEO, review_data_path=self.scratch)

    def test_actual_collector_persists_one_verified_video_and_checkpoint_only_in_scratch(self):
        result = self.collect()
        self.assertEqual(result['success'], 1)
        self.youtube.videos.return_value.list.assert_called_once_with(part='snippet,contentDetails,statistics', id=VIDEO)
        row = collect_meta.get_latest_meta(self.scratch, VIDEO)
        self.assertEqual(row['channel_id'], CHANNEL_ID)
        self.assertEqual(row['channel_name'], 'fixture'); self.assertEqual(row['recollect_id'], 0)
        self.assertEqual(row['title'], 'fixture')
        self.assertEqual(list((self.scratch / 'meta').iterdir()), [self.scratch / 'meta' / (VIDEO + '.jsonl')])
        cache = json.loads((self.scratch / 'checked_cache.json').read_text())
        self.assertEqual(list(cache), [VIDEO])

    def test_wrong_uploader_or_video_is_rejected_before_thumbnail_and_output(self):
        for field, value in [('channelId', 'UC' + 'b' * 22), ('id', 'ZZZZZZZZZZZ')]:
            response = json.loads(json.dumps(self.response))
            if field == 'id': response['items'][0]['id'] = value
            else: response['items'][0]['snippet'][field] = value
            self.youtube.videos.return_value.list.return_value.execute.return_value = response
            with patch.object(collect_meta, 'get_image_hash') as thumbnail, self.assertRaises(collect_meta.ScopedMetadataError) as raised:
                collect_meta.get_video_meta_batch(self.youtube, [VIDEO], 'fixture', expected_channel_id=CHANNEL_ID)
            self.assertEqual(str(raised.exception), 'metadata_identity_mismatch')
            thumbnail.assert_not_called()
            self.assertFalse((self.scratch / 'meta').exists())

    def test_provider_empty_and_transient_are_not_terminal_video_evidence(self):
        self.youtube.videos.return_value.list.return_value.execute.return_value = {'items': []}
        with self.assertRaises(collect_meta.ScopedMetadataError) as raised:
            collect_meta.get_video_meta_batch(self.youtube, [VIDEO], 'fixture', expected_channel_id=CHANNEL_ID)
        self.assertEqual(str(raised.exception), 'metadata_provider_incomplete')
        self.youtube.videos.return_value.list.return_value.execute.side_effect = TimeoutError('private details')
        with self.assertRaises(collect_meta.ScopedMetadataError) as raised:
            collect_meta.get_video_meta_batch(self.youtube, [VIDEO], 'fixture', expected_channel_id=CHANNEL_ID)
        self.assertEqual(str(raised.exception), 'metadata_provider_transient')

    def test_existing_metadata_extra_video_and_symlink_never_call_provider(self):
        with patch.object(collect_meta, 'get_api_key', side_effect=AssertionError('provider admission')):
            (self.scratch / 'urls.txt').write_text(f'https://www.youtube.com/watch?v={VIDEO}\nhttps://www.youtube.com/watch?v=ZZZZZZZZZZZ\n')
            with self.assertRaises(collect_meta.ScopedMetadataError):
                collect_meta._review_metadata_path(self.scratch, 'fixture', VIDEO)
            (self.scratch / 'urls.txt').write_text(f'https://www.youtube.com/watch?v={VIDEO}\n')
            (self.scratch / 'meta').mkdir()
            record = self.scratch / 'meta' / (VIDEO + '.jsonl'); record.write_text('original bytes')
            with self.assertRaises(collect_meta.ScopedMetadataError):
                collect_meta._review_metadata_path(self.scratch, 'fixture', VIDEO)
            self.assertEqual(record.read_text(), 'original bytes')
            record.unlink(); record.symlink_to(self.scratch / 'missing')
            with self.assertRaises(collect_meta.ScopedMetadataError):
                collect_meta._review_metadata_path(self.scratch, 'fixture', VIDEO)


if __name__ == '__main__': unittest.main()
