"""Positive acceptance cases for the independent audit's failures.

Reuse its real pg_trgm, canonical index, G041 JSON-claim bridge and actual review
INSERT RLS. Do not inherit its intentionally failing characterizations. Storage
is synthetic metadata; no Storage HTTP, hosted DB or provider call is performed.
"""
import copy
import json
import os
import re
import unittest
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
from psycopg2.extras import Json
from backend.supabase.tests import test_admin_record_actions as author
from backend.supabase.tests import test_admin_record_actions_independent_audit as audit


@unittest.skipUnless(os.environ.get('TZUDONG_RECORD_INDEPENDENT_AUDIT') == '1', 'owned real-extension PG17 fixture required')
class RecordRegressions(unittest.TestCase):
    cleanup = classmethod(author.AdminRecordActions.cleanup.__func__)
    scalar = audit.IndependentAudit.scalar
    good = audit.IndependentAudit.good
    setUp = audit.IndependentAudit.setUp
    insert = audit.IndependentAudit.insert
    row = audit.IndependentAudit.row
    changes = audit.IndependentAudit.changes
    preview = audit.IndependentAudit.preview
    apply = audit.IndependentAudit.apply
    submission = audit.IndependentAudit.submission
    review = audit.IndependentAudit.review

    @classmethod
    def setUpClass(cls):
        audit.IndependentAudit.setUpClass.__func__(cls)
        with cls.conn.cursor() as c:
            # Actual legacy workflow owner and service-only grants, not postgres-owned RPCs.
            c.execute('GRANT USAGE ON SCHEMA public,privacy_retention,extensions,auth TO privacy_workflow_owner; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO privacy_workflow_owner')
            for sig in ['public.approve_submission_item(uuid,uuid,jsonb)', 'public.approve_edit_submission_item(uuid,uuid,jsonb)', 'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)']:
                c.execute('ALTER FUNCTION '+sig+' OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION '+sig+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+sig+' TO service_role')
            # Canonical review-count trigger, no verified-only replacement semantics.
            baseline=(author.ROOT/'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
            c.execute('CREATE TABLE public.user_stats(user_id uuid,review_count integer,verified_review_count integer,trust_score integer,last_updated timestamptz)')
            c.execute(re.search(r'CREATE FUNCTION public.update_user_stats_on_review\(\).*?\$\$;',baseline,re.S).group())
            c.execute(re.search(r'CREATE TRIGGER trigger_update_user_stats .*?;',baseline,re.S).group())

    def call(self,*args,**kwargs):
        kwargs['modern']=True
        return audit.IndependentAudit.call(self,*args,**kwargs)

    def test_real_extensions_index_and_owner_present(self):
        self.assertEqual(self.scalar("SELECT extversion FROM pg_extension WHERE extname='pg_trgm'"),'1.6')
        self.assertIsNotNone(self.scalar("SELECT to_regclass('public.idx_restaurants_active_video_identity')"))
        self.assertEqual(self.scalar("SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.approve_submission_item(uuid,uuid,jsonb)'::regprocedure"),'privacy_workflow_owner')

    def test_json_claims_approve_new_and_edit_preserve_fields_and_real_evidence(self):
        for kind in ['new','edit']:
            self.setUp()
            r=self.good();r.update(phone='02-1111-2222',updated_by_admin_id=self.actor,youtube_meta={'title':'old','operator_marker':'keep'})
            target=self.insert(r) if kind=='edit' else None
            sid,items=self.submission(kind,[target['id']] if target else [None])
            pld={'items':[{'id':items[0],'decision':'approve','changes':self.changes()}]}
            p=self.preview('submission.approve',payload=pld,ids=[sid]);result=self.apply(p,pld)
            self.assertEqual(result['state'],'applied');self.assertEqual(self.apply(p,pld),result)
            self.assertEqual(self.scalar("SELECT item_status FROM public.restaurant_submission_items WHERE id=%s",(items[0],)),'approved')
            if target:
                saved=self.row(target['id']);self.assertEqual(saved['phone'],r['phone']);self.assertEqual(saved['youtube_meta']['operator_marker'],'keep');self.assertEqual(saved['evaluation_results'],r['evaluation_results'])
            self.assertEqual(self.scalar("SELECT current_setting('request.jwt.claim.role',true)"),'')

    def test_approve_changes_null_name_uses_reviewed_name_and_preserves_evidence(self):
        r=self.good();r['approved_name']=None;self.insert(r)
        pld={'changes':{'phone':'02-1234-5678','youtube_meta':{'title':'reviewed public title'}}}
        p=self.preview('restaurant.approve',r,pld);result=self.apply(p,pld)
        saved=self.row(r['id']);self.assertEqual(saved['approved_name'],r['origin_name']);self.assertEqual(saved['status'],'approved')
        self.assertEqual(saved['evaluation_results'],r['evaluation_results']);self.assertEqual(saved['phone'],'02-1234-5678')
        self.assertEqual(self.call('readback',op=p['operationId']),result)

    def test_approval_proposal_cas_and_invalid_evidence_cannot_promote(self):
        r=self.insert();pld={'changes':{'phone':'02-1234-5678'}};p=self.preview('restaurant.approve',r,pld)
        with self.conn.cursor() as c:c.execute("UPDATE public.restaurants SET phone='02-0000-0000',updated_by_admin_id=%s WHERE id=%s",(self.actor,r['id']))
        with self.assertRaisesRegex(self.driver.Error,'STALE'):self.apply(p,pld)
        self.assertEqual(self.row(r['id'])['phone'],'02-0000-0000')
        with self.conn.cursor() as c:c.execute("UPDATE public.restaurants SET evaluation_results='{}' WHERE id=%s",(r['id'],))
        p=self.preview('restaurant.approve',r,pld)
        with self.assertRaisesRegex(self.driver.Error,'EVIDENCE_REQUIRED'):self.apply(p,pld)
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),0)

    def test_multi_create_returns_all_ids_and_repeated_ack_does_not_duplicate(self):
        a=self.changes();b=copy.deepcopy(a);b['youtube_link']='https://www.youtube.com/watch?v=ZZZZZZZZZZZ'
        pld={'changes':a,'additions':[b]};p=self.preview('restaurant.create',payload=pld,ids=[]);r=self.apply(p,pld)
        self.assertEqual(len(r['targetIds']),2);self.assertEqual(self.apply(p,pld),r);self.assertEqual(self.call('readback',op=p['operationId']),r)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'),2)
        self.assertEqual({self.row(i)['youtube_link'] for i in r['targetIds']},{a['youtube_link'],b['youtube_link']})
        self.assertTrue(all(self.row(i)['evaluation_results'] is None for i in r['targetIds']))

    def test_multi_create_failure_rolls_back_and_new_preview_can_resume(self):
        a=self.changes();b=copy.deepcopy(a);b['categories']=['invalid']
        pld={'changes':a,'additions':[b]};p=self.preview('restaurant.create',payload=pld,ids=[])
        with self.assertRaises(self.driver.Error):self.apply(p,pld)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'),0)
        pld['additions'][0]={**a,'youtube_link':'https://www.youtube.com/watch?v=ZZZZZZZZZZZ'}
        r=self.apply(self.preview('restaurant.create',payload=pld,ids=[]),pld);self.assertEqual(len(r['targetIds']),2)

    def test_group_swaps_final_identities_and_preserves_partial_incomplete_rows(self):
        a=self.insert();b=self.good();b.update(youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ',lat=None,lng=None,geocoding_success=False);self.insert(b)
        pld={'changes':{'phone':'02-1234-5678'},'perTargetChanges':[{'id':a['id'],'changes':{'youtube_link':b['youtube_link']}},{'id':b['id'],'changes':{'youtube_link':a['youtube_link']}}]}
        self.apply(self.preview('restaurant.edit',payload=pld,ids=[a['id'],b['id']]),pld)
        self.assertEqual(self.row(a['id'])['youtube_link'],b['youtube_link']);self.assertEqual(self.row(b['id'])['youtube_link'],a['youtube_link'])
        self.assertIsNone(self.row(b['id'])['lat']);self.assertEqual(self.row(b['id'])['status'],'pending');self.assertEqual(self.row(a['id'])['evaluation_results'],a['evaluation_results'])

    def test_merge_empty_target_fills_review_meta_categories_clears_source_error(self):
        a=self.good();a.update(youtube_meta={'title':'source','duration':30},categories=['분식'],db_error_message='synthetic',db_error_details={'code':'synthetic'});self.insert(a)
        b=self.good();b.update(approved_name='target',youtube_link=None,tzuyang_review=None,youtube_meta=None);self.insert(b)
        pld={'mergeTargetId':b['id'],'incomingChanges':{'youtube_meta':{'title':'reviewed source'}}}
        self.apply(self.preview('restaurant.merge',payload=pld,ids=[a['id'],b['id']]),pld)
        saved=self.row(b['id']);self.assertEqual(saved['youtube_link'],a['youtube_link']);self.assertEqual(saved['tzuyang_review'],a['tzuyang_review']);self.assertEqual(saved['youtube_meta']['title'],'reviewed source');self.assertIn('분식',saved['categories']);self.assertIn('한식',saved['categories'])
        self.assertEqual(saved['evaluation_results'],b['evaluation_results']);self.assertEqual(self.row(a['id'])['status'],'deleted');self.assertIsNone(self.row(a['id'])['db_error_message'])

    def test_cross_video_merge_preserves_each_video_and_other_link_cas(self):
        a=self.good();a.update(youtube_meta={'title':'source'},tzuyang_review='source review');self.insert(a)
        b=self.good();b.update(approved_name='target',youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ',phone='02-9999-9999',youtube_meta={'title':'target'});self.insert(b)
        link=copy.deepcopy(b);link.update(id=str(uuid.uuid4()),trace_id=uuid.uuid4().hex,youtube_link='https://www.youtube.com/watch?v=YYYYYYYYYYY');self.insert(link)
        pld={'mergeTargetId':b['id'],'incomingChanges':{'categories':['분식'],'youtube_meta':{'title':'source edited'}}}
        p=self.preview('restaurant.merge',payload=pld,ids=[a['id'],b['id']]);self.assertIn(link['id'],[x['id'] for x in p['readback']])
        with self.conn.cursor() as c:c.execute("UPDATE public.restaurants SET phone='02-1111-1111' WHERE id=%s",(link['id'],))
        with self.assertRaisesRegex(self.driver.Error,'STALE'):self.apply(p,pld)
        p=self.preview('restaurant.merge',payload=pld,ids=[a['id'],b['id']]);r=self.apply(p,pld)
        self.assertEqual(self.row(a['id'])['youtube_link'],a['youtube_link']);self.assertEqual(self.row(b['id'])['youtube_link'],b['youtube_link']);self.assertEqual(self.row(link['id'])['youtube_link'],link['youtube_link'])
        self.assertEqual(self.row(a['id'])['youtube_meta']['title'],'source edited');self.assertEqual(self.row(b['id'])['youtube_meta']['title'],'target');self.assertEqual(self.row(a['id'])['tzuyang_review'],'source review')
        self.assertEqual(self.row(a['id'])['phone'],b['phone']);self.assertEqual(self.row(a['id'])['status'],'pending');self.assertEqual(self.row(a['id'])['evaluation_results'],a['evaluation_results']);self.assertEqual(self.apply(p,pld),r)

    def test_real_fuzzy_neighbor_returns_domain_conflict_and_keeps_rows(self):
        a=self.good();a.update(approved_name='unrelated',youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ',jibun_address='1234567890 synthetic business street number 10');self.insert(a)
        sid,items=self.submission(targets=[None]);changes=self.changes();changes['jibun_address']=a['jibun_address']+'A'
        self.assertGreater(self.scalar('SELECT extensions.similarity(%s,%s)',(a['jibun_address'],changes['jibun_address'])),.9)
        pld={'items':[{'id':items[0],'decision':'approve','changes':changes}]};p=self.preview('submission.approve',payload=pld,ids=[sid])
        with self.assertRaisesRegex(self.driver.Error,'DUPLICATE_REVIEW'):self.apply(p,pld)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'),1);self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'),0)

    def test_actual_review_trigger_keeps_total_count_across_moderation_and_delete(self):
        a=self.insert();first,_=self.review(a);self.review(a);self.assertEqual(self.row(a['id'])['review_count'],2)
        self.apply(self.preview('review.approve',payload={},ids=[first]));self.assertEqual(self.row(a['id'])['review_count'],2)
        pld={'reason':'fixture'};self.apply(self.preview('review.reject',payload=pld,ids=[first]),pld);self.assertEqual(self.row(a['id'])['review_count'],2)
        self.apply(self.preview('review.delete',payload=pld,ids=[first]),pld);self.assertEqual(self.row(a['id'])['review_count'],1)

    def delete_photo(self):
        a=self.insert();rid,path=self.review(a);pld={'reason':'fixture'};p=self.preview('review.delete',payload=pld,ids=[rid]);self.apply(p,pld)
        job=self.call('cleanup_read',op=p['operationId'])['jobs'][0]
        return a,path,p,job

    def insert_reference_as_owner(self,a,path,conn=None):
        with (conn or self.conn).cursor() as c:
            c.execute('SET ROLE authenticated');c.execute('SELECT set_config(%s,%s,false)',('request.jwt.claims',json.dumps({'sub':path.split('/')[0],'role':'authenticated'})))
            try:c.execute("INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES(%s,%s,%s,'fixture','synthetic review content',now(),%s)",(str(uuid.uuid4()),path.split('/')[0],a['id'],path))
            finally:c.execute('RESET ROLE')

    def test_live_reference_after_claim_rejected_by_actual_insert_rls_and_fence(self):
        a,path,p,job=self.delete_photo();self.assertTrue(self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']})['claimed'])
        with self.assertRaisesRegex(self.driver.Error,'MEDIA_RETIRED'):self.insert_reference_as_owner(a,path)
        with self.conn.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                with self.assertRaisesRegex(self.driver.Error,'MEDIA_RETIRED'):c.execute("UPDATE storage.objects SET version='v2' WHERE name=%s",(path,))
            finally:c.execute('RESET ROLE')
        self.assertEqual(self.scalar('SELECT version FROM storage.objects WHERE name=%s',(path,)),'v1')

    def test_reference_before_claim_is_protected_and_new_path_remains_usable(self):
        a,path,p,job=self.delete_photo();self.insert_reference_as_owner(a,path)
        self.assertFalse(self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']})['claimed'])
        receipt=self.call('readback',op=p['operationId']);self.assertFalse(receipt['mediaCleanupPending']);self.assertTrue(receipt['mediaCleanupUnmanaged'])
        self.assertEqual(self.scalar('SELECT count(*) FROM storage.objects WHERE name=%s',(path,)),1)
        self.insert_reference_as_owner(a,path.replace('fixture.jpg','new.jpg'))

    def test_changed_object_before_claim_is_preserved_and_never_removed(self):
        _,path,p,job=self.delete_photo()
        with self.conn.cursor() as c:c.execute("UPDATE storage.objects SET version='new-version' WHERE name=%s",(path,))
        self.assertFalse(self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']})['claimed'])
        self.assertEqual(self.scalar('SELECT version FROM storage.objects WHERE name=%s',(path,)),'new-version')
        self.assertTrue(self.call('readback',op=p['operationId'])['mediaCleanupUnmanaged'])

    def test_deleted_path_cannot_be_reused_after_lost_ack_and_confirmed_absence(self):
        a,path,p,job=self.delete_photo();self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']})
        with self.conn.cursor() as c:c.execute('DELETE FROM storage.objects WHERE name=%s',(path,))
        self.call('cleanup_absent',op=p['operationId'],payload={'jobId':job['id']})
        self.assertFalse(self.call('readback',op=p['operationId'])['mediaCleanupPending'])
        with self.conn.cursor() as c:
            with self.assertRaisesRegex(self.driver.Error,'MEDIA_RETIRED'):c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('review-photos',%s)",(path,))
        with self.assertRaisesRegex(self.driver.Error,'MEDIA_RETIRED'):self.insert_reference_as_owner(a,path)

    def test_object_changed_after_preview_fails_cas_without_deleting_review(self):
        a=self.insert();rid,path=self.review(a);pld={'reason':'fixture'};p=self.preview('review.delete',payload=pld,ids=[rid])
        with self.conn.cursor() as c:c.execute("UPDATE storage.objects SET version='new-version' WHERE name=%s",(path,))
        with self.assertRaisesRegex(self.driver.Error,'STALE'):self.apply(p,pld)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews WHERE id=%s',(rid,)),1)
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_media_cleanup'),0)

    def wait_for_advisory_waiter(self,pid):
        deadline=time.monotonic()+2
        while time.monotonic()<deadline:
            if self.scalar("SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=%s",(pid,)):return
            time.sleep(.01)
        self.fail('concurrent connection did not reach the path fence')

    def test_concurrent_claim_then_insert_waits_and_rejects_after_commit(self):
        a,path,p,job=self.delete_photo()
        winner=self.driver.connect(dbname=self.db,**self.params);winner.autocommit=False
        loser=self.driver.connect(dbname=self.db,**self.params);loser.autocommit=True
        try:
            self.call('cleanup_claim',op=p['operationId'],payload={'jobId':job['id']},conn=winner)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(self.insert_reference_as_owner,a,path,loser)
                try:self.wait_for_advisory_waiter(loser.get_backend_pid())
                finally:winner.commit()
                with self.assertRaisesRegex(self.driver.Error,'MEDIA_RETIRED'):future.result(timeout=3)
            self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'),0)
        finally:winner.close();loser.close()

    def test_concurrent_insert_then_claim_preserves_committed_live_reference(self):
        a,path,p,job=self.delete_photo()
        winner=self.driver.connect(dbname=self.db,**self.params);winner.autocommit=False
        loser=self.driver.connect(dbname=self.db,**self.params);loser.autocommit=True
        try:
            self.insert_reference_as_owner(a,path,winner)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(self.call,'cleanup_claim',op=p['operationId'],payload={'jobId':job['id']},conn=loser)
                try:self.wait_for_advisory_waiter(loser.get_backend_pid())
                finally:winner.commit()
                self.assertFalse(future.result(timeout=3)['claimed'])
            self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'),1)
        finally:winner.close();loser.close()

    def test_external_asset_db_delete_is_successful_without_actionable_cleanup(self):
        a=self.insert();rid,_=self.review(a,legacy=True)
        with self.conn.cursor() as c:c.execute('UPDATE public.reviews SET verification_photo=%s WHERE id=%s',('https://external.invalid/file.jpg',rid))
        pld={'reason':'fixture'};p=self.preview('review.delete',payload=pld,ids=[rid]);r=self.apply(p,pld)
        self.assertEqual(r['state'],'applied');self.assertFalse(r['mediaCleanupPending']);self.assertTrue(r['mediaCleanupUnmanaged']);self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'),0)

    def test_actor_forgery_cas_and_lost_ack_positive_controls(self):
        a=self.insert()
        with self.assertRaises(self.driver.Error):self.call('preview','restaurant.approve',[a['id']],role='authenticated')
        self.setUp();author.AdminRecordActions.test_approval_lost_ack_same_uuid_once_preserves_evidence_and_minimal_audit(self)
        self.setUp();author.AdminRecordActions.test_payload_actor_and_stale_fingerprint_rejected(self)
        self.setUp();author.AdminRecordActions.test_concurrent_same_uuid_has_single_audit(self)


if __name__=='__main__':unittest.main()
