"""Real cache receipts/files and read-only producer probes; no network calls."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from backend.utils.pipeline_cache_contracts import stage_inputs
from backend.utils.stage_cache import complete, fingerprint

ROOT = Path(__file__).resolve().parents[3]
VIDEO = 'abcdefghijk'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value) + '\n')


class LocalFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for part in ('bin', 'utils', 'config', 'restaurant-crawling/scripts', 'restaurant-crawling/prompts',
                     'restaurant-evaluation/scripts', 'restaurant-evaluation/prompts', 'supabase/scripts'):
            shutil.copytree(ROOT / 'backend' / part, self.root / 'backend' / part,
                            ignore=shutil.ignore_patterns('__pycache__', 'node_modules', 'tests'))
        self.crawl = self.root / 'backend/restaurant-crawling/data/tzuyang'
        self.eval = self.root / 'backend/restaurant-evaluation/data/tzuyang'
        self.module = load('fresh_evaluator', self.root / 'backend/bin/evaluate_new_youtube_videos.py')
        self.selection = load('fresh_selection', self.root / 'backend/restaurant-evaluation/scripts/09-target-selection.py')
        self.transform = load('fresh_transform', self.root / 'backend/restaurant-evaluation/scripts/12-transform.py')
        self.env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.root / 'home'),
                    'PYTHON_CMD': sys.executable, 'TZUDONG_PIPELINE_ISOLATED': '1',
                    'GEMINI_API_KEY': 'fixture-unusable'}
        self.settings = {
            'crawl': ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', '0', 'LOW', 'MEDIUM'],
            'selection': 'tzuyang',
            'rule': {'naverInterval': .167, 'ncpInterval': .167,
                     'fallbackModel': 'gemini-3.8-flash', 'fallbackTimeout': 90},
            'laaj': ['gemini-3.8-flash', 'gemini-3.8-flash', 'MEDIUM', 'unavailable'],
        }

    def certify(self, stage, outputs, video=VIDEO):
        plan = stage_inputs(stage, self.root / 'backend', self.crawl, self.eval,
                            video, self.settings[stage],
                            channel_config=self.env.get('CHANNELS_CONFIG') or 'channels.yaml')
        directory = 'crawling' if stage == 'crawl' else {
            'selection': 'selection', 'rule': 'rule_results', 'laaj': 'laaj_results'}[stage]
        parent = self.crawl if stage == 'crawl' else self.eval / 'evaluation'
        complete(parent / directory / '.receipts' / (video + '.json'), fingerprint(**plan), outputs)

    def terminal(self, kind='selected', video=VIDEO):
        link = f'https://www.youtube.com/watch?v={video}'
        write(self.crawl / 'meta' / (video + '.jsonl'), {'id': video, 'duration': 600})
        write(self.crawl / 'transcript' / (video + '.jsonl'), {'transcript': [{'start': 0, 'text': 'fixture'}]})
        restaurants = [] if kind == 'no_restaurants' else [
            {'origin_name': (None if kind == 'all_names_null' else '' if kind == 'all_empty_names' else 'fixture'), 'address': 'fixture address',
             'category': '분식', 'reasoning_basis': 'fixture evidence', 'youtuber_review': 'fixture review'}]
        crawl = {'youtube_link': link, 'restaurants': restaurants,
                 'no_restaurant_reason': 'explicit fixture absence' if not restaurants else None}
        source = self.crawl / 'crawling' / (video + '.jsonl')
        write(source, crawl)
        self.certify('crawl', [source], video)
        result = self.selection.create_evaluation_targets(video, self.crawl, 'tzuyang')
        selection = result['data']
        directory = 'notSelection' if result['is_not_selected'] else 'selection'
        selected = self.eval / 'evaluation' / directory / (video + '.jsonl')
        write(selected, selection)
        self.certify('selection', [selected], video)
        if kind != 'selected':
            return
        payload = copy.deepcopy(selection)
        payload['evaluation_results'] = {'location_match_TF': [
            {'origin_name': 'fixture', 'eval_value': False, 'match_status': 'pending'}]}
        for name, value in {'category_validity_TF': False, 'visit_authenticity': 0,
                            'rb_inference_score': 0, 'rb_grounding_TF': False,
                            'review_faithfulness_score': 0, 'category_TF': False}.items():
            values = [{'name': 'fixture', 'eval_value': value, 'eval_basis': 'fixture evidence'}]
            payload['evaluation_results'][name] = {'values': values} if name == 'visit_authenticity' else values
        for stage, directory in [('rule', 'rule_results'), ('laaj', 'laaj_results')]:
            path = self.eval / 'evaluation' / directory / (video + '.jsonl')
            write(path, payload)
            self.certify(stage, [path], video)
        with contextlib.redirect_stdout(io.StringIO()):
            self.transform.run_transform('tzuyang', self.crawl, self.eval)

    def run_main(self, *, dry=True, urls=None):
        output = io.StringIO()
        urls = urls or [f'https://www.youtube.com/watch?v={VIDEO}']
        with patch.dict(os.environ, self.env, clear=True), \
             patch.object(self.module, 'assert_hosted_target'), \
             patch.object(self.module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
             patch.object(self.module, '_load_urls', return_value=urls), \
             patch.object(self.module, '_write_urls'), \
             patch.object(self.module, '_run', return_value=0) as run, \
             contextlib.redirect_stdout(output):
            result = self.module.main(['--limit', '1', *(['--dry-run'] if dry else [])])
        return result, output.getvalue(), run

    def assert_miss(self):
        result, output, _ = self.run_main()
        self.assertEqual(result, 0)
        self.assertIn('localEvaluatedIds=0', output)
        self.assertIn('newVideoCount=1', output)

    def test_transcript_mutation_bypasses_neither_prelimit_nor_final_completeness(self):
        self.terminal()
        write(self.crawl / 'transcript' / (VIDEO + '.jsonl'), {'transcript': [{'text': 'changed'}]})
        self.assert_miss()
        result, output, _ = self.run_main(dry=False)
        self.assertEqual(result, 1)
        self.assertIn('error=evaluation_output_incomplete', output)

    def test_changed_crawl_no_restaurants_is_not_a_terminal_cache_hit(self):
        self.terminal('no_restaurants')
        write(self.crawl / 'crawling' / (VIDEO + '.jsonl'), {'youtube_link': f'https://youtu.be/{VIDEO}',
              'restaurants': [{'origin_name': 'new restaurant', 'address': None}]})
        self.assert_miss()

    def test_unchanged_receipts_skip_providers_and_allow_next_video(self):
        self.terminal()
        result, output, run = self.run_main(dry=False)
        self.assertEqual(result, 0)
        self.assertIn('localEvaluatedIds=1', output)
        self.assertEqual(run.call_count, 1)
        _, output, _ = self.run_main(urls=[f'https://youtu.be/{VIDEO}', 'https://youtu.be/bbbbbbbbbbb'])
        self.assertIn("newVideoIds=['bbbbbbbbbbb']", output)

    def test_no_restaurants_and_all_names_null_need_current_provenance_but_no_transform(self):
        for kind in ('no_restaurants', 'all_names_null', 'all_empty_names'):
            with self.subTest(kind=kind):
                self.terminal(kind)
                _, output, _ = self.run_main()
                self.assertIn('localEvaluatedIds=1', output)
                self.assertFalse((self.eval / 'evaluation/transforms.jsonl').exists())
                (self.crawl / 'crawling/.receipts' / (VIDEO + '.json')).unlink()
                self.assert_miss()

    def test_current_prompt_or_imported_helper_change_invalidates(self):
        self.terminal()
        for relative in ('restaurant-crawling/prompts/chunk_crawling_prompt.txt',
                         'restaurant-evaluation/prompts/evaluation_prompt.txt',
                         'restaurant-evaluation/scripts/evidence_identity.py',
                         'restaurant-evaluation/scripts/evaluation_results_boundary.py'):
            path = self.root / 'backend' / relative
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n# fixture source drift\n')
                self.assert_miss()
            finally:
                path.write_bytes(original)

    def test_valid_json_output_corruption_and_partial_receipt_are_not_reusable(self):
        self.terminal()
        output = self.eval / 'evaluation/transforms.jsonl'
        original = output.read_bytes()
        value = json.loads(original.splitlines()[0])
        value['youtuber_review'] = 'corrupted but still valid identity'
        write(output, value)
        self.assert_miss()
        output.write_bytes(original)
        receipt = self.eval / 'evaluation/laaj_results/.receipts' / (VIDEO + '.json')
        receipt.write_text('{')
        self.assert_miss()

    def test_shorts_rechecks_current_metadata_without_claiming_crawl_provenance(self):
        marker = self.eval / 'evaluation/notSelection' / (VIDEO + '.jsonl')
        write(marker, {'youtube_link': f'https://youtu.be/{VIDEO}', 'is_notSelected': True,
                       'notSelected_reason': 'shorts:is_shorts_le_180'})
        meta = self.crawl / 'meta' / (VIDEO + '.jsonl')
        write(meta, {'id': VIDEO, 'duration': 100})
        _, output, _ = self.run_main()
        self.assertIn('localEvaluatedIds=1', output)
        write(meta, {'id': VIDEO, 'duration': 600})
        self.assert_miss()
        write(meta, [])
        self.assert_miss()

    def test_probe_does_not_publish_or_repair_credentials(self):
        self.terminal()
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.run_main()
        after = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((self.root / 'home/.gemini').exists())

    def test_settings_and_visual_presence_are_current_not_receipt_self_certification(self):
        self.terminal()
        for setting, value in [('LAAJ_THINKING_LEVEL', 'LOW'), ('NAVER_REQUEST_INTERVAL_SEC', '0.5')]:
            with self.subTest(setting=setting):
                self.env[setting] = value
                self.assert_miss()
                self.env.pop(setting)
        # 08's existing env-file precedence must also govern the cache probe.
        env_path = self.root / 'backend/.env'
        env_path.write_text('GEMINI_CHUNK_THINKING_LEVEL=HIGH\n')
        self.assert_miss()
        env_path.unlink()
        write(self.crawl / 'visual-location' / (VIDEO + '.jsonl'), {'origin_name': 'new visual'})
        self.assert_miss()

    def test_automatic_web_fallback_matches_the_producer_without_initializing_a_provider(self):
        self.env.pop('GEMINI_API_KEY')
        self.settings['crawl'][3] = '1'
        write(self.root/'backend/restaurant-crawling/data/gemini_cookies.local.json', {})
        self.terminal('no_restaurants')
        before = {p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for explicit in (None, '0', '1'):
            with self.subTest(explicit=explicit):
                if explicit is None:
                    self.env.pop('FORCE_WEB_FALLBACK', None)
                else:
                    self.env['FORCE_WEB_FALLBACK'] = explicit
                _, output, _ = self.run_main()
                self.assertIn('localEvaluatedIds=1', output)
        self.env.pop('FORCE_WEB_FALLBACK')
        self.env['GEMINI_API_KEY_BYEON'] = 'fixture-unusable'
        self.assert_miss()
        after = {p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_mutation_after_last_successful_probe_is_not_a_stable_hit(self):
        self.terminal()
        probe = self.module._cache_probe
        def mutate_after_probe(command, env):
            result = probe(command, env)
            if str(self.module.SCRIPTS['transform']) in command:
                write(self.crawl / 'transcript' / (VIDEO + '.jsonl'), {'transcript': [{'text': 'raced'}]})
            return result
        with patch.object(self.module, '_cache_probe', side_effect=mutate_after_probe):
            self.assert_miss()

    def test_terminal_shape_is_rechecked_inside_the_receipt_snapshot(self):
        self.terminal()
        snapshot = self.module._cache_snapshot
        first = True
        def replace_before_snapshot(*args):
            nonlocal first
            if first:
                first = False
                for stage, directory in [('rule', 'rule_results'), ('laaj', 'laaj_results')]:
                    path = self.eval / 'evaluation' / directory / (VIDEO + '.jsonl')
                    value = json.loads(path.read_text())
                    value['evaluation_results']['visit_authenticity']['values'][0]['eval_value'] = 3
                    write(path, value)
                    self.certify(stage, [path])
                with contextlib.redirect_stdout(io.StringIO()):
                    self.transform.run_transform('tzuyang', self.crawl, self.eval)
            return snapshot(*args)
        with patch.object(self.module, '_cache_snapshot', side_effect=replace_before_snapshot):
            self.assert_miss()

    def test_bare_legacy_marker_and_unexplained_empty_crawl_are_not_certified(self):
        marker = self.eval / 'evaluation/notSelection' / (VIDEO + '.jsonl')
        write(marker, {'youtube_link': f'https://youtu.be/{VIDEO}', 'is_notSelected': True,
                       'notSelected_reason': 'no_restaurants'})
        self.assert_miss()
        self.terminal('no_restaurants')
        source = self.crawl / 'crawling' / (VIDEO + '.jsonl')
        value = json.loads(source.read_text())
        value['no_restaurant_reason'] = None
        write(source, value)
        self.certify('crawl', [source])
        self.certify('selection', [marker])
        self.assert_miss()

    def test_transform_metadata_drift_and_malformed_group_ledger_are_rejected(self):
        self.terminal()
        meta = self.crawl / 'meta' / (VIDEO + '.jsonl')
        original = meta.read_bytes()
        value = json.loads(original)
        value['viewCount'] = 42
        write(meta, value)
        self.assert_miss()  # 08/11 ignore counters; transform intentionally hashes full metadata.
        meta.write_bytes(original)
        receipt = self.eval / 'evaluation/.receipts/transform.json'
        value = json.loads(receipt.read_text())
        value['recordCount'] = -1
        write(receipt, value)
        self.assert_miss()

    def test_pipeline_recipe_cannot_be_replaced_by_explicit_input_or_asset_paths(self):
        self.terminal()
        fake_input = self.root / 'replacement.jsonl'
        fake_asset = self.root / 'replacement.py'
        write(fake_input, {'transcript': 'unrelated'})
        fake_asset.write_text('# unrelated recipe asset\n')
        output = self.crawl / 'crawling' / (VIDEO + '.jsonl')
        receipt = output.parent / '.receipts' / (VIDEO + '.json')
        forged = fingerprint([fake_input], assets=[fake_asset],
                             settings=self.settings['crawl'])
        complete(receipt, forged, [output])
        command = [sys.executable, '-B', str(self.root / 'backend/bin/stage_cache.py'),
                   'check', '--pipeline-stage', 'crawl',
                   '--crawling-path', str(self.crawl), '--evaluation-path', str(self.eval),
                   '--video-id', VIDEO, '--receipt', str(receipt), '--output', str(output),
                   '--input', str(fake_input), '--asset', str(fake_asset)]
        for setting in self.settings['crawl']:
            command += ['--setting', setting]
        before = receipt.read_bytes()
        result = subprocess.run(command, env=self.env, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt.read_bytes(), before)
        command[3] = 'check-many'
        command[command.index('--video-id') + 1] = '{id}'
        result = subprocess.run(command, env=self.env, input=json.dumps([VIDEO]).encode(),
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {'cacheHits': []})
        self.assertEqual(receipt.read_bytes(), before)
        self.assert_miss()

    def test_warm_batch_uses_one_probe_per_stage_without_writes(self):
        videos = {VIDEO, 'bbbbbbbbbbb', 'ccccccccccc'}
        for video in sorted(videos):
            self.terminal(video=video)
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        run = self.module.subprocess.run
        with patch.object(self.module.subprocess, 'run', wraps=run) as calls:
            hits = self.module._fresh_locally_evaluated_ids(self.eval, self.crawl, 'tzuyang', self.env)
        self.assertEqual(hits, videos)
        self.assertEqual(calls.call_count, 5)
        self.assertEqual(sum(str(self.module.SCRIPTS['transform']) in call.args[0]
                             for call in calls.call_args_list), 1)
        after = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_batch_stale_input_does_not_hide_an_unchanged_sibling(self):
        self.terminal()
        self.terminal(video='bbbbbbbbbbb')
        transcript = self.crawl / 'transcript' / (VIDEO + '.jsonl')
        write(transcript, {'transcript': [{'text': 'changed local transcript'}]})
        self.assertEqual(self.module._fresh_locally_evaluated_ids(
            self.eval, self.crawl, 'tzuyang', self.env), {'bbbbbbbbbbb'})

    def test_batch_last_probe_change_invalidates_earlier_and_sibling_hits(self):
        self.terminal()
        self.terminal(video='bbbbbbbbbbb')
        probe = self.module._cache_probe
        def race(command, env):
            valid = probe(command, env)
            self.assertTrue(valid)
            # A current input introduced after all content probes also changes
            # the reconstructed path set, not merely an existing file's stat.
            write(self.crawl / 'visual-location' / (VIDEO + '.jsonl'), {'origin_name': 'new input'})
            return valid
        with patch.object(self.module, '_cache_probe', side_effect=race):
            self.assertEqual(self.module._fresh_locally_evaluated_ids(
                self.eval, self.crawl, 'tzuyang', self.env), set())

    def test_batch_transport_rejects_invalid_partial_and_foreign_results(self):
        command = ['fixed-local-fixture']
        for output in ('', '{', '[]', '{"cacheHits":null}', '{"cacheHits":[1]}',
                       '{"cacheHits":["foreign"]}', '{"cacheHits":["a","a"]}',
                       '{"cacheHits":["a"],"extra":true}', 'x' * 256_001):
            with self.subTest(output=output[:60]), patch.object(
                    self.module.subprocess, 'run', return_value=subprocess.CompletedProcess(command, 0, output)):
                self.assertEqual(self.module._cache_probe_many(command, ['a'], self.env), set())
        for failure in (subprocess.CompletedProcess(command, 1, '{"cacheHits":["a"]}'),
                        subprocess.TimeoutExpired(command, 15), OSError('fixture unavailable')):
            with self.subTest(failure=type(failure).__name__), patch.object(
                    self.module.subprocess, 'run', **({'side_effect': failure} if isinstance(failure, Exception)
                                                    else {'return_value': failure})):
                self.assertEqual(self.module._cache_probe_many(command, ['a'], self.env), set())
        with patch.object(self.module.subprocess, 'run') as calls:
            self.assertEqual(self.module._cache_probe_many(command, [], self.env), set())
            calls.assert_not_called()

    def test_corrupt_latest_input_and_missing_stage_receipt_do_not_reuse(self):
        self.terminal()
        transcript = self.crawl / 'transcript' / (VIDEO + '.jsonl')
        original = transcript.read_bytes()
        for damaged in (original + b'{', b'', b'[]\n', b'\xff\n'):
            with self.subTest(damaged=damaged[-12:]):
                transcript.write_bytes(damaged)
                self.assertEqual(self.module._fresh_locally_evaluated_ids(
                    self.eval, self.crawl, 'tzuyang', self.env), set())
        transcript.write_bytes(original)
        (self.eval / 'evaluation/selection/.receipts' / (VIDEO + '.json')).unlink()
        self.assertEqual(self.module._fresh_locally_evaluated_ids(
            self.eval, self.crawl, 'tzuyang', self.env), set())

    def test_malformed_short_duration_cannot_certify_terminal_skip(self):
        marker = self.eval / 'evaluation/notSelection' / (VIDEO + '.jsonl')
        write(marker, {'youtube_link': f'https://youtu.be/{VIDEO}', 'is_notSelected': True,
                       'notSelected_reason': 'shorts:is_shorts_le_180'})
        for duration in (True, False, -1, -float('inf'), float('inf'), float('nan'), 10**400, '120', None):
            with self.subTest(duration=duration):
                write(self.crawl / 'meta' / (VIDEO + '.jsonl'), {'id': VIDEO, 'duration': duration})
                self.assertEqual(self.module._fresh_locally_evaluated_ids(
                    self.eval, self.crawl, 'tzuyang', self.env), set())

        # Preserve the existing numeric threshold and explicit short marker;
        # this regression only rejects malformed numeric fallback inputs.
        for metadata in ({'duration': 0}, {'duration': 180}, {'is_shorts': True}):
            write(self.crawl / 'meta' / (VIDEO + '.jsonl'), {'id': VIDEO, **metadata})
            self.assertEqual(self.module._fresh_locally_evaluated_ids(
                self.eval, self.crawl, 'tzuyang', self.env), {VIDEO})

    def test_multi_restaurant_requires_each_selected_sibling_but_not_unlocated_review(self):
        self.terminal()
        source = self.crawl / 'crawling' / (VIDEO + '.jsonl')
        crawl = json.loads(source.read_text())
        seed = crawl['restaurants'][0]
        crawl['restaurants'] = [{**seed, 'origin_name': name,
                                 'address': None if name == 'unlocated' else 'fixture address'}
                                for name in ('first', 'second', 'unlocated')]
        write(source, crawl)
        self.certify('crawl', [source])
        selection = self.selection.create_evaluation_targets(VIDEO, self.crawl, 'tzuyang')['data']
        selected = self.eval / 'evaluation/selection' / (VIDEO + '.jsonl')
        marker = self.eval / 'evaluation/notSelection' / (VIDEO + '.jsonl')
        write(selected, selection)
        write(marker, selection)
        self.certify('selection', [selected, marker])
        payload = copy.deepcopy(selection)
        payload['evaluation_results'] = {'location_match_TF': [
            {'origin_name': name, 'eval_value': False, 'match_status': 'pending'}
            for name in ('first', 'second')]}
        for name, value in {'category_validity_TF': False, 'visit_authenticity': 0,
                            'rb_inference_score': 0, 'rb_grounding_TF': False,
                            'review_faithfulness_score': 0, 'category_TF': False}.items():
            values = [{'name': restaurant, 'eval_value': value, 'eval_basis': 'fixture evidence'}
                      for restaurant in ('first', 'second')]
            payload['evaluation_results'][name] = {'values': values} if name == 'visit_authenticity' else values
        rule = self.eval / 'evaluation/rule_results' / (VIDEO + '.jsonl')
        laaj = self.eval / 'evaluation/laaj_results' / (VIDEO + '.jsonl')
        write(rule, payload)
        self.certify('rule', [rule])
        write(laaj, payload)
        self.certify('laaj', [laaj])
        with contextlib.redirect_stdout(io.StringIO()):
            self.transform.run_transform('tzuyang', self.crawl, self.eval)
        self.assertEqual(self.module._fresh_locally_evaluated_ids(
            self.eval, self.crawl, 'tzuyang', self.env), {VIDEO})
        # Current certified outputs may still be incomplete: one valid sibling
        # and the explicit address-unknown row do not complete the second name.
        partial = copy.deepcopy(payload)
        partial['evaluation_results']['review_faithfulness_score'] = [
            partial['evaluation_results']['review_faithfulness_score'][0]]
        write(laaj, partial)
        self.certify('laaj', [laaj])
        with contextlib.redirect_stdout(io.StringIO()):
            self.transform.run_transform('tzuyang', self.crawl, self.eval)
        self.assertEqual(self.module._fresh_locally_evaluated_ids(
            self.eval, self.crawl, 'tzuyang', self.env), set())

    def test_current_channel_config_and_selected_config_change_invalidate_crawl(self):
        self.terminal()
        config = self.root / 'backend/config/channels.yaml'
        original = config.read_bytes()
        changed = original.decode().replace('name: "쯔양"', 'name: "changed fixture producer"')
        self.assertNotEqual(changed, original.decode())
        config.write_text(changed)
        with self.subTest(change='channel-name-used-in-prompt'):
            self.assertEqual(self.module._fresh_locally_evaluated_ids(
                self.eval, self.crawl, 'tzuyang', self.env), set())
        config.write_bytes(original)
        self.env['CHANNELS_CONFIG'] = 'channels-test.yaml'
        with self.subTest(change='selected-config-file'):
            self.assertEqual(self.module._fresh_locally_evaluated_ids(
                self.eval, self.crawl, 'tzuyang', self.env), set())

    def test_alternate_config_current_receipt_and_late_config_race(self):
        self.env['CHANNELS_CONFIG'] = 'channels-test.yaml'
        self.terminal()
        self.assertEqual(self.module._fresh_locally_evaluated_ids(
            self.eval, self.crawl, 'tzuyang', self.env), {VIDEO})
        probe = self.module._cache_probe
        def race(command, env):
            valid = probe(command, env)
            self.assertTrue(valid)
            path = self.root / 'backend/config/channels-test.yaml'
            path.write_bytes(path.read_bytes() + b'\n# raced config\n')
            return valid
        with patch.object(self.module, '_cache_probe', side_effect=race):
            self.assertEqual(self.module._fresh_locally_evaluated_ids(
                self.eval, self.crawl, 'tzuyang', self.env), set())

    def test_selected_config_cannot_escape_current_configuration_root(self):
        outside = self.root / 'outside.yaml'
        outside.write_text('channels: {}\n')
        link = self.root / 'backend/config/escape.yaml'
        link.symlink_to(outside)
        for value in ('../outside.yaml', str(outside), 'escape.yaml'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^stage_channel_config_invalid$'):
                stage_inputs('crawl', self.root / 'backend', self.crawl, self.eval,
                             VIDEO, self.settings['crawl'], channel_config=value)

    def test_recipe_video_cannot_traverse_or_replace_the_input_root(self):
        for video in ('../outside', '/tmp/outside', 'nested/video', '..',
                      'fixture\\outside', '', 'x' * 65):
            with self.subTest(video=video), self.assertRaisesRegex(ValueError, '^stage_video_id_invalid$'):
                stage_inputs('crawl', self.root / 'backend', self.crawl, self.eval,
                             video, self.settings['crawl'])
        # Preserve the existing shell scan's literal template contract.
        template = stage_inputs('laaj', self.root / 'backend', self.crawl, self.eval,
                                '{id}', self.settings['laaj'])
        self.assertEqual(template['inputs'][0],
                         self.eval / 'evaluation/rule_results/{id}.jsonl')


if __name__ == '__main__':
    unittest.main()
