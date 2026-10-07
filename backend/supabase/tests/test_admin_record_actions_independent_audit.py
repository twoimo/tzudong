"""Independent characterizations, not release acceptance tests.

Uses the author's isolated fixture, then replaces equality-only extensions with
real pg_trgm/pgcrypto, installs canonical identity index/functions and selected
actual review RLS. JSON-claims mode models PostgREST without its legacy GUC.
Only run on a disposable, task-owned PG17 cluster. No hosted I/O.
"""
import json
import os
import re
import unittest
import uuid

from psycopg2.extras import Json
from backend.supabase.tests import test_admin_record_actions as author


@unittest.skipUnless(os.environ.get('TZUDONG_RECORD_INDEPENDENT_AUDIT') == '1', 'owned audit cluster required')
class IndependentAudit(unittest.TestCase):
    cleanup = classmethod(author.AdminRecordActions.cleanup.__func__)
    scalar = author.AdminRecordActions.scalar
    good = author.AdminRecordActions.good
    setUp = author.AdminRecordActions.setUp
    insert = author.AdminRecordActions.insert
    row = author.AdminRecordActions.row
    changes = author.AdminRecordActions.changes
    preview = author.AdminRecordActions.preview
    apply = author.AdminRecordActions.apply
    submission = author.AdminRecordActions.submission
    review = author.AdminRecordActions.review

    @classmethod
    def setUpClass(cls):
        if not os.environ['TZUDONG_TEST_PG_SOCKET'].startswith('/tmp/tz-rec-audit-'):
            raise RuntimeError('unique task-owned Unix socket required')
        author.AdminRecordActions.setUpClass.__func__(cls)
        with cls.conn.cursor() as c:
            c.execute('DROP FUNCTION extensions.similarity(text,text); DROP FUNCTION extensions.digest(text,text); CREATE EXTENSION pg_trgm SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;')
            identity = (author.M / '20260417_prevent_active_restaurant_identity_duplicates.sql').read_text()
            # Fixture used different parameter names; SQL replacement must preserve them.
            for name, signature in [('extract_youtube_video_id', 'text'), ('normalize_restaurant_identity_name', 'text'), ('resolve_restaurant_identity_name', 'text,text,text,text')]:
                source = re.search(r'create or replace function public\.' + name + r'\(.*?\$\$;', identity, re.S).group()
                args = re.search(r'\((.*?)\)\s*returns', source, re.S).group(1)
                params = [p.strip().split()[0] for p in args.split(',')]
                for index, param in enumerate(params, 1):
                    source = re.sub(r'\b' + param + r'\b', '$' + str(index), source)
                source = re.sub(r'\(.*?\)\s*returns', '(' + signature + ')\nreturns', source, count=1, flags=re.S)
                c.execute(source)
            index = re.search(r'create unique index.*?;', identity, re.S | re.I).group()
            c.execute(index)
            c.execute((author.M / '20260410_add_admin_review_merge_rpc.sql').read_text())
            bridge = (author.M / '20260804000500_g041_auth_workflow_bridge.sql').read_text()
            c.execute(re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.g041_current_claim_user_id\(\).*?\$function\$;', bridge, re.S).group())
            # Apply the exact G041 auth.uid() transformation to three legacy bodies.
            for sig in ['public.approve_submission_item(uuid,uuid,jsonb)', 'public.approve_edit_submission_item(uuid,uuid,jsonb)', 'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)']:
                c.execute('SELECT pg_get_functiondef(%s::regprocedure)', (sig,))
                c.execute(c.fetchone()[0].replace('auth.uid()', 'privacy_retention.g041_current_claim_user_id()'))
            c.execute("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;")
            baseline = (author.ROOT / 'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
            c.execute('ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT ON public.reviews TO authenticated; GRANT USAGE ON SCHEMA auth TO authenticated;')
            for name in ['Users can insert own reviews', 'Reviews are viewable by everyone']:
                c.execute(re.search(r'CREATE POLICY "' + name + r'".*?;', baseline, re.S).group())

    def call(self, phase, action=None, ids=None, payload=None, op=None, preview=None,
             actor=None, conn=None, role='service_role', modern=False):
        con = conn or self.conn
        with con.cursor() as c:
            c.execute('SET ROLE ' + role)
            c.execute('SELECT set_config(%s,%s,false),set_config(%s,%s,false)',
                      ('request.jwt.claim.role', '' if modern else 'service_role',
                       'request.jwt.claims', json.dumps({'role': role})))
            try:
                c.execute('SELECT public.admin_record_action(%s,%s,%s,%s,%s::uuid[],%s,%s)',
                          (actor or self.actor, phase, op or str(uuid.uuid4()), action, ids or [], Json(payload or {}), preview))
                return c.fetchone()[0]
            finally:
                c.execute('RESET ROLE')

    def test_real_extensions_and_index_are_present(self):
        self.assertGreater(self.scalar("SELECT extensions.similarity('synthetic business address','synthetic business addresses')"), .8)
        self.assertIsNotNone(self.scalar("SELECT to_regclass('public.idx_restaurants_active_video_identity')"))
        self.assertEqual(self.scalar("SELECT extversion FROM pg_extension WHERE extname='pg_trgm'"), '1.6')

    def test_repro_json_claims_reject_both_submission_approval_types(self):
        for kind in ['new', 'edit']:
            self.setUp()
            target = self.insert() if kind == 'edit' else None
            sid, items = self.submission(kind, [target['id']] if target else [None])
            payload = {'items': [{'id': items[0], 'decision': 'approve', 'changes': self.changes()}]}
            p = self.preview('submission.approve', payload=payload, ids=[sid])
            with self.assertRaisesRegex(self.driver.Error, 'SUBMISSION_CONFLICT'):
                self.call('apply', p['action'], p['targetIds'], payload, p['operationId'], p['previewHash'], modern=True)
            self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 0)
            self.assertEqual(self.apply(p, payload)['state'], 'applied')

    def test_repro_fuzzy_address_rejection_hidden_by_equality_stub(self):
        row = self.good()
        row.update(approved_name='unrelated restaurant', youtube_link='https://www.youtube.com/watch?v=XXXXXXXXXXX', jibun_address='1234567890 common synthetic business street number 10')
        self.insert(row)
        sid, items = self.submission(targets=[None])
        changes = self.changes()
        changes['jibun_address'] = row['jibun_address'] + 'A'
        self.assertGreater(self.scalar('SELECT extensions.similarity(%s,%s)', (row['jibun_address'], changes['jibun_address'])), .9)
        payload = {'items': [{'id': items[0], 'decision': 'approve', 'changes': changes}]}
        p = self.preview('submission.approve', payload=payload, ids=[sid])
        with self.assertRaisesRegex(self.driver.Error, 'SUBMISSION_CONFLICT'):
            self.apply(p, payload)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'), 1)

    def test_repro_edit_omitted_phone_erases_admin_value(self):
        row = self.good()
        row.update(phone='02-1111-2222', updated_by_admin_id=self.actor, youtube_meta={'title': 'saved title', 'operator_marker': 'preserve'})
        self.insert(row)
        sid, items = self.submission('edit', [row['id']])
        changes = self.changes()  # phone omitted by a valid DTO
        payload = {'items': [{'id': items[0], 'decision': 'approve', 'changes': changes}]}
        self.apply(self.preview('submission.approve', payload=payload, ids=[sid]), payload)
        updated = self.row(row['id'])
        self.assertIsNone(updated['phone'])
        self.assertNotIn('operator_marker', updated['youtube_meta'])
        self.assertEqual(updated['evaluation_results'], row['evaluation_results'])

    def test_repro_group_video_swap_rejects_valid_final_identity(self):
        a = self.insert()
        b = self.good()
        b['youtube_link'] = 'https://www.youtube.com/watch?v=ZZZZZZZZZZZ'
        self.insert(b)
        payload = {'changes': {'phone': '02-1234-5678'}, 'perTargetChanges': [
            {'id': a['id'], 'changes': {'youtube_link': b['youtube_link']}},
            {'id': b['id'], 'changes': {'youtube_link': a['youtube_link']}}]}
        p = self.preview('restaurant.edit', payload=payload, ids=[a['id'], b['id']])
        with self.assertRaisesRegex(self.driver.Error, 'DUPLICATE'):
            self.apply(p, payload)
        self.assertEqual(self.row(a['id'])['youtube_link'], a['youtube_link'])

    def test_repro_incomplete_pending_row_cannot_save_partial_repair(self):
        row = self.good()
        row.update(lat=None, lng=None, geocoding_success=False)
        self.insert(row)
        payload = {'changes': {'phone': '02-1234-5678'}}
        p = self.preview('restaurant.edit', row, payload)
        with self.assertRaisesRegex(self.driver.Error, 'INVALID_RESTAURANT'):
            self.apply(p, payload)

    def test_repro_crawler_row_without_approved_name_passes_evidence_but_cannot_approve(self):
        row = self.good()
        row['approved_name'] = None
        self.insert(row)
        self.assertEqual(self.scalar('SELECT pipeline_control.restaurant_review_decision(%s)', (Json(row),)), 'approve:all_checks_passed')
        p = self.preview('restaurant.approve', row)
        with self.assertRaisesRegex(self.driver.Error, 'INVALID_RESTAURANT'):
            self.apply(p)
        self.assertEqual(self.row(row['id'])['status'], 'pending')

    def test_repro_merge_empty_target_supported_by_old_rpc_only(self):
        source = self.insert()
        target = self.good()
        target.update(approved_name='target', youtube_link=None, tzuyang_review=None, youtube_meta=None)
        self.insert(target)
        with self.conn.cursor() as c:
            c.execute('UPDATE public.restaurants SET updated_at=now() WHERE id=%s', (target['id'],))
        payload = {'mergeTargetId': target['id']}
        p = self.preview('restaurant.merge', payload=payload, ids=[source['id'], target['id']])
        with self.assertRaisesRegex(self.driver.Error, 'INVALID_RESTAURANT'):
            self.apply(p, payload)
        with self.conn.cursor() as c:
            c.execute("SET request.jwt.claim.role='service_role'")
            c.execute('SELECT * FROM public.merge_restaurant_records_for_admin_review(%s,%s,%s,(SELECT updated_at FROM public.restaurants WHERE id=%s),%s,%s,%s,%s)',
                      (target['id'], source['id'], self.actor, target['id'], source['youtube_link'], Json({'title': 'source title'}), source['tzuyang_review'], '분식'))
            self.assertTrue(c.fetchone()[0])
        self.assertEqual(self.row(target['id'])['youtube_link'], source['youtube_link'])
        self.assertIn('분식', self.row(target['id'])['categories'])

    def test_repro_reference_can_arrive_after_cleanup_claim_via_actual_rls(self):
        row = self.insert()
        rid, photo = self.review(row)
        payload = {'reason': 'fixture'}
        p = self.preview('review.delete', payload=payload, ids=[rid])
        self.apply(p, payload)
        job = self.call('cleanup_read', op=p['operationId'])['jobs'][0]
        self.call('cleanup_claim', op=p['operationId'], payload={'jobId': job['id']})
        with self.conn.cursor() as c:
            c.execute('SET ROLE authenticated')
            c.execute('SELECT set_config(%s,%s,false)', ('request.jwt.claims', json.dumps({'sub': photo.split('/')[0], 'role': 'authenticated'})))
            try:
                c.execute("INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES(%s,%s,%s,'fixture','synthetic review content',now(),%s)",
                          (str(uuid.uuid4()), photo.split('/')[0], row['id'], photo))
            finally:
                c.execute('RESET ROLE')
        self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews WHERE verification_photo=%s', (photo,)), 1)
        # No guard is consulted between claim and storage.remove in the TS helper.
        self.assertEqual(self.scalar('SELECT state FROM pipeline_control.admin_record_media_cleanup WHERE id=%s', (job['id'],)), 'inflight')

    def test_service_rpc_rejects_browser_actor_forgery_even_with_admin_id(self):
        row = self.insert()
        with self.assertRaises(self.driver.Error):
            self.call('preview', 'restaurant.approve', [row['id']], actor=self.actor, role='authenticated')

    def test_same_operation_ack_loss_and_minimal_audit_control(self):
        author.AdminRecordActions.test_approval_lost_ack_same_uuid_once_preserves_evidence_and_minimal_audit(self)

    def test_actor_payload_and_concurrent_row_cas_control(self):
        author.AdminRecordActions.test_payload_actor_and_stale_fingerprint_rejected(self)

    def test_concurrent_same_uuid_control(self):
        author.AdminRecordActions.test_concurrent_same_uuid_has_single_audit(self)

    def test_external_photo_does_not_prevent_database_delete(self):
        row = self.insert()
        rid, _ = self.review(row)
        with self.conn.cursor() as c:
            c.execute('UPDATE public.reviews SET verification_photo=%s WHERE id=%s', ('https://external.invalid/photo.jpg', rid))
        payload = {'reason': 'fixture'}
        p = self.preview('review.delete', payload=payload, ids=[rid])
        receipt = self.apply(p, payload)
        self.assertEqual(receipt['state'], 'applied')
        self.assertTrue(receipt['mediaCleanupPending'])
        self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'), 0)
        self.assertEqual(self.call('cleanup_read', op=p['operationId'])['jobs'], [])

    def test_repro_verified_count_overrides_original_total_count_trigger(self):
        baseline = (author.ROOT / 'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
        with self.conn.cursor() as c:
            c.execute('CREATE TABLE public.user_stats(user_id uuid,review_count integer,verified_review_count integer,trust_score integer,last_updated timestamptz)')
            c.execute(re.search(r'CREATE FUNCTION public.update_user_stats_on_review\(\).*?\$\$;', baseline, re.S).group())
            c.execute(re.search(r'CREATE TRIGGER trigger_update_user_stats .*?;', baseline, re.S).group())
        try:
            row = self.insert()
            first, _ = self.review(row)
            self.review(row)
            self.assertEqual(self.row(row['id'])['review_count'], 2)
            self.apply(self.preview('review.approve', payload={}, ids=[first]))
            self.assertEqual(self.row(row['id'])['review_count'], 1)
            self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews'), 2)
        finally:
            with self.conn.cursor() as c:
                c.execute('DROP TRIGGER trigger_update_user_stats ON public.reviews; DROP FUNCTION public.update_user_stats_on_review(); DROP TABLE public.user_stats;')


if __name__ == '__main__':
    unittest.main()
