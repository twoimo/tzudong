import contextlib
import copy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib
from urllib.parse import urlencode

from backend.bin import review_native_visual_packet as native
from backend.bin import run_restaurant_evidence_recovery as recovery
from backend.bin import run_restaurant_review_automation as review
from backend.bin.tests.test_restaurant_evidence_recovery import JOB, Transport, result
from backend.bin.tests import test_restaurant_review_automation as review_tests

RECIPE = {'mainSha':'a'*40,'treeSha':'b'*40,'codeSha256':'c'*64}
FIXTURES = Path(__file__).parent/'fixtures/native_visual_source_cases.v1.json'
ARTIFACTS = Path('/Users/twoimo/.local/state/tzudong-unified-20261025/auth-p0/admin-review-automation-v847')


def png():
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body))
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))
            +chunk(b'IDAT',zlib.compress((b'\0'+b'\xff'*48)*16))+chunk(b'IEND',b''))


class NativeVisualTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve();self.bundle=self.root/'bundle';self.bundle.mkdir(mode=0o700)
        self.state=self.root/'state';self.node=shutil.which('node') or 'node'
        self.rpc=Transport();rid=next(iter(native.TARGETS));video,scene=native.TARGETS[rid]
        self.original={'id':rid,'status':'hold','channel_name':None,'youtube_link':'https://www.youtube.com/watch?v='+video,
                       'origin_name':'황해모밀냉면','origin_address':{'address':'인천 남동구 구월말로 92'},
                       'tzuyang_review':'음식이 맛있습니다','reasoning_basis':None,'categories':['한식'],
                       'recollect_version':{'meta':3,'transcript':7},'lat':Decimal('37.1200')}
        self.original['trace_id']=hashlib.sha256((self.original['youtube_link']+self.original['origin_name']+self.original['tzuyang_review']).encode()).hexdigest()
        self.rpc.original=self.original;self.rpc.meta.update(restaurantId=rid,videoId=video,
            rowSha256=recovery.digest(self.original),inputSha256=recovery.digest(self.original))
        now=datetime.now(timezone.utc)
        self.blobs={'frame':png(),'clip':b'\0\0\0\x18ftypisom'+b'\0'*24,
            'publisher':{'httpStatus':200,'items':[{'videoId':video,'sourceUrl':self.original['youtube_link'],
                         'channelMatchesConfiguredTzuyang':True,'title':'합성 식당 영상'}]},
            'transcript':{'youtube_link':self.original['youtube_link'],'channel_name':'tzuyang','recollect_id':0,
                          'transcript':[{'start':120.5,'text':'음식이 맛있습니다'}]}}
        self.blobs['receipt']={'videoId':video,'exit':0,'state':'selected_cue_frames_inspected','publisherBindingObserved':True,
             'inspectedFrames':1,'requestedRangeSeconds':[80,115],'clipSha256':native.sha(self.blobs['clip']),
             'startedAt':(now-timedelta(seconds=2)).isoformat(),'inspectedAt':(now-timedelta(seconds=1)).isoformat(),
             'frames':[{'sourceSeconds':87,'clipSeconds':7,'sha256':native.sha(self.blobs['frame'])}],
             'observation':{'sourceApproxSeconds':87,'pixelName':'황해 모밀냉면','pixelNameQualifier':'본점',
                            'publisherAddressOverlay':'인천 남동구 구월말로 92'}}
        self.packet={'schemaVersion':1,'kind':'native_observer_report','projectRef':recovery.PROJECT,'jobId':JOB,
            'restaurantId':rid,'rowSha256':self.rpc.meta['rowSha256'],'inputSha256':self.rpc.meta['inputSha256'],
            'videoId':video,'sceneId':scene,'publisherId':review.review_target('tzuyang')['channel_id'],
            'sourceRecipe':RECIPE,'custodySha256':native.custody(self.bundle),'files':{},
            'observer':{'id':'synthetic-native-observer','method':'native_image_view',
                        'observedAt':self.blobs['receipt']['inspectedAt'],'recordSha256':''},
            'observation':{'signName':'황해 모밀냉면','branchQualifier':'본점','addressOverlay':'인천 남동구 구월말로 92','sourceApproxSeconds':87},
            'reviewQuotes':[{'segment':0,'start':120.5,'text':'음식이 맛있습니다'}]}
        self.path=self.bundle/'packet.json';self.save()
        self.actual_source_recipe=native.source_recipe
        self.source_patch=patch.object(native,'source_recipe',return_value=RECIPE);self.source_patch.start();self.addCleanup(self.source_patch.stop)
        self.calls=[]

    def put(self,path,data):
        path.write_bytes(data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode())
        path.chmod(0o600)

    def save(self):
        for key,body in self.blobs.items():
            p=self.bundle/(key+('.png' if key=='frame' else '.mp4' if key=='clip' else '.json'))
            self.put(p,body);self.packet['files'][key]={'path':str(p),'sha256':native.sha(p.read_bytes())}
        self.packet['observer']['recordSha256']=self.packet['files']['receipt']['sha256'];self.put(self.path,self.packet)

    def validate(self,original=True):
        return native.validate_packet(self.path,self.rpc.meta,original=self.original if original else None,node=self.node)

    def evaluator(self,original,crawling_root,**kwargs):
        data=kwargs['native_visual_inputs'];self.assertIsInstance(data,native.NativeInputs)
        self.assertEqual(original['lat'],37.12);self.assertIn('native_packet_preflight',(self.state/(JOB+'.jsonl')).read_text())
        kwargs['source_proof_sink'](data.proof)
        kwargs['run_command'](['node','review_decision_gemini.mjs'],timeout=480)
        return result(kwargs['decision_context']['inputSha256'])

    def command(self,argv,**kwargs):
        self.calls.append(argv);self.assertEqual(Path(argv[1]).name,'review_decision_gemini.mjs')
        self.assertIn('paid_intent',(self.state/(JOB+'.jsonl')).read_text())
        return subprocess.CompletedProcess(argv,0)

    def run_worker(self,**kwargs):
        return recovery.run_recovery(self.rpc,job_id=JOB,channel='tzuyang',state_dir=self.state,allow_worker_write=True,
             native_visual_packet=self.path,evaluator=kwargs.pop('evaluator',self.evaluator),
             privacy_validator=lambda _:None,node=self.node,run_command=kwargs.pop('run_command',self.command),**kwargs)

    def test_packet_and_scratch_preserve_raw_original_cache_refs_and_real_quote_types(self):
        before=copy.deepcopy(self.original);source={p:p.read_bytes() for p in self.bundle.iterdir()}
        native_inputs=self.validate();scratch=self.root/'scratch';scratch.mkdir(mode=0o700)
        prepared=review.prepare_review_inputs(json.loads(recovery.jsonb_text(self.original)),self.root/'no-corpus',scratch,
            expected_channel='tzuyang',native_visual_inputs=native_inputs,decision_context={'inputSha256':self.packet['inputSha256']},
            run_command=lambda *a,**kw:self.fail('source fetch/extraction'))
        crawl=review.last_record(scratch/'crawling'/(self.packet['videoId']+'.jsonl'))
        transcript=review.last_record(scratch/'transcript'/(self.packet['videoId']+'.jsonl'))
        self.assertEqual(transcript['transcript'][0]['text'],'음식이 맛있습니다')
        self.assertNotIn('구월말로',json.dumps(transcript,ensure_ascii=False))
        self.assertEqual(crawl['restaurants'][0]['address'],self.packet['observation']['addressOverlay'])
        self.assertNotIn('lat',crawl['restaurants'][0]);self.assertIsNone(self.original['reasoning_basis'])
        self.assertEqual(prepared['sourceProof']['claimRecollectReferences'],{'meta':3,'transcript':7})
        self.assertFalse(native_inputs.report['pixelsProvidedToJudge']);self.assertEqual(native_inputs.report['independentEvidenceFamiliesAdded'],[])
        self.assertEqual(self.original,before);self.assertTrue(all(p.read_bytes()==raw for p,raw in source.items()))

    def test_wrong_job_video_row_input_project_or_recipe_rejects_without_claim(self):
        original=copy.deepcopy(self.packet)
        for key,value in [('jobId','33333333-3333-4333-8333-333333333333'),('videoId','gV9QMjeRV8s'),
                          ('restaurantId','218457d8-5f7c-4e4d-8dcf-fc986c0780b6'),('inputSha256','d'*64),
                          ('rowSha256','e'*64),('projectRef','other'),('sourceRecipe',{**RECIPE,'treeSha':'f'*40})]:
            self.packet={**original,key:value};self.put(self.path,self.packet)
            with self.assertRaises(review.WorkerFailure):self.validate(False)
        self.assertFalse(self.rpc.calls);self.assertFalse(self.calls)

    def test_local_source_recipe_rejects_dirty_stale_or_wrong_repository_checkout(self):
        answers={('rev-parse','HEAD'):'a'*40,('rev-parse','refs/remotes/origin/main'):'a'*40,
                 ('rev-parse','HEAD^{tree}'):'b'*40,('status','--porcelain'):'',
                 ('remote','get-url','origin'):'https://github.com/twoimo/tzudong.git'}
        def git(argv,**kwargs):
            self.assertEqual(argv[0],'git');return subprocess.CompletedProcess(argv,0,(answers[tuple(argv[1:])]+'\n').encode())
        with patch.object(native.subprocess,'run',side_effect=git):
            self.assertEqual(self.actual_source_recipe()['mainSha'],'a'*40)
            for key,value in [(('status','--porcelain'),' M owned.py'),
                              (('rev-parse','refs/remotes/origin/main'),'c'*40),
                              (('remote','get-url','origin'),'https://untrusted.invalid/repo.git')]:
                before=answers[key];answers[key]=value
                with self.assertRaises(review.WorkerFailure):self.actual_source_recipe()
                answers[key]=before

    def test_frame_hash_mime_size_custody_and_approximate_precision_reject(self):
        for mutation in ('hash','mime','oversize','precision','time','custody'):
            with self.subTest(mutation=mutation):
                packet=copy.deepcopy(self.packet);blobs=copy.deepcopy(self.blobs)
                if mutation=='hash':self.packet['files']['frame']['sha256']='f'*64;self.put(self.path,self.packet)
                if mutation=='mime':self.blobs['frame']=b'not an image';self.save()
                if mutation=='oversize':self.blobs['frame']=b'x'*(2*1024*1024+1);self.save()
                if mutation=='precision':self.packet['observation']['timePrecision']='exact';self.put(self.path,self.packet)
                if mutation=='time':self.packet['observation']['sourceApproxSeconds']=87.001;self.put(self.path,self.packet)
                if mutation=='custody':self.packet['custodySha256']='f'*64;self.put(self.path,self.packet)
                with self.assertRaises(review.WorkerFailure):self.validate(False)
                self.packet=packet;self.blobs=blobs;self.save()

    def test_symlink_nonprivate_and_hardlinked_inputs_reject(self):
        p=Path(self.packet['files']['frame']['path']);raw=p.read_bytes()
        p.unlink();p.symlink_to(self.bundle/'clip.mp4')
        with self.assertRaises(review.WorkerFailure):self.validate(False)
        p.unlink();self.put(p,raw);p.chmod(0o644)
        with self.assertRaises(review.WorkerFailure):self.validate(False)
        p.chmod(0o600);os.link(p,self.bundle/'frame-hardlink.png')
        with self.assertRaises(review.WorkerFailure):self.validate(False)

    def test_real_quote_required_and_never_replaced_by_visual_text(self):
        for quote in [{'segment':0,'start':120.5,'text':'인천 남동구 구월말로 92'},
                      {'segment':0,'start':87,'text':'음식이 맛있습니다'},
                      {'segment':-1,'start':120.5,'text':'음식이 맛있습니다'}]:
            self.packet['reviewQuotes']=[quote];self.put(self.path,self.packet)
            with self.assertRaises(review.WorkerFailure):self.validate()

    def test_full_original_numeric_scale_and_immutable_trace_bind_before_projection(self):
        self.validate()
        for key,value in [('lat',Decimal('37.12')),('trace_id','other'),('tzuyang_review','changed')]:
            row={**self.original,key:value}
            with self.assertRaises(review.WorkerFailure):native.validate_packet(self.path,self.rpc.meta,original=row,node=self.node)

    def test_name_address_conflict_blocks_and_corroboration_cannot_override_it(self):
        report=self.bundle/'corroboration.json';self.put(report,{'kind':'synthetic public place proof','address':'different'})
        self.packet['corroboration']={'kind':'independent_public_place_receipt','path':str(report),'sha256':native.sha(report.read_bytes())}
        self.put(self.path,self.packet)
        self.assertEqual(self.validate().proof['corroborationUse'],'preserve_only')
        self.original['origin_address']['address']='인천 중구 경동 13-2'
        self.rpc.meta.update(rowSha256=recovery.digest(self.original),inputSha256=recovery.digest(self.original))
        self.packet.update(rowSha256=self.rpc.meta['rowSha256'],inputSha256=self.rpc.meta['inputSha256']);self.put(self.path,self.packet)
        with self.assertRaisesRegex(review.WorkerFailure,'source_identity_mismatch'):self.validate()
        observed=self.run_worker();self.assertEqual(observed['code'],'source_identity_mismatch');self.assertFalse(self.calls)
        self.assertEqual(self.original['origin_address']['address'],'인천 중구 경동 13-2')

    def corrected_case(self):
        rid='a08b0767-c015-4d37-9fdf-b446eff82abc';video='jkDzCwDpfV8'
        self.original.update(id=rid,origin_name='명동식당',origin_address={'address':'인천광역시 중구 경동 13-2'},
                             youtube_link='https://www.youtube.com/watch?v='+video)
        self.original['trace_id']=native.sha((self.original['youtube_link']+self.original['origin_name']+self.original['tzuyang_review']).encode())
        self.rpc.meta.update(restaurantId=rid,videoId=video,rowSha256=recovery.digest(self.original),inputSha256=recovery.digest(self.original))
        self.packet.update(restaurantId=rid,videoId=video,sceneId='cue-84-94',rowSha256=self.rpc.meta['rowSha256'],inputSha256=self.rpc.meta['inputSha256'])
        self.blobs['publisher']['items'][0].update(videoId=video,sourceUrl=self.original['youtube_link'])
        self.blobs['transcript']['youtube_link']=self.original['youtube_link']
        r=self.blobs['receipt'];r['videoId']=video
        r['observation'].update(pixelName='명동식당',pixelNameQualifier=None,publisherAddressOverlay='인천광역시 중구 경동 179-2',addressConflict=True)
        self.packet['observation'].update(signName='명동식당',branchQualifier=None,addressOverlay='인천광역시 중구 경동 179-2')
        query='명동식당 인천 답동로30번길 25';url='https://openapi.naver.com/v1/search/local.json?'+urlencode({'query':query,'display':5})
        now=datetime.now(timezone.utc).isoformat()
        c={'name':'명동식당','parcelAddress':'인천광역시 제물포구 경동 179-2','roadAddress':'인천광역시 제물포구 답동로30번길 25',
           'observedAt':now,'apiSourceUrl':url}
        self.public={'provider':'naver_local_search','restaurantId':rid,'videoId':video,'name':'명동식당','videoAddress':self.packet['observation']['addressOverlay'],
            'storedOriginAddress':self.original['origin_address']['address'],'query':query,'apiSourceUrl':url,'observedAt':now,
            'httpStatus':200,'queriesAttempted':1,'state':'public_place_candidates_observed','candidates':[c]}
        self.packet['correctionIntent']={'kind':'derive_fresh_location_preserve_origin','candidateSha256':native.digest(c),
            'observedAddress':self.public['videoAddress'],'parcelAddress':c['parcelAddress'],'roadAddress':c['roadAddress']}
        self.save_corroboration();self.save()

    def save_corroboration(self):
        p=self.bundle/'independent-place.json';self.put(p,self.public)
        self.packet['corroboration']={'kind':'independent_public_place_receipt','path':str(p),'sha256':native.sha(p.read_bytes())}
        self.put(self.path,self.packet)

    def test_explicit_corroborated_conflict_materializes_derived_road_and_preserves_original(self):
        self.corrected_case();before=copy.deepcopy(self.original);data=self.validate()
        self.assertEqual(data.records['crawling']['restaurants'][0]['address'],'인천광역시 제물포구 답동로30번길 25')
        report=data.report['locationCorroboration'];self.assertTrue(report['sourceOriginConflict'])
        self.assertFalse(report['administrativeEquivalenceClaimed']);self.assertEqual(report['independentEvidenceFamiliesAdded'],[])
        self.assertEqual(report['originAddress'],'인천광역시 중구 경동 13-2')
        self.assertEqual(self.run_worker()['state'],'draft');self.assertEqual(len(self.calls),1);self.assertEqual(self.original,before)

    def test_missing_wrong_stale_target_parcel_road_or_candidate_corroboration_blocks(self):
        self.corrected_case();base=copy.deepcopy(self.public);intent=copy.deepcopy(self.packet['correctionIntent'])
        for mutate in [lambda p:p.update(restaurantId='769a87f9-efc3-4603-93be-7ae1bb4d8c10'),
                       lambda p:p['candidates'][0].update(name='다른 식당'),
                       lambda p:p['candidates'][0].update(parcelAddress='인천광역시 제물포구 경동 13-2'),
                       lambda p:p['candidates'][0].update(parcelAddress='인천광역시 제물포구 서경동 179-2'),
                       lambda p:p['candidates'][0].update(roadAddress='인천광역시 제물포구 답동로30번길 26'),
                       lambda p:p.update(observedAt='2000-01-01T00:00:00+00:00')]:
            self.public=copy.deepcopy(base);mutate(self.public);self.save_corroboration()
            with self.assertRaises(review.WorkerFailure):self.validate()
        self.public=base;self.packet.pop('correctionIntent');self.save_corroboration()
        with self.assertRaisesRegex(review.WorkerFailure,'source_identity_mismatch'):self.validate()
        self.packet['correctionIntent']={**intent,'candidateSha256':'f'*64};self.save_corroboration()
        with self.assertRaises(review.WorkerFailure):self.validate()
        self.assertFalse(self.calls)

    def test_pii_and_incidental_fields_reject_before_claim_without_source_diagnostics(self):
        self.packet['observation']['people']='private-person@example.invalid';self.put(self.path,self.packet)
        output=io.StringIO()
        with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):observed=self.run_worker()
        self.assertEqual(observed['code'],'source_input_invalid');self.assertNotIn('claim',[c[0] for c in self.rpc.calls])
        self.assertNotIn('private-person',output.getvalue());self.assertFalse(self.calls)
        self.packet['observation'].pop('people');self.blobs['receipt']['observation']['publisherAddressOverlay']='010-1234-5678'
        self.packet['observation']['addressOverlay']='010-1234-5678';self.save()
        with self.assertRaises(review.WorkerFailure):self.validate(False)

    def test_default_does_not_discover_packet_and_next_rejects_before_transport(self):
        with patch.object(native,'validate_packet',side_effect=AssertionError('packet discovered')):
            result_=recovery.run_recovery(self.rpc,job_id=JOB,channel='tzuyang',state_dir=self.state,native_visual_packet=self.path)
        self.assertEqual(result_['code'],'dry_run');self.assertFalse(self.state.exists())
        before=len(self.rpc.calls)
        with self.assertRaises(recovery.RecoveryFailure):recovery.run_next_recovery(self.rpc,channel='tzuyang',state_dir=self.state,native_visual_packet=self.path)
        self.assertEqual(len(self.rpc.calls),before)
        with patch.object(recovery,'resolve_privileged_supabase_rest_credentials') as credentials,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(recovery.main(['--next','--channel','tzuyang','--native-visual-packet',str(self.path)]),1)
        credentials.assert_not_called()

    def test_selected_quotes_never_replace_the_full_verified_transcript(self):
        later={'start':130.0,'text':'뒤 문맥: 앞선 표현을 정정합니다.'}
        self.blobs['transcript']['transcript'].append(later);self.save()
        inputs=self.validate()
        self.assertEqual(inputs.records['transcript']['transcript'],self.blobs['transcript']['transcript'])
        self.assertEqual(len(inputs.report['reviewQuotes']),1)
        self.assertTrue(inputs.report['fullTranscriptProvidedToJudge'])

    def test_single_claim_one_judge_and_existing_journal_never_redispatches(self):
        self.assertEqual(self.run_worker()['state'],'draft');self.assertEqual(len(self.calls),1)
        with patch.object(native,'validate_packet',side_effect=AssertionError('replayed')):
            self.assertEqual(self.run_worker()['code'],'journal_exists_no_replay')
        self.assertEqual(len(self.calls),1)

    def test_rejected_packet_can_be_corrected_without_spending_the_queued_job(self):
        self.packet['observation']['people']='private-person@example.invalid'
        self.put(self.path,self.packet)
        rejected=self.run_worker()
        self.assertEqual(rejected['code'],'source_input_invalid')
        self.assertEqual(self.rpc.meta['state'],'queued')
        self.assertFalse((self.state/(JOB+'.jsonl')).exists())
        self.assertFalse(self.calls)
        self.assertNotIn('claim',[c[0] for c in self.rpc.calls])
        self.packet['observation'].pop('people');self.save()
        self.assertEqual(self.run_worker()['state'],'draft')
        self.assertEqual([c[0] for c in self.rpc.calls].count('claim'),1)
        self.assertEqual(len(self.calls),1)

    def test_read_only_preflight_failure_does_not_reserve_a_claim_journal(self):
        def unavailable(*args,**kwargs):
            self.assertEqual(args[0],'read')
            raise RuntimeError('synthetic transport detail must not reach output')
        observed=recovery.run_recovery(unavailable,job_id=JOB,channel='tzuyang',state_dir=self.state,
            allow_worker_write=True,native_visual_packet=self.path,evaluator=self.evaluator,
            privacy_validator=lambda _:None,node=self.node,run_command=self.command)
        self.assertEqual(observed['code'],'result_unconfirmed')
        self.assertFalse((self.state/(JOB+'.jsonl')).exists())
        self.assertFalse(self.calls)
        self.assertEqual(self.run_worker()['state'],'draft')
        self.assertEqual([c[0] for c in self.rpc.calls].count('claim'),1)
        self.assertEqual(len(self.calls),1)

    def test_complete_ack_unknown_reads_same_job_once_without_fail_or_second_judge(self):
        self.rpc.complete_mode='lost_ack';observed=self.run_worker()
        self.assertEqual(observed['state'],'draft');self.assertEqual(len(self.calls),1)
        self.assertEqual([c[0] for c in self.rpc.calls],['read','claim','complete','read'])
        self.assertEqual(len({c[2] for c in self.rpc.calls}),1)

    def test_unknown_paid_or_unaccepted_save_never_replays(self):
        def timeout(argv,**kwargs):self.calls.append(argv);raise subprocess.TimeoutExpired('private-canary',480)
        observed=self.run_worker(run_command=timeout);self.assertEqual(observed['state'],'uncertain')
        self.run_worker();self.assertEqual(len(self.calls),1)
        self.assertNotIn('private-canary',(self.state/(JOB+'.jsonl')).read_text())

    def test_unaccepted_completion_ack_does_not_send_opposite_fail_or_retry(self):
        self.rpc.complete_mode='unaccepted';observed=self.run_worker()
        self.assertEqual(observed['state'],'uncertain');self.assertEqual(len(self.calls),1)
        self.assertEqual([c[0] for c in self.rpc.calls],['read','claim','complete','read'])
        self.run_worker();self.assertEqual(len(self.calls),1)

    def test_unknown_claim_ack_never_evaluates_or_claims_again(self):
        def lost_claim(phase,*args):
            value=self.rpc(phase,*args)
            if phase=='claim':raise TimeoutError('synthetic-unknown-claim')
            return value
        for _ in range(2):
            recovery.run_recovery(lost_claim,job_id=JOB,channel='tzuyang',state_dir=self.state,allow_worker_write=True,
                native_visual_packet=self.path,node=self.node,privacy_validator=lambda _:None,
                evaluator=lambda *a,**kw:self.fail('evaluation after unknown claim'))
        self.assertEqual([c[0] for c in self.rpc.calls],['read','claim']);self.assertFalse(self.calls)

    def test_frame_changes_during_rule_stage_rejects_before_paid_intent(self):
        def evaluator(original,root,**kwargs):
            Path(self.packet['files']['frame']['path']).write_bytes(b'changed')
            kwargs['run_command'](['node','review_decision_gemini.mjs'])
        observed=self.run_worker(evaluator=evaluator);self.assertFalse(observed['paid_attempted']);self.assertFalse(self.calls)

    def test_selected_claim_uses_real_selection_parser_transform_and_one_mocked_judge(self):
        self.blobs['transcript']['transcript'].append({'start':130.0,'text':'뒤 문맥: 앞선 표현을 정정합니다.'})
        self.save()
        name=self.original['origin_name'];video=self.packet['videoId'];stages=[]
        metrics=review_tests.ReviewWorkerTests.complete_metrics()
        laaj={k:[{'name':name,**v}] for k,v in metrics.items() if k not in ('category_validity_TF','location_match_TF')}
        laaj['visit_authenticity']={'values':laaj['visit_authenticity'],'missing':[]}
        def command(argv,**kwargs):
            stage=Path(argv[1]).name;stages.append(stage)
            if stage=='review_rule_evaluation.py':
                ep=Path(argv[argv.index('--evaluation-path')+1]);selection=review.last_record(ep/'evaluation/selection'/(video+'.jsonl'))
                rule={**selection,'evaluation_results':{
                    'category_validity_TF':[{'origin_name':name,'name':name,'eval_value':True}],
                    'location_match_TF':[{'origin_name':name,'naver_name':name,'matched_name':name,'matched_provider':'naver',
                        'eval_value':True,'match_status':'matched','evidence_families':['source_geo','provider_candidate'],
                        'matched_address':{'jibunAddress':'synthetic public business address','x':'127','y':'37.5'}}]}}
                p=ep/'evaluation/rule_results'/(video+'.jsonl');p.parent.mkdir(parents=True);self.put(p,rule)
                return subprocess.CompletedProcess(argv,0)
            if stage=='review_decision_gemini.mjs':
                self.command(argv,**kwargs);prompt=Path(argv[2]).read_text()
                self.assertIn('<native_observer_report>',prompt);self.assertIn('"pixelsProvidedToJudge": false',prompt)
                self.assertIn('not transcript',prompt);self.assertIn('음식이 맛있습니다',prompt)
                self.assertNotIn(str(self.bundle),prompt)
                self.assertNotIn(self.packet['observer']['id'],prompt)
                self.assertIn('뒤 문맥: 앞선 표현을 정정합니다.',prompt)
                decision=result(self.packet['inputSha256'])['gemini_decision'];decision['promptSha256']=native.sha(prompt.encode())
                self.put(Path(argv[3]),{'evaluation':laaj,'gemini_decision':decision});return subprocess.CompletedProcess(argv,0)
            self.assertIn(stage,['09-target-selection.py','parse_laaj_evaluation.py','12-transform.py'])
            return subprocess.run(argv,**kwargs)
        before=copy.deepcopy(self.original);observed=self.run_worker(evaluator=review.evaluate,run_command=command)
        self.assertEqual(observed['state'],'draft');self.assertEqual(len(self.calls),1);self.assertEqual(self.original,before)
        self.assertEqual(stages,['09-target-selection.py','review_rule_evaluation.py','review_decision_gemini.mjs','parse_laaj_evaluation.py','12-transform.py'])

    def test_real_public_source_case_hashes_and_two_conflicts_when_local_bytes_exist(self):
        fixture=json.loads(FIXTURES.read_text())
        if not (ARTIFACTS/fixture['publisherRelativePath']).is_file():self.skipTest('local public source bytes absent; synthetic contracts still run')
        expected={'same_address_cue':0,'address_conflict':0}
        for case in fixture['cases']:
            directory=self.root/case['restaurantId'];directory.mkdir(mode=0o700)
            packet={'restaurantId':case['restaurantId'],'videoId':case['videoId'],'sceneId':case['sceneId'],
                'publisherId':review.review_target('tzuyang')['channel_id'],'observation':case['observation'],
                'observer':{'id':'receipt-native-observer','method':'native_image_view',
                    'observedAt':case['observerObservedAt'],'recordSha256':case['receiptSha256']},'files':{}}
            for kind in ('receipt','frame','clip','publisher'):
                relative=fixture['publisherRelativePath'] if kind=='publisher' else case[kind+'RelativePath']
                source=ARTIFACTS/relative;raw=source.read_bytes()
                expected_sha=fixture['publisherSha256'] if kind=='publisher' else case[kind+'Sha256']
                self.assertEqual(native.sha(raw),expected_sha)
                p=directory/(kind+source.suffix);self.put(p,raw);packet['files'][kind]={'path':str(p),'sha256':expected_sha}
            if case['expected']=='address_conflict':
                with self.assertRaisesRegex(review.WorkerFailure,'source_identity_mismatch'):native.inspect_sources(packet,directory,cue_only=True)
            else:native.inspect_sources(packet,directory,cue_only=True)
            if 'corroborationRelativePath' in case:
                raw=(ARTIFACTS/case['corroborationRelativePath']).read_bytes()
                self.assertEqual(native.sha(raw),case['corroborationSha256'])
                packet['correctionIntent']=case['correctionIntent']
                joined=native.correction_join(packet,json.loads(raw))
                self.assertTrue(joined['sourceOriginConflict']);self.assertFalse(joined['administrativeEquivalenceClaimed'])
                native.inspect_sources(packet,directory,cue_only=True,allow_conflict=True)
            expected[case['expected']]+=1
        self.assertEqual(expected,{'same_address_cue':3,'address_conflict':2});self.assertFalse(self.calls)

    def test_dng_target_scene_exchange_and_observer_invention_reject(self):
        self.packet.update(restaurantId='5d14e8a2-2f12-47f8-80d9-94b4692168bc',videoId='DNGGl1-jFcU',sceneId='chicken-overlay-refinement')
        binding={**self.rpc.meta,**{k:self.packet[k] for k in ('restaurantId','videoId')}};self.put(self.path,self.packet)
        with self.assertRaises(review.WorkerFailure):native.validate_packet(self.path,binding,node=self.node)
        self.packet.update(restaurantId=self.original['id'],videoId=self.rpc.meta['videoId'],sceneId='intro')
        self.packet['observer']['method']='hash-only-no-pixels';self.put(self.path,self.packet)
        with self.assertRaises(review.WorkerFailure):self.validate(False)


if __name__=='__main__':unittest.main()
