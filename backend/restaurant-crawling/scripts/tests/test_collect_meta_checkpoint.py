import json
import io
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from contextlib import redirect_stdout
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

class ScopedMetadataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.channel = root / 'data' / 'fixture'
        (self.channel / 'meta').mkdir(parents=True)
        self.file = self.channel / 'meta' / f'{VID}.jsonl'
        self.urls = self.channel / 'urls.txt'
        self.urls.write_text('\n'.join([ROW['youtube_link'], ROW['youtube_link'],
                                      'https://www.youtube.com/watch?v=otherID_001',
                                      'https://www.youtube.com/watch?v=otherID_002'])+'\n')
        self.other = self.channel / 'meta' / 'otherID_001.jsonl'
        self.other.write_bytes(b'original unselected history\n')
        self.cache = self.channel / 'checked_cache.json'
        self.cache.write_text(json.dumps({'otherID_001': {'original': True},
                                         'otherID_002': 'legacy-date'}))
        self.client = Mock()
        self.client.chat.completions.create.return_value.choices = [
            Mock(message=Mock(content='["fixture sponsor"]'))]
        self.row = {**ROW, 'description': '광고 fixture', 'thumbnail_url': VALID_URL,
                    'thumbnail_hash': hashlib.md5(JPEG_FIXTURE).hexdigest()}
        self.log = Mock()
        patches = [
            patch.object(collect_meta, '__file__', str(root / 'scripts' / '02-collect-meta.py')),
            patch.object(collect_meta, 'get_channel_info', return_value={
                'data_path': 'restaurant-crawling/data/fixture'}),
            patch.object(collect_meta, 'get_api_config', return_value={
                'openai': {'model': 'fixture-model'}}),
            patch.object(collect_meta, 'get_api_key', return_value='unit-only-key'),
            patch.object(collect_meta.os, 'environ', {}),
            patch.object(collect_meta, 'build', return_value=object()),
            patch.object(collect_meta, 'OpenAI', return_value=self.client),
            patch.object(collect_meta, 'PipelineLogger', return_value=self.log),
            patch.object(collect_meta, 'get_video_meta_batch', side_effect=lambda *_: {VID: dict(self.row)}),
            patch.object(collect_meta.requests, 'get', side_effect=lambda *_a, **_k: FixtureResponse(chunks=[JPEG_FIXTURE])),
            patch.object(collect_meta, 'OPENAI_AD_ANALYSIS_DISABLED_REASON', None),
            patch.object(collect_meta, 'OPENAI_AD_ANALYSIS_FAILURE_COUNT', 0),
        ]
        self.mocks = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)
        self.build, self.openai, self.supplier = self.mocks[5], self.mocks[6], self.mocks[8]

    def run_cli(self, *extra):
        output = io.StringIO()
        with redirect_stdout(output):
            code = collect_meta.main(['--channel', 'fixture', '--video-id', VID, *extra])
        return code, output.getvalue()

    def recipe(self):
        return collect_meta.canonical_digest({'code': collect_meta.METADATA_RECIPE_HASH,
                                             'adModel': 'fixture-model', 'adsAnalysisEnabled': True})

    def put_current_checkpoint(self):
        self.file.write_text(json.dumps(ROW)+'\n')
        cache = json.loads(self.cache.read_text())
        cache[VID] = collect_meta.checkpoint(collect_meta.datetime.now(collect_meta.KST).date().isoformat(),
                                           self.recipe(), ROW)
        self.cache.write_text(json.dumps(cache))

    def assert_unselected_unchanged(self, before):
        self.assertEqual(self.urls.read_bytes(), before['urls'])
        self.assertEqual(self.other.read_bytes(), before['other'])
        cache = json.loads(self.cache.read_text())
        for vid in ('otherID_001', 'otherID_002'):
            self.assertEqual(cache[vid], before['cache'][vid])
        self.assertFalse((self.channel / 'meta' / 'otherID_002.jsonl').exists())

    def snapshot(self):
        return {'urls': self.urls.read_bytes(), 'other': self.other.read_bytes(),
                'cache': json.loads(self.cache.read_text())}

    def test_singleton_success_preserves_other_ids_and_uses_real_output_hash(self):
        before = self.snapshot()
        code, output = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn('op=metadata_scoped_complete', output)
        self.supplier.assert_called_once()
        self.assertEqual(self.supplier.call_args.args[1], [VID])
        self.client.chat.completions.create.assert_called_once()
        self.assertEqual(self.client.chat.completions.create.call_args.kwargs['model'], 'fixture-model')
        saved = collect_meta.get_latest_meta(self.channel, VID)
        self.assertEqual(saved['ads_info']['what_ads'], ['fixture sponsor'])
        self.assertTrue(collect_meta.verified_today(json.loads(self.cache.read_text())[VID],
                        collect_meta.datetime.now(collect_meta.KST).date().isoformat(), self.recipe(), saved))
        self.assert_unselected_unchanged(before)

    def test_current_genuine_checkpoint_is_no_api_and_no_output_write(self):
        self.put_current_checkpoint()
        before = (self.cache.read_bytes(), self.file.read_bytes(), self.cache.stat().st_mtime_ns)
        self.assertEqual(self.run_cli()[0], 0)
        self.build.assert_not_called()
        self.openai.assert_not_called()
        self.supplier.assert_not_called()
        self.assertEqual((self.cache.read_bytes(), self.file.read_bytes(), self.cache.stat().st_mtime_ns), before)

    def test_real_verified_thumbnail_md5_is_accepted_by_scoped_cli(self):
        # Exercise the real thumbnail verifier; the request boundary alone is mocked.
        digest = collect_meta.get_image_hash(VALID_URL)
        self.assertEqual(digest, hashlib.md5(JPEG_FIXTURE).hexdigest())
        self.assertEqual(len(digest), 32)
        self.row['thumbnail_hash'] = digest
        self.assertEqual(self.run_cli()[0], 0)
        self.assertEqual(collect_meta.get_latest_meta(self.channel, VID)['thumbnail_hash'], digest)

    def test_sha256_thumbnail_hash_is_rejected_without_append_or_checkpoint(self):
        self.row['thumbnail_hash'] = hashlib.sha256(JPEG_FIXTURE).hexdigest()
        before = self.cache.read_bytes()
        code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_thumbnail_incomplete', output)
        self.assertFalse(self.file.exists())
        self.assertEqual(self.cache.read_bytes(), before)

    def test_false_cache_output_hash_cannot_skip_real_processing(self):
        self.put_current_checkpoint()
        self.file.write_text(json.dumps({**ROW, 'title': 'actual changed output'})+'\n')
        self.assertEqual(self.run_cli()[0], 0)
        self.supplier.assert_called_once()
        saved = collect_meta.get_latest_meta(self.channel, VID)
        self.assertEqual(saved['recollect_id'], 7)
        self.assertEqual(json.loads(self.cache.read_text())[VID]['outputHash'], collect_meta.canonical_digest(saved))

    def test_disabled_analyzer_or_date_only_checkpoint_cannot_skip(self):
        for prior in ['legacy-date', collect_meta.checkpoint(
                collect_meta.datetime.now(collect_meta.KST).date().isoformat(),
                collect_meta.canonical_digest({'code': collect_meta.METADATA_RECIPE_HASH,
                    'adModel': 'fixture-model', 'adsAnalysisEnabled': False}), ROW)]:
            with self.subTest(prior=prior):
                self.file.write_text(json.dumps(ROW)+'\n')
                cache = json.loads(self.cache.read_text())
                cache[VID] = prior
                self.cache.write_text(json.dumps(cache))
                self.supplier.reset_mock()
                self.client.chat.completions.create.reset_mock()
                self.assertEqual(self.run_cli()[0], 0)
                self.supplier.assert_called_once()
                self.client.chat.completions.create.assert_called_once()

    def test_scope_rejections_are_fixed_nonzero_before_provider_or_append(self):
        cases = [
            (['--video-id', VID], 'metadata_scope_invalid'),
            (['--channel', 'fixture', '--video-id', '../invalid'], 'metadata_video_id_invalid'),
            (['--channel', '../fixture', '--video-id', VID], 'metadata_channel_invalid'),
            (['--channel', 'fixture', '--video-id', VID, '--video-id', VID], 'metadata_scope_invalid'),
            (['--channel', 'fixture', '--video-id', VID, '--skip-ads'], 'metadata_scope_invalid'),
        ]
        for argv, expected in cases:
            with self.subTest(expected=expected), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(collect_meta.main(argv), 2)
                self.assertIn('code='+expected, output.getvalue())
        self.build.assert_not_called()
        self.openai.assert_not_called()
        self.assertFalse(self.file.exists())

    def test_unregistered_or_noncanonical_channel_cannot_construct_provider(self):
        for config, code in [(ValueError('private diagnostic'), 'metadata_channel_unregistered'),
                             ({'data_path': 'private-mirror'}, 'metadata_channel_path_invalid')]:
            with self.subTest(code=code), patch.object(collect_meta, 'get_channel_info') as get_channel:
                if isinstance(config, Exception):
                    get_channel.side_effect = config
                else:
                    get_channel.return_value = config
                status, output = self.run_cli()
                self.assertEqual(status, 2)
                self.assertIn('code='+code, output)
                self.assertNotIn('private', output)
        self.build.assert_not_called()

    def test_exact_canonical_membership_and_deleted_fence(self):
        for urls, deleted, expected in [
            ('https://evil.invalid/?x=youtube.com/watch?v='+VID+'\n', '', 'metadata_video_not_in_urls'),
            ('https://youtu.be/'+VID+'\n', '', 'metadata_video_not_in_urls'),
            (ROW['youtube_link']+'\n', ROW['youtube_link']+'\toriginal-time\n', 'metadata_video_deleted')
        ]:
            with self.subTest(code=expected):
                self.urls.write_text(urls)
                (self.channel / 'deleted_urls.txt').write_text(deleted)
                before = self.cache.read_bytes()
                status, output = self.run_cli()
                self.assertEqual(status, 2)
                self.assertIn('code='+expected, output)
                self.assertEqual(self.cache.read_bytes(), before)
        self.build.assert_not_called()
        self.openai.assert_not_called()
        self.supplier.assert_not_called()
        self.assertFalse(self.file.exists())

    def test_provider_missing_or_incomplete_never_appends_or_certifies(self):
        for missing_key in (True, False):
            with self.subTest(missing_key=missing_key), patch.object(collect_meta, 'get_api_key',
                    return_value=None if missing_key else 'unit-only-key'), \
                 patch.object(collect_meta, 'get_video_meta_batch', return_value={}):
                before = self.cache.read_bytes()
                status, output = self.run_cli()
                self.assertEqual(status, 1)
                self.assertIn('code=metadata_provider_not_configured' if missing_key else
                              'code=metadata_provider_incomplete', output)
                self.assertFalse(self.file.exists())
                self.assertEqual(self.cache.read_bytes(), before)

    def test_ads_failure_never_appends_or_certifies_and_hides_diagnostics(self):
        self.client.chat.completions.create.side_effect = RuntimeError('private provider body')
        before = self.cache.read_bytes()
        code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_ads_incomplete', output)
        self.assertNotIn('private', output)
        self.assertFalse(self.file.exists())
        self.assertEqual(self.cache.read_bytes(), before)

    def test_thumbnail_failure_never_appends_or_certifies(self):
        before = self.cache.read_bytes()
        with patch.object(collect_meta, 'save_thumbnail_file', return_value=False):
            code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_thumbnail_incomplete', output)
        self.client.chat.completions.create.assert_not_called()
        self.assertFalse(self.file.exists())
        self.assertEqual(self.cache.read_bytes(), before)

    def test_bad_provider_shape_or_thumbnail_hash_cannot_append(self):
        for change, expected in [({'title': ''}, 'metadata_provider_output_invalid'),
                                 ({'duration': float('nan')}, 'metadata_provider_output_invalid'),
                                 ({'thumbnail_hash': None}, 'metadata_thumbnail_incomplete')]:
            with self.subTest(code=expected):
                self.row.update(change)
                before = self.cache.read_bytes()
                status, output = self.run_cli()
                self.assertEqual(status, 1)
                self.assertIn('code='+expected, output)
                self.assertFalse(self.file.exists())
                self.assertEqual(self.cache.read_bytes(), before)
                self.row = {**ROW, 'description': '광고 fixture', 'thumbnail_url': VALID_URL,
                            'thumbnail_hash': hashlib.md5(JPEG_FIXTURE).hexdigest()}

    def test_cache_corruption_is_preserved_before_any_provider(self):
        self.cache.write_bytes(b'{incomplete')
        code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_checkpoint_invalid', output)
        self.assertEqual(self.cache.read_bytes(), b'{incomplete')
        self.build.assert_not_called()

    def test_append_or_checkpoint_not_persisted_is_nonzero(self):
        with patch.object(collect_meta, 'append_metadata'):
            code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_output_incomplete', output)
        self.assertNotIn(VID, json.loads(self.cache.read_text()))
        with patch.object(collect_meta, 'save_checked_cache'):
            code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_checkpoint_incomplete', output)
        self.assertIsNotNone(collect_meta.get_latest_meta(self.channel, VID))
        self.assertNotIn(VID, json.loads(self.cache.read_text()))

    def test_default_cli_keeps_optional_analyzer_and_unscoped_call(self):
        with patch.object(collect_meta, 'collect_channel_meta') as collect:
            with redirect_stdout(io.StringIO()):
                self.assertIsNone(collect_meta.main(['--channel', 'fixture', '--skip-ads']))
            collect.assert_called_once_with('fixture', self.build.return_value, None, self.log)
        self.openai.assert_not_called()

    def test_default_all_channels_keeps_existing_provider_and_iteration(self):
        with patch.object(collect_meta, 'get_all_channels', return_value={'fixture': {}, 'second': {}}), \
             patch.object(collect_meta, 'collect_channel_meta') as collect, redirect_stdout(io.StringIO()):
            self.assertIsNone(collect_meta.main([]))
        self.build.assert_called_once_with('youtube', 'v3', developerKey='unit-only-key')
        self.openai.assert_called_once_with(api_key='unit-only-key')
        self.assertEqual([call.args for call in collect.call_args_list], [
            ('fixture', self.build.return_value, self.client, self.log),
            ('second', self.build.return_value, self.client, self.log)])
        self.assertTrue(all(not call.kwargs for call in collect.call_args_list))

    def test_scoped_writers_share_the_existing_channel_lock(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: collect_meta.collect_channel_meta(
                'fixture', None, None, Logger(), video_id=VID), range(2)))
        self.assertEqual(sorted(result['success'] for result in results), [0, 1])
        self.build.assert_called_once()
        self.openai.assert_called_once()
        self.supplier.assert_called_once()
        self.assertEqual(len(self.file.read_text().splitlines()), 1)

    def test_scoped_log_failure_returns_fixed_nonzero(self):
        self.log.end_stage.side_effect = OSError('private log diagnostic')
        code, output = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('code=metadata_log_incomplete', output)
        self.assertNotIn('private', output)
        self.assertNotIn('op=metadata_scoped_complete', output)


if __name__ == '__main__':
    unittest.main()
