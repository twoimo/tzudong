import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from test_collect_meta_thumbnail_security import collect_meta, FixtureResponse, JPEG_FIXTURE, VALID_URL

VID = 'abcDEF_1234'
ROW = {'youtube_link': f'https://www.youtube.com/watch?v={VID}', 'title': 'fixture', 'description': '',
       'duration': 300, 'recollect_id': 6, 'collected_at': '2026-01-01T00:00:00+09:00', 'stats': {}, 'ads_info': {}}

class Logger:
    def __getattr__(self, name):
        return lambda *args, **kwargs: None

class MetadataCheckpointTests(unittest.TestCase):
    def test_changed_ad_recipe_runs_before_certifying_an_unchanged_unscheduled_video(self):
        row={**ROW,'description':'광고 fixture','ads_info':{'is_ads':True,'what_ads':['old fixture']}}
        self.file.write_text(json.dumps(row)+'\n')
        day=collect_meta.datetime.now(collect_meta.KST).date().isoformat()
        collect_meta.save_checked_cache(self.channel,{VID:collect_meta.checkpoint(day,'old-recipe',row)})
        client=object()
        with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:dict(row)}),patch.object(collect_meta,'detect_changes',return_value=[]), \
             patch.object(collect_meta,'get_schedule_frequency',return_value=None),patch.object(collect_meta,'save_thumbnail_file'), \
             patch.object(collect_meta,'analyze_ad_content',return_value=['new fixture']) as analyze:
            collect_meta.collect_channel_meta('fixture',None,client,Logger())
        analyze.assert_called_once()
        saved=collect_meta.get_latest_meta(self.channel,VID)
        self.assertEqual(saved['ads_info']['what_ads'],['new fixture'])
        cache=collect_meta.load_checked_cache(self.channel)[VID]
        self.assertEqual(cache['outputHash'],collect_meta.canonical_digest(saved))
        with patch.object(collect_meta,'get_video_meta_batch') as supplier:
            collect_meta.collect_channel_meta('fixture',None,client,Logger())
        supplier.assert_not_called()

    def test_failed_ad_recipe_does_not_publish_a_checkpoint_or_replace_old_metadata(self):
        row={**ROW,'description':'광고 fixture'};self.file.write_text(json.dumps(row)+'\n');before=self.file.read_bytes()
        def failed(*args):
            collect_meta.OPENAI_AD_ANALYSIS_FAILURE_COUNT+=1
            return None
        with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:dict(row)}),patch.object(collect_meta,'detect_changes',return_value=[]), \
             patch.object(collect_meta,'get_schedule_frequency',return_value=None),patch.object(collect_meta,'save_thumbnail_file'), \
             patch.object(collect_meta,'analyze_ad_content',side_effect=failed):
            collect_meta.collect_channel_meta('fixture',None,object(),Logger())
        self.assertEqual(self.file.read_bytes(),before)
        self.assertNotIn(VID,collect_meta.load_checked_cache(self.channel))

    def test_missing_or_changed_recipe_without_analyzer_preserves_prior_ad_attribution(self):
        row={**ROW,'description':'광고 fixture','ads_info':{'is_ads':True,'what_ads':['known sponsor']}}
        for checkpoint in [None,{}, {'recipe':'old-recipe'}]:
            with self.subTest(checkpoint=checkpoint):
                self.file.write_text(json.dumps(row)+'\n')
                collect_meta.save_checked_cache(self.channel,{} if checkpoint is None else {VID:checkpoint})
                with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:dict(row)}), \
                     patch.object(collect_meta,'detect_changes',return_value=[]),patch.object(collect_meta,'get_schedule_frequency',return_value=None), \
                     patch.object(collect_meta,'analyze_ad_content',side_effect=AssertionError('disabled provider invoked')):
                    self.run_collection()
                saved=collect_meta.get_latest_meta(self.channel,VID)
                self.assertEqual(saved['ads_info']['what_ads'],['known sponsor'])
                self.assertEqual(collect_meta.load_checked_cache(self.channel)[VID]['outputHash'],collect_meta.canonical_digest(saved))

    def test_changed_ad_evidence_without_analyzer_does_not_certify_null_or_stale_attribution(self):
        row={**ROW,'description':'광고 original','ads_info':{'is_ads':True,'what_ads':['known sponsor']}}
        self.file.write_text(json.dumps(row)+'\n');before=self.file.read_bytes()
        with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:{**row,'description':'광고 changed'}}), \
             patch.object(collect_meta,'get_schedule_frequency',return_value=None), \
             patch.object(collect_meta,'analyze_ad_content',side_effect=AssertionError('disabled provider invoked')):
            self.run_collection();self.run_collection()
        self.assertEqual(self.file.read_bytes(),before)
        self.assertNotIn(VID,collect_meta.load_checked_cache(self.channel))

    def test_failed_thumbnail_backfill_stays_pending_until_a_verified_save_on_restart(self):
        row={**ROW,'thumbnail_url':VALID_URL}
        recipe=collect_meta.canonical_digest({'code':collect_meta.METADATA_RECIPE_HASH,
            'adModel':collect_meta.get_api_config().get('openai',{}).get('model','gpt-4o-mini'),'adsAnalysisEnabled':False})
        for failure in ['download','validation','link']:
            with self.subTest(failure=failure):
                self.file.write_text(json.dumps(row)+'\n');before=self.file.read_bytes()
                collect_meta.save_checked_cache(self.channel,{VID:collect_meta.checkpoint('2000-01-01',recipe,row)})
                destination=self.channel/'thumbnails'/f'{VID}-6.jpg';destination.unlink(missing_ok=True)
                response=FixtureResponse(status_code=503) if failure=='download' else FixtureResponse(chunks=[b'invalid']) if failure=='validation' else FixtureResponse(chunks=[JPEG_FIXTURE])
                with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:dict(row)}) as supplier, \
                     patch.object(collect_meta,'detect_changes',return_value=[]),patch.object(collect_meta,'get_schedule_frequency',return_value=None):
                    with patch.object(collect_meta.requests,'get',return_value=response), \
                         patch.object(collect_meta.os,'link',side_effect=OSError('synthetic link failure')) if failure=='link' else nullcontext():
                        self.run_collection()
                    self.assertFalse(destination.exists())
                    self.assertEqual(self.file.read_bytes(),before)
                    self.assertEqual(collect_meta.load_checked_cache(self.channel)[VID],collect_meta.checkpoint('2000-01-01',recipe,row))
                    with patch.object(collect_meta.requests,'get',return_value=FixtureResponse(chunks=[JPEG_FIXTURE])):
                        self.run_collection()
                    self.assertEqual(supplier.call_count,2)
                    self.assertEqual(destination.read_bytes(),JPEG_FIXTURE)
                    self.assertEqual(self.file.read_bytes(),before)
                    saved=collect_meta.get_latest_meta(self.channel,VID)
                    self.assertTrue(collect_meta.verified_today(collect_meta.load_checked_cache(self.channel)[VID],collect_meta.datetime.now(collect_meta.KST).date().isoformat(),recipe,saved))
                with patch.object(collect_meta,'get_video_meta_batch') as supplier:
                    self.run_collection();supplier.assert_not_called()

    def test_new_thumbnail_failure_does_not_publish_a_metadata_row_or_checkpoint(self):
        row={**ROW,'thumbnail_url':VALID_URL,'thumbnail_hash':'changed'}
        before=self.file.read_bytes()
        with patch.object(collect_meta,'get_video_meta_batch',return_value={VID:row}), \
             patch.object(collect_meta,'detect_changes',return_value=['thumbnail_changed']), \
             patch.object(collect_meta.requests,'get',return_value=FixtureResponse(status_code=503)):
            self.run_collection()
        self.assertEqual(self.file.read_bytes(),before)
        self.assertNotIn(VID,collect_meta.load_checked_cache(self.channel))

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
