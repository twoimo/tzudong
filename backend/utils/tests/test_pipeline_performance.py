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
            # Old-format dead leases must still be reaped without admitting a
            # provider operation for a nonexistent process.
            with budget.connect() as db:
                db.execute('INSERT INTO leases VALUES(?,?,?,?)', ('project','dead-fixture',999999999,time.time()))
            with budget.lease():
                with budget.connect() as db:
                    self.assertEqual(1, db.execute('SELECT count(*) FROM leases').fetchone()[0])
            with budget.connect() as db:
                self.assertEqual(0, db.execute('SELECT count(*) FROM leases').fetchone()[0])

    def test_reused_live_pid_reaps_only_the_old_birth_and_preserves_limit(self):
        from backend.utils import provider_budget as module
        with tempfile.TemporaryDirectory() as directory:
            budget = ProjectBudget(Path(directory)/'budget.sqlite', 'project', rpm=100000, concurrency=1)
            with budget.connect() as db:
                db.execute('INSERT INTO leases VALUES(?,?,?,?)', ('project','stale',os.getpid(),100))
                db.execute('INSERT INTO lease_births VALUES(?,?)', ('stale','previous-birth'))
            with patch.object(module,'process_birth',return_value=('new-birth',200.0,0.0)):
                lease=budget.acquire(os.getpid(),timeout=.1)
                with budget.connect() as db:
                    self.assertEqual(db.execute('SELECT id FROM leases').fetchall(),[(lease,)])
                    self.assertEqual(db.execute('SELECT birth FROM lease_births').fetchall(),[('new-birth',)])
                with self.assertRaises(TimeoutError):budget.acquire(os.getpid(),timeout=.01)
                budget.release(lease)
            with budget.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM lease_births').fetchone()[0],0)

    def test_legacy_reused_pid_is_reaped_but_live_and_unknown_owners_stay_reserved(self):
        from backend.utils import provider_budget as module
        with tempfile.TemporaryDirectory() as directory:
            budget=ProjectBudget(Path(directory)/'budget.sqlite','project',rpm=100000,concurrency=1)
            with budget.connect() as db:db.execute('INSERT INTO leases VALUES(?,?,?,?)',('project','legacy',os.getpid(),100))
            with patch.object(module,'process_birth',return_value=('current',200.0,1.0)):
                lease=budget.acquire(os.getpid(),timeout=.1)
                budget.release(lease)
            for birth in [('same-live',50.0,1.0),None,('ambiguous',100.5,1.0)]:
                with self.subTest(birth=birth),budget.connect() as db:
                    db.execute('INSERT INTO leases VALUES(?,?,?,?)',('project','legacy',7,100))
                    def identity(pid):return ('current',200.0,0.0) if pid==os.getpid() else birth
                    with patch.object(module,'process_birth',side_effect=identity),patch.object(budget,'alive',return_value=True):
                        with self.assertRaises(TimeoutError):budget.acquire(os.getpid(),timeout=.01)
                    self.assertEqual(db.execute('SELECT id FROM leases').fetchall(),[('legacy',)])
                    db.execute('DELETE FROM leases')
                    db.execute('DELETE FROM lease_births')

    def test_missing_or_changed_requester_birth_never_admits_a_lease(self):
        from backend.utils import provider_budget as module
        with tempfile.TemporaryDirectory() as directory:
            budget=ProjectBudget(Path(directory)/'budget.sqlite','project',rpm=100000,concurrency=1)
            with patch.object(module,'process_birth',return_value=None):
                with self.assertRaisesRegex(ValueError,'identity_unavailable'):budget.acquire(os.getpid())
            with patch.object(module,'process_birth',side_effect=[('original',50.0,0.0),('replacement',60.0,0.0)]):
                with self.assertRaisesRegex(ValueError,'identity_changed'):budget.acquire(os.getpid())
            with budget.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM leases').fetchone()[0],0)

    def test_native_birth_is_stable_and_linux_parenthesized_names_do_not_shift_ticks(self):
        from backend.utils import provider_budget as module
        first=module.process_birth(os.getpid())
        self.assertIsNotNone(first)
        self.assertEqual(first[0],module.process_birth(os.getpid())[0])
        self.assertLessEqual(first[1],time.time()+first[2])
        fields=['S',*(['0']*18),'500']
        files={'/proc/17/stat':'17 (fixture ) with spaces) '+' '.join(fields),
               '/proc/sys/kernel/random/boot_id':'fixture-boot', '/proc/stat':'cpu 0\nbtime 100\n'}
        def read(path):return files[str(path)]
        with patch.object(module.sys,'platform','linux'),patch.object(Path,'read_text',read),patch.object(module.os,'sysconf',return_value=100):
            self.assertEqual(module.process_birth(17),('linux:fixture-boot:500',105.0,1.0))

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

    def test_waiter_observes_a_cooldown_received_during_sleep(self):
        now=[0.0];sleeps=[]
        def sleep(delay):
            sleeps.append(delay);now[0]+=delay
            if len(sleeps)==1:pacer.cooldown(5)
        pacer=RequestPacer(1,clock=lambda:now[0],sleep=sleep)
        pacer.wait();pacer.wait()
        self.assertEqual(sleeps,[1,5])
        self.assertEqual(now[0],6)
        pacer.wait()
        self.assertEqual(sleeps,[1,5,1])


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
