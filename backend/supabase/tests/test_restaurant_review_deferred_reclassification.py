"""Deferred judgment regressions against an isolated PG17.6 database only."""
import copy
import uuid
from backend.supabase.tests.test_restaurant_review_gemini_decision import ReviewGeminiTests, MIGRATIONS

FORWARD = MIGRATIONS / '20261004172622_restaurant_review_deferred_reclassification.sql'
TICK = 'public.restaurant_review_automation_tick(uuid)'


class DeferredReviewTests(ReviewGeminiTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with cls.conn.cursor() as c:
            c.execute('SELECT pg_get_functiondef(%s::regprocedure)', (TICK,))
            cls.old_definition = c.fetchone()[0]
            c.execute(FORWARD.read_text())

    def deferred(self, count=1):
        with self.conn.cursor() as c:
            c.execute('UPDATE pipeline_control.restaurant_review_policy SET daily_limit=1')
        for index in range(count + 1):
            row = self.good()
            for name in ['origin_name', 'naver_name', 'approved_name']:
                row[name] = 'fixture branch ' + str(index)
            row['evaluation_results']['location_match_TF']['origin_name'] = row['origin_name']
            self.insert(row)
        self.assertEqual(count + 1, self.rpc()['recheck'])
        first = self.claim()
        self.assertEqual('applied', self.rpc('complete', first, self.payload(first))['state'])
        items = []
        for _ in range(count):
            item = self.claim()
            payload = self.payload(item)
            payload['evaluation_results']['visit_authenticity']['eval_basis'] = 'reevaluated fixture evidence'
            result = self.rpc('complete', item, payload)
            self.assertEqual('deferred', result['geminiDecision']['outcome'])
            items.append(item)
        self.assertIsNone(self.claim())
        return first, items

    def duplicate(self, item):
        row = copy.deepcopy(item['restaurant'])
        row.update(id=str(uuid.uuid4()), trace_id=uuid.uuid4().hex, status='approved')
        return self.insert(row)

    def tick(self, request):
        with self.conn.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT public.restaurant_review_automation_tick(%s)', (request,))
                return c.fetchone()[0]
            finally:
                c.execute('RESET ROLE')

    def catalog(self):
        return self.scalar("SELECT to_jsonb(p) FROM pg_proc p WHERE oid=%s::regprocedure", (TICK,))

    def test_original_reproduces_stuck_pending_and_forward_applies_current_hold(self):
        # Reproduce the reported failure with the actual applied function, then
        # rerun identical catalog/input conditions with the guarded forward fix.
        for original in [True, False]:
            with self.subTest(original=original):
                self.setUp()
                with self.conn.cursor() as c:
                    if original: c.execute(self.old_definition)
                    else: c.execute(FORWARD.read_text())
                _, items = self.deferred()
                item = items[0]
                self.duplicate(item)
                request = str(uuid.uuid4())
                run = self.tick(request)
                self.assertEqual(run, self.tick(request))
                result = self.rpc('read', item)
                if original:
                    self.assertEqual('cancelled', result['state'])
                    self.assertEqual('pending', self.status(item['restaurant']['id']))
                    self.assertEqual(0, self.rpc()['scanned'])
                else:
                    self.assertEqual((1, 0, 0), (run['held'], run['approved'], run['recheck']))
                    self.assertEqual('applied', result['state'])
                    self.assertEqual('duplicate_requires_review', result['reason'])
                    self.assertEqual('hold', result['geminiDecision']['outcome'])
                    self.assertEqual('hold', self.status(item['restaurant']['id']))
                    self.assertEqual(0, self.rpc()['scanned'])
                    self.assertIsNone(self.claim())

    def test_changed_address_queues_new_bound_input_without_using_old_approval(self):
        _, items = self.deferred()
        old = items[0]
        with self.conn.cursor() as c:
            c.execute("UPDATE public.restaurants SET jibun_address='changed fixture address' WHERE id=%s", (old['restaurant']['id'],))
            c.execute('UPDATE pipeline_control.restaurant_review_policy SET daily_limit=2')
        run = self.rpc()
        self.assertEqual((0, 1), (run['approved'], run['recheck']))
        current = self.claim()
        self.assertNotEqual(old['id'], current['id'])
        self.assertNotEqual(old['decisionContext']['inputSha256'], current['decisionContext']['inputSha256'])
        self.assertEqual('changed fixture address', current['restaurant']['jibun_address'])
        self.assertIsNone(self.claim())
        self.assertEqual('pending', self.status(old['restaurant']['id']))

    def test_catalog_recheck_retires_old_capability_and_claims_once(self):
        _, items = self.deferred()
        old = items[0]
        signature = 'pipeline_control.restaurant_review_classify(jsonb)'
        self.assertTrue(self.scalar('SELECT fingerprint<>applied_fingerprint FROM pipeline_control.restaurant_review_items WHERE id=%s', (old['id'],)))
        definition = self.scalar('SELECT pg_get_functiondef(%s::regprocedure)', (signature,))
        # A stricter catalog classifier now requires a missing basis. The row
        # and its fingerprint stay unchanged, exactly the deferred failure mode.
        changed = definition.replace("RETURN 'approve:all_checks_passed';", "RETURN 'recheck:missing_basis';")
        self.assertNotEqual(changed, definition)
        with self.conn.cursor() as c: c.execute(changed)
        try:
            self.assertEqual(1, self.rpc()['recheck'])
            self.assertEqual(0, self.rpc()['scanned'])
            with self.assertRaisesRegex(self.driver.Error, 'LEASE_INVALID'):
                self.rpc('complete', old, self.payload(old))
            current = self.claim()
            self.assertEqual(old['id'], current['id'])
            self.assertNotEqual(old['_token'], current['_token'])
            self.assertIsNone(self.claim())
            self.assertEqual(1, self.rpc('status')['judgmentEngine']['maxCallsPerClaim'])
            result = self.rpc('complete', current, self.payload(current, 'recheck'))
            self.assertEqual('recheck', result['geminiDecision']['outcome'])
            self.assertEqual(0, self.rpc()['scanned'])
            self.assertIsNone(self.claim())
        finally:
            with self.conn.cursor() as c: c.execute(definition)

    def test_maximum_daily_cap_keeps_remaining_deferred_and_reuses_without_claim(self):
        first, items = self.deferred(count=2)
        with self.conn.cursor() as c:
            c.execute('UPDATE pipeline_control.restaurant_review_policy SET daily_limit=200,batch_size=200')
            c.execute("""INSERT INTO pipeline_control.restaurant_review_items
                (run_id,restaurant_id,fingerprint,decision,reason,state,finished_at)
                SELECT run_id,gen_random_uuid(),md5(i::text),'approve','fixture','applied',now()
                FROM pipeline_control.restaurant_review_items CROSS JOIN generate_series(1,198) i WHERE id=%s""", (first['id'],))
        self.assertEqual(1, self.rpc()['approved'])
        self.assertEqual(200, self.scalar("SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE decision='approve' AND state='applied'"))
        states = [self.rpc('read', item) for item in items]
        self.assertEqual(['applied', 'succeeded'], sorted(result['state'] for result in states))
        self.assertIn('daily_limit', [result['reason'] for result in states])
        self.assertEqual(0, self.rpc()['scanned'])
        self.assertIsNone(self.claim())
        with self.conn.cursor() as c:
            c.execute("UPDATE pipeline_control.restaurant_review_items SET finished_at=now()-interval '2 days' WHERE id=%s", (first['id'],))
        self.assertEqual(1, self.rpc()['approved'])
        self.assertTrue(all(self.status(item['restaurant']['id']) == 'approved' for item in items))
        self.assertIsNone(self.claim())
        self.assertEqual(200, self.scalar("SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE decision='approve' AND state='applied' AND finished_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'"))

    def test_admin_author_and_stop_changes_are_preserved(self):
        for marker in ['updated_by_admin_id', 'created_by', 'stop']:
            with self.subTest(marker=marker):
                self.setUp(); _, items = self.deferred(); item = items[0]
                with self.conn.cursor() as c:
                    if marker == 'stop': c.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=false')
                    else: c.execute('UPDATE public.restaurants SET '+marker+'=%s WHERE id=%s', (self.operator, item['restaurant']['id']))
                before = self.scalar('SELECT to_jsonb(r) FROM public.restaurants r WHERE id=%s', (item['restaurant']['id'],))
                run = self.rpc()
                self.assertTrue(run.get('disabled') or run['protected'] == 1)
                self.assertEqual(before, self.scalar('SELECT to_jsonb(r) FROM public.restaurants r WHERE id=%s', (item['restaurant']['id'],)))
                if marker == 'stop': self.assertEqual({'disabled': True}, self.rpc('claim'))
                else: self.assertIsNone(self.claim())

    def test_patch_is_idempotent_and_rejects_body_acl_and_execution_drift_atomically(self):
        before = self.catalog()
        with self.conn.cursor() as c: c.execute(FORWARD.read_text())
        self.assertEqual(before, self.catalog())
        for mutation, code in [
            ("ALTER FUNCTION "+TICK+" SET lock_timeout='3s'", 'METADATA_DRIFT'),
            ('ALTER FUNCTION '+TICK+' SECURITY DEFINER', 'METADATA_DRIFT'),
            ('GRANT EXECUTE ON FUNCTION '+TICK+' TO anon', 'METADATA_DRIFT'),
            (self.old_definition.replace("IF request_id IS NULL", "IF request_id IS NOT NULL"), 'SOURCE_DRIFT'),
        ]:
            with self.subTest(code=code), self.conn.cursor() as c:
                c.execute('BEGIN'); c.execute(mutation)
                with self.assertRaisesRegex(self.driver.Error, 'REVIEW_DEFERRED_'+code): c.execute(FORWARD.read_text())
                c.execute('ROLLBACK')
            self.assertEqual(before, self.catalog())
