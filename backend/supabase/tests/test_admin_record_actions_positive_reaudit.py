"""Positive regression audit, separate from the historical bug characterizations.

Requires an explicitly received source-ready SQL SHA and owned PG17 socket.
Current UI builders execute through a Bun adapter with synthetic metadata only.
This exercises SQL/RLS/object-metadata boundaries, not Supabase Storage HTTP/S3.
"""
import copy
import hashlib
import json
import os
import re
import subprocess
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from psycopg2.extras import Json
from backend.supabase.tests import test_admin_record_actions as author
from backend.supabase.tests import test_admin_record_actions_independent_audit as audit


@unittest.skipUnless(os.environ.get('TZUDONG_RECORD_POSITIVE_REAUDIT') == '1', 'source-ready audit opt-in required')
class PositiveReaudit(unittest.TestCase):
    cleanup = classmethod(audit.IndependentAudit.cleanup.__func__)
    scalar = audit.IndependentAudit.scalar
    good = audit.IndependentAudit.good
    insert = audit.IndependentAudit.insert
    row = audit.IndependentAudit.row
    changes = audit.IndependentAudit.changes
    preview = audit.IndependentAudit.preview
    apply = audit.IndependentAudit.apply
    submission = audit.IndependentAudit.submission
    review = audit.IndependentAudit.review

    @classmethod
    def setUpClass(cls):
        ready = os.environ.get('TZUDONG_RECORD_READY_SQL_SHA', '')
        actual = hashlib.sha256(author.SOURCE.read_bytes()).hexdigest()
        if not re.fullmatch('[a-f0-9]{64}', ready) or ready != actual:
            raise RuntimeError('received source-ready SQL SHA required and must match before fixture execution')
        cls.source_sha = actual
        cls.ui_files = [author.ROOT / path for path in [
            'apps/web/lib/admin/record-action-contract.ts', 'apps/web/lib/admin/evaluation-record-actions.ts',
            'apps/web/components/admin/AdminRestaurantModal.tsx', 'apps/web/components/admin/EditRestaurantModal.tsx',
            'apps/web/scripts/audit-admin-record-action-payloads.ts']]
        cls.ui_hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in cls.ui_files}
        audit.IndependentAudit.setUpClass.__func__(cls)
        baseline = (author.ROOT / 'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
        with cls.conn.cursor() as c:
            # Owned fixture cluster only; model actual non-login legacy workflow ownership.
            c.execute("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner') THEN CREATE ROLE privacy_workflow_owner NOLOGIN; END IF; END $$")
            c.execute('GRANT USAGE ON SCHEMA public,privacy_retention,extensions,auth TO privacy_workflow_owner; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO privacy_workflow_owner')
            for sig in ['public.approve_submission_item(uuid,uuid,jsonb)', 'public.approve_edit_submission_item(uuid,uuid,jsonb)', 'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)']:
                c.execute('ALTER FUNCTION '+sig+' OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION '+sig+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+sig+' TO service_role')
            c.execute('CREATE TABLE public.user_stats(user_id uuid,review_count integer,verified_review_count integer,trust_score integer,last_updated timestamptz)')
            c.execute(re.search(r'CREATE FUNCTION public.update_user_stats_on_review\(\).*?\$\$;', baseline, re.S).group())
            c.execute(re.search(r'CREATE TRIGGER trigger_update_user_stats .*?;', baseline, re.S).group())

    def setUp(self):
        self.assertEqual(hashlib.sha256(author.SOURCE.read_bytes()).hexdigest(), self.source_sha, 'SQL changed after source-ready receipt')
        for path, sha in self.ui_hashes.items():
            self.assertEqual(hashlib.sha256(Path(path).read_bytes()).hexdigest(), sha, 'UI changed during audit; recollect inputs')
        author.AdminRecordActions.setUp(self)
        with self.conn.cursor() as c:
            c.execute('TRUNCATE public.user_stats')

    def call(self, *args, **kwargs):
        return audit.IndependentAudit.call(self, *args, **{**kwargs, 'modern': True})

    def ui(self, mode, value):
        result = subprocess.run(
            ['/Users/twoimo/.bun/bin/bun', 'scripts/audit-admin-record-action-payloads.ts'],
            input=json.dumps({'mode': mode, 'value': value}), text=True, capture_output=True, timeout=15,
            cwd=author.ROOT / 'apps/web', check=True)
        return json.loads(result.stdout)

    def apply_ui(self, request):
        p = self.preview(request['action'], ids=request['targetIds'], payload=request['payload'])
        result = self.apply(p, request['payload'])
        self.assertEqual(self.call('readback', op=p['operationId']), result)
        return p, result

    def form(self, rows):
        row = rows[0]
        return {'name': row.get('approved_name') or row['origin_name'], 'phone': row.get('phone') or '',
                'categories': row.get('categories') or [], 'searchAddress': row.get('jibun_address') or '',
                'road_address': row.get('road_address') or '', 'jibun_address': row.get('jibun_address') or '',
                'english_address': row.get('english_address') or '', 'address_elements': row.get('address_elements'),
                'lat': '' if row.get('lat') is None else str(row['lat']),
                'lng': '' if row.get('lng') is None else str(row['lng']),
                'youtube_link': row.get('youtube_link') or '', 'tzuyang_review': row.get('tzuyang_review') or '',
                'youtube_reviews': [{'id': x['id'], 'youtube_link': x.get('youtube_link') or '', 'tzuyang_review': x.get('tzuyang_review') or ''} for x in rows]}

    def test_json_claims_normal_ui_new_and_edit_submission(self):
        for kind in ['new', 'edit']:
            self.setUp()
            row = self.insert() if kind == 'edit' else self.good()
            if kind == 'edit':
                with self.conn.cursor() as c:
                    c.execute('UPDATE public.restaurants SET youtube_meta=%s WHERE id=%s', (Json({'operator_marker': 'preserve', 'duration': 42}), row['id']))
            sid, items = self.submission(kind, [row['id']] if kind == 'edit' else [None])
            submission = {'id': sid, 'submission_type': kind, 'items': [{'id': items[0], 'item_status': 'pending', 'youtube_link': row['youtube_link']}]}
            request = self.ui('submission', {'submission': submission, 'approvalData': {
                'lat': '37.5', 'lng': '127', 'jibun_address': row['jibun_address'], 'road_address': '', 'english_address': '', 'address_elements': {}},
                'forceApprove': False, 'editableData': {'name': row['approved_name'], 'phone': '02-1234-5678', 'address': row['jibun_address'], 'categories': ['한식']},
                'itemDecisions': {items[0]: {'approved': True, 'tzuyang_review': row['tzuyang_review'], 'youtube_link': row['youtube_link'],
                    'metaData': {'title': 'synthetic video', 'publishedAt': '2026-10-01', 'duration': 42, 'is_shorts': False, 'ads_info': {'is_ads': False, 'what_ads': None}}}}})
            _, receipt = self.apply_ui(request)
            target = self.scalar('SELECT target_restaurant_id::text FROM public.restaurant_submission_items WHERE id=%s', (items[0],))
            self.assertEqual(self.row(target)['phone'], '02-1234-5678')
            self.assertEqual(self.scalar("SELECT current_setting('request.jwt.claim.role',true)"), '')
            self.assertEqual(receipt['state'], 'applied')
            if kind == 'edit':
                self.assertEqual(self.row(target)['youtube_meta']['operator_marker'], 'preserve')
                self.assertEqual(self.row(target)['evaluation_results'], row['evaluation_results'])

    def test_edit_submission_omission_preserves_and_explicit_clear_is_intentional(self):
        row = self.good(); row.update(phone='02-1111-2222', youtube_meta={'title': 'saved', 'operator_marker': 'keep'}, updated_by_admin_id=self.actor)
        self.insert(row)
        for patch, phone in [({'youtube_meta': {'title': 'new'}}, row['phone']), ({'phone': None}, None)]:
            sid, items = self.submission('edit', [row['id']])
            request = self.ui('parse', {'action': 'submission.approve', 'targetIds': [sid], 'payload': {'items': [{'id': items[0], 'decision': 'approve', 'changes': patch}]}})
            self.apply_ui(request)
            updated = self.row(row['id'])
            self.assertEqual(updated['phone'], phone)
            self.assertEqual(updated['youtube_meta']['operator_marker'], 'keep')
            self.assertEqual(updated['evaluation_results'], row['evaluation_results'])

    def test_partial_edit_from_actual_edit_modal_preserves_incomplete_row(self):
        row = self.good(); row.update(approved_name=None, lat=None, lng=None, geocoding_success=False, youtube_link='https://youtu.be/ABCDEFGHIJK')
        self.insert(row); initial = self.form([row]); form = copy.deepcopy(initial); form['phone'] = '02-1234-5678'
        request = self.ui('edit', {'id': row['id'], 'formData': form, 'initialForm': initial, 'selectedGeocodingIndex': None, 'geocodingResults': [], 'geocodingDirty': False, 'forApproval': False})
        self.assertEqual(request['payload'], {'changes': {'phone': '02-1234-5678'}})
        self.apply_ui(request); updated = self.row(row['id'])
        self.assertEqual(updated['phone'], '02-1234-5678'); self.assertIsNone(updated['lat'])
        self.assertEqual(updated['youtube_link'], row['youtube_link']); self.assertEqual(updated['status'], 'pending')

    def test_approve_crawler_name_and_normal_edit_modal_payload(self):
        row = self.good(); row['approved_name'] = None; self.insert(row)
        form = self.form([row])
        request = self.ui('edit', {'id': row['id'], 'formData': form, 'initialForm': form,
            'selectedGeocodingIndex': 0, 'geocodingResults': [{'road_address': '', 'jibun_address': row['jibun_address'], 'english_address': '', 'address_elements': {}, 'x': '127', 'y': '37.5'}],
            'geocodingDirty': False, 'forApproval': True})
        self.apply_ui(request); self.assertEqual(self.row(row['id'])['approved_name'], row['origin_name']); self.assertEqual(self.row(row['id'])['status'], 'approved')

    def test_actual_group_modal_empty_common_changes_swaps_video_ids_atomically(self):
        a = self.insert(); b = self.good(); b['youtube_link'] = 'https://www.youtube.com/watch?v=ZZZZZZZZZZZ'; self.insert(b)
        initial = self.form([a, b]); form = copy.deepcopy(initial)
        form['youtube_reviews'][0]['youtube_link'], form['youtube_reviews'][1]['youtube_link'] = b['youtube_link'], a['youtube_link']
        request = self.ui('modal', {'restaurant': {**a, 'mergedRestaurants': [b]}, 'formData': form, 'initialForm': initial})
        self.assertEqual(request['payload']['changes'], {})
        self.apply_ui(request)
        self.assertEqual(self.row(a['id'])['youtube_link'], b['youtube_link']); self.assertEqual(self.row(b['id'])['youtube_link'], a['youtube_link'])

    def test_actual_create_modal_multiple_videos_returns_all_created_ids(self):
        rows = [self.good() for _ in range(3)]
        for row, video in zip(rows, ['ABCDEFGHIJK', 'ZZZZZZZZZZZ', 'YYYYYYYYYYY']):
            row.update(id='new-' + video, youtube_link='https://www.youtube.com/watch?v=' + video)
        form = self.form(rows)
        request = self.ui('modal', {'formData': form, 'meta': {'title': 'synthetic title', 'duration': 12}})
        self.assertEqual(len(request['payload']['additions']), 2)
        p, receipt = self.apply_ui(request)
        self.assertEqual(len(receipt['targetIds']), 3)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.restaurants'), 3)
        self.assertEqual(self.apply(p, request['payload']), receipt)
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 1)

    def test_cross_video_merge_keeps_both_videos_and_evaluation(self):
        a = self.insert(); b = self.good(); b.update(approved_name='target business', phone='02-1234-5678', youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ'); self.insert(b)
        request = self.ui('parse', {'action': 'restaurant.merge', 'targetIds': [a['id'], b['id']], 'payload': {'mergeTargetId': b['id'], 'incomingChanges': {'tzuyang_review': 'reviewed source correction'}}})
        self.apply_ui(request)
        source, target = self.row(a['id']), self.row(b['id'])
        self.assertNotEqual(source['status'], 'deleted'); self.assertEqual(source['youtube_link'], a['youtube_link'])
        self.assertEqual(target['youtube_link'], b['youtube_link']); self.assertEqual(source['approved_name'], b['approved_name'])
        self.assertEqual(source['tzuyang_review'], 'reviewed source correction')
        self.assertEqual(source['evaluation_results'], a['evaluation_results']); self.assertEqual(target['evaluation_results'], b['evaluation_results'])

    def test_merge_missing_target_supplements_metadata_without_overwriting_admin_title(self):
        a = self.good(); a.update(youtube_meta={'title': 'source', 'published_at': '2026-10-01'}, categories=['분식']); self.insert(a)
        b = self.good(); b.update(approved_name='target business', youtube_link=None, tzuyang_review=None, youtube_meta={'title': 'admin title'}, categories=['한식']); self.insert(b)
        request = self.ui('parse', {'action': 'restaurant.merge', 'targetIds': [a['id'], b['id']], 'payload': {'mergeTargetId': b['id']}})
        self.apply_ui(request); target = self.row(b['id'])
        self.assertEqual(target['youtube_link'], a['youtube_link']); self.assertEqual(target['tzuyang_review'], a['tzuyang_review'])
        self.assertEqual(target['youtube_meta'], {'title': 'admin title', 'published_at': '2026-10-01'})
        self.assertEqual(set(target['categories']), {'한식', '분식'}); self.assertEqual(self.row(a['id'])['status'], 'deleted')

    def test_review_count_parity_with_actual_trigger(self):
        row = self.insert(); first, _ = self.review(row); self.review(row)
        self.assertEqual(self.row(row['id'])['review_count'], 2)
        self.apply(self.preview('review.approve', ids=[first], payload={}))
        self.assertEqual(self.row(row['id'])['review_count'], 2)
        self.apply(self.preview('review.reject', ids=[first], payload={'reason': 'fixture'}), {'reason': 'fixture'})
        self.assertEqual(self.row(row['id'])['review_count'], 2)
        self.apply(self.preview('review.delete', ids=[first], payload={'reason': 'fixture'}), {'reason': 'fixture'})
        self.assertEqual(self.row(row['id'])['review_count'], 1)

    def test_cleanup_claim_fences_new_reference_and_object_replacement(self):
        row = self.insert(); rid, photo = self.review(row); payload = {'reason': 'fixture'}
        p = self.preview('review.delete', ids=[rid], payload=payload); self.apply(p, payload)
        job = self.call('cleanup_read', op=p['operationId'])['jobs'][0]
        self.assertTrue(self.call('cleanup_claim', op=p['operationId'], payload={'jobId': job['id']})['claimed'])
        with self.conn.cursor() as c:
            c.execute('SET ROLE authenticated')
            c.execute('SELECT set_config(%s,%s,false)', ('request.jwt.claims', json.dumps({'sub': photo.split('/')[0], 'role': 'authenticated'})))
            try:
                with self.assertRaisesRegex(self.driver.Error, 'MEDIA_RETIRED'):
                    c.execute("INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES(%s,%s,%s,'fixture','synthetic review',now(),%s)", (str(uuid.uuid4()), photo.split('/')[0], row['id'], photo))
            finally:
                c.execute('RESET ROLE')
            with self.assertRaisesRegex(self.driver.Error, 'MEDIA_RETIRED'):
                c.execute("UPDATE storage.objects SET version='replacement' WHERE name=%s", (photo,))
        self.call('cleanup_uncertain', op=p['operationId'], payload={'jobId': job['id']})
        with self.assertRaisesRegex(self.driver.Error, 'STATE_CONFLICT'):
            self.call('cleanup_claim', op=p['operationId'], payload={'jobId': job['id']})

    def test_changed_storage_object_after_preview_rejects_delete(self):
        row = self.insert(); rid, photo = self.review(row); payload = {'reason': 'fixture'}
        p = self.preview('review.delete', ids=[rid], payload=payload)
        with self.conn.cursor() as c:
            c.execute("UPDATE storage.objects SET version='replacement' WHERE name=%s", (photo,))
        with self.assertRaisesRegex(self.driver.Error, 'STALE'):
            self.apply(p, payload)
        self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews WHERE id=%s', (rid,)), 1)

    def wait_for_block(self, pid):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if self.scalar('SELECT cardinality(pg_blocking_pids(%s))>0', (pid,)):
                return
            time.sleep(.01)
        self.fail('independent fixture did not reach expected lock boundary')

    def test_concurrent_reference_waits_for_claim_then_observes_committed_fence(self):
        row = self.insert(); rid, photo = self.review(row); payload = {'reason': 'fixture'}
        p = self.preview('review.delete', ids=[rid], payload=payload); self.apply(p, payload)
        job = self.call('cleanup_read', op=p['operationId'])['jobs'][0]
        claim_conn = self.driver.connect(dbname=self.db, **self.params)
        write_conn = self.driver.connect(dbname=self.db, **self.params); write_conn.autocommit = True
        with write_conn.cursor() as c:
            c.execute('SELECT pg_backend_pid()'); writer_pid = c.fetchone()[0]
            c.execute('SET ROLE authenticated')
            c.execute('SELECT set_config(%s,%s,false)', ('request.jwt.claims', json.dumps({'sub': photo.split('/')[0], 'role': 'authenticated'})))
        def insert_reference():
            try:
                with write_conn.cursor() as c:
                    c.execute("INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES(%s,%s,%s,'fixture','synthetic review',now(),%s)", (str(uuid.uuid4()), photo.split('/')[0], row['id'], photo))
                return 'inserted'
            except self.driver.Error as error:
                return error.diag.message_primary
        try:
            self.assertTrue(self.call('cleanup_claim', op=p['operationId'], payload={'jobId': job['id']}, conn=claim_conn)['claimed'])
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(insert_reference)
                try:
                    self.wait_for_block(writer_pid)
                finally:
                    claim_conn.commit()
                self.assertEqual(future.result(timeout=3), 'RECORD_ACTION_MEDIA_RETIRED')
            self.assertEqual(self.scalar('SELECT count(*) FROM public.reviews WHERE verification_photo=%s', (photo,)), 0)
        finally:
            claim_conn.rollback(); claim_conn.close(); write_conn.close()

    def test_concurrent_object_replacement_before_claim_is_preserved(self):
        row = self.insert(); rid, photo = self.review(row); payload = {'reason': 'fixture'}
        p = self.preview('review.delete', ids=[rid], payload=payload); self.apply(p, payload)
        job = self.call('cleanup_read', op=p['operationId'])['jobs'][0]
        upload_conn = self.driver.connect(dbname=self.db, **self.params)
        claim_conn = self.driver.connect(dbname=self.db, **self.params); claim_conn.autocommit = True
        try:
            with upload_conn.cursor() as c:
                c.execute("UPDATE storage.objects SET version='new-before-claim' WHERE name=%s", (photo,))
            with claim_conn.cursor() as c:
                c.execute('SELECT pg_backend_pid()'); claimant_pid = c.fetchone()[0]
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.call, 'cleanup_claim', op=p['operationId'], payload={'jobId': job['id']}, conn=claim_conn)
                try:
                    self.wait_for_block(claimant_pid)
                finally:
                    upload_conn.commit()
                self.assertFalse(future.result(timeout=3)['claimed'])
            receipt = self.call('readback', op=p['operationId'])
            self.assertFalse(receipt['mediaCleanupPending']); self.assertTrue(receipt['mediaCleanupUnmanaged'])
            self.assertEqual(self.scalar('SELECT version FROM storage.objects WHERE name=%s', (photo,)), 'new-before-claim')
        finally:
            upload_conn.rollback(); upload_conn.close(); claim_conn.close()

    def test_real_fuzzy_duplicate_reports_domain_conflict(self):
        a = self.good(); a.update(approved_name='other restaurant', youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ', jibun_address='1234567890 common synthetic business street number 10'); self.insert(a)
        sid, items = self.submission(targets=[None]); changes = self.changes(); changes['jibun_address'] = a['jibun_address'] + 'A'
        self.assertGreater(self.scalar('SELECT extensions.similarity(%s,%s)', (a['jibun_address'], changes['jibun_address'])), .9)
        payload = {'items': [{'id': items[0], 'decision': 'approve', 'changes': changes}]}
        p = self.preview('submission.approve', ids=[sid], payload=payload)
        with self.assertRaisesRegex(self.driver.Error, 'DUPLICATE_REVIEW'):
            self.apply(p, payload)
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 0)

    def test_cas_idempotency_and_actor_controls(self):
        author.AdminRecordActions.test_approval_lost_ack_same_uuid_once_preserves_evidence_and_minimal_audit(self)
        self.setUp(); author.AdminRecordActions.test_payload_actor_and_stale_fingerprint_rejected(self)
        self.setUp(); author.AdminRecordActions.test_concurrent_same_uuid_has_single_audit(self)
        row = self.insert({**self.good(), 'approved_name': 'separate restaurant'})
        with self.assertRaises(self.driver.Error):
            self.call('preview', 'restaurant.approve', [row['id']], role='authenticated')


if __name__ == '__main__':
    unittest.main()
