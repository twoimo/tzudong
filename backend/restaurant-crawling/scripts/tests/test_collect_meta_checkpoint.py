import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
from concurrent.futures import ThreadPoolExecutor
from test_collect_meta_thumbnail_security import collect_meta

VID = 'abcDEF_1234'
ROW = {'youtube_link': f'https://www.youtube.com/watch?v={VID}', 'title': 'fixture', 'description': '',
       'duration': 300, 'recollect_id': 6, 'collected_at': '2026-01-01T00:00:00+09:00', 'stats': {}, 'ads_info': {}}

class Logger:
    def __getattr__(self, name):
        return lambda *args, **kwargs: None

class MetadataCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.channel = self.root / 'data' / 'fixture'
        (self.channel / 'meta').mkdir(parents=True)
        self.file = self.channel / 'meta' / f'{VID}.jsonl'
        self.file.write_text(json.dumps(ROW)+'\n')
        (self.channel / 'urls.txt').write_text((ROW['youtube_link']+'\n')*2)
        patcher = patch.object(collect_meta, '__file__', str(self.root / 'scripts' / '02-collect-meta.py'))
        patcher.start(); self.addCleanup(patcher.stop)

    def run_collection(self):
        return collect_meta.collect_channel_meta('fixture', None, None, Logger())

    def test_failed_response_never_completes_and_is_retried_after_restart(self):
        with patch.object(collect_meta, 'get_video_meta_batch', return_value={}) as supplier:
            self.run_collection(); self.run_collection()
        self.assertEqual(supplier.call_count, 2)
        self.assertEqual(supplier.call_args.args[1], [VID])
        self.assertNotIn(VID, collect_meta.load_checked_cache(self.channel))

    def test_two_writers_produce_one_saved_result_and_one_verified_checkpoint(self):
        with patch.object(collect_meta, 'get_video_meta_batch', return_value={VID: {**ROW, 'title':'changed'}}) as supplier, \
             patch.object(collect_meta, 'detect_changes', return_value=['title_changed']), \
             patch.object(collect_meta, 'save_thumbnail_file'):
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(lambda _: self.run_collection(), range(2)))
        self.assertEqual(supplier.call_count, 1)
        rows = [json.loads(line) for line in self.file.read_text().splitlines()]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]['recollect_id'], 7)
        self.assertEqual(rows[0], ROW)
        self.assertEqual(collect_meta.load_checked_cache(self.channel)[VID]['schemaVersion'], 1)

    def test_date_only_cache_and_corrupt_tail_do_not_skip_and_sequence_is_preserved(self):
        today = collect_meta.datetime.now(collect_meta.KST).date().isoformat()
        collect_meta.save_checked_cache(self.channel, {VID: today})
        self.file.write_text(self.file.read_text()+'{"partial":')
        with patch.object(collect_meta, 'get_video_meta_batch', return_value={VID: {**ROW, 'title':'repair'}}) as supplier, \
             patch.object(collect_meta, 'save_thumbnail_file'):
            self.run_collection()
        self.assertEqual(supplier.call_count, 1)
        # The pre-existing damaged line remains evidence; a newline is needed before repair.
        self.assertEqual(collect_meta.get_latest_meta(self.channel, VID)['recollect_id'], 7)

    def test_invalid_utf8_is_not_ignored_and_prior_sequence_remains_recoverable(self):
        self.file.write_bytes(self.file.read_bytes()+json.dumps({**ROW,'title':'bad'}).encode().replace(b'bad',b'b\xffad')+b'\n')
        self.assertIsNone(collect_meta.get_latest_meta(self.channel,VID))
        self.assertEqual(collect_meta.last_sequence(self.file,VID),6)

    def test_output_change_or_recipe_change_invalidates_completion(self):
        meta = collect_meta.get_latest_meta(self.channel, VID)
        entry = collect_meta.checkpoint('2026-10-03', 'recipe-a', meta)
        self.assertTrue(collect_meta.verified_today(entry, '2026-10-03', 'recipe-a', meta))
        self.assertFalse(collect_meta.verified_today(entry, '2026-10-03', 'recipe-b', meta))
        self.assertFalse(collect_meta.verified_today(entry, '2026-10-03', 'recipe-a', {**meta,'duration':301}))
        self.file.unlink()
        self.assertIsNone(collect_meta.get_latest_meta(self.channel, VID))

if __name__ == '__main__':
    unittest.main()
