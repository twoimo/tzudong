"""Offline recovery caller tests; fake CAS does not replace actual PG proof."""
import copy
import io
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path
import tempfile
from unittest.mock import patch

from backend.supabase.scripts import hosted_pending_operation as op
from backend.supabase.scripts.hosted_data_plane import HostedDataPlaneError, preview_hash
from backend.supabase.scripts.test_hosted_pending_operation import candidate, REV, VIDEO


class Custody:
    """Synthetic authoritative store with an atomic claim transition."""
    def __init__(self, c, state='prepared'):
        self.c = c
        self.rid = str(uuid.uuid4())
        self.binding = preview_hash({'revision':c.revision,'freshness':c.freshness,'rows':c.rows})
        self.state = state
        self.sender = None
        self.calls = []
        self.restaurant_rows = len(c.rows) if state == 'committed' else 0
        self.lock = threading.Lock()
        self.claim_barrier = None
        self.drop_ack = None
        self.before = None
        self.history = []

    def record(self):
        current = [{'identitySha':str(i+1)*64,'video':op.row_youtube_id(self.c.rows[0]),'action':'present' if i<self.restaurant_rows else 'absent',
                    **({'id':str(uuid.UUID(int=i+1))} if i<self.restaurant_rows else {})} for i in range(len(self.c.rows))]
        return {'requestId':self.rid,'bindingSha':self.binding,'state':self.state,'replayAllowed':False,
                'sourceRevision':self.c.revision,'freshness':copy.deepcopy(self.c.freshness),
                'rows':[{**row,'action':'inserted'} for row in current] if self.state=='committed' else None,
                'currentRows':current,'currentSetPresent':self.restaurant_rows==len(self.c.rows),
                'originalRowsStillPresent':self.state=='committed','relatedRequestIds':[]}

    def __call__(self, action, body):
        if self.before:self.before(action,body)
        if action=='claim' and self.claim_barrier:self.claim_barrier.wait(timeout=3)
        with self.lock:
            self.calls.append((action,copy.deepcopy(body)))
            if action=='read':
                if 'video_ids' in body:
                    return {'videos':body['video_ids'],'legacyHeld':[],
                            'operations':copy.deepcopy(self.history)+[self.record()],'replayAllowed':False}
                return self.record() if body['request_id']==self.rid else None
            if body['request_id']!=self.rid:raise AssertionError('NEW_REQUEST_FORBIDDEN')
            if action=='prepare':
                binding=preview_hash({'revision':body['source_revision'],'freshness':body['freshness'],'rows':body['rows']})
                if binding!=self.binding:raise HostedDataPlaneError('pending_request_drift')
                result={'requestId':self.rid,'bindingSha':self.binding,'state':self.state,'created':False}
            elif action=='claim':
                if body['binding_sha']!=self.binding:raise HostedDataPlaneError('pending_request_drift')
                won=self.state=='prepared'
                if won:self.state='claimed';self.sender=body['sender_id']
                result={'claimed':won,'state':self.state}
            elif action=='apply':
                if self.state!='claimed' or body['sender_id']!=self.sender or body['binding_sha']!=self.binding or body['rows']!=self.c.rows:
                    raise AssertionError('APPLY_WITHOUT_CURRENT_CLAIM')
                self.state='committed';self.restaurant_rows=len(self.c.rows)
                result={'state':'committed','rows':self.record()['rows'],'replayed':False}
            else:raise AssertionError('RPC_NOT_ALLOWED')
        if self.drop_ack==action:raise TimeoutError('synthetic acknowledgement lost')
        return result

    def count(self, action):return sum(a==action for a,_ in self.calls)


def historical_candidate(c,tag='b'):
    # A prior complete A-only input is distinct from the new complete A+B input.
    # Equal SQL bindings cannot produce two original requests under the candidate.
    fresh={**c.freshness,'inputSha256':tag*64};rows=copy.deepcopy(c.rows[:1])
    prior=op.CandidateSet(c.revision,fresh,rows,preview_hash({'revision':c.revision,'freshness':fresh,'rows':rows}),lambda:prior)
    return prior


def apply(c, rpc):
    with patch.object(op,'admit_current_candidate_set',return_value=c):
        return op.apply_current_sets(evaluation='.',crawling='.',channel='tzuyang',revision=c.revision,
             environment={},videos=[VIDEO],transport=rpc,expected_payloads=c.rows)


def discover(records):
    return op.observe_deliveries([VIDEO],revision=REV,transport=lambda *args:{'videos':[VIDEO],
        'legacyHeld':[],'operations':records,'replayAllowed':False})[VIDEO]


class PreparedResumptionTests(unittest.TestCase):
    def test_existing_prepared_original_uuid_resumes_one_claim_and_full_siblings(self):
        c=candidate();rpc=Custody(c)
        result=op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertEqual(result['state'],'committed')
        self.assertEqual(rpc.count('claim'),1);self.assertEqual(rpc.count('apply'),1)
        self.assertEqual(rpc.restaurant_rows,2)
        self.assertTrue(all(b.get('request_id',rpc.rid)==rpc.rid for _,b in rpc.calls))
        self.assertFalse(result['authorizesVideoSkip'])

    def test_discovery_prepared_and_historical_commit_preserves_original_for_apply(self):
        for reverse in (False,True):
            with self.subTest(reverse=reverse):
                c=candidate();rpc=Custody(c);old=Custody(historical_candidate(c),'committed').record();rpc.restaurant_rows=1
                records=[old,rpc.record()]
                if reverse:records.reverse()
                observed=discover(records)
                self.assertEqual(observed['state'],'prepared');self.assertEqual(observed['requestId'],rpc.rid)
                self.assertEqual(observed['bindingSha'],rpc.binding)
                rpc.history=[old]
                result=apply(c,rpc)
                self.assertEqual(result['reflection']['applied'],[VIDEO]);self.assertEqual(result['reflection']['unresolved'],[])
                self.assertEqual(rpc.count('apply'),1);self.assertEqual(result['requests'][0]['requestId'],rpc.rid)

    def test_any_claimed_or_held_precedes_committed_in_both_orders(self):
        c=candidate();done=Custody(historical_candidate(c),'committed').record()
        for state in ('claimed','held'):
            blocked=Custody(c,state).record()
            for records in ([done,blocked],[blocked,done]):
                with self.subTest(state=state,first=records[0]['state']):
                    observed=discover(records)
                    self.assertEqual(observed['state'],'held');self.assertEqual(observed['requestId'],blocked['requestId'])

    def test_held_competitor_and_prepared_original_cannot_resume(self):
        c=candidate();rpc=Custody(c);rpc.history=[Custody(historical_candidate(c,'c'),'held').record(),Custody(historical_candidate(c),'committed').record()]
        self.assertEqual(discover([rpc.record(),*rpc.history])['state'],'held')
        result=apply(c,rpc)
        self.assertEqual(result['reflection']['unresolved'],[VIDEO]);self.assertEqual(rpc.count('prepare'),0)
        self.assertEqual(rpc.count('claim'),0);self.assertEqual(rpc.count('apply'),0)
        self.assertEqual({x['requestId'] for x in result['requests']},{rpc.rid,rpc.history[0]['requestId']})

    def test_two_prepared_requests_are_ambiguous_not_new_identity(self):
        c=candidate();rpc=Custody(c);rpc.history=[Custody(c).record()]
        self.assertEqual(discover([rpc.record(),*rpc.history])['state'],'held')
        self.assertEqual(apply(c,rpc)['reflection']['unresolved'],[VIDEO])
        self.assertEqual(rpc.count('prepare'),0);self.assertEqual(rpc.count('claim'),0)

    def test_two_recovery_callers_only_explicit_cas_winner_applies(self):
        c=candidate();rpc=Custody(c);rpc.claim_barrier=threading.Barrier(2)
        with ThreadPoolExecutor(2) as pool:
            futures=[pool.submit(op.submit_once,c,transport=rpc,request_id=rpc.rid) for _ in range(2)]
            results=[f.result(timeout=5) for f in futures]
        self.assertEqual(rpc.count('claim'),2);self.assertEqual(rpc.count('apply'),1)
        self.assertEqual(rpc.restaurant_rows,2);self.assertTrue(all(r['replayAllowed'] is False for r in results))

    def test_old_client_wins_claim_while_recovery_is_in_flight(self):
        c=candidate();rpc=Custody(c);old_sender=str(uuid.uuid4());once=[]
        def before(action,body):
            if action=='claim' and not once:
                once.append(True)
                with rpc.lock:rpc.state='claimed';rpc.sender=old_sender
        rpc.before=before
        result=op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertEqual(result['state'],'claimed');self.assertEqual(rpc.count('claim'),1);self.assertEqual(rpc.count('apply'),0)
        rpc.before=None
        rpc('apply',{'request_id':rpc.rid,'sender_id':old_sender,'binding_sha':rpc.binding,'rows':c.rows})
        self.assertEqual(op.reconcile_request(rpc.rid,transport=rpc)['state'],'committed')
        self.assertEqual(rpc.count('apply'),1)

    def test_recovery_wins_then_old_client_cannot_claim_or_apply(self):
        c=candidate();rpc=Custody(c)
        self.assertEqual(op.submit_once(c,transport=rpc,request_id=rpc.rid)['state'],'committed')
        old_claim=rpc('claim',{'request_id':rpc.rid,'sender_id':str(uuid.uuid4()),'binding_sha':rpc.binding})
        self.assertFalse(old_claim['claimed']);self.assertEqual(rpc.count('apply'),1)

    def test_claim_ack_loss_is_readonly_even_when_zero_rows_and_on_restart(self):
        c=candidate();rpc=Custody(c);rpc.drop_ack='claim'
        first=op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertEqual(first['state'],'claimed');self.assertEqual(rpc.restaurant_rows,0)
        before=len(rpc.calls);second=op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertEqual(second['state'],'claimed');self.assertTrue(all(a=='read' for a,_ in rpc.calls[before:]))
        self.assertEqual(rpc.count('claim'),1);self.assertEqual(rpc.count('apply'),0)

    def test_unknown_claim_that_did_not_settle_does_not_retry_within_invocation(self):
        c=candidate();rpc=Custody(c);claims=[]
        def transport(action,body):
            if action=='claim':claims.append(1);raise TimeoutError('unknown claim')
            return rpc(action,body)
        result=op.submit_once(c,transport=transport,request_id=rpc.rid)
        self.assertEqual(result['state'],'prepared');self.assertEqual(len(claims),1);self.assertEqual(rpc.count('apply'),0)

    def test_claimed_zero_rows_and_held_are_readonly_at_both_entrypoints(self):
        for state in ('claimed','held'):
            with self.subTest(state=state):
                c=candidate();rpc=Custody(c,state)
                result=op.submit_once(c,transport=rpc,request_id=rpc.rid)
                self.assertEqual(result['state'],state);self.assertTrue(all(a=='read' for a,_ in rpc.calls))
                result=apply(c,rpc)
                self.assertEqual(result['reflection']['unresolved'],[VIDEO]);self.assertEqual(rpc.count('apply'),0)

    def test_changed_current_source_or_freshness_rejects_before_prepare(self):
        for changed in ('source','input','incomplete'):
            c=candidate();rpc=Custody(c)
            fresh={**c.freshness,**({'inputSha256':'f'*64} if changed=='input' else {'complete':False} if changed=='incomplete' else {})}
            rev='f'*40 if changed=='source' else c.revision
            current=op.CandidateSet(rev,fresh,c.rows,preview_hash({'revision':rev,'freshness':fresh,'rows':c.rows}),lambda:current)
            self.assertEqual(apply(current,rpc)['reflection']['unresolved'],[VIDEO])
            self.assertEqual(rpc.count('prepare'),0);self.assertEqual(rpc.count('claim'),0)

    def test_changed_full_sibling_payload_is_rejected_by_same_uuid_binding(self):
        c=candidate();rpc=Custody(c);rows=copy.deepcopy(c.rows);rows.pop()
        changed=op.CandidateSet(c.revision,c.freshness,rows,preview_hash({'revision':c.revision,'freshness':c.freshness,'rows':rows}),lambda:changed)
        result=op.submit_once(changed,transport=rpc,request_id=rpc.rid)
        self.assertEqual(result['state'],'prepared');self.assertEqual(rpc.count('prepare'),1)
        self.assertEqual(rpc.count('claim'),0);self.assertEqual(rpc.count('apply'),0)

    def test_source_drift_after_winning_claim_sends_no_apply(self):
        c=candidate();rpc=Custody(c)
        def observe():
            if rpc.state=='claimed':raise HostedDataPlaneError('pending_source_input_changed')
            return c
        changing=replace(c,reobserve=observe)
        result=op.submit_once(changing,transport=rpc,request_id=rpc.rid)
        self.assertEqual(result['state'],'claimed');self.assertFalse(result['sourceStillCurrent'])
        self.assertEqual(rpc.count('apply'),0)

    def test_prepare_binding_response_drift_never_claims_or_redirects(self):
        for field in ('requestId','bindingSha','created'):
            c=candidate();rpc=Custody(c)
            def transport(action,body):
                result=rpc(action,body)
                if action=='prepare':result[field]=str(uuid.uuid4()) if field=='requestId' else 'f'*64 if field=='bindingSha' else True
                return result
            r=op.submit_once(c,transport=transport,request_id=rpc.rid)
            self.assertEqual(r['requestId'],rpc.rid);self.assertEqual(r['state'],'prepared')
            self.assertEqual(rpc.count('claim'),0)

    def test_lost_apply_ack_reconciles_original_and_never_resends(self):
        c=candidate();rpc=Custody(c);rpc.drop_ack='apply'
        result=op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertEqual(result['state'],'committed')
        before=len(rpc.calls);op.submit_once(c,transport=rpc,request_id=rpc.rid)
        self.assertTrue(all(a=='read' for a,_ in rpc.calls[before:]));self.assertEqual(rpc.count('apply'),1)

    def test_failed_or_missing_original_read_cannot_create_replacement(self):
        c=candidate();rid=str(uuid.uuid4())
        for failed in (False,True):
            calls=[]
            def transport(action,body):
                calls.append(action)
                if failed:raise TimeoutError('read unknown')
                return None
            result=op.submit_once(c,transport=transport,request_id=rid)
            self.assertEqual(result['state'],'unconfirmed');self.assertTrue(all(a=='read' for a in calls))

    def test_prepared_discovery_does_not_suppress_evaluator_input_admission(self):
        from backend.bin import evaluate_new_youtube_videos as evaluator
        c=candidate();rpc=Custody(c)
        with tempfile.TemporaryDirectory() as d, patch.object(evaluator,'REPO_ROOT',Path(d)), \
             patch.object(evaluator,'assert_hosted_target'),patch.object(evaluator,'fetch_hosted_restaurant_snapshot',return_value=([],[VIDEO])), \
             patch.object(evaluator,'_fresh_locally_evaluated_ids',return_value=set()),patch.object(evaluator,'_permanent_no_transcript_ids',return_value=set()), \
             patch.object(evaluator,'_load_urls',return_value=['https://youtu.be/'+VIDEO]),patch.object(evaluator,'_write_urls'), \
             patch.object(evaluator,'_run',return_value=0) as run,patch.object(op,'current_source_revision',return_value=REV), \
             patch.object(op,'rpc_transport',side_effect=lambda action,body,**kw:rpc(action,body)),redirect_stdout(io.StringIO()) as output:
            self.assertEqual(evaluator.main(['--limit','1','--dry-run']),0)
        self.assertIn('newVideoCount=1',output.getvalue());self.assertEqual(run.call_count,1)
        self.assertTrue(all(a=='read' for a,_ in rpc.calls))

    def test_discovery_binding_drift_is_readonly_before_prepare(self):
        c=candidate();rpc=Custody(c)
        def transport(action,body):
            value=rpc(action,body)
            if action=='read' and 'request_id' in body:value['bindingSha']='f'*64
            return value
        self.assertEqual(apply(c,transport)['reflection']['unresolved'],[VIDEO])
        self.assertEqual(rpc.count('prepare'),0);self.assertEqual(rpc.count('claim'),0)

    def test_nonboolean_or_wrong_state_claim_ack_cannot_authorize_apply(self):
        for reply in ({'claimed':'true','state':'claimed'},{'claimed':True,'state':'prepared'}):
            c=candidate();rpc=Custody(c)
            def transport(action,body):
                result=rpc(action,body)
                return reply if action=='claim' else result
            r=op.submit_once(c,transport=transport,request_id=rpc.rid)
            self.assertEqual(r['state'],'claimed');self.assertEqual(rpc.count('apply'),0)

    def test_old_client_commit_between_discovery_and_resume_is_present_not_new_apply(self):
        c=candidate();rpc=Custody(c);once=[]
        def before(action,body):
            if action=='read' and 'request_id' in body and not once:
                once.append(True);rpc.state='committed';rpc.restaurant_rows=2
        rpc.before=before
        result=apply(c,rpc)
        self.assertEqual(result['reflection'],{'applied':[],'skippedAlreadyPresent':[VIDEO],'unresolved':[]})
        self.assertEqual(rpc.count('prepare'),0);self.assertEqual(rpc.count('apply'),0)

    def test_prepared_recovery_uses_existing_three_set_attempt_limit(self):
        videos=['video00000'+str(i) for i in range(4)];sets={};stores={}
        for video in videos:
            c=candidate();rows=[{**r,'youtube_link':'https://youtu.be/'+video} for r in c.rows]
            c=replace(c,rows=rows,fingerprint=preview_hash({'revision':c.revision,'freshness':c.freshness,'rows':rows}))
            c=replace(c,reobserve=lambda c=c:c);sets[video]=c;stores[video]=Custody(c)
        def transport(action,body):
            if action=='read' and 'video_ids' in body:store=stores[body['video_ids'][0]]
            else:store=next(r for r in stores.values() if r.rid==body['request_id'])
            return store(action,body)
        with patch.object(op,'admit_current_candidate_set',side_effect=lambda **kw:sets[kw['videos'][0]]):
            result=op.apply_current_sets(evaluation='.',crawling='.',channel='tzuyang',revision=REV,environment={},
                videos=videos,transport=transport,expected_payloads=[r for c in sets.values() for r in c.rows])
        self.assertEqual(result['reflection']['applied'],videos[:3]);self.assertEqual(result['reflection']['unresolved'],videos[3:])
        self.assertEqual(sum(r.count('apply') for r in stores.values()),3)
        self.assertEqual(stores[videos[3]].state,'prepared');self.assertEqual(stores[videos[3]].count('prepare'),0)

    def test_old_source_prepared_holds_only_its_video_in_batched_discovery(self):
        c=candidate();blocked=Custody(c).record();blocked['sourceRevision']='f'*40
        other='fixturevid2';done=Custody(c,'committed').record()
        for row in done['currentRows']:row['video']=other
        answer=op.observe_deliveries([VIDEO,other],revision=REV,transport=lambda *args:{'videos':[VIDEO,other],
            'legacyHeld':[],'operations':[blocked,done],'replayAllowed':False})
        self.assertEqual(answer[VIDEO]['state'],'held');self.assertEqual(answer[other]['state'],'delivered_snapshot')

if __name__=='__main__':unittest.main()
