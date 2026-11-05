"""Actual PG17 component checks. A new disposable cluster only; not full G014.

Runner supplies a private Unix socket owned by this task. No hosted defaults.
"""
import copy
import json
import os
from pathlib import Path
import threading
import time
import unittest
import uuid

import psycopg2
from psycopg2.extras import Json

from backend.supabase.scripts.hosted_data_plane import pending_insert_payload

SOURCE = '028af1b9ec87630c5e8055c5668f681501b4202a'
FRESH = {'contract':'local-pipeline-candidate-set-v1','complete':True,
         'inputSha256':'1'*64,'sourceSha256':'2'*64}
VIDEO = 'fixturevid1'


def payload(name='A', trace='trace-a'):
    return pending_insert_payload({'youtube_link':'https://www.youtube.com/watch?v='+VIDEO,
      'origin_name':name,'trace_id':trace,'geocoding_success':True,'lat':1,'lng':2,
      'reasoning_basis':'synthetic public business evidence','channel_name':'tzuyang',
      'recollect_version':{'meta':1,'transcript':1}})


def connect(role='postgres', autocommit=True):
    socket = os.environ['PENDING_CUSTODY_TEST_SOCKET']
    if not socket.startswith('/private/tmp/pending-custody-'):
        raise RuntimeError('owned_socket_required')
    c=psycopg2.connect(host=socket,port=55432,user='postgres',dbname='postgres')
    c.autocommit=autocommit
    if role != 'postgres':
        with c.cursor() as q:q.execute('SET ROLE '+role)
    return c


def call(c,name,*args):
    values=[Json(x) if isinstance(x,(dict,list)) else x for x in args]
    with c.cursor() as q:
        q.execute('SELECT public.hosted_pending_'+name+'('+','.join(['%s']*len(args))+')',values)
        return q.fetchone()[0]


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.owner=connect()
        with self.owner.cursor() as q:
            q.execute('TRUNCATE pipeline_control.hosted_pending_identity_custody,pipeline_control.hosted_pending_operations,public.restaurants CASCADE')
            q.execute('DROP TRIGGER IF EXISTS test_late_failure ON public.restaurants')
            q.execute('DROP TRIGGER IF EXISTS test_sleep_commit ON public.restaurants')
        self.client=connect('service_role')
        self.addCleanup(self.owner.close);self.addCleanup(self.client.close)

    def prepared(self, rows=None,request=None,fresh=None):
        rows=rows or [payload(),payload('B','trace-b')]
        rid=request or str(uuid.uuid4())
        p=call(self.client,'prepare',rid,SOURCE,fresh or FRESH,rows)
        return rid,rows,p

    def claim(self,rid,p,sender=None):
        sender=sender or str(uuid.uuid4())
        r=call(self.client,'claim',rid,sender,p['bindingSha'])
        self.assertTrue(r['claimed'])
        return sender

    def count(self):
        with self.owner.cursor() as q:q.execute('SELECT count(*) FROM public.restaurants');return q.fetchone()[0]

    def insert(self,name='A',trace='trace-a',status='approved'):
        with self.owner.cursor() as q:
            q.execute('INSERT INTO public.restaurants(origin_name,trace_id,youtube_link,status,approved_name) VALUES(%s,%s,%s,%s,%s) RETURNING id',
                      (name,trace,payload()['youtube_link'],status,name))
            return q.fetchone()[0]

    def test_normal_multi_restaurant_atomic_and_source_bound_readback(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        result=call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(result['state'],'committed');self.assertEqual(self.count(),2)
        observed=call(self.client,'read',rid)
        self.assertTrue(observed['currentSetPresent']);self.assertFalse(observed['replayAllowed'])
        self.assertEqual(observed['sourceRevision'],SOURCE);self.assertEqual(observed['freshness'],FRESH)
        with self.owner.cursor() as q:
            q.execute('SELECT count(*) FROM public.restaurants WHERE status=%s AND channel_name=%s AND recollect_version=%s::jsonb',('pending','tzuyang',json.dumps({'meta':1,'transcript':1})))
            self.assertEqual(q.fetchone()[0],2)

    def test_existing_A_preserved_and_missing_B_inserted(self):
        existing=self.insert()
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        result=call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual([r['action'] for r in result['rows']],['present','inserted'])
        self.assertEqual(result['rows'][0]['id'],str(existing))
        with self.owner.cursor() as q:q.execute('SELECT status,approved_name FROM public.restaurants WHERE id=%s',(existing,));self.assertEqual(q.fetchone(),('approved','A'))
        self.assertEqual(self.count(),2)

    def test_same_request_or_new_request_same_binding_share_original(self):
        rid,rows,p=self.prepared()
        for other in (rid,str(uuid.uuid4())):
            again=call(self.client,'prepare',other,SOURCE,FRESH,rows)
            self.assertFalse(again['created']);self.assertEqual(again['requestId'],rid)
        sender=self.claim(rid,p)
        again=call(self.client,'claim',rid,str(uuid.uuid4()),p['bindingSha'])
        self.assertFalse(again['claimed'])
        self.assertEqual(call(self.client,'read',rid)['state'],'claimed')
        self.assertEqual(self.count(),0)

    def test_other_source_binding_reads_original_owner_and_late_presence(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        other=str(uuid.uuid4())
        held=call(self.client,'prepare',other,SOURCE,{**FRESH,'inputSha256':'b'*64},rows)
        self.assertEqual(held['state'],'held')
        read=call(self.client,'read',other)
        self.assertEqual(read['relatedRequestIds'],[rid]);self.assertFalse(read['currentSetPresent'])
        call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        read=call(self.client,'read',other)
        self.assertEqual(read['state'],'held');self.assertTrue(read['currentSetPresent'])
        self.assertFalse(read['originalRowsStillPresent']);self.assertFalse(read['replayAllowed'])
        self.assertEqual(self.count(),2)

    def test_changed_source_input_set_or_payload_rejected(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        for rev,fresh,rr in [('3'*40,FRESH,rows),(SOURCE,{**FRESH,'inputSha256':'4'*64},rows),
                              (SOURCE,FRESH,rows[:1]),(SOURCE,FRESH,[{**rows[0],'reasoning_basis':'changed'},rows[1]])]:
            with self.subTest(revision=rev,input=fresh['inputSha256'],size=len(rr)):
                with self.assertRaises(psycopg2.Error) as e:call(self.client,'prepare',rid,rev,fresh,rr)
                self.assertEqual(e.exception.pgcode,'22023')
        with self.assertRaises(psycopg2.Error):call(self.client,'apply',rid,sender,p['bindingSha'],rows[:1])
        self.assertEqual(self.count(),0)

    def test_ambiguous_or_missing_fields_and_admin_columns_rejected(self):
        for rows in ([payload(),payload(trace='new-trace')], [{**payload(),'approved_name':'forbidden'}],
                     [{**payload(),'lat':None,'geocoding_success':False}], [{**payload(),'trace_id':None}]):
            with self.subTest(rows=len(rows)):
                with self.assertRaises(psycopg2.Error) as e:self.prepared(rows)
                self.assertEqual(e.exception.pgcode,'22023')
        self.assertEqual(self.count(),0)

    def test_pending_unlocated_remains_pending_no_geocode_fabrication(self):
        r=payload();r.update(lat=None,lng=None,geocoding_success=False,evaluation_results={'location_match_TF':{'pending_reason':'insufficient_evidence','match_status':'unknown'}})
        rid,rows,p=self.prepared([r]);sender=self.claim(rid,p)
        self.assertEqual(call(self.client,'apply',rid,sender,p['bindingSha'],rows)['state'],'committed')
        with self.owner.cursor() as q:q.execute('SELECT status,lat,lng,geocoding_success FROM public.restaurants');self.assertEqual(q.fetchone(),('pending',None,None,False))

    def test_admin_rename_between_prepare_apply_holds_all(self):
        existing=self.insert()
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        with self.owner.cursor() as q:q.execute('UPDATE public.restaurants SET approved_name=%s WHERE id=%s',('Renamed',existing))
        result=call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(result['state'],'held');self.assertEqual(self.count(),1)
        self.assertEqual(call(self.client,'read',rid)['state'],'held')

    def test_late_admin_alias_prevents_old_name_reinsert(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        with self.owner.cursor() as q:
            q.execute('INSERT INTO public.restaurants(origin_name,approved_name,trace_id,youtube_link,status) VALUES(%s,%s,%s,%s,%s)',
                      ('A','Renamed','admin-trace',payload()['youtube_link'],'approved'))
        result=call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(result['state'],'held');self.assertEqual(self.count(),1)

    def test_existing_active_row_wins_over_deleted_same_identity_without_resurrection(self):
        self.insert('A','old-deleted','deleted');active=self.insert('A','active-trace','approved')
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        result=call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(result['state'],'committed')
        self.assertEqual(result['rows'][0]['id'],str(active));self.assertEqual(self.count(),3)

    def test_deleted_or_foreign_trace_holds_without_insert(self):
        for status,link in [('deleted',payload()['youtube_link']),('approved','https://youtu.be/fixturevid2')]:
            with self.subTest(status=status):
                with self.owner.cursor() as q:
                    q.execute('TRUNCATE pipeline_control.hosted_pending_identity_custody,pipeline_control.hosted_pending_operations,public.restaurants CASCADE')
                    q.execute('INSERT INTO public.restaurants(origin_name,trace_id,youtube_link,status) VALUES(%s,%s,%s,%s)',('A','trace-a',link,status))
                _,_,p=self.prepared()
                self.assertEqual(p['state'],'held');self.assertEqual(self.count(),1)

    def test_late_insert_error_rolls_back_A_and_keeps_committed_claim(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        with self.owner.cursor() as q:
            q.execute("CREATE OR REPLACE FUNCTION public.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.origin_name='B' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END$$")
            q.execute('CREATE TRIGGER test_late_failure BEFORE INSERT ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.test_fail()')
        with self.assertRaises(psycopg2.Error) as e:call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(e.exception.pgcode,'P0001');self.assertEqual(e.exception.diag.message_primary,'PENDING_APPLY_FAILED')
        self.assertEqual(self.count(),0);self.assertEqual(call(self.client,'read',rid)['state'],'claimed')
        self.assertFalse(call(self.client,'claim',rid,str(uuid.uuid4()),p['bindingSha'])['claimed'])
        different=call(self.client,'prepare',str(uuid.uuid4()),SOURCE,{**FRESH,'inputSha256':'8'*64},rows)
        self.assertEqual(different['state'],'held')

    def test_lost_ack_commit_readback_and_repeat_are_not_second_insert(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        call(self.client,'apply',rid,sender,p['bindingSha'],rows)  # caller drops returned acknowledgement
        read=call(self.client,'read',rid);self.assertEqual(read['state'],'committed')
        self.assertFalse(call(self.client,'claim',rid,str(uuid.uuid4()),p['bindingSha'])['claimed'])
        self.assertTrue(call(self.client,'apply',rid,sender,p['bindingSha'],rows)['replayed'])
        self.assertEqual(self.count(),2)
        with self.owner.cursor() as q:q.execute("UPDATE public.restaurants SET status='deleted' WHERE origin_name='B'")
        self.assertFalse(call(self.client,'read',rid)['currentSetPresent'])

    def test_client_ack_loss_uses_actual_db_custody_and_read_only_recovery(self):
        from backend.supabase.scripts.hosted_pending_operation import CandidateSet,submit_once,reconcile_request
        from backend.supabase.scripts.hosted_data_plane import preview_hash
        rows=[payload(),payload('B','trace-b')]
        fp=preview_hash({'revision':SOURCE,'freshness':FRESH,'rows':rows})
        candidate=CandidateSet(SOURCE,FRESH,rows,fp,lambda:candidate)
        calls=[]
        def transport(action,body):
            calls.append(action)
            result=call(self.client,action,*body.values())
            if action=='apply':raise TimeoutError('dropped local acknowledgement')
            return result
        result=submit_once(candidate,transport=transport)
        self.assertEqual(result['state'],'committed');self.assertEqual(self.count(),2)
        self.assertEqual(calls,['prepare','claim','apply','read'])
        calls.clear();reconcile_request(result['requestId'],transport=transport)
        self.assertEqual(calls,['read']);self.assertEqual(self.count(),2)

    def test_concurrent_claim_only_one_sender_wins(self):
        rid,_,p=self.prepared();barrier=threading.Barrier(2);out=[]
        def worker():
            with connect('service_role') as c:
                barrier.wait();out.append(call(c,'claim',rid,str(uuid.uuid4()),p['bindingSha']))
        threads=[threading.Thread(target=worker) for _ in range(2)]
        [t.start() for t in threads];[t.join(5) for t in threads]
        self.assertEqual(sorted(x['claimed'] for x in out),[False,True])

    def test_concurrent_prepare_returns_single_shared_request(self):
        barrier=threading.Barrier(2);out=[];rows=[payload(),payload('B','trace-b')]
        def worker():
            c=connect('service_role')
            try:barrier.wait();out.append(call(c,'prepare',str(uuid.uuid4()),SOURCE,FRESH,rows))
            finally:c.close()
        threads=[threading.Thread(target=worker) for _ in range(2)]
        [t.start() for t in threads];[t.join(5) for t in threads]
        self.assertEqual(len(out),2);self.assertEqual(len({x['requestId'] for x in out}),1)
        self.assertEqual(sorted(x['created'] for x in out),[False,True])

    def test_writer_lock_wait_then_recheck_and_timeout(self):
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        blocker=connect(autocommit=False);self.addCleanup(blocker.close)
        with blocker.cursor() as q:q.execute('LOCK TABLE public.restaurants IN ROW EXCLUSIVE MODE')
        with self.assertRaises(psycopg2.Error) as e:call(self.client,'apply',rid,sender,p['bindingSha'],rows)
        self.assertEqual(e.exception.pgcode,'55P03');self.assertEqual(self.count(),0)
        blocker.rollback()
        self.assertEqual(call(self.client,'read',rid)['state'],'claimed')

    def test_inflight_apply_is_claimed_until_same_transaction_commits(self):
        existing=self.insert()
        rid,rows,p=self.prepared();sender=self.claim(rid,p)
        ready=threading.Event();release=threading.Event();errors=[]
        def worker():
            c=connect('service_role',autocommit=False)
            try:
                call(c,'apply',rid,sender,p['bindingSha'],rows)
                ready.set();release.wait(5);c.commit()
            except Exception as exc:errors.append(type(exc).__name__);ready.set()
            finally:c.close()
        thread=threading.Thread(target=worker);thread.start()
        try:
            self.assertTrue(ready.wait(3));self.assertEqual(errors,[])
            self.assertEqual(self.count(),1)
            self.assertEqual(call(self.client,'read',rid)['state'],'claimed')
            with self.owner.cursor() as q:
                q.execute("SET lock_timeout='100ms'")
                with self.assertRaises(psycopg2.Error) as error:
                    q.execute('UPDATE public.restaurants SET approved_name=%s WHERE id=%s',('Renamed',existing))
                self.assertEqual(error.exception.pgcode,'55P03')
                q.execute("SET lock_timeout='0'")
        finally:release.set();thread.join(5)
        self.assertEqual(errors,[]);self.assertEqual(self.count(),2)
        self.assertEqual(call(self.client,'read',rid)['state'],'committed')

    def test_browser_and_direct_custody_dml_denied(self):
        for role in ('anon','authenticated'):
            c=connect(role);self.addCleanup(c.close)
            for name,args in [('prepare',(str(uuid.uuid4()),SOURCE,FRESH,[payload()])),('read',(str(uuid.uuid4()),))]:
                with self.assertRaises(psycopg2.Error) as e:call(c,name,*args)
                self.assertEqual(e.exception.pgcode,'42501')
        with self.client.cursor() as q:
            with self.assertRaises(psycopg2.Error) as e:q.execute('DELETE FROM pipeline_control.hosted_pending_operations')
        self.assertEqual(e.exception.pgcode,'42501')

if __name__=='__main__':unittest.main()
