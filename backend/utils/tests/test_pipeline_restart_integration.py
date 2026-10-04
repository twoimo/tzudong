"""Real file/subprocess failure paths; no provider or database requests."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, redirect_stdout
import copy
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


transform = load('restart_transform', ROOT / 'backend/restaurant-evaluation/scripts/12-transform.py')
laaj = load('restart_laaj', ROOT / 'backend/bin/run_parallel_laaj.py')


RULE = {
    'youtube_link': 'https://www.youtube.com/watch?v=abcdefghijk',
    'evaluation_results': {'category_validity_TF': [{'name': 'fixture', 'eval_value': True}],
                           'location_match_TF': [{'origin_name':'fixture','eval_value':True}]},
    'evaluation_target': {'fixture': True},
    'restaurants': [{'origin_name': 'fixture', 'category': '분식', 'reasoning_basis': 'fixture', 'youtuber_review': 'fixture'}],
    'recollect_version': {},
}


def certified_rule(evaluation, crawling, video, value=None):
    from backend.utils.stage_cache import complete
    rule=evaluation/'evaluation/rule_results'/(video+'.jsonl')
    rule.parent.mkdir(parents=True,exist_ok=True)
    rule.write_text(json.dumps(RULE if value is None else value)+'\n')
    complete(rule.parent/'.receipts'/(video+'.json'),'fixture',[rule])
    transcript=crawling/'transcript'/(video+'.jsonl')
    transcript.parent.mkdir(parents=True,exist_ok=True)
    transcript.write_text('{"transcript":[{"start":0,"text":"fixture"}]}\n')


class TransformRestartTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.crawling, self.evaluation = self.root/'crawling', self.root/'evaluation'
        self.rule = self.evaluation/'evaluation/rule_results'
        self.rule.mkdir(parents=True)
        self.crawling.mkdir()
        self.source = self.rule/'video.jsonl'
        self.write_rule(RULE)
        self.output = self.evaluation/'evaluation/transforms.jsonl'
        self.receipt = self.evaluation/'evaluation/.receipts/transform.json'

    def write_rule(self, value):
        self.source.write_text(json.dumps(value)+'\n')

    def run_transform(self):
        with redirect_stdout(io.StringIO()):
            return transform.run_transform('tzuyang', self.crawling, self.evaluation)

    def test_damaged_output_is_rebuilt_and_exact_damaged_bytes_are_preserved(self):
        self.run_transform()
        expected = self.output.read_bytes()
        damaged = expected + b'{truncated\xff\n'
        self.output.write_bytes(damaged)
        self.run_transform()
        self.assertEqual(expected, self.output.read_bytes())
        history = list((self.output.parent/'.history').glob('damaged-*.jsonl'))
        self.assertEqual(1, len(history))
        self.assertEqual(damaged, history[0].read_bytes())
        self.assertEqual(1, self.run_transform()['reused'])

    def test_invalid_receipt_shapes_rebuild_instead_of_aborting(self):
        self.run_transform()
        expected = self.output.read_bytes()
        for receipt in [[], None, {'schemaVersion':2,'groups':{'results:video':None},'recordCount':1},
                        {'schemaVersion':2,'groups':{'results:video':{'records':None}},'recordCount':1}]:
            self.receipt.write_text(json.dumps(receipt))
            self.run_transform()
            self.assertEqual(expected, self.output.read_bytes())

    def test_same_size_change_with_restored_mtime_is_detected_by_ctime(self):
        self.run_transform()
        stat = self.source.stat()
        self.source.write_bytes(self.source.read_bytes().replace(b'"eval_value": true', b'"eval_value":false'))
        os.utime(self.source, ns=(stat.st_atime_ns,stat.st_mtime_ns))
        result = self.run_transform()
        self.assertEqual(1, result['updated'])
        self.assertFalse(json.loads(self.output.read_text())['evaluation_results']['category_validity_TF']['eval_value'])

    def test_change_between_hash_and_parse_cannot_publish_receipt_or_output(self):
        self.run_transform()
        original = self.output.read_bytes(), self.receipt.read_bytes()
        changed = copy.deepcopy(RULE)
        changed['evaluation_results']['category_validity_TF'][0]['eval_value'] = False
        self.write_rule(changed)
        read = transform.load_last_jsonl_record
        def concurrent_change(path):
            value = read(path)
            self.source.write_bytes(self.source.read_bytes()+b'\n')
            return value
        with patch.object(transform, 'load_last_jsonl_record', concurrent_change):
            with self.assertRaisesRegex(ValueError, 'transform_input_changed'):
                self.run_transform()
        self.assertEqual(original, (self.output.read_bytes(), self.receipt.read_bytes()))
        self.assertEqual(1, self.run_transform()['updated'])

    def test_new_earlier_group_updates_priority_and_removal_releases_it(self):
        self.run_transform()
        higher = copy.deepcopy(RULE)
        higher['evaluation_results']['category_validity_TF'][0]['eval_value'] = False
        added = self.rule/'aaa.jsonl'
        added.write_text(json.dumps(higher)+'\n')
        self.run_transform()
        self.assertFalse(json.loads(self.output.read_text())['evaluation_results']['category_validity_TF']['eval_value'])
        added.unlink()
        self.run_transform()
        self.assertTrue(json.loads(self.output.read_text())['evaluation_results']['category_validity_TF']['eval_value'])

    def test_removed_group_is_archived_and_cannot_remain_certified(self):
        self.run_transform()
        old=json.loads(self.output.read_text())
        self.source.unlink()
        result=self.run_transform()
        self.assertEqual(result['removed'],1)
        self.assertEqual(self.output.read_bytes(),b'')
        ledger=json.loads(self.receipt.read_text())
        self.assertEqual(ledger['recordCount'],0)
        self.assertEqual(ledger['groups'],{})
        history=[json.loads(line) for p in (self.output.parent/'.history').glob('*.jsonl') for line in p.read_text().splitlines()]
        self.assertIn(old,history)
        self.assertEqual(self.run_transform()['records'],0)

    def test_changed_group_stops_claiming_old_trace(self):
        self.run_transform()
        old_trace=json.loads(self.output.read_text())['trace_id']
        empty=copy.deepcopy(RULE);empty['restaurants']=[]
        self.write_rule(empty)
        result=self.run_transform()
        self.assertEqual(result['removed'],1)
        current=[json.loads(line) for line in self.output.read_text().splitlines()]
        self.assertNotIn(old_trace,[row['trace_id'] for row in current])
        self.assertEqual(json.loads(self.receipt.read_text())['recordCount'],len(current))

    def test_unclaimed_legacy_record_survives_owned_group_removal(self):
        self.run_transform()
        legacy={'trace_id':'legacy-unclaimed','name':'retained'}
        with self.output.open('a') as output:output.write(json.dumps(legacy)+'\n')
        self.source.unlink()
        result=self.run_transform()
        self.assertEqual(result['removed'],1)
        self.assertEqual(json.loads(self.output.read_text()),legacy)
        self.assertEqual(self.run_transform()['records'],1)


class LaajRestartTests(unittest.TestCase):
    def test_omitted_rule_or_transcript_retires_stale_laaj_without_losing_bytes(self):
        from backend.utils.stage_cache import complete
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);crawling=root/'crawl';evaluation=root/'eval'
            valid=['ready','excluded','no-transcript','no-receipt','damaged-rule','no-rule']
            original={}
            for video in valid:
                certified_rule(evaluation,crawling,video)
                output=evaluation/'evaluation/laaj_results'/(video+'.jsonl')
                output.parent.mkdir(parents=True,exist_ok=True)
                output.write_text('{"stale":true}\n')
                receipt=output.parent/'.receipts'/(video+'.json')
                complete(receipt,'old',[output])
                original[video]=(output.read_bytes(),receipt.read_bytes())
            certified_rule(evaluation,crawling,'excluded',{**RULE,'evaluation_target':{'fixture':False}})
            (crawling/'transcript/no-transcript.jsonl').unlink()
            (evaluation/'evaluation/rule_results/.receipts/no-receipt.json').unlink()
            (evaluation/'evaluation/rule_results/damaged-rule.jsonl').write_text('{"damaged":true}\n')
            (evaluation/'evaluation/rule_results/no-rule.jsonl').unlink()
            self.assertEqual(['ready'],laaj.prepare_items(valid,evaluation,crawling,1))
            for video in valid[1:]:
                output=evaluation/'evaluation/laaj_results'/(video+'.jsonl')
                receipt=output.parent/'.receipts'/(video+'.json')
                self.assertFalse(output.exists());self.assertFalse(receipt.exists())
                for path,data in zip((output,receipt),original[video]):
                    archives=list((path.parent/'.superseded').glob(path.name+'.*'))
                    self.assertEqual([data],[item.read_bytes() for item in archives])
            self.assertTrue((evaluation/'evaluation/laaj_results/ready.jsonl').exists())

    def test_rule_changed_after_admission_never_starts_a_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);certified_rule(root,root,'fixture')
            self.assertEqual(['fixture'],laaj.prepare_items(['fixture'],root,root))
            (root/'evaluation/rule_results/.receipts/fixture.json').unlink()
            args=SimpleNamespace(script=root/'never.sh',channel='fixture',crawling_path=root,evaluation_path=root,process_timeout=2)
            with patch.object(laaj.subprocess,'Popen') as provider:
                self.assertEqual((0,{}),laaj.run_video('fixture',args))
            provider.assert_not_called()

    @unittest.skipIf(os.name=='nt','POSIX descriptor inheritance proof')
    def test_killed_coordinator_does_not_release_a_live_child_video_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=root/'worker.sh';worker=root/'worker.py'
            certified_rule(root,root,'same')
            worker.write_text('''import json,os,sys,time
from pathlib import Path
sys.path.insert(0,sys.argv[2])
from backend.utils.stage_cache import complete,reusable
r=Path(sys.argv[1]);receipt=r/'evaluation/laaj_results/.receipts/same.json';output=receipt.parent.parent/'same.jsonl'
if reusable(receipt,'fixture',[output]):raise SystemExit(0)
with (r/'calls').open('a') as f:f.write('work\\n')
(r/'child.pid').write_text(str(os.getpid()))
deadline=time.monotonic()+8
while not (r/'release').exists():
 if time.monotonic()>deadline:raise SystemExit(1)
 time.sleep(.01)
output.parent.mkdir(parents=True,exist_ok=True);output.write_text('{"result":1}\\n')
complete(receipt,'fixture',[output])
''')
            script.write_text(f'exec "{sys.executable}" "{worker}" "{root}" "{ROOT}"\n')
            code="from types import SimpleNamespace;from pathlib import Path;from backend.bin.run_parallel_laaj import run_video;import sys;root=Path(sys.argv[1]);args=SimpleNamespace(script=root/'worker.sh',channel='fixture',crawling_path=root,evaluation_path=root,process_timeout=10);raise SystemExit(run_video('same',args)[0])"
            command=[sys.executable,'-c',code,str(root)]
            first=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            second=None;child_pid=None
            try:
                deadline=time.monotonic()+5
                while not (root/'child.pid').exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue((root/'child.pid').exists());child_pid=int((root/'child.pid').read_text())
                first.kill();first.wait(timeout=5)
                second=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                with self.assertRaises(subprocess.TimeoutExpired):second.wait(timeout=.15)
                (root/'release').touch();self.assertEqual(second.wait(timeout=5),0)
                self.assertEqual((root/'calls').read_text().splitlines(),['work'])
            finally:
                for process in [first,second]:
                    if process and process.poll() is None:process.kill();process.wait()
                if child_pid:
                    try:os.killpg(child_pid,15)
                    except ProcessLookupError:pass

    def test_default_sequential_shell_overlaps_execute_one_provider_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for relative in [
                'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh','backend/restaurant-evaluation/scripts/parse_laaj_evaluation.py',
                'backend/restaurant-evaluation/scripts/gemini_api_request.mjs','backend/restaurant-evaluation/prompts/evaluation_prompt.txt',
                'backend/bin/stage_cache.py','backend/bin/run_parallel_laaj.py','backend/utils/stage_cache.py','backend/utils/jsonl_utils.py',
                'backend/utils/provider_budget.py','backend/utils/provider-budget.mjs','backend/utils/gemini-client.mjs']:
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/relative,target)
            (root/'backend/bin/run_agy_prompt.py').write_text('raise SystemExit(1)\n')
            tools=root/'tools';tools.mkdir();(tools/'python').symlink_to(sys.executable)
            metrics={key:[{'name':'fixture','eval_value':True if key.endswith('TF') else 1,'eval_basis':'fixture'}]
                     for key in ['visit_authenticity','rb_inference_score','rb_grounding_TF','review_faithfulness_score','category_TF']}
            response=root/'response.json';response.write_text(json.dumps(metrics));calls=root/'calls'
            provider=tools/'node';provider.write_text(f'#!{sys.executable}\n'+
                'import os,sys,time\nfrom pathlib import Path\n'+
                'with Path(os.environ["FX_CALLS"]).open("a") as f:f.write("request\\n")\n'+
                'time.sleep(.2)\nPath(sys.argv[3]).write_text(Path(os.environ["FX_RESPONSE"]).read_text())\n')
            provider.chmod(0o700)
            crawling,evaluation=root/'crawl',root/'evaluation'
            rule=evaluation/'evaluation/rule_results';rule.mkdir(parents=True)
            transcript=crawling/'transcript';transcript.mkdir(parents=True)
            certified_rule(evaluation,crawling,'abcdefghijk')
            (transcript/'abcdefghijk.jsonl').write_text('{"transcript":[{"start":0,"text":"fixture"}]}\n')
            env={**os.environ,'PATH':f'{tools}:/opt/homebrew/bin:/usr/bin:/bin','TZUDONG_PIPELINE_ISOLATED':'1',
                 'GEMINI_API_KEY':'fixture-unusable','FX_CALLS':str(calls),'FX_RESPONSE':str(response)}
            env.pop('GEMINI_MAX_INFLIGHT',None);env.pop('LAAJ_CHILD',None)
            bash='/opt/homebrew/bin/bash' if Path('/opt/homebrew/bin/bash').is_file() else shutil.which('bash')
            command=[bash,str(root/'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh'),
                     '--channel','tzuyang','--crawling-path',str(crawling),'--evaluation-path',str(evaluation)]
            first=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            second=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                first.communicate(timeout=20);second.communicate(timeout=20)
                self.assertEqual(first.returncode,0);self.assertEqual(second.returncode,0)
            finally:
                for process in [first,second]:
                    if process.poll() is None:process.kill();process.wait()
            self.assertEqual(calls.read_text().splitlines(),['request'])
            self.assertEqual(len((evaluation/'evaluation/laaj_results/abcdefghijk.jsonl').read_text().splitlines()),1)

    def test_jobs_one_preserves_sticky_fallback_and_oauth_only_never_admits_api(self):
        calls=[]
        def runner(video,args,*,fallback=False):
            calls.append((video,fallback));return (0 if fallback else 75),{}
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'LAAJ_FALLBACK_LOCK_PATH':str(Path(directory)/'fallback.json')}):
            result=laaj.run_jobs(['one','two','three'],SimpleNamespace(jobs=1),runner)
            self.assertEqual(calls,[('one',False),('one',True),('two',True),('three',True)])
            self.assertEqual(result['failures'],0)
            calls.clear();laaj.run_jobs(['one','two'],SimpleNamespace(jobs=3,oauth_only=True),runner)
            self.assertEqual(calls,[('one',True),('two',True)])

    def test_real_shell_quota_failure_drains_api_then_uses_sequential_oauth(self):
        settings=Path.home()/'.gemini/settings.json'
        before=hashlib.sha256(settings.read_bytes()).hexdigest() if settings.is_file() else None
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for relative in [
                'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh',
                'backend/restaurant-evaluation/scripts/parse_laaj_evaluation.py',
                'backend/restaurant-evaluation/scripts/gemini_api_request.mjs',
                'backend/restaurant-evaluation/prompts/evaluation_prompt.txt',
                'backend/bin/stage_cache.py','backend/bin/run_parallel_laaj.py',
                'backend/utils/stage_cache.py','backend/utils/jsonl_utils.py','backend/utils/provider_budget.py',
                'backend/utils/provider-budget.mjs','backend/utils/gemini-client.mjs',
            ]:
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(ROOT/relative,target)
            (root/'backend/bin/run_agy_prompt.py').write_text('raise SystemExit(1)\n')
            tools=root/'tools';tools.mkdir()
            (tools/'python').symlink_to(sys.executable)
            metrics={key:[{'name':'fixture','eval_value':True if key.endswith('TF') else 1,'eval_basis':'fixture'}]
                     for key in ['visit_authenticity','rb_inference_score','rb_grounding_TF','review_faithfulness_score','category_TF']}
            response=root/'response.json';response.write_text(json.dumps(metrics))
            journal=root/'calls.sqlite'
            with closing(sqlite3.connect(journal)) as db:
                db.execute('CREATE TABLE events(provider TEXT, started REAL, ended REAL)')
                db.commit()
            helper=(f'#!{sys.executable}\n'
                'import json,os,sqlite3,time\n'
                'from pathlib import Path\n'
                'provider=Path(__file__).name;start=time.monotonic()\n'
                'time.sleep(.01)\n'
                'with sqlite3.connect(os.environ["FIXTURE_JOURNAL"]) as db:\n'
                ' db.execute("INSERT INTO events VALUES(?,?,?)",(provider,start,time.monotonic()))\n'
                'if provider=="node": raise SystemExit(42)\n'
                'print(Path(os.environ["FIXTURE_RESPONSE"]).read_text())\n')
            for name in ['node','gemini']:
                executable=tools/name;executable.write_text(helper);executable.chmod(0o700)
            crawling,evaluation=root/'crawling',root/'evaluation'
            rule=evaluation/'evaluation/rule_results';rule.mkdir(parents=True)
            transcript=crawling/'transcript';transcript.mkdir(parents=True)
            for video in ['excluded','first','second','third']:
                value=copy.deepcopy(RULE)
                if video=='excluded':value['evaluation_target']={'fixture':False}
                certified_rule(evaluation,crawling,video,value)
                (transcript/(video+'.jsonl')).write_text('{"transcript":[{"start":0,"text":"fixture"}]}\n')
            args=SimpleNamespace(script=root/'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh',
                channel='tzuyang',crawling_path=crawling,evaluation_path=evaluation,process_timeout=20,jobs=3)
            env={**os.environ,'PATH':f'{tools}:/opt/homebrew/bin:/usr/bin:/bin',
                 'TZUDONG_PIPELINE_ISOLATED':'1','GEMINI_API_KEY':'fixture-unusable',
                 'TZUDONG_PIPELINE_LIVE':'1','LIVE_MAX_NEW_ITEMS':'2',
                 'LAAJ_FALLBACK_LOCK_PATH':str(root/'fallback.json'),
                 'FIXTURE_JOURNAL':str(journal),'FIXTURE_RESPONSE':str(response)}
            with patch.dict(os.environ,env,clear=True):
                result=laaj.run_jobs(laaj.select_items(['excluded','first','second','third'],evaluation,crawling,2),args)
            self.assertEqual(0,result['failures'])
            self.assertEqual(2,result['fallbackItems'])
            self.assertEqual(2,len(list((evaluation/'evaluation/laaj_results').glob('*.jsonl'))))
            with closing(sqlite3.connect(journal)) as db:
                events=db.execute('SELECT provider,started,ended FROM events ORDER BY started').fetchall()
            node=[event for event in events if event[0]=='node']
            oauth=[event for event in events if event[0]=='gemini']
            self.assertEqual(2,len(node))
            self.assertEqual(4,len(oauth))  # one health probe and one evaluation per video
            self.assertLessEqual(max(event[2] for event in node),min(event[1] for event in oauth))
            self.assertTrue(all(left[2]<=right[1] for left,right in zip(oauth,oauth[1:])))
            for output in (evaluation/'evaluation/laaj_results').glob('*.jsonl'):
                self.assertEqual(1,len(output.read_text().splitlines()))
        after=hashlib.sha256(settings.read_bytes()).hexdigest() if settings.is_file() else None
        self.assertEqual(before,after)

    def test_live_limit_counts_eligible_ids_and_deduplicates(self):
        with patch.object(laaj,'eligible',lambda video,*_: video != 'excluded'):
            self.assertEqual(['first','second'],laaj.select_items(['excluded','first','first','second'],Path('.'),Path('.'),2))
            self.assertEqual([],laaj.select_items(['first'],Path('.'),Path('.'),0))
            with self.assertRaises(ValueError): laaj.select_items(['../bad'],Path('.'),Path('.'))

    def test_bounded_queue_drains_before_serialized_fallback_and_keeps_usage(self):
        active, peak, fallback_active, fallback_peak = 0,0,0,0
        mutex = threading.Lock()
        def runner(video,args,*,fallback=False):
            nonlocal active,peak,fallback_active,fallback_peak
            with mutex:
                if fallback:
                    self.assertEqual(0,active)
                    fallback_active+=1;fallback_peak=max(fallback_peak,fallback_active)
                else:
                    active+=1;peak=max(peak,active)
            time.sleep(.002)
            with mutex:
                if fallback: fallback_active-=1
                else: active-=1
            return (0 if fallback or int(video)%5 else 75),{'totalTokenCount':1}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'LAAJ_FALLBACK_LOCK_PATH':str(Path(directory)/'fallback.json')}):
            result=laaj.run_jobs([str(index) for index in range(100)],SimpleNamespace(jobs=3),runner)
        self.assertLessEqual(peak,3)
        self.assertEqual(3,result['peakPendingJobs'])
        self.assertEqual(1,fallback_peak)
        self.assertEqual(20,result['fallbackItems'])
        self.assertEqual(0,result['failures'])
        self.assertEqual(120,result['knownTokenUsage']['totalTokenCount'])

    def test_concurrent_run_fallbacks_share_one_writer_lock(self):
        active, peak = 0,0
        mutex=threading.Lock()
        def runner(video,args,*,fallback=False):
            nonlocal active,peak
            if not fallback: return 75,{}
            with mutex: active+=1;peak=max(peak,active)
            time.sleep(.01)
            with mutex: active-=1
            return 0,{}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'LAAJ_FALLBACK_LOCK_PATH':str(Path(directory)/'fallback.json')}), ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:laaj.run_jobs(['one','two'],SimpleNamespace(jobs=2),runner),range(2)))
        self.assertEqual(1,peak)
        self.assertTrue(all(result['failures']==0 for result in results))

    def test_successful_exit_without_a_valid_output_receipt_is_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=root/'child.sh';script.write_text('exit 0\n')
            certified_rule(root,root,'fixture')
            args=SimpleNamespace(script=script,channel='fixture',crawling_path=root,evaluation_path=root,process_timeout=2)
            self.assertEqual(1,laaj.run_video('fixture',args)[0])

    def test_timeout_releases_lock_and_does_not_mark_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=root/'child.sh';script.write_text('sleep 10\n')
            certified_rule(root,root,'fixture')
            args=SimpleNamespace(script=script,channel='fixture',crawling_path=root,evaluation_path=root,process_timeout=.05)
            before=time.monotonic()
            self.assertEqual(1,laaj.run_video('fixture',args)[0])
            self.assertLess(time.monotonic()-before,2)
            script.write_text('exit 75\n')
            self.assertEqual(75,laaj.run_video('fixture',args)[0])


if __name__=='__main__': unittest.main()
