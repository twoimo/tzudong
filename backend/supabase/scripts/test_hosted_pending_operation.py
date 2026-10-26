import copy
import hashlib
import json
from contextlib import ExitStack
from pathlib import Path
import tempfile
import types
import unittest
import uuid
from unittest.mock import patch

from backend.supabase.scripts import hosted_pending_operation as client
from backend.supabase.scripts.hosted_data_plane import HostedDataPlaneError,preview_hash,pending_insert_payload
from backend.bin import evaluate_new_youtube_videos as producer

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
            def snapshot(*args,**kwargs):
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

class ScopedDeliveryBudgetTests(unittest.TestCase):
    """Real file/snapshot admission with synthetic freshness and RPC boundaries."""

    def setUp(self):
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.root=Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.crawling=self.root/'backend/restaurant-crawling/data/tzuyang'
        self.evaluation=self.root/'backend/restaurant-evaluation/data/tzuyang'
        self.old=['video000001','video000002','video000003'];self.new='zzzzz000001'
        self.rows=[];self.fresh=set();self.operations={};self.stored=set();self.calls=[]
        self.producer_source=self.root/'scripts/evaluator.py'
        self.caller_source=self.root/'scripts/caller.py'
        self.payload_source=self.root/'scripts/hosted_data_plane.py'
        for path in (self.producer_source,self.caller_source,self.payload_source):
            path.parent.mkdir(parents=True,exist_ok=True);path.write_text('source-v1\n')
        self.stack.enter_context(patch.object(producer,'REPO_ROOT',self.root))
        self.stack.enter_context(patch.object(client,'__file__',str(self.caller_source)))
        self.stack.enter_context(patch.object(client,'current_source_revision',return_value=REV))
        from backend.supabase.scripts import hosted_data_plane
        self.stack.enter_context(patch.object(hosted_data_plane,'__file__',str(self.payload_source)))
        self.evaluator=types.SimpleNamespace(REPO_ROOT=self.root,__file__=str(self.producer_source),
            _cache_snapshot=producer._cache_snapshot,_fresh_locally_evaluated_ids=lambda *args:set(self.fresh))
        for video in self.old:self.add_video(video)

    @staticmethod
    def write(path,value):
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value)+'\n')

    def add_video(self,video):
        self.fresh.add(video)
        for directory in ('crawling','meta','transcript','visual-location'):
            self.write(self.crawling/directory/(video+'.jsonl'),{'video':video,'stage':directory})
        for directory in ('selection','rule_results','laaj_results'):
            self.write(self.evaluation/'evaluation'/directory/(video+'.jsonl'),{'video':video,'stage':directory})
            self.write(self.evaluation/'evaluation'/directory/'.receipts'/(video+'.json'),{'inputHash':video,'stage':directory})
        self.rows.extend({'youtube_link':'https://youtu.be/'+video,'origin_name':name,
            'trace_id':video+'-'+name,'lat':1,'lng':2,'geocoding_success':True} for name in ('A','B'))
        self.publish_transform()

    def publish_transform(self):
        path=self.evaluation/'evaluation/transforms.jsonl'
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(''.join(json.dumps(row)+'\n' for row in self.rows))
        self.write(path.parent/'.receipts/transform.json',{'schemaVersion':2,
            'groups':{video:{'records':[video+'-A',video+'-B']} for video in sorted(self.fresh)},
            'recordCount':len(self.rows),'outputHash':hashlib.sha256(path.read_bytes()).hexdigest()})

    def admit(self,video):
        return client.admit_current_candidate_set(evaluation=self.evaluation,crawling=self.crawling,
            channel='tzuyang',videos=[video],revision=REV,environment={},evaluator=self.evaluator)

    @staticmethod
    def row_identity(row):
        video=client.row_youtube_id(row)
        return {'video':video,'id':str(uuid.uuid5(uuid.NAMESPACE_URL,video+':'+row['origin_name'])),
            'identitySha':hashlib.sha256((video+':'+row['origin_name']).encode()).hexdigest()}

    def record(self,operation):
        c=operation['candidate'];current=[]
        for row in c.rows:
            identity=self.row_identity(row)
            current.append({**identity,'action':'present' if identity['id'] in self.stored else 'absent'})
        return {'requestId':operation['requestId'],'bindingSha':c.fingerprint,'state':operation['state'],
            'replayAllowed':False,'sourceRevision':c.revision,'freshness':copy.deepcopy(c.freshness),
            'rows':copy.deepcopy(operation.get('result')),'currentRows':current,
            'currentSetPresent':all(row['action']=='present' for row in current),
            'originalRowsStillPresent':operation['state']=='committed' and all(row['action']=='present' for row in current),
            'relatedRequestIds':[]}

    def seed_delivered(self,c):
        rid=str(uuid.uuid5(uuid.NAMESPACE_URL,'tzudong:pending:v1:'+c.fingerprint))
        result=[{**self.row_identity(row),'action':'inserted'} for row in c.rows]
        self.stored.update(row['id'] for row in result)
        self.operations[rid]={'requestId':rid,'candidate':c,'state':'committed','result':result}
        return rid

    def rpc(self,action,body):
        if action=='read' and 'video_ids' in body:
            video=body['video_ids'][0];self.calls.append((action,video))
            return {'videos':body['video_ids'],'legacyHeld':[],'replayAllowed':False,
                'operations':[self.record(o) for o in self.operations.values()
                    if client.row_youtube_id(o['candidate'].rows[0])==video]}
        rid=body['request_id'];operation=self.operations.get(rid)
        video=client.row_youtube_id(body['rows'][0]) if 'rows' in body else (
            client.row_youtube_id(operation['candidate'].rows[0]) if operation else None)
        self.calls.append((action,video))
        if action=='read':return self.record(operation) if operation else None
        if action=='prepare':
            created=operation is None
            if created:
                rows=copy.deepcopy(body['rows']);fresh=copy.deepcopy(body['freshness'])
                fingerprint=preview_hash({'revision':body['source_revision'],'freshness':fresh,'rows':rows})
                c=client.CandidateSet(body['source_revision'],fresh,rows,fingerprint,None)
                operation={'requestId':rid,'candidate':c,'state':'prepared'};self.operations[rid]=operation
            return {'requestId':rid,'bindingSha':operation['candidate'].fingerprint,
                'state':operation['state'],'created':created}
        if action=='claim':
            won=operation['state']=='prepared'
            if won:operation.update(state='claimed',sender=body['sender_id'])
            return {'claimed':won,'state':operation['state']}
        if action=='apply':
            if (operation['state']!='claimed' or operation['sender']!=body['sender_id']
                or operation['candidate'].fingerprint!=body['binding_sha'] or operation['candidate'].rows!=body['rows']):
                raise AssertionError('APPLY_WITHOUT_EXACT_CLAIM_AND_SIBLINGS')
            result=[]
            for row in body['rows']:
                identity=self.row_identity(row)
                result.append({**identity,'action':'present' if identity['id'] in self.stored else 'inserted'})
                self.stored.add(identity['id'])
            operation.update(state='committed',result=result)
            return {'state':'committed','rows':result}
        raise AssertionError('UNEXPECTED_RPC')

    def apply_all(self,transport=None):
        return client.apply_current_sets(evaluation=self.evaluation,crawling=self.crawling,
            channel='tzuyang',revision=REV,environment={},videos=self.old+[self.new],
            transport=transport or self.rpc,evaluator=self.evaluator,
            expected_payloads=[pending_insert_payload(row) for row in self.rows])

    def test_three_delivered_sets_do_not_spend_new_video_budget_after_unrelated_evaluation(self):
        previous={video:self.admit(video) for video in self.old}
        original_ids={video:self.seed_delivered(c) for video,c in previous.items()}
        self.add_video(self.new)
        result=self.apply_all()
        self.assertIn(self.new,result['reflection']['applied'])
        self.assertEqual(result['reflection']['skippedAlreadyPresent'],self.old)
        self.assertEqual(result['reflection']['unresolved'],[])
        self.assertEqual([(a,v) for a,v in self.calls if a!='read'],
            [('prepare',self.new),('claim',self.new),('apply',self.new)])
        for video,c in previous.items():
            self.assertEqual(self.admit(video).fingerprint,c.fingerprint)
            self.assertEqual(self.operations[original_ids[video]]['state'],'committed')
        self.assertEqual(len([row for row in self.stored if row in {
            self.row_identity(r)['id'] for r in self.rows if client.row_youtube_id(r)==self.new}]),2)

    def test_actual_video_inputs_receipts_payload_and_source_still_invalidate(self):
        video=self.old[0];other=self.admit(self.old[1])
        paths=[self.crawling/directory/(video+'.jsonl') for directory in ('crawling','meta','transcript','visual-location')]
        paths += [self.evaluation/'evaluation'/directory/(video+'.jsonl') for directory in ('selection','rule_results','laaj_results')]
        paths += [self.evaluation/'evaluation'/directory/'.receipts'/(video+'.json') for directory in ('selection','rule_results','laaj_results')]
        for path in paths:
            with self.subTest(path=str(path.relative_to(self.root))):
                c=self.admit(video);path.write_text(path.read_text()+'\n')
                with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()
                other.assert_current()
        c=self.admit(video);self.rows[0]['lat']=3;self.publish_transform()
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()
        other.assert_current()
        c=self.admit(video);self.producer_source.write_text('source-v2\n')
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):c.assert_current()

    def test_expired_or_invalid_cache_admission_still_holds(self):
        c=self.admit(self.old[0]);self.fresh.remove(self.old[0])
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_local_input_stale'):c.assert_current()
        self.assertEqual(self.calls,[])

    def test_global_transform_change_during_admission_remains_fail_closed(self):
        def freshness(*args):
            self.rows.append({**self.rows[0],'youtube_link':'https://youtu.be/'+self.new})
            self.publish_transform()
            return set(self.fresh)
        self.evaluator._fresh_locally_evaluated_ids=freshness
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):self.admit(self.old[0])
        self.assertEqual(self.calls,[])

    def test_added_sibling_invalidates_and_cannot_be_cherry_picked(self):
        video=self.old[0];previous=self.admit(video)
        self.rows.append({**self.rows[0],'origin_name':'C','trace_id':video+'-C'})
        self.publish_transform()
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_source_input_changed'):previous.assert_current()
        current=self.admit(video)
        self.assertEqual([row['origin_name'] for row in current.rows],['A','B','C'])
        result=client.apply_current_sets(evaluation=self.evaluation,crawling=self.crawling,
            channel='tzuyang',revision=REV,environment={},videos=[video],transport=self.rpc,
            evaluator=self.evaluator,expected_payloads=previous.rows)
        self.assertEqual(result['reflection']['unresolved'],[video])
        self.assertEqual(self.calls,[])

    def test_unpromoted_snapshot_without_candidate_scope_is_rejected(self):
        def unscoped_only(crawling,evaluation,videos,environment):
            return producer._cache_snapshot(crawling,evaluation,videos,environment)
        self.evaluator._cache_snapshot=unscoped_only
        with self.assertRaisesRegex(HostedDataPlaneError,'pending_freshness_contract_unavailable'):self.admit(self.old[0])
        self.assertEqual(self.calls,[])

    def test_uncertain_and_held_originals_remain_read_only_while_new_video_progresses(self):
        ids={video:self.seed_delivered(self.admit(video)) for video in self.old}
        self.operations[ids[self.old[0]]]['state']='claimed'
        self.operations[ids[self.old[1]]]['state']='held'
        self.add_video(self.new)
        def transport(action,body):
            if action=='read' and body.get('video_ids')==[self.old[2]]:
                self.calls.append((action,self.old[2]));raise TimeoutError('synthetic read loss')
            return self.rpc(action,body)
        result=self.apply_all(transport)
        self.assertEqual(result['reflection']['applied'],[self.new])
        self.assertEqual(result['reflection']['unresolved'],self.old)
        self.assertTrue(all(video==self.new for action,video in self.calls if action!='read'))


if __name__=='__main__':unittest.main()
