from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest

from backend.utils.stage_cache import fingerprint, reusable, complete, atomic_write, stage_lock
from backend.utils.request_budget import ReadCoalescer, RequestPacer, retry_after_seconds
from backend.utils.provider_budget import ProjectBudget, budget_path
from backend.pipeline_control.media_cache import owned_media_cache
from unittest.mock import patch


class StageCacheTests(unittest.TestCase):
    def test_changed_inputs_settings_assets_and_corrupt_output_invalidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, asset, receipt = [root / name for name in ('in.jsonl', 'out.jsonl', 'prompt.txt', 'receipt.json')]
            source.write_text('{"restaurants":[]}\n')
            output.write_text('{"result":true}\n')
            asset.write_text('prompt-v1')
            key = fingerprint([source], assets=[asset], settings='model-v1')
            self.assertFalse(reusable(receipt, key, [output]))
            complete(receipt, key, [output])
            self.assertTrue(reusable(receipt, key, [output]))
            self.assertFalse(reusable(receipt, fingerprint([source], assets=[asset], settings='model-v2'), [output]))
            asset.write_text('prompt-v2')
            self.assertFalse(reusable(receipt, fingerprint([source], assets=[asset], settings='model-v1'), [output]))
            source.write_text('{"restaurants":[{}]}\n')
            self.assertFalse(reusable(receipt, fingerprint([source]), [output]))
            output.write_text('{truncated')
            self.assertFalse(reusable(receipt, key, [output]))

    def test_invalid_utf8_cannot_masquerade_as_the_same_completed_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / 'output.jsonl'; receipt = root / 'receipt.json'
            output.write_bytes(b'{"name":"food"}\n')
            complete(receipt, 'same-input', [output])
            output.write_bytes(b'{"name":"f\xffood"}\n')
            self.assertFalse(reusable(receipt, 'same-input', [output]))

    def test_only_explicit_metadata_ignores_counters(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'meta.jsonl'
            source.write_text('{"title":"A","viewCount":1}\n')
            metadata_key, raw_key = fingerprint([], metadata=[source]), fingerprint([source])
            source.write_text('{"title":"A","viewCount":2}\n')
            self.assertEqual(metadata_key, fingerprint([], metadata=[source]))
            self.assertNotEqual(raw_key, fingerprint([source]))
            source.write_text('{"title":"B","viewCount":2}\n')
            self.assertNotEqual(metadata_key, fingerprint([], metadata=[source]))

    def test_latest_append_and_single_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'out.jsonl'
            receipt = Path(directory) / 'receipt.json'
            active, peak = 0, 0
            def work(index):
                nonlocal active, peak
                with stage_lock(receipt):
                    active += 1
                    peak = max(peak, active)
                    atomic_write(output, json.dumps({'index': index}).encode())
                    time.sleep(.001)
                    active -= 1
            with ThreadPoolExecutor(max_workers=8) as executor:
                list(executor.map(work, range(16)))
            self.assertEqual(1, peak)
            self.assertIn(json.loads(output.read_text())['index'], range(16))


class ReadBudgetTests(unittest.TestCase):
    def test_default_quota_store_is_independent_of_working_directory(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(Path.home()/'.cache/tzudong/provider-budget.sqlite', budget_path())
        with patch.dict(os.environ, {'GEMINI_BUDGET_PATH':'fixture.sqlite'}):
            self.assertEqual(Path('fixture.sqlite'), budget_path())
    def test_concurrent_identical_reads_are_one_request_and_independent_results(self):
        cache = ReadCoalescer()
        calls = 0
        def read():
            nonlocal calls
            calls += 1
            time.sleep(.01)
            return [{'value': 1}]
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: cache.get('same', read), range(16)))
        self.assertEqual(1, calls)
        results[0][0]['value'] = 2
        self.assertEqual(1, results[1][0]['value'])

    def test_failure_is_not_a_negative_cache(self):
        cache = ReadCoalescer()
        with self.assertRaises(ValueError):
            cache.get('same', lambda: (_ for _ in ()).throw(ValueError()))
        self.assertEqual([], cache.get('same', lambda: []))

    def test_retry_after_seconds_and_dates(self):
        self.assertEqual(12, retry_after_seconds('12'))
        self.assertEqual(60, retry_after_seconds('Thu, 01 Jan 1970 00:01:00 GMT', now=0))
        self.assertIsNone(retry_after_seconds('NaN'))
        self.assertIsNone(retry_after_seconds('bad'))

    def test_project_budget_releases_capacity_and_prunes_dead_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            budget = ProjectBudget(Path(directory) / 'budget.sqlite', 'project', rpm=100000, concurrency=1)
            lease = budget.acquire(999999999)
            self.assertTrue(lease)
            with budget.lease():
                with budget.connect() as db:
                    self.assertEqual(1, db.execute('SELECT count(*) FROM leases').fetchone()[0])
            with budget.connect() as db:
                self.assertEqual(0, db.execute('SELECT count(*) FROM leases').fetchone()[0])

    def test_pacer_does_not_delay_first_or_unneeded_requests(self):
        now = [1.0]
        sleeps = []
        def sleep(delay):
            sleeps.append(delay)
            now[0] += delay
        pacer = RequestPacer(.5, clock=lambda: now[0], sleep=sleep)
        pacer.wait()
        self.assertEqual([], sleeps)
        pacer.wait()
        self.assertEqual([.5], sleeps)

        now[0] += 1
        pacer.wait()
        self.assertEqual([.5], sleeps)

    def test_long_provider_cooldown_is_bounded(self):
        pacer = RequestPacer(.5, clock=lambda: 1.0, sleep=lambda _: None)
        pacer.cooldown(3600)
        with self.assertRaises(TimeoutError): pacer.wait()


class OwnedMediaCacheTests(unittest.TestCase):
    def test_success_cleans_only_owned_run_and_failure_preserves_resume(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            with owned_media_cache('fixture', enabled=True, root=root):
                cache = Path(os.environ['VIDEO_CACHE_DIR'])
                (cache/'video.mp4').write_bytes(b'fixture')
            self.assertTrue((cache/'video.mp4').is_file())
            self.assertNotIn('VIDEO_CACHE_DIR',os.environ)
            with owned_media_cache('fixture', enabled=True, root=root) as completed:
                self.assertTrue((cache/'video.mp4').is_file())
                completed()
            self.assertFalse(cache.exists())

    def test_configured_user_cache_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VIDEO_CACHE_DIR':directory}):
            path = Path(directory)/'user.mp4';path.write_bytes(b'user')
            with owned_media_cache('fixture',enabled=True) as completed: completed()
            self.assertEqual(b'user',path.read_bytes())


if __name__ == '__main__':
    unittest.main()
