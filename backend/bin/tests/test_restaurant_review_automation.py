from pathlib import Path
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from backend.bin import run_restaurant_review_automation as worker
from backend.bin import run_hosted_new_video_pipeline as runner


class ReviewWorkerTests(unittest.TestCase):
    def test_null_claim_distinguishes_active_rechecks_from_an_empty_queue(self):
        for queued,running in [(0,1),(1,0),(0,0)]:
            calls=[]
            def rpc(name,body):
                calls.append(name)
                if name=='restaurant_review_automation_tick':return {}
                if name=='restaurant_review_automation_worker':return None
                return {'queue':{'queued':queued,'running':running}}
            summary=worker.run_once(rpc,recheck_limit=1,evaluator=lambda *args:self.fail('provider called'))
            self.assertFalse(summary['recheckAttempted'])
            self.assertEqual(summary['recheckOutstanding'],bool(queued or running))
            self.assertEqual(calls[-1],'restaurant_review_automation_status')

    @staticmethod
    def complete_metrics():
        return {**{key:{'eval_value':1,'eval_basis':'synthetic'} for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score']},
                'rb_grounding_TF':{'eval_value':True,'eval_basis':'synthetic'},
                'category_TF':{'eval_value':True},'category_validity_TF':{'eval_value':True},
                'location_match_TF':{'eval_value':True,'match_status':'matched','evidence_families':['source_geo','provider_candidate']}}

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
        metrics=self.complete_metrics()
        result=worker.result_fields([{'trace_id':'fixed','status':'approved','approved_name':'untrusted','updated_by_admin_id':'untrusted','roadAddress':'synthetic','category':['한식'],'evaluation_results':metrics}],{'trace_id':'fixed'})
        self.assertEqual(set(result),{'road_address','categories','evaluation_results'})

    def test_every_missing_or_malformed_metric_fails_before_completion(self):
        good=self.complete_metrics()
        for key in good:
            for value in [None,{},'invalid']:
                metrics=copy.deepcopy(good);metrics[key]=value
                with self.subTest(key=key,value=value),self.assertRaises(worker.WorkerFailure) as raised:
                    worker.result_fields([{'trace_id':'fixed','evaluation_results':metrics}],{'trace_id':'fixed'})
                self.assertEqual(raised.exception.code,'evaluation_incomplete')
        for value in [True,-1,5,float('nan'),'1']:
            metrics=copy.deepcopy(good);metrics['visit_authenticity']['eval_value']=value
            with self.subTest(value=value),self.assertRaises(worker.WorkerFailure):
                worker.result_fields([{'trace_id':'fixed','evaluation_results':metrics}],{'trace_id':'fixed'})
        metrics=copy.deepcopy(good)
        for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score']:metrics[key]['eval_value']=0
        self.assertEqual(worker.result_fields([{'trace_id':'fixed','evaluation_results':metrics}],{'trace_id':'fixed'})['evaluation_results'],metrics)

    def test_location_provenance_must_be_complete_but_need_not_pass_approval(self):
        good=self.complete_metrics()
        for patch in [{'evidence_families':[]},{'evidence_families':['source_geo']},{'evidence_families':['source_geo','source_geo']},{'match_status':'pending'},{'pending_reason':'missing'},{'eval_value':'true'}]:
            metrics=copy.deepcopy(good);metrics['location_match_TF'].update(patch)
            with self.subTest(patch=patch),self.assertRaises(worker.WorkerFailure):
                worker.result_fields([{'trace_id':'fixed','evaluation_results':metrics}],{'trace_id':'fixed'})
        for location in [
            {'eval_value':True,'match_status':'matched','evidence_families':['source_geo','llm_verification']},
            {'eval_value':False,'match_status':'pending','evidence_families':[],'pending_reason':'insufficient_evidence'}]:
            metrics=copy.deepcopy(good);metrics['location_match_TF']=location
            self.assertEqual(worker.result_fields([{'trace_id':'fixed','evaluation_results':metrics}],{'trace_id':'fixed'})['evaluation_results'],metrics)

    def test_ambiguous_source_result_is_rejected(self):
        with self.assertRaises(worker.WorkerFailure):worker.result_fields([{'trace_id':'fixed'},{'trace_id':'fixed'}],{'trace_id':'fixed'})

    def test_cached_inputs_match_video_channel_and_leased_recollect_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'ABCDEFGHIJK.jsonl'
            first={'youtube_link':'https://youtu.be/ABCDEFGHIJK','channel_name':'tzuyang','recollect_id':0}
            latest={**first,'recollect_id':13}
            path.write_text(json.dumps(first)+'\n'+json.dumps(latest)+'\n')
            original={'recollect_version':{'meta':0}}
            self.assertEqual(worker.cached_source_record(path,'meta',original,'ABCDEFGHIJK','tzuyang'),first)
            for change in [{'youtube_link':'https://youtu.be/ZZZZZZZZZZZ'},{'channel_name':'other'},{'recollect_id':True}]:
                path.write_text(json.dumps({**first,**change})+'\n')
                with self.subTest(change=change),self.assertRaises(worker.WorkerFailure):
                    worker.cached_source_record(path,'meta',original,'ABCDEFGHIJK','tzuyang')
            path.write_text(json.dumps(latest)+'\n')
            with self.assertRaises(worker.WorkerFailure):worker.cached_source_record(path,'meta',original,'ABCDEFGHIJK','tzuyang')

    def test_misfiled_cached_source_never_starts_a_command(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'tzuyang/meta';root.mkdir(parents=True)
            (root/'ABCDEFGHIJK.jsonl').write_text('{"youtube_link":"https://youtu.be/ZZZZZZZZZZZ","channel_name":"tzuyang"}\n')
            with self.assertRaises(worker.WorkerFailure):worker.evaluate({'channel_name':'tzuyang','youtube_link':'https://youtu.be/ABCDEFGHIJK'},folder,run_command=lambda *args,**kw:self.fail('command called'))

    def test_cached_transcript_segments_are_validated_before_commands_or_paid_work(self):
        invalid=[[],[{}],[{'start':True,'text':'fixture'}],[{'start':-1,'text':'fixture'}],[{'start':float('nan'),'text':'fixture'}],
                 [{'start':10**400,'text':'fixture'}],[{'start':0,'text':'  '}],[{'start':0,'text':'\ufeff'}],
                 [{'start':0,'text':'fixture','duration':True}],[{'start':0,'text':'fixture','duration':-1}],[{'start':0,'text':'fixture','duration':float('inf')}]]
        for segments in invalid:
            with self.subTest(segments=segments),tempfile.TemporaryDirectory() as folder:
                root=Path(folder)/'tzuyang/transcript';root.mkdir(parents=True)
                record={'youtube_link':'https://youtu.be/ABCDEFGHIJK','channel_name':'tzuyang','transcript':segments}
                path=root/'ABCDEFGHIJK.jsonl';path.write_text(json.dumps(record)+'\n');before=path.read_bytes()
                with self.assertRaises(worker.WorkerFailure) as raised:
                    worker.evaluate({'channel_name':'tzuyang','youtube_link':'https://youtu.be/ABCDEFGHIJK'},folder,run_command=lambda *a,**k:self.fail('command called'))
                self.assertEqual(raised.exception.code,'source_unavailable');self.assertEqual(path.read_bytes(),before)
        for duration in [None,0,1.25]:
            record={'transcript':[{'start':0,'text':'fixture','duration':duration}]}
            self.assertIs(worker.validate_transcript(record),record)

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
            self.assertEqual(len(reviews),0 if dry else 1)
            if not dry:
                self.assertEqual([command[command.index('--recheck-limit')+1] for command in reviews],['1'])
                self.assertIn('--request-id', reviews[0])

    def test_no_recheck_preserves_all_three_new_video_slots(self):
        def completed(command,**kwargs):
            receipt=Path(command[command.index('--receipt-file')+1]);receipt.write_text('{"recheckAttempted":false,"recheckOutstanding":false}')
            return 0
        with patch.object(runner,'_run',side_effect=completed):self.assertEqual(runner._review_reserved_slot(),runner.ReviewReservation(0,True))
        with patch.object(runner,'_run',return_value=1):self.assertEqual(runner._review_reserved_slot(),runner.ReviewReservation(1,False))

    def test_active_recheck_reserves_one_slot_and_an_incomplete_receipt_fails_closed(self):
        for outstanding,expected in [(True,runner.ReviewReservation(1,True)),(None,runner.ReviewReservation(1,False))]:
            def completed(command,**kwargs):
                receipt={'recheckAttempted':False}
                if outstanding is not None:receipt['recheckOutstanding']=outstanding
                Path(command[command.index('--receipt-file')+1]).write_text(json.dumps(receipt))
                return 0
            with patch.object(runner,'_run',side_effect=completed):self.assertEqual(runner._review_reserved_slot(),expected)

    def test_confirmed_reservation_allows_one_followup(self):
        import contextlib,io
        commands=[]
        def completed(command,**kwargs):
            commands.append(command)
            if '--receipt-file' in command:
                Path(command[command.index('--receipt-file')+1]).write_text('{"recheckAttempted":true}')
            return 0
        with patch.object(runner,'_load_backend_env'),patch.object(runner,'cadence_source_preflight'),patch.object(runner,'env_contract_preflight'),patch.object(runner,'_apply_local_runtime_environment'),patch.object(runner,'_run',side_effect=completed),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(['--review-automation','--limit','3']),0)
        reviews=[command for command in commands if command[1]==str(runner.REVIEW)]
        self.assertEqual([command[command.index('--recheck-limit')+1] for command in reviews],['1','0'])
        evaluation=next(command for command in commands if command[1]==str(runner.EVALUATE))
        self.assertEqual(evaluation[evaluation.index('--limit')+1],'2')

    def test_lost_tick_response_does_not_apply_a_fresh_followup(self):
        import contextlib,io
        commands=[]
        def lost_response(command,**kwargs):
            commands.append(command)
            return 1 if command[1]==str(runner.REVIEW) else 0
        with patch.object(runner,'_load_backend_env'),patch.object(runner,'cadence_source_preflight'),patch.object(runner,'env_contract_preflight'),patch.object(runner,'_apply_local_runtime_environment'),patch.object(runner,'_run',side_effect=lost_response),contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(runner.main(['--review-automation','--limit','3']),0)
        self.assertEqual(sum(command[1]==str(runner.REVIEW) for command in commands),1)
        self.assertIn('review_followup=skipped_unconfirmed',output.getvalue())

if __name__=='__main__':unittest.main()
