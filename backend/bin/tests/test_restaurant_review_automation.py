from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch
from backend.bin import run_restaurant_review_automation as worker
from backend.bin import run_hosted_new_video_pipeline as runner


class ReviewWorkerTests(unittest.TestCase):
    def test_stored_original_fields_are_preserved_without_inventing_evidence(self):
        original={'channel_name':'tzuyang','youtube_link':'https://youtu.be/ABCDEFGHIJK','origin_name':'합성 식당','reasoning_basis':'합성 원본 근거','tzuyang_review':'합성 원본 리뷰','origin_address':{'address':'합성 원본 주소','lat':37,'lng':127},'categories':['한식'],'youtube_meta':{'title':'합성 원본 영상'},'recollect_version':{'meta':3}}
        before=json.dumps(original,sort_keys=True)
        crawl,meta=worker.stored_extraction(original,'ABCDEFGHIJK')
        self.assertEqual(json.dumps(original,sort_keys=True),before)
        self.assertEqual(crawl['restaurants'][0]['reasoning_basis'],original['reasoning_basis'])
        self.assertEqual(crawl['restaurants'][0]['youtuber_review'],original['tzuyang_review'])
        self.assertEqual(crawl['source'],'stored_original_extraction')
        self.assertEqual(meta['recollect_id'],3)
        self.assertEqual(crawl['youtube_link'],original['youtube_link'])
        for key in ['origin_name','reasoning_basis','tzuyang_review','origin_address','youtube_meta']:
            invalid=dict(original);invalid.pop(key)
            with self.subTest(key=key),self.assertRaises(worker.WorkerFailure):worker.stored_extraction(invalid,'ABCDEFGHIJK')

    def test_youtube_source_never_fetches_another_host(self):
        for link in ['https://untrusted.test/?v=ABCDEFGHIJK','https://youtube.com@untrusted.test/?v=ABCDEFGHIJK','https://youtube.com:8080/watch?v=ABCDEFGHIJK','file:///ABCDEFGHIJK']:
            with self.subTest(link=link),self.assertRaises(worker.WorkerFailure):worker.youtube_id(link)
        self.assertEqual(worker.youtube_id('https://www.youtube.com/watch?v=ABCDEFGHIJK'),'ABCDEFGHIJK')

    def test_disabled_does_not_claim_or_call_provider(self):
        calls=[]
        def rpc(name,body): calls.append(name); return {'disabled':True}
        def fail(*args): self.fail('provider called')
        worker.run_once(rpc,recheck_limit=1,evaluator=fail)
        self.assertEqual(calls,['restaurant_review_automation_tick'])

    def test_provider_failure_is_minimized_and_not_retried(self):
        calls=[]; generations=[]
        def rpc(name,body):
            calls.append(body)
            if body.get('action')=='claim': return {'id':'fixture-item','restaurant':{'trace_id':'fixture'}}
            return {}
        def evaluate(*args): generations.append(1); raise RuntimeError('untrusted provider diagnostics')
        worker.run_once(rpc,recheck_limit=1,evaluator=evaluate)
        self.assertEqual(len(generations),1)
        self.assertEqual(calls[-1]['result'],{'code':'evaluation_failed'})
        self.assertNotIn('untrusted',json.dumps(calls))

    def test_uncertain_save_never_generates_again_or_changes_to_failed(self):
        calls=[]; generations=[]
        def rpc(name,body):
            calls.append(body)
            if body.get('action')=='claim': return {'id':'fixture-item','restaurant':{}}
            if body.get('action')=='complete': raise TimeoutError()
            return {}
        def evaluate(*args): generations.append(1); return {'evaluation_results':{}}
        with self.assertRaises(TimeoutError):worker.run_once(rpc,recheck_limit=1,evaluator=evaluate)
        self.assertEqual(len(generations),1)
        self.assertEqual([x.get('action') for x in calls],[None,'claim','complete'])

    def test_missing_original_never_launches_command(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(worker.WorkerFailure) as raised:
                worker.evaluate({'channel_name':'tzuyang','youtube_link':'https://youtu.be/ABCDEFGHIJK'},Path(folder),run_command=lambda *args,**kwargs:self.fail('command launched'))
        self.assertEqual(raised.exception.code,'source_unavailable')

    def test_result_identifier_and_admin_fields_cannot_escape(self):
        metrics={key:{'eval_value':1,'eval_basis':'synthetic'} for key in ['visit_authenticity','rb_inference_score','rb_grounding_TF','review_faithfulness_score']}
        result=worker.result_fields([{'trace_id':'fixed','status':'approved','approved_name':'untrusted','updated_by_admin_id':'untrusted','roadAddress':'synthetic','category':['한식'],'evaluation_results':metrics}],{'trace_id':'fixed'})
        self.assertEqual(set(result),{'road_address','categories','evaluation_results'})

    def test_ambiguous_source_result_is_rejected(self):
        with self.assertRaises(worker.WorkerFailure):worker.result_fields([{'trace_id':'fixed'},{'trace_id':'fixed'}],{'trace_id':'fixed'})

    def test_shared_daily_budget_and_dry_run(self):
        import contextlib,io
        for dry in [False,True]:
            args=['--review-automation','--limit','3']+(['--dry-run'] if dry else [])
            with patch.object(runner,'_load_backend_env'),patch.object(runner,'cadence_source_preflight'),patch.object(runner,'env_contract_preflight'),patch.object(runner,'_apply_local_runtime_environment'),patch.object(runner,'_run',return_value=0) as run,contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(args),0)
            commands=[item.args[0] for item in run.call_args_list]
            evaluation=next(command for command in commands if command[1]==str(runner.EVALUATE))
            self.assertEqual(evaluation[evaluation.index('--limit')+1],'3' if dry else '2')
            self.assertEqual('--dry-run' in evaluation,dry)
            reviews=[command for command in commands if command[1]==str(runner.REVIEW)]
            self.assertEqual(len(reviews),0 if dry else 2)
            if not dry:self.assertEqual([command[command.index('--recheck-limit')+1] for command in reviews],['1','0'])

    def test_no_recheck_preserves_all_three_new_video_slots(self):
        def completed(command,**kwargs):
            receipt=Path(command[command.index('--receipt-file')+1]);receipt.write_text('{"recheckAttempted":false}')
            return 0
        with patch.object(runner,'_run',side_effect=completed):self.assertEqual(runner._review_reserved_slot(),0)
        with patch.object(runner,'_run',return_value=1):self.assertEqual(runner._review_reserved_slot(),1)

if __name__=='__main__':unittest.main()
