import copy
import json
from pathlib import Path
import tempfile
import types
import unittest
import uuid
from unittest.mock import patch

from backend.supabase.scripts import hosted_pending_operation as client
from backend.supabase.scripts.hosted_data_plane import HostedDataPlaneError,preview_hash,pending_insert_payload

REV='028af1b9ec87630c5e8055c5668f681501b4202a'
VIDEO='fixturevid1'


def candidate():
    fresh={'contract':'local-pipeline-candidate-set-v1','complete':True,'inputSha256':'1'*64,'sourceSha256':'2'*64}
    rows=[pending_insert_payload({'youtube_link':'https://youtu.be/'+VIDEO,'origin_name':n,'trace_id':'synthetic-'+n,'lat':1,'lng':2,'geocoding_success':True}) for n in ('A','B')]
    finger=preview_hash({'revision':REV,'freshness':fresh,'rows':rows})
    c=client.CandidateSet(REV,fresh,rows,finger,lambda:c)
    return c


class FakeRPC:
    def __init__(self,fail=None,commit=False):
        self.state=None;self.calls=[];self.fail=fail;self.commit=commit;self.rid=None
    def __call__(self,action,body):
        self.calls.append(action);self.rid=body.get('request_id',self.rid)
        if action=='prepare':
            created=self.state is None
            if created:self.state='prepared'
            result={'created':created,'state':self.state,'requestId':self.rid,'bindingSha':'a'*64}
        elif action=='claim':
            claimed=self.state=='prepared';self.state='claimed' if claimed else self.state
            result={'claimed':claimed,'state':self.state}
        elif action=='apply':
            if self.commit or self.fail!='apply':self.state='committed'
            result={'state':self.state}
        else:
            if self.state is None:return None
            c=candidate()
            return {'requestId':self.rid,'state':self.state,'replayAllowed':False,
                    'bindingSha':'a'*64,'sourceRevision':c.revision,'freshness':c.freshness}
        if action==self.fail:raise TimeoutError('must not be logged')
        return result


class CallerTests(unittest.TestCase):
    def test_normal_send_once_and_same_request_restart_read_only(self):
        rpc=FakeRPC();c=candidate();r=client.submit_once(c,transport=rpc)
        self.assertEqual(r['state'],'committed');self.assertEqual(rpc.calls,['read','prepare','claim','apply','read'])
        rpc.calls=[];client.submit_once(c,transport=rpc)
        self.assertEqual(rpc.calls,['read','read'])

    def test_unknown_prepare_claim_apply_never_retries(self):
        for phase,commit in [('prepare',False),('claim',False),('apply',False),('apply',True)]:
            with self.subTest(phase=phase,commit=commit):
                rpc=FakeRPC(phase,commit);c=candidate()
                r=client.submit_once(c,transport=rpc)
                self.assertFalse(r['replayAllowed'])
                self.assertEqual(r['state'],'committed' if commit else 'prepared' if phase=='prepare' else 'claimed')
                sent=rpc.calls.count('apply');rpc.calls=[]
                client.submit_once(c,transport=rpc)
                self.assertEqual(rpc.calls,['read','prepare','read'] if phase=='prepare' else ['read','read']);self.assertLessEqual(sent,1)
                if phase!='prepare':self.assertTrue(all(a=='read' for a in rpc.calls))

    def test_read_only_resume_does_not_prepare_or_claim(self):
        rpc=FakeRPC();rpc.state='claimed'
        r=client.reconcile_request(str(uuid.uuid4()),transport=rpc)
        self.assertEqual(r['state'],'claimed');self.assertEqual(rpc.calls,['read'])

    def test_source_change_after_claim_holds_without_apply(self):
        c=candidate();calls=[];rpc=FakeRPC()
        original=c.reobserve
        def check():
            calls.append(1)
            if rpc.state=='claimed':raise HostedDataPlaneError('pending_source_input_changed')
            return original()
        c=client.CandidateSet(c.revision,c.freshness,c.rows,c.fingerprint,check)
        result=client.submit_once(c,transport=rpc)
        self.assertEqual(result['state'],'claimed');self.assertEqual(rpc.calls,['read','prepare','claim','read'])

    def test_mutating_rows_cannot_cherry_pick_sibling(self):
        c=candidate();c.rows.pop()
        rpc=FakeRPC()
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_candidate_set_changed'):
            client.submit_once(c,transport=rpc)
        self.assertEqual(rpc.calls,[])

    def test_change_during_commit_preserves_receipt_but_cannot_certify_reuse(self):
        c=candidate();rpc=FakeRPC();changed=[]
        def observe():
            if changed:raise HostedDataPlaneError('pending_source_input_changed')
            return c
        c=client.CandidateSet(c.revision,c.freshness,c.rows,c.fingerprint,observe)
        def transport(action,body):
            result=rpc(action,body)
            if action=='apply':changed.append(True)
            return result
        result=client.submit_once(c,transport=transport)
        self.assertEqual(result['state'],'committed')
        self.assertFalse(result['sourceStillCurrent']);self.assertFalse(result['authorizesVideoSkip'])
        self.assertEqual(rpc.calls,['read','prepare','claim','apply','read'])

    def test_invalid_or_missing_readback_stays_unconfirmed(self):
        rid=str(uuid.uuid4())
        for value in (None,{}, {'requestId':rid,'state':'claimed','replayAllowed':True}):
            r=client.reconcile_request(rid,transport=lambda *args:value)
            self.assertEqual(r,{'requestId':rid,'state':'unconfirmed','replayAllowed':False})

    def test_base_without_promoted_freshness_contract_holds(self):
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_freshness_contract_unavailable'):
            client.admit_current_candidate_set(evaluation='.',crawling='.',channel='tzuyang',videos=[VIDEO],revision=REV,environment={},evaluator=types.SimpleNamespace())

    def test_admission_reads_all_siblings_and_invalidates_input_and_source(self):
        # Real bytes/hash/snapshot guards; the producer cache-hit result below is
        # a synthetic seam, not evidence of full promoted producer compatibility.
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);ev=root/'data';(ev/'evaluation').mkdir(parents=True)
            transforms=ev/'evaluation/transforms.jsonl';producer=root/'scripts/evaluator.py';producer.parent.mkdir();producer.write_text('pass\n')
            caller=root/'scripts/caller.py';caller.write_text('pass\n')
            rows=[{'youtube_link':'https://youtu.be/'+VIDEO,'origin_name':n,'trace_id':n,
                   'lat':1,'lng':2,'geocoding_success':True} for n in ('A','B')]
            transforms.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            def snapshot(*args):
                paths=[transforms,producer]
                return {p:(p.stat().st_ino,p.stat().st_mtime_ns,p.stat().st_size,p.stat().st_ctime_ns) for p in paths}
            evaluator=types.SimpleNamespace(REPO_ROOT=root,__file__=str(producer),_cache_snapshot=snapshot,_fresh_locally_evaluated_ids=lambda *a:{VIDEO})
            from backend.supabase.scripts import hosted_data_plane
            payload_source=root/'scripts/hosted_data_plane.py';payload_source.write_text('payload-v1')
            with patch.object(client,'__file__',str(caller)), patch.object(hosted_data_plane,'__file__',str(payload_source)), patch.object(client,'current_source_revision',return_value=REV):
                c=client.admit_current_candidate_set(evaluation=ev,crawling=root,channel='tzuyang',videos=[VIDEO],revision=REV,environment={},evaluator=evaluator)
                self.assertEqual([r['origin_name'] for r in c.rows],['A','B'])
                alias=root/'alias';alias.symlink_to(root,target_is_directory=True)
                evaluator.REPO_ROOT=alias
                via_alias=client.admit_current_candidate_set(evaluation=ev,crawling=root,channel='tzuyang',videos=[VIDEO],revision=REV,environment={},evaluator=evaluator)
                self.assertEqual(via_alias.fingerprint,c.fingerprint)
                evaluator.REPO_ROOT=root
                payload_source.write_text('payload-v2')
                with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()
                c=client.admit_current_candidate_set(evaluation=ev,crawling=root,channel='tzuyang',videos=[VIDEO],revision=REV,environment={},evaluator=evaluator)
                producer.write_text('changed_source = True\n')
                with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()
                c=client.admit_current_candidate_set(evaluation=ev,crawling=root,channel='tzuyang',videos=[VIDEO],revision=REV,environment={},evaluator=evaluator)
                transforms.write_text(transforms.read_text().replace('"lat": 1','"lat": 2'))
                with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()

if __name__=='__main__':unittest.main()
