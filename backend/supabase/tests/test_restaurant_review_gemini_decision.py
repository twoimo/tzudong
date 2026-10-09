"""Real PG17 execution in a unique disposable database; no provider/network calls."""
import copy
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from backend.supabase.tests.test_restaurant_review_identity import ReviewIdentityTests, ROOT

MIGRATIONS = ROOT / 'backend/supabase/migrations'
APPROVAL_CODES = ['visit_supported', 'identity_supported', 'review_grounded',
                  'category_supported', 'location_corroborated', 'source_consistent']


@unittest.skipUnless(os.environ.get('TZUDONG_REVIEW_GEMINI_LOCAL_PG') == '1', 'owned PG fixture opt-in required')
class ReviewGeminiTests(unittest.TestCase):
    cleanup = classmethod(ReviewIdentityTests.cleanup.__func__)
    scalar = ReviewIdentityTests.scalar
    good = ReviewIdentityTests.good

    @classmethod
    def setUpClass(cls):
        ReviewIdentityTests.setUpClass.__func__(cls)
        with cls.conn.cursor() as c:
            c.execute('SHOW server_version')
            assert c.fetchone()[0].startswith('17.6'), 'pinned fixture PG required'
            c.execute("CREATE TABLE pipeline_control.admin_evaluation_catalog_revision(singleton boolean); INSERT INTO pipeline_control.admin_evaluation_catalog_revision VALUES(true); CREATE FUNCTION public.admin_evaluation_revision() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture'::text $$;")
            for name in ['20261003171449_restaurant_review_manual_guards.sql', '20261003193717_restaurant_review_claim_progress.sql', '20261004120000_restaurant_review_gemini_decision.sql']:
                c.execute((MIGRATIONS / name).read_text())

    def setUp(self):
        self.operator = str(uuid.uuid4())
        with self.conn.cursor() as c:
            c.execute('TRUNCATE pipeline_control.restaurant_review_items,pipeline_control.restaurant_review_runs,public.restaurants,public.user_roles,public.user_account_status,pipeline_control.restaurant_review_policy_events')
            c.execute("INSERT INTO public.user_roles VALUES(%s,'admin'); INSERT INTO public.user_account_status VALUES(%s,'active')", (self.operator, self.operator))
            c.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=true,operator_id=%s,version=1,batch_size=50,daily_limit=50', (self.operator,))

    def insert(self, row=None):
        from psycopg2.extras import Json
        row = row or self.good()
        with self.conn.cursor() as c:
            c.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)', (Json(row),))
        return row

    def rpc(self, action=None, item=None, result=None, token=None, connection=None):
        from psycopg2.extras import Json
        connection = connection or self.conn
        with connection.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                if action is None:
                    c.execute('SELECT public.restaurant_review_automation_tick(%s)', (str(uuid.uuid4()),))
                elif action == 'status':
                    c.execute('SELECT public.restaurant_review_automation_status()')
                else:
                    c.execute('SELECT public.restaurant_review_automation_worker(%s,%s,%s,%s)',
                              (action, item and item['id'], token or (item and item['_token']) or str(uuid.uuid4()), Json(result or {})))
                return c.fetchone()[0]
            finally:
                c.execute('RESET ROLE')

    def claim(self):
        token = str(uuid.uuid4())
        item = self.rpc('claim', token=token)
        if item:
            item['_token'] = token
        return item

    def payload(self, item, recommendation='approve'):
        return {'evaluation_results': copy.deepcopy(item['restaurant']['evaluation_results']), 'gemini_decision': {
            'schemaVersion': 1, 'model': 'gemini-3.8-flash', 'modelVersion': 'gemini-3.8-flash',
            'promptVersion': 'restaurant-review-v1', 'inputSha256': item['decisionContext']['inputSha256'],
            'promptSha256': 'a' * 64, 'recommendation': recommendation,
            'evidenceCodes': APPROVAL_CODES if recommendation == 'approve' else ['insufficient_evidence']}}

    def queued(self, row=None):
        row = self.insert(row)
        run = self.rpc()
        self.assertEqual(run['approved'], 0)
        item = self.claim()
        self.assertIsNotNone(item)
        return item

    def status(self, row_id):
        return self.scalar('SELECT status FROM public.restaurants WHERE id=%s', (row_id,))

    def test_tick_never_approves_without_recommendation(self):
        item = self.queued()
        self.assertEqual(self.status(item['restaurant']['id']), 'pending')
        self.assertEqual(self.rpc('complete', item, {'evaluation_results': item['restaurant']['evaluation_results']}), {'state': 'failed'})
        self.assertEqual(self.status(item['restaurant']['id']), 'pending')
        self.assertEqual(self.rpc('read', item)['reason'], 'gemini_decision_invalid')
        self.assertEqual(self.rpc()['scanned'], 0)

    def test_valid_approval_preserves_real_evidence_but_minimizes_judgment_ledger(self):
        item = self.queued()
        payload = self.payload(item)
        payload['evaluation_results']['visit_authenticity']['eval_basis'] = '00:12 fixture menu order and branch identification support actual visit'
        result = self.rpc('complete', item, payload)
        self.assertEqual(result['geminiDecision']['outcome'], 'approve')
        self.assertEqual(self.status(item['restaurant']['id']), 'approved')
        self.assertEqual(self.rpc('complete', item, payload), {'state': 'applied'})
        self.assertEqual(self.scalar('SELECT sum(approved) FROM pipeline_control.restaurant_review_runs'), 1)
        self.assertEqual(self.rpc('read', item)['state'], 'applied')
        snapshot = self.rpc('status')
        self.assertEqual(snapshot['judgmentEngine'], {'provider':'gemini', 'model':'gemini-3.8-flash', 'promptVersion':'restaurant-review-v1', 'requiredForApproval':True, 'maxCallsPerClaim':1})
        self.assertNotIn('worker_token', snapshot['items'][0])
        self.assertNotIn('fingerprint', snapshot['items'][0])
        self.assertNotIn('fixture menu order', str(snapshot))
        persisted=self.scalar('SELECT evaluation_results FROM public.restaurants WHERE id=%s', (item['restaurant']['id'],))
        self.assertEqual(persisted,payload['evaluation_results'])
        self.assertNotEqual(persisted['visit_authenticity']['eval_basis'],item['restaurant']['evaluation_results']['visit_authenticity']['eval_basis'])
        self.assertNotIn('structured_evaluation:',str(persisted))

    def test_malformed_or_unbound_recommendations_fail_closed(self):
        for patch in [{'model':'gemini-3.7-flash'}, {'modelVersion':'unknown'}, {'inputSha256':'b'*64}, {'promptSha256':''},
                      {'schemaVersion':True}, {'confidence':1}, {'evidenceCodes':[]}, {'evidenceCodes':APPROVAL_CODES+['PRIVATE']},
                      {'evidenceCodes':APPROVAL_CODES+APPROVAL_CODES}, {'recommendation':'delete'}, {'evidenceCodes':['visit_supported']}]:
            with self.subTest(patch=patch):
                self.setUp()
                item = self.queued()
                payload = self.payload(item)
                payload['gemini_decision'].update(patch)
                self.assertEqual(self.rpc('complete', item, payload)['state'], 'failed')
                self.assertEqual(self.status(item['restaurant']['id']), 'pending')

    def test_gemini_approve_cannot_bypass_any_server_family(self):
        changes = [('visit_authenticity', 'eval_value', 0), ('rb_inference_score','eval_value',2),
                   ('rb_grounding_TF','eval_value',False), ('review_faithfulness_score','eval_value',0.5),
                   ('category_validity_TF','eval_value',False), ('category_TF','eval_value',False),
                   ('location_match_TF','eval_value',False), ('location_match_TF','origin_name','another business'),
                   ('location_match_TF','evidence_families',['source_geo','llm_verification']),
                   ('rb_grounding_TF','eval_basis','-')]
        for metric, key, value in changes:
            with self.subTest(metric=metric,key=key):
                self.setUp()
                item = self.queued()
                payload = self.payload(item)
                payload['evaluation_results'][metric][key] = value
                result = self.rpc('complete',item,payload)
                self.assertNotEqual(result['geminiDecision']['outcome'],'approve')
                self.assertNotEqual(self.status(item['restaurant']['id']),'approved')
                self.assertEqual(self.scalar('SELECT sum(approved) FROM pipeline_control.restaurant_review_runs'),0)
        for patch in [{'lat':None}, {'lng':181}, {'lat':91}, {'geocoding_success':False}, {'categories':['unknown']}, {'categories':[]}]:
            with self.subTest(patch=patch):
                self.setUp(); item=self.queued()
                self.rpc('complete',item,{**self.payload(item),**patch})
                self.assertNotEqual(self.status(item['restaurant']['id']),'approved')

    def test_late_duplicate_is_rechecked_at_commit(self):
        item = self.queued()
        duplicate = self.good()
        duplicate['status'] = 'approved'
        self.insert(duplicate)
        result = self.rpc('complete',item,self.payload(item))
        self.assertEqual(result['reason'],'duplicate_requires_review')
        self.assertEqual(self.status(item['restaurant']['id']),'hold')

    def test_admin_source_policy_and_stop_guards(self):
        for change in ['admin','author','source','policy','stop','operator']:
            with self.subTest(change=change):
                self.setUp();item=self.queued()
                with self.conn.cursor() as c:
                    if change=='admin':c.execute('UPDATE public.restaurants SET updated_by_admin_id=%s WHERE id=%s',(self.operator,item['restaurant']['id']))
                    elif change=='author':c.execute('UPDATE public.restaurants SET created_by=%s WHERE id=%s',(self.operator,item['restaurant']['id']))
                    elif change=='source':c.execute("UPDATE public.restaurants SET tzuyang_review='changed' WHERE id=%s",(item['restaurant']['id'],))
                    elif change=='policy':c.execute('UPDATE pipeline_control.restaurant_review_policy SET version=version+1')
                    elif change=='stop':c.execute("SELECT public.restaurant_review_automation_configure(%s,'stop','1',NULL,NULL,NULL)",(self.operator,))
                    else:c.execute("UPDATE public.user_account_status SET account_status='blocked'")
                if change=='operator':
                    with self.assertRaisesRegex(self.driver.Error,'OPERATOR_INVALID'):self.rpc('complete',item,self.payload(item))
                else:
                    result=self.rpc('complete',item,self.payload(item))
                    self.assertTrue(result.get('disabled') or result.get('state')=='cancelled')
                self.assertEqual(self.status(item['restaurant']['id']),'pending')
                self.assertEqual(self.scalar('SELECT evaluation_results FROM public.restaurants WHERE id=%s',(item['restaurant']['id'],)),item['restaurant']['evaluation_results'])

    def test_hold_or_recheck_never_approves_and_does_not_loop(self):
        for recommendation in ['hold','recheck']:
            self.setUp();item=self.queued()
            result=self.rpc('complete',item,self.payload(item,recommendation))
            self.assertEqual(result['geminiDecision']['outcome'],recommendation)
            self.assertEqual(self.status(item['restaurant']['id']),'hold' if recommendation=='hold' else 'pending')
            self.assertEqual(self.rpc()['scanned'],0)
            self.assertIsNone(self.claim())

    def test_daily_limit_defers_and_reuses_judgment_without_second_claim(self):
        with self.conn.cursor() as c:c.execute('UPDATE pipeline_control.restaurant_review_policy SET daily_limit=1')
        self.insert()
        row=self.good()
        for key in ['origin_name','naver_name','approved_name']:row[key]='other fixture branch'
        row['evaluation_results']['location_match_TF']['origin_name']=row['origin_name']
        self.insert(row)
        self.assertEqual(self.rpc()['recheck'],2)
        first=self.claim();self.rpc('complete',first,self.payload(first))
        second=self.claim();result=self.rpc('complete',second,self.payload(second))
        self.assertEqual(result['geminiDecision']['outcome'],'deferred')
        self.assertEqual(self.status(second['restaurant']['id']),'pending')
        self.assertEqual(self.rpc()['scanned'],0)
        with self.conn.cursor() as c:c.execute("UPDATE pipeline_control.restaurant_review_items SET finished_at=now()-interval '2 days' WHERE id=%s",(first['id'],))
        self.assertEqual(self.rpc()['approved'],1)
        self.assertEqual(self.status(second['restaurant']['id']),'approved')
        self.assertIsNone(self.claim())
        self.assertEqual(self.rpc('read',second)['geminiDecision']['outcome'],'approve')

    def test_parallel_completion_counts_once_and_only_one_claim_runs(self):
        item=self.queued()
        self.assertIsNone(self.claim())
        def complete(_):
            connection=self.driver.connect(dbname=self.db,**self.params);connection.autocommit=True
            try:return self.rpc('complete',item,self.payload(item),connection=connection)
            finally:connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(complete,range(2)))
        self.assertEqual([r['state'] for r in results],['applied','applied'])
        self.assertEqual(self.scalar('SELECT sum(approved) FROM pipeline_control.restaurant_review_runs'),1)

    def test_expired_or_uncertain_work_never_automatically_retries(self):
        for code in ['gemini_result_uncertain','gemini_decision_invalid','gemini_decision_incomplete','expired']:
            self.setUp();item=self.queued()
            if code=='expired':
                with self.conn.cursor() as c:c.execute("UPDATE pipeline_control.restaurant_review_items SET lease_until=now()-interval '1 second' WHERE id=%s",(item['id'],))
                self.assertIsNone(self.claim())
            else:self.rpc('fail',item,{'code':code})
            self.assertEqual(self.rpc()['scanned'],0)
            self.assertIsNone(self.claim())
            self.assertEqual(self.status(item['restaurant']['id']),'pending')

    def test_rpc_acl_invoker_and_timeout_contract(self):
        for signature in ['public.restaurant_review_automation_tick(uuid)', 'public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)',
                          'public.restaurant_review_automation_status()', 'pipeline_control.restaurant_review_gemini_valid(jsonb,text)']:
            with self.conn.cursor() as c:
                c.execute("SELECT pg_get_userbyid(proowner),prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE'),has_function_privilege('authenticated',oid,'EXECUTE'),has_function_privilege('service_role',oid,'EXECUTE') FROM pg_proc WHERE oid=%s::regprocedure",(signature,))
                owner,definer,config,anon,authenticated,service=c.fetchone()
                self.assertEqual((owner,definer,anon,authenticated,service),('postgres',False,False,False,True))
                self.assertIn('search_path=""',config)
                if 'tick' in signature or 'worker' in signature:self.assertIn('lock_timeout=2s',config)


if __name__=='__main__':unittest.main()
