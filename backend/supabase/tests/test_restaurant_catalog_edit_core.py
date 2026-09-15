"""Atomic edit behavior in a disposable PG17, with no published network ports."""
import json
from concurrent.futures import ThreadPoolExecutor
import os
import re
from pathlib import Path
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'backend/supabase/candidates/restaurant_catalog_edit_core.sql'
IMAGE = 'pgvector/pgvector@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f'
ACTOR = '11111111-1111-4111-8111-111111111111'
RESTAURANT = '22222222-2222-4222-8222-222222222222'
OPERATION = '33333333-3333-4333-8333-333333333333'
PATCH = '{"approved_name":"Edited restaurant"}'


@unittest.skipUnless(os.environ.get('TZUDONG_CATALOG_EDIT_LOCAL_PG') == '1', 'disposable PG17 opt-in required')
class AtomicCatalogEdit(unittest.TestCase):
    @classmethod
    def docker(cls, *args, input=None):
        return subprocess.run(['docker', *args], input=input, text=True, capture_output=True, timeout=45)

    @classmethod
    def setUpClass(cls):
        cls.container = 'catalog-edit-test-' + uuid.uuid4().hex[:12]
        result = cls.docker('run', '--rm', '-d', '--network', 'none', '--name', cls.container,
                            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE)
        if result.returncode:
            raise AssertionError('private_pg_start_failed')
        cls.addClassCleanup(cls.docker, 'rm', '-f', cls.container)
        for _ in range(150):
            if cls.docker('exec', cls.container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').returncode == 0:
                break
            time.sleep(.1)
        else:
            raise AssertionError('private_pg_ready_failed')
        cls.database = 'postgres'
        result = cls.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN; CREATE ROLE privacy_workflow_owner NOLOGIN; CREATE ROLE supabase_admin NOLOGIN SUPERUSER;')
        if result.returncode:
            raise AssertionError(result.stderr)

    @classmethod
    def query(cls, sql):
        return cls.docker('exec', '-i', cls.container, 'psql', '-XAtq', '-h', '127.0.0.1', '-U', 'postgres',
                          '-d', cls.database, '-v', 'ON_ERROR_STOP=1', input=sql)

    def setUp(self):
        type(self).database = 'postgres'
        database = 'edit_' + uuid.uuid4().hex[:10]
        self.assertEqual(self.query('CREATE DATABASE ' + database).returncode, 0)
        type(self).database = database
        self.ok(f"""
            CREATE TABLE public.user_roles(user_id uuid, role text);
            CREATE TABLE public.user_account_status(user_id uuid, account_status text, disabled_at timestamptz);
            INSERT INTO public.user_roles VALUES ('{ACTOR}','admin');
            INSERT INTO public.user_account_status VALUES ('{ACTOR}','active',NULL);
            CREATE TABLE public.restaurants(id uuid PRIMARY KEY, approved_name text, categories text[],
                lat numeric, lng numeric, road_address text, jibun_address text, english_address text,
                youtube_link text, tzuyang_review text, status text, geocoding_success boolean,
                geocoding_false_stage text, updated_by_admin_id uuid, updated_at timestamptz,
                unrelated_fixture text);
            INSERT INTO public.restaurants(id,approved_name,categories,status,updated_at,unrelated_fixture)
              VALUES ('{RESTAURANT}','Original restaurant',ARRAY['Food'],'approved','2026-01-01','preserve');
            CREATE TABLE public.profiles(user_id uuid,username text,nickname text,avatar_url text,
              role text,created_at timestamptz,updated_at timestamptz);
            GRANT SELECT ON public.user_roles,public.user_account_status,public.profiles TO privacy_workflow_owner;
            GRANT SELECT,UPDATE ON public.restaurants TO service_role;
        """)
        metadata_source = (ROOT / 'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql').read_text()
        metadata_rpc = re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_management_metadata\(.*?END\n\$\$;', metadata_source, re.S).group()
        self.ok(metadata_rpc + '''
            ALTER FUNCTION public.read_admin_user_management_metadata(uuid[]) OWNER TO privacy_workflow_owner;
            REVOKE ALL ON FUNCTION public.read_admin_user_management_metadata(uuid[]) FROM PUBLIC,anon,authenticated;
            GRANT EXECUTE ON FUNCTION public.read_admin_user_management_metadata(uuid[]) TO service_role;
        ''')
        self.ok(SOURCE.read_text())

    def ok(self, sql):
        result = self.query(sql)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def preview(self, patch=PATCH):
        return json.loads(self.ok(f"SET ROLE service_role; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{patch}'::jsonb);"))

    def apply(self, preview, patch=PATCH, operation=OPERATION):
        return self.query(f"SET ROLE service_role; SELECT admin_catalog_edit.apply('{ACTOR}','{RESTAURANT}','{patch}'::jsonb,'{preview}','{operation}');")

    def test_preview_is_read_only_and_apply_preserves_unselected_fields(self):
        preview = self.preview()
        self.assertEqual(preview['before'], {'approved_name': 'Original restaurant'})
        self.assertEqual(preview['after'], {'approved_name': 'Edited restaurant'})
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')
        result = self.apply(preview['preview_sha256'])
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertFalse(receipt['replayed'])
        self.assertEqual(receipt['changed_fields'], ['approved_name'])
        row = json.loads(self.ok('SELECT row_to_json(r) FROM public.restaurants r'))
        self.assertEqual((row['approved_name'], row['status'], row['unrelated_fixture']), ('Edited restaurant','approved','preserve'))
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '1')
        self.assertEqual(self.ok('SELECT admin_catalog_edit.digest(to_jsonb(r)) FROM public.restaurants r'), receipt['after_sha256'])

    def test_repeat_is_idempotent_and_different_payload_cannot_reuse_operation(self):
        preview = self.preview()['preview_sha256']
        first = self.apply(preview)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self.apply(preview)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertTrue(json.loads(second.stdout)['replayed'])
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '1')
        conflict = self.apply(preview, '{"approved_name":"Different edit"}')
        self.assertNotEqual(conflict.returncode, 0)
        self.assertIn('catalog_edit_operation_conflict', conflict.stderr)

    def test_concurrent_retries_commit_exactly_one_edit_and_one_audit(self):
        preview = self.preview()['preview_sha256']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.apply(preview), range(2)))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(json.loads(result.stdout)['replayed'] for result in results), [False, True])
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '1')

    def test_stale_preview_cannot_overwrite_concurrent_edit(self):
        preview = self.preview()['preview_sha256']
        self.ok("UPDATE public.restaurants SET unrelated_fixture='concurrent edit'")
        result = self.apply(preview)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('catalog_edit_preview_stale', result.stderr)
        self.assertEqual(self.ok('SELECT approved_name FROM public.restaurants'), 'Original restaurant')
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')

    def test_independent_readback_detects_later_changes_and_minimizes_values(self):
        result = self.apply(self.preview()['preview_sha256'])
        self.assertEqual(result.returncode, 0, result.stderr)
        command = f"SET ROLE service_role; SELECT admin_catalog_edit.readback('{ACTOR}','{OPERATION}');"
        receipt = json.loads(self.ok(command))
        self.assertTrue(receipt['matches'])
        self.assertEqual(receipt['values'], {'approved_name':'Edited restaurant'})
        self.assertNotIn('unrelated_fixture', receipt['values'])
        self.ok("UPDATE public.restaurants SET unrelated_fixture='later change'")
        self.assertFalse(json.loads(self.ok(command))['matches'])

    def test_deleted_missing_and_no_change_records_cannot_be_prepared(self):
        for mutation, patch, expected in (
            ('', '{"approved_name":"Original restaurant"}', 'catalog_edit_no_changes'),
            ("UPDATE public.restaurants SET status='deleted';", PATCH, 'catalog_edit_deleted_record'),
            ('DELETE FROM public.restaurants;', PATCH, 'catalog_edit_not_found'),
        ):
            result = self.query(mutation + f"SET ROLE service_role; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{patch}');")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(expected, result.stderr)

    def test_audit_failure_rolls_back_restaurant_update(self):
        preview = self.preview()['preview_sha256']
        self.ok('ALTER TABLE admin_catalog_edit.audit_events ADD CONSTRAINT reject_fixture CHECK(false)')
        result = self.apply(preview)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.ok('SELECT approved_name FROM public.restaurants'), 'Original restaurant')
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')

    def test_non_admin_disabled_actor_and_browser_roles_are_rejected(self):
        self.assertEqual(self.ok("SELECT has_table_privilege('service_role','public.user_roles','SELECT') OR has_table_privilege('service_role','public.user_account_status','SELECT')"), 'f')
        self.ok("UPDATE public.user_account_status SET account_status='disabled'")
        result = self.query(f"SET ROLE service_role; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{PATCH}');")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('catalog_edit_forbidden', result.stderr)
        for role in ('anon', 'authenticated'):
            result = self.query(f"SET ROLE {role}; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{PATCH}');")
            self.assertNotEqual(result.returncode, 0)
        self.ok("UPDATE public.user_account_status SET account_status='active'; UPDATE public.user_roles SET role='user'")
        result = self.query(f"SET ROLE service_role; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{PATCH}');")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('catalog_edit_forbidden', result.stderr)

    def test_patch_validation_rejects_privileged_fields_and_incomplete_coordinates(self):
        for patch in ('{}', '{"status":"deleted"}', '{"updated_by_admin_id":null}',
                      '{"phone":"123"}', '{"lat":37}', '{"lat":91,"lng":127}',
                      '{"road_address":"changed"}', '{"categories":[{}]}',
                      '{"approved_name":null}', '{"youtube_link":"javascript:alert(1)"}'):
            with self.subTest(patch=patch):
                result = self.query(f"SET ROLE service_role; SELECT admin_catalog_edit.prepare('{ACTOR}','{RESTAURANT}','{patch}');")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('catalog_edit_', result.stderr)

    def test_address_and_coordinates_apply_together(self):
        patch = '{"road_address":"Business address","lat":37.5,"lng":127.0,"categories":[]}'
        preview = self.preview(patch)['preview_sha256']
        result = self.apply(preview, patch)
        self.assertEqual(result.returncode, 0, result.stderr)
        row = json.loads(self.ok('SELECT row_to_json(r) FROM public.restaurants r'))
        self.assertEqual((row['road_address'],row['lat'],row['lng'],row['categories']), ('Business address',37.5,127.0,[]))
        self.assertTrue(row['geocoding_success'])

    def test_definer_wrappers_apply_with_narrow_column_grants_and_rls(self):
        # Exercise the exact API definitions/grants. The complete G014 assertion
        # block is separately verified against the real local catalog in rollback.
        self.ok('''
            CREATE SCHEMA _tzudong_local;
            CREATE TABLE _tzudong_local.migration_ledger(marker boolean);
            ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
            GRANT SELECT ON public.restaurants TO privacy_workflow_owner;
            CREATE POLICY fixture_owner_read ON public.restaurants FOR SELECT TO privacy_workflow_owner USING(true);
            CREATE POLICY fixture_service_access ON public.restaurants TO service_role USING(true) WITH CHECK(true);
        ''')
        source = (ROOT / 'backend/supabase/candidates/restaurant_catalog_edit_api.sql').read_text()
        definitions = source.split('-- The generated local Supabase bootstrap actor')[0]
        self.ok('SET ROLE supabase_admin;\n' + definitions + 'COMMIT; RESET ROLE;')
        self.assertEqual(self.ok("SELECT has_column_privilege('privacy_workflow_owner','public.restaurants','status','UPDATE')"), 'f')
        prepare = f"SET ROLE service_role; SELECT public.prepare_local_restaurant_catalog_edit('{ACTOR}','{RESTAURANT}','{PATCH}');"
        preview = json.loads(self.ok(prepare))['preview_sha256']
        self.ok(f"SET ROLE service_role; SELECT public.apply_local_restaurant_catalog_edit('{ACTOR}','{RESTAURANT}','{PATCH}','{preview}','{OPERATION}');")
        receipt = json.loads(self.ok(f"SET ROLE service_role; SELECT public.readback_local_restaurant_catalog_edit('{ACTOR}','{OPERATION}');"))
        self.assertTrue(receipt['matches'])
        self.assertEqual(receipt['restaurant_id'], RESTAURANT)
        for role in ('anon','authenticated','privacy_workflow_owner'):
            result = self.query(f"SET ROLE {role}; SET request.jwt.claim.role='service_role'; SELECT public.prepare_local_restaurant_catalog_edit('{ACTOR}','{RESTAURANT}','{PATCH}');")
            self.assertNotEqual(result.returncode, 0)

    def test_audit_cannot_be_updated_deleted_or_truncated(self):
        result = self.apply(self.preview()['preview_sha256'])
        self.assertEqual(result.returncode, 0, result.stderr)
        for statement in ("UPDATE admin_catalog_edit.audit_events SET changed_fields=ARRAY['status']",
                          'DELETE FROM admin_catalog_edit.audit_events',
                          'TRUNCATE admin_catalog_edit.audit_events'):
            result = self.query(statement)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('catalog_edit_audit_immutable', result.stderr)


    def publish_fixture(self):
        self.ok((ROOT / 'backend/supabase/candidates/restaurant_catalog_publish_core.sql').read_text())
        expected = json.loads(self.ok("""SELECT jsonb_build_object(
          'approved_name',approved_name,'categories',categories,'lat',lat,'lng',lng,
          'road_address',road_address,'jibun_address',jibun_address,'english_address',english_address,
          'status',status,'tzuyang_review',tzuyang_review,'youtube_link',youtube_link)
          FROM public.restaurants"""))
        return dict(actor_user_id=ACTOR, restaurant_id=RESTAURANT, operation_id=OPERATION,
                    review_sha256='a'*64, selection=['approved_name'], patch=json.loads(PATCH),
                    expected_hosted_review_values=expected)

    def publish_call(self, envelope, preview=None, role='service_role'):
        literal = json.dumps(envelope).replace("'", "''")
        function = 'prepare' if preview is None else 'apply'
        args = "'" + literal + "'::jsonb"
        if preview is not None:
            args += ", '" + preview + "'"
        return self.query(f'SET ROLE {role}; SELECT admin_catalog_publish.{function}({args});')

    def publish_preview(self, envelope):
        result = self.publish_call(envelope)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_publish_permissions(self):
        envelope = self.publish_fixture()
        self.publish_preview(envelope)
        for role in ('anon', 'authenticated', 'privacy_workflow_owner'):
            result = self.publish_call(envelope, role=role)
            self.assertNotEqual(result.returncode, 0)
        for role in ('anon', 'authenticated'):
            self.assertEqual(self.ok(f"SELECT has_schema_privilege('{role}','admin_catalog_publish','USAGE')"), 'f')
            self.assertEqual(self.ok(f"SELECT has_function_privilege('{role}','admin_catalog_publish.apply(jsonb,text)','EXECUTE')"), 'f')
        for change in ("UPDATE public.user_account_status SET account_status='disabled'",
                       "UPDATE public.user_account_status SET account_status='active'; UPDATE public.user_roles SET role='user'"):
            self.ok(change)
            result = self.publish_call(envelope)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('catalog_edit_forbidden', result.stderr)

    def test_publish_stale_review_and_preview(self):
        envelope = self.publish_fixture()
        preview = self.publish_preview(envelope)['preview_sha256']
        for altered in (dict(envelope, review_sha256='b'*64),
                        dict(envelope, selection=['approved_name','categories']),
                        dict(envelope, operation_id=str(uuid.uuid4()))):
            result = self.publish_call(altered, preview)
            self.assertIn('catalog_publish_preview_stale', result.stderr)
        for column, value in (('status', 'pending'), ('tzuyang_review', 'concurrent review'),
                              ('unrelated_fixture', 'concurrent metadata')):
            with self.subTest(column=column):
                self.ok(f"UPDATE public.restaurants SET {column}='{value}'")
                result = self.publish_call(envelope, preview)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('catalog_publish_preview_stale' if column == 'unrelated_fixture' else 'catalog_publish_review_stale', result.stderr)
                self.ok("UPDATE public.restaurants SET status='approved',tzuyang_review=NULL,unrelated_fixture='preserve'")
        for key in ('status', 'lat'):
            invalid = json.loads(json.dumps(envelope))
            del invalid['expected_hosted_review_values'][key]
            self.assertNotEqual(self.publish_call(invalid).returncode, 0)
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_publish.operation_receipts'), '0')
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')

    def test_publish_unselected_fields_and_location_group(self):
        envelope = self.publish_fixture()
        invalid = json.loads(json.dumps(envelope))
        invalid['patch']['tzuyang_review'] = 'unselected'
        self.assertIn('catalog_publish_unselected_field', self.publish_call(invalid).stderr)
        for selected in (['lat','lng'], ['approved_name','status'], ['approved_name','approved_name'], [None]):
            invalid = dict(envelope, selection=selected)
            self.assertNotEqual(self.publish_call(invalid).returncode, 0)
        preview = self.publish_preview(envelope)
        self.assertEqual(preview['derived_fields'], ['updated_by_admin_id','updated_at'])
        result = self.publish_call(envelope, preview['preview_sha256'])
        self.assertEqual(result.returncode, 0, result.stderr)
        row = json.loads(self.ok('SELECT row_to_json(r) FROM public.restaurants r'))
        self.assertEqual((row['status'],row['categories'],row['unrelated_fixture'],row['geocoding_success']), ('approved',['Food'],'preserve',None))
        envelope['expected_hosted_review_values']['approved_name'] = 'Edited restaurant'
        envelope.update(operation_id=str(uuid.uuid4()), selection=['lat','lng','road_address','jibun_address','english_address'],
                        patch={'lat':37.5,'lng':127,'road_address':'Business address'})
        preview = self.publish_preview(envelope)
        self.assertEqual(preview['derived_fields'], ['updated_by_admin_id','updated_at','geocoding_success','geocoding_false_stage'])
        result = self.publish_call(envelope, preview['preview_sha256'])
        self.assertEqual(result.returncode, 0, result.stderr)
        row = json.loads(self.ok('SELECT row_to_json(r) FROM public.restaurants r'))
        self.assertEqual((row['lat'],row['lng'],row['road_address'],row['jibun_address'],row['english_address']), (37.5,127,'Business address',None,None))
        self.assertEqual((row['geocoding_success'],row['geocoding_false_stage']), (True,None))

    def test_publish_retry_binds_entire_envelope_and_core_operation(self):
        envelope = self.publish_fixture()
        preview = self.publish_preview(envelope)['preview_sha256']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.publish_call(envelope,preview), range(2)))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(json.loads(r.stdout)['replayed'] for r in results), [False,True])
        for key,value in (('review_sha256','b'*64), ('selection',['approved_name','categories']),
                          ('patch',{'approved_name':'another edit'}),
                          ('expected_hosted_review_values',dict(envelope['expected_hosted_review_values'],status='pending'))):
            result = self.publish_call(dict(envelope, **{key:value}), preview)
            self.assertIn('catalog_publish_operation_conflict', result.stderr)
        self.assertIn('catalog_publish_operation_conflict', self.publish_call(envelope,'b'*64).stderr)
        self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events a JOIN admin_catalog_publish.operation_receipts p USING(operation_id) WHERE a.actor_user_id=p.actor_user_id AND a.restaurant_id=p.restaurant_id AND a.request_sha256=p.core_request_sha256 AND a.after_sha256=p.after_sha256'), '1')
        # A direct edit with an existing UUID cannot acquire a publish receipt later.
        next_op = str(uuid.uuid4())
        patch = '{"approved_name":"Direct core edit"}'
        core_preview = self.preview(patch)['preview_sha256']
        self.assertEqual(self.apply(core_preview,patch,next_op).returncode, 0)
        collision = dict(envelope, operation_id=next_op)
        self.assertIn('catalog_publish_operation_conflict', self.publish_call(collision,core_preview).stderr)

    def test_publish_audit_rollback_and_readback(self):
        envelope = self.publish_fixture()
        preview = self.publish_preview(envelope)['preview_sha256']
        for table in ('admin_catalog_edit.audit_events','admin_catalog_publish.operation_receipts'):
            self.ok(f'ALTER TABLE {table} ADD CONSTRAINT reject_publish_fixture CHECK(false)')
            result = self.publish_call(envelope,preview)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.ok('SELECT approved_name FROM public.restaurants'), 'Original restaurant')
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_publish.operation_receipts'), '0')
            self.ok(f'ALTER TABLE {table} DROP CONSTRAINT reject_publish_fixture')
        result = self.publish_call(envelope,preview)
        self.assertEqual(result.returncode, 0, result.stderr)
        command = f"SET ROLE service_role; SELECT admin_catalog_publish.readback('{ACTOR}','{OPERATION}');"
        readback = json.loads(self.ok(command))
        self.assertTrue(readback['matches'])
        self.assertTrue(readback['link_matches'])
        self.assertEqual(readback['values'], {'approved_name':'Edited restaurant'})
        self.ok("UPDATE public.restaurants SET unrelated_fixture='later change'")
        self.assertFalse(json.loads(self.ok(command))['matches'])
        replay = self.publish_call(envelope,preview)
        self.assertTrue(json.loads(replay.stdout)['replayed'])
        self.assertFalse(json.loads(replay.stdout)['matches'])
        for statement in ("UPDATE admin_catalog_publish.operation_receipts SET review_sha256=repeat('b',64)",
                          'DELETE FROM admin_catalog_publish.operation_receipts',
                          'TRUNCATE admin_catalog_publish.operation_receipts'):
            result = self.query(statement)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('catalog_publish_receipt_immutable',result.stderr)
        # Deliberate superuser corruption in disposable fixture verifies linkage.
        self.ok("ALTER TABLE admin_catalog_publish.operation_receipts DISABLE TRIGGER USER; UPDATE admin_catalog_publish.operation_receipts SET core_request_sha256=repeat('b',64)")
        self.assertIn('catalog_publish_receipt_link_invalid', self.query(command).stderr)


    def test_publish_operator_real_sql_contract(self):
        # Synthetic approval and artifacts exist only inside this disposable test;
        # this adapter never instantiates the hosted HTTP transport.
        import sys
        import tempfile
        from unittest.mock import patch

        with patch.object(sys, 'path', [str(ROOT / 'backend/supabase/scripts'), *sys.path]):
            import local_catalog_workspace as catalog
            from catalog_publish_operator import APPROVAL_ENV, CONFIRMATION, PublishOperator
            from catalog_publish_transport import APPLY, PREPARE, READBACK

        fixture = self.publish_fixture()
        test = self
        sessions = []

        class FixtureRpc:
            def __init__(self):
                self.calls = []

            def call(self, name, args):
                self.calls.append(name)
                if name == PREPARE:
                    test.assertEqual(set(args), {'p_envelope'})
                    function, keys = 'prepare', ['p_envelope']
                elif name == APPLY:
                    test.assertEqual(set(args), {'p_envelope', 'p_preview_sha256'})
                    function, keys = 'apply', ['p_envelope', 'p_preview_sha256']
                else:
                    test.assertEqual(name, READBACK)
                    test.assertEqual(set(args), {'p_actor', 'p_operation'})
                    function, keys = 'readback', ['p_actor', 'p_operation']
                literals = []
                for key in keys:
                    value = json.dumps(args[key]) if key == 'p_envelope' else args[key]
                    literals.append("'" + value.replace("'", "''") + "'" + ('::jsonb' if key == 'p_envelope' else ''))
                # query launches a new psql process/connection for EVERY RPC.
                output = test.ok('SET ROLE service_role; SELECT pg_backend_pid(); SELECT '
                                 + 'admin_catalog_publish.' + function + '(' + ','.join(literals) + ');')
                pid, result = output.splitlines()
                sessions.append(pid)
                return json.loads(result)

        with tempfile.TemporaryDirectory(prefix='publish-operator-pg-fixture-') as temporary:
            directory = Path(temporary)
            project = 'isolated-pg-synthetic-fixture'
            review = {'schema': 'local-catalog-publish-review-v1', 'project': project,
                      'source': catalog.HOSTED_PROJECT_REF, 'local_digest': 'fixture-local-digest',
                      'safe_to_apply': False,
                      'records': [{'id': RESTAURANT, 'state': 'candidate',
                                   'selected_fields': fixture['selection'], 'patch': fixture['patch'],
                                   'expected_hosted_review_values': fixture['expected_hosted_review_values']}]}
            review_sha = catalog.sha(review)
            catalog.private_write(directory / (review_sha + '.publish-review.json'), review)
            rpc = FixtureRpc()
            operator = PublishOperator(directory, project, rpc, local_digest=lambda: 'fixture-local-digest')
            prepared = operator.prepare(review_sha, RESTAURANT, ACTOR)
            digest = prepared['prepared_sha256']
            artifact = catalog.read_private_json(directory / (digest + '.publish-prepared.json'))
            self.assertEqual(catalog.sha(artifact), digest)
            self.assertEqual(artifact['envelope']['review_sha256'], review_sha)
            self.assertEqual(prepared['derived_fields'], ['updated_by_admin_id', 'updated_at'])
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '0')
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_publish.operation_receipts'), '0')

            approval_file = directory / 'synthetic-fixture-approval.json'
            catalog.private_write(approval_file, {
                'schema': 'catalog-publish-approval-v1', 'source': catalog.HOSTED_PROJECT_REF,
                'operation_id': prepared['operation_id'], 'prepared_sha256': digest,
                'actor_user_id': ACTOR, 'approved': True, 'release_evidence_sha256': '9'*64})
            approval_args = {'confirmation': CONFIRMATION, 'approval_file': approval_file,
                             'environment': {APPROVAL_ENV: digest, 'G037_WRITE_FREEZE': 'cleared'}}
            outcome = operator.apply(digest, **approval_args)
            self.assertEqual(outcome['state'], 'verified')
            self.assertEqual(rpc.calls, [PREPARE, APPLY, READBACK])
            receipt_path = directory / (outcome['receipt_sha256'] + '.publish-readback.json')
            receipt = catalog.read_private_json(receipt_path)
            self.assertEqual(catalog.sha(receipt), outcome['receipt_sha256'])
            self.assertEqual(receipt['operation_id'], prepared['operation_id'])
            self.assertEqual(receipt['prepared_sha256'], digest)
            self.assertEqual(receipt['review_sha256'], review_sha)
            self.assertEqual(receipt['result'], 'applied_and_read_back')
            self.assertNotIn('Edited restaurant', receipt_path.read_text())
            self.assertEqual(list(directory.glob('*.publish-pending.json')), [])
            attempt_path = directory / (prepared['operation_id'] + '.publish-attempt.json')
            self.assertEqual(catalog.read_private_json(attempt_path)['prepared_sha256'], digest)

            restarted_rpc = FixtureRpc()
            restarted = PublishOperator(directory, project, restarted_rpc, local_digest=lambda: 'fixture-local-digest')
            with self.assertRaisesRegex(catalog.CatalogError, 'publish_readback_required'):
                restarted.apply(digest, **approval_args)
            self.assertEqual(restarted_rpc.calls, [])
            self.assertEqual(restarted.readback(digest), outcome)
            self.assertEqual(restarted_rpc.calls, [READBACK])
            self.assertEqual(len(sessions), 4)
            self.assertEqual(len(set(sessions)), 4)
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            for path in directory.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_edit.audit_events'), '1')
            self.assertEqual(self.ok('SELECT count(*) FROM admin_catalog_publish.operation_receipts'), '1')
            stored = json.loads(self.ok("""SELECT jsonb_build_object('operation_id',p.operation_id,
              'after_sha256',p.after_sha256,'envelope_sha256',p.envelope_sha256)
              FROM admin_catalog_publish.operation_receipts p JOIN admin_catalog_edit.audit_events a
              ON a.operation_id=p.operation_id AND a.request_sha256=p.core_request_sha256
              AND a.after_sha256=p.after_sha256"""))
            for key, value in stored.items():
                self.assertEqual(receipt[key], value)
            self.assertEqual(self.ok('SELECT approved_name FROM public.restaurants'), 'Edited restaurant')



if __name__ == '__main__':
    unittest.main()
