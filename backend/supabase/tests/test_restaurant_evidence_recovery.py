"""Real owned PG15/17 recovery transactions; synthetic business rows, no providers.

Opt in with TZUDONG_EVIDENCE_RECOVERY_LOCAL_PG=1 and explicitly supplied
TZUDONG_TEST_PG_SOCKET=127.0.0.1, TZUDONG_TEST_PG_PORT, TZUDONG_EXPECTED_PG_MAJOR.
PG17 must initialize under a different bootstrap role, then create the test
postgres login as a non-bootstrap superuser. PG17 cannot demote role OID10;
the owner-lease case must exercise the actual non-superuser path, not skip it.
No server/container lifecycle operations or default socket/port are used.
"""
import copy
import hashlib
import json
import os
import re
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

from backend.supabase.tests import test_admin_record_actions as baseline
from backend.supabase.tests import test_service_invoker_contract as invoker_fixture

M = baseline.M
SOURCE = M / '20261103171649_restaurant_evidence_recovery.sql'


@unittest.skipUnless(os.environ.get('TZUDONG_EVIDENCE_RECOVERY_LOCAL_PG') == '1', 'owned PG opt-in required')
class RestaurantEvidenceRecoveryTests(unittest.TestCase):
    cleanup = classmethod(baseline.AdminRecordActions.cleanup.__func__)
    scalar = baseline.AdminRecordActions.scalar
    good = baseline.AdminRecordActions.good
    insert = baseline.AdminRecordActions.insert
    row = baseline.AdminRecordActions.row

    @classmethod
    def setUpClass(cls):
        if os.environ.get('TZUDONG_TEST_PG_SOCKET') != '127.0.0.1' or not os.environ.get('TZUDONG_TEST_PG_PORT'):
            raise RuntimeError('Explicit owned loopback fixture port required')
        major = os.environ.get('TZUDONG_EXPECTED_PG_MAJOR')
        if major not in ('15', '17'):
            raise RuntimeError('Explicit PG15 or PG17 expectation required')
        # The operator explicitly authorized these roles only in the supplied
        # task-owned synthetic servers. Never change postgres or outside roles.
        import psycopg2
        with psycopg2.connect(host='127.0.0.1', port=int(os.environ['TZUDONG_TEST_PG_PORT']),
                              user='postgres', dbname='postgres') as bootstrap:
            with bootstrap.cursor() as c:
                c.execute('SHOW server_version_num')
                if int(c.fetchone()[0]) // 10000 != int(major):
                    raise RuntimeError('Owned fixture PostgreSQL version mismatch')
                c.execute("SELECT oid FROM pg_roles WHERE rolname='postgres'")
                if major == '17' and c.fetchone()[0] == 10:
                    raise RuntimeError('PG17 owner fixture requires a non-bootstrap postgres login')
                for role, inherit in [('privacy_workflow_owner', False), ('privacy_auth_bridge', True)]:
                    c.execute('SELECT rolsuper,rolbypassrls,rolcanlogin,rolinherit FROM pg_roles WHERE rolname=%s', (role,))
                    existing = c.fetchone()
                    if existing is None:
                        c.execute('CREATE ROLE ' + role + ' NOLOGIN NOSUPERUSER NOBYPASSRLS ' + ('INHERIT' if inherit else 'NOINHERIT'))
                    elif existing != (False, False, False, inherit):
                        raise RuntimeError('Owned fixture role precondition mismatch')
                c.execute('GRANT privacy_workflow_owner TO privacy_auth_bridge')
        # Existing fixture loads actual classifiers/hash/snapshot/readback/action
        # SQL in a unique disposable database; legacy metadata identities use
        # the existing G014 fixture method, not hosted user/catalog evidence.
        baseline.AdminRecordActions.setUpClass.__func__(cls)
        with cls.conn.cursor() as c:
            c.execute('SHOW server_version_num')
            if int(c.fetchone()[0]) // 10000 != int(major):
                raise RuntimeError('Owned fixture PostgreSQL version mismatch')
            gemini = (M / '20261004120000_restaurant_review_gemini_decision.sql').read_text()
            c.execute(gemini)
            cls.prepare_g014(c)
            c.execute(SOURCE.read_text())
            # Existing framework extracts only the actual public-RPC loop from
            # the unchanged full catalog assertion. Relation-manifest replay is
            # deliberately not represented as this targeted proof.
            from types import SimpleNamespace
            invoker_fixture.PostgreSQLContract.install_loop(SimpleNamespace(cursor=c))

    @classmethod
    def prepare_g014(cls, c):
        """Frozen assertion bodies, source-bound additive historical patches.

        This is the existing framework's targeted owner/invoker fixture. The
        complete catalog relation manifest/hosted ledger is a separate replay.
        Actual recovery functions and business SQL are never stubbed.
        """
        f = invoker_fixture
        definitions = f.definitions()[0]
        base = f.MIGRATION.read_text()
        cls.g014_prior_definitions = {}
        for name, definition in definitions.items():
            body = f.tagged(definition, 'function')
            body = f.replace_exact(body, f.tagged(base, name + '_anchor'), f.tagged(base, name + '_addition') + f.tagged(base, name + '_anchor'))
            for filename in ['20261003172126_restaurant_review_manual_invoker_contract.sql',
                             '20261003220841_admin_evaluation_page_invoker_contract.sql',
                             '20261004050600_admin_evaluation_warning_invoker_contract.sql']:
                patch = (M / filename).read_text()
                addition = f.tagged(patch, 'signature' if 'manual' in filename else 'addition')
                body = f.replace_exact(body, f.tagged(patch, 'anchor'), addition + f.tagged(patch, 'anchor'))
                if 'manual' in filename:
                    anchor = f.tagged(patch, name + '_lock')
                    body = f.replace_exact(body, anchor, anchor.replace(f.tagged(patch, 'tick'), f.tagged(patch, 'manual')))
            raw = (M / '20261004194715_admin_evaluation_raw_warning_invoker_contract.sql').read_text()
            for tag in ['record_addition', 'addition']:
                body = f.replace_exact(body, f.tagged(raw, 'anchor'), f.tagged(raw, tag) + f.tagged(raw, 'anchor'))
            cls.g014_prior_definitions[name] = definition.replace(f.tagged(definition, 'function'), body)
        variant = os.environ.get('TZUDONG_EVIDENCE_G014_SOURCE', 'canonical')
        if variant == 'hosted':
            snapshot = json.loads((SOURCE.parents[1] / 'tests/fixtures/g014_hosted_pre_recovery_v1.json').read_text())
            expected = {'definer': 'bb8dc8d2e4020f70b2332cbdf6acf465a97cbc4d582f9f14415330247ae34131',
                        'catalog': '5c5971a5578e09db25a41e88474f1da15acfbd658571ba28f29e8c226e4d1883'}
            for name, definition in definitions.items():
                item = snapshot['functions']['assert_g014_' + name + '_contract']
                if item['sha256'] != expected[name] or hashlib.sha256(item['body'].encode()).hexdigest() != expected[name]:
                    raise RuntimeError('Hosted G014 source snapshot drift')
                cls.g014_prior_definitions[name] = definition.replace(f.tagged(definition, 'function'), item['body'])
        elif variant != 'canonical':
            raise RuntimeError('Explicit canonical or hosted G014 source required')
        c.execute('ALTER SCHEMA privacy_retention OWNER TO privacy_workflow_owner; ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner; GRANT USAGE ON SCHEMA public TO privacy_workflow_owner,privacy_auth_bridge; CREATE TABLE privacy_retention.privacy_retention_runs(id uuid); CREATE TABLE public.admin_storyboard_production_projects(id uuid); CREATE TABLE public.admin_storyboard_production_jobs(id uuid);')
        # Metadata-only private dependencies follow the existing fixture's
        # exact union identities and owner split. They are never business mocks.
        extra = f.tagged(definitions['definer'], 'function').split('UNION ALL VALUES', 1)[1].split('  LOOP', 1)[0]
        for signature in re.findall(r"'([^']+)'", extra):
            c.execute('CREATE FUNCTION ' + signature + " RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT true'; ALTER FUNCTION " + signature + ' OWNER TO ' + ('privacy_auth_bridge' if 'append_audit' in signature else 'privacy_workflow_owner'))
        known = re.findall(r"^      '(public\.[^']+)'", f.tagged(base, 'definer_addition'), re.M)
        known += ['public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)']
        c.execute('SELECT to_regprocedure(s)::oid FROM unnest(%s::text[]) s', (known,))
        invoker_oids = {row[0] for row in c.fetchall() if row[0] is not None}
        c.execute("SELECT p.oid,format('%I.%I(%s)',n.nspname,p.proname,replace(oidvectortypes(p.proargtypes),', ',',')),p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")
        public_functions = c.fetchall()
        c.execute('DELETE FROM privacy_retention.g014_public_rpc_allowlist')
        for oid, signature, name in public_functions:
            if oid in invoker_oids:
                path = 'pg_catalog,public,extensions' if name in ('extract_youtube_video_id', 'normalize_restaurant_identity_name', 'resolve_restaurant_identity_name') else "''"
                c.execute('ALTER FUNCTION ' + signature + ' SECURITY INVOKER; ALTER FUNCTION ' + signature + ' SET search_path=' + path)
            else:
                # Baseline fixture helper modes converge to the frozen legacy
                # metadata contract; new recovery routines remain real invokers.
                c.execute('ALTER FUNCTION ' + signature + " SECURITY DEFINER; ALTER FUNCTION " + signature + " OWNER TO privacy_workflow_owner; ALTER FUNCTION " + signature + " SET search_path=''")
            c.execute('REVOKE ALL ON FUNCTION ' + signature + ' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ' + signature + ' TO service_role')
            c.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',%s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=%s", (signature, oid))
        for name, definition in cls.g014_prior_definitions.items():
            c.execute(definition + ' ALTER FUNCTION privacy_retention.assert_g014_' + name + '_contract() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_' + name + '_contract() FROM PUBLIC,anon,authenticated,service_role')
        boundary = (M / '20260713002000_g014_public_api_private_boundary.sql').read_text()
        assertion = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_public_rpc_allowlist\(\).*?\$function\$;', boundary, re.S).group()
        c.execute(assertion + ' ALTER FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() FROM PUBLIC,anon,authenticated,service_role')
        # Frozen checks genuinely pass before the four new objects exist.
        c.execute('SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract()')
        cls.g014_prior_metadata = cls.assertion_state(c)
        c.execute("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m")
        cls.g014_prior_memberships = c.fetchone()[0]

    @staticmethod
    def assertion_state(c):
        c.execute("SELECT p.proname,to_jsonb(p) FROM pg_proc p WHERE p.oid IN ('privacy_retention.assert_g014_definer_contract()'::regprocedure,'privacy_retention.assert_g014_catalog_contract()'::regprocedure) ORDER BY p.proname")
        return dict(c.fetchall())

    def setUp(self):
        baseline.AdminRecordActions.setUp(self)
        with self.conn.cursor() as c:
            c.execute('TRUNCATE pipeline_control.restaurant_review_items,pipeline_control.restaurant_review_runs CASCADE')
            c.execute('UPDATE pipeline_control.restaurant_review_policy SET enabled=true,version=2,operator_id=%s', (self.actor,))

    def sql(self, query, args=()):
        with self.conn.cursor() as c:
            if args:
                c.execute(query, args)
            else:
                c.execute(query)

    def rpc(self, name, args, connection=None, role='service_role'):
        connection = connection or self.conn
        if name not in ('context', 'admin', 'worker', 'status') or role not in ('service_role', 'anon', 'authenticated'):
            raise ValueError('Fixed fixture RPC/role only')
        with connection.cursor() as c:
            c.execute('SET ROLE ' + role)
            try:
                c.execute('SELECT public.restaurant_evidence_recovery_' + name + '(' + ','.join(['%s'] * len(args)) + ')', args)
                return c.fetchone()[0]
            finally:
                c.execute('RESET ROLE')

    def held(self, **changes):
        row = self.good()
        row.update(status='hold', source_type='geminiCLI', geocoding_success=False,
                   channel_name='tzuyang', recollect_version={'meta': 1, 'transcript': 2},
                   reasoning_basis='fixture extraction', origin_address={'address': 'fixture source address'},
                   created_at='2026-10-25T00:00:00Z', updated_at='2026-10-25T00:00:00Z')
        row.update(changes)
        return self.insert(row)

    def context(self, row):
        return self.rpc('context', (self.actor, row['id']))

    def admin_rpc(self, phase, context, operation=None, job=None, preview=None, confirmation=None, connection=None):
        return self.rpc('admin', (
            self.actor, phase, operation or str(uuid.uuid4()), job or str(uuid.uuid4()),
            context.get('restaurantId'), context.get('policyVersion'), context.get('rowSha256'),
            context.get('inputSha256'), preview, confirmation,
        ), connection)

    def request(self, row=None):
        row = row or self.held()
        context = self.context(row)
        original = self.row(row['id'])
        self.assertEqual(context['originName'], original['origin_name'])
        self.assertEqual(context['sourceUpdatedAt'], original['updated_at'])
        self.assertEqual(set(context), {'schemaVersion', 'restaurantId', 'policyVersion', 'rowSha256',
                                       'inputSha256', 'videoId', 'originName', 'sourceUpdatedAt'})
        preview = self.admin_rpc('preview_request', context)
        queued = self.confirm(preview, 'request')
        return row, queued

    def confirm(self, preview, phase, connection=None):
        return self.admin_rpc(phase, preview, operation=preview['receipt']['operationId'], job=preview['jobId'],
                          preview=preview['receipt']['previewHash'],
                          confirmation='REQUEST EVIDENCE RECOVERY' if phase == 'request' else 'APPLY EVIDENCE RECOVERY',
                          connection=connection)

    def worker(self, phase, job, token, result=None, connection=None):
        return self.rpc('worker', (phase, job['jobId'], token, baseline.Json(result or {})), connection)

    def result(self, claimed):
        raw = claimed['restaurant']
        return {
            'evaluation_results': copy.deepcopy(raw['evaluation_results']), 'geocoding_success': True,
            'lat': 37.4, 'lng': 127.1, 'jibun_address': 'fixture recovered business address', 'categories': ['한식'],
            'gemini_decision': {
                'schemaVersion': 1, 'model': 'gemini-3.8-flash', 'modelVersion': 'gemini-3.8-flash',
                'promptVersion': 'restaurant-review-v1', 'inputSha256': claimed['inputSha256'], 'promptSha256': 'b' * 64,
                'recommendation': 'approve', 'evidenceCodes': ['visit_supported', 'identity_supported', 'review_grounded',
                                                            'category_supported', 'location_corroborated', 'source_consistent'],
            },
        }

    def draft(self, row=None):
        row, queued = self.request(row)
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        result = self.result(claimed)
        draft = self.worker('complete', queued, token, result)
        return row, queued, token, result, draft

    def new_connection(self):
        connection = self.driver.connect(dbname=self.db, **self.params)
        connection.autocommit = True
        self.addCleanup(connection.close)
        return connection

    def test_request_collect_apply_stays_held_and_separate_existing_approval(self):
        row = self.held()
        original = self.row(row['id'])
        context = self.context(row)
        preview = self.admin_rpc('preview_request', context)
        self.assertEqual(preview['state'], 'preview')
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.restaurant_evidence_recovery_jobs'), 0)
        self.assertEqual(self.row(row['id']), original)
        self.assertEqual(self.admin_rpc('preview_request', context, preview['receipt']['operationId'], preview['jobId']), preview)
        queued = self.confirm(preview, 'request')
        self.assertEqual(self.confirm(preview, 'request'), queued)
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        self.assertEqual(claimed['restaurant'], original)
        self.assertEqual(claimed['decisionContext'], {'inputSha256': context['inputSha256']})
        self.assertNotIn('restaurant', self.worker('claim', queued, token))
        result = self.result(claimed)
        draft = self.worker('complete', queued, token, result)
        self.assertEqual(self.worker('complete', queued, token, result), draft)
        self.assertEqual(self.row(row['id']), original)
        preview_apply = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        self.assertNotEqual(preview_apply['receipt']['operationId'], preview['receipt']['operationId'])
        self.assertNotEqual(preview_apply['receipt']['previewHash'], preview['receipt']['previewHash'])
        applied = self.confirm(preview_apply, 'apply')
        self.assertEqual(self.confirm(preview_apply, 'apply'), applied)
        saved = self.row(row['id'])
        self.assertEqual(saved['status'], 'hold')
        self.assertEqual(saved['updated_by_admin_id'], self.actor)
        for key in ('origin_name', 'trace_id', 'youtube_link', 'tzuyang_review', 'reasoning_basis',
                    'recollect_version', 'origin_address', 'source_type', 'created_at'):
            self.assertEqual(saved[key], original[key])
        self.assertEqual(saved['evaluation_results'], result['evaluation_results'])
        self.assertEqual(saved['jibun_address'], result['jibun_address'])
        status_job = self.rpc('status', (self.actor, row['id']))['jobs'][0]
        self.assertIsNone(status_job['proposal'])
        self.assertIsNone(status_job['receipt'])
        self.assertEqual(status_job['applyOperationId'], preview_apply['receipt']['operationId'])
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 2)
        audits = self.scalar('SELECT jsonb_agg(to_jsonb(a)) FROM pipeline_control.admin_record_audit a')
        self.assertNotIn('fixture evidence', json.dumps(audits))
        self.assertNotIn('fixture recovered business address', json.dumps(audits))
        # Recovery never approves, but the original full guarded approval is usable.
        ticket = baseline.AdminRecordActions.call(self, 'preview', 'restaurant.approve', [row['id']])
        baseline.AdminRecordActions.call(self, 'apply', 'restaurant.approve', [row['id']], {}, ticket['operationId'], ticket['previewHash'])
        self.assertEqual(self.row(row['id'])['status'], 'approved')

    def test_snapshot_minimization_and_readonly_status_reload(self):
        row = self.held(db_error_message='fixture-provider-diagnostic', db_error_details={'privateDiagnostic': 'fixture-secret'})
        row, queued, token, result, draft = self.draft(row)
        stored = self.scalar('SELECT original_row FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=%s', (queued['jobId'],))
        for key in ('db_error_message', 'db_error_details', 'created_by', 'updated_by_admin_id', 'search_count', 'weekly_search_count', 'review_count', 'updated_at'):
            self.assertNotIn(key, stored)
        self.assertEqual(draft['rowSha256'], self.scalar('SELECT pipeline_control.admin_record_hash(to_jsonb(r)) FROM public.restaurants r WHERE id=%s', (row['id'],)))
        with self.assertRaisesRegex(self.driver.Error, 'WORK_OUTSTANDING'):
            self.context(row)
        preview = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET enabled=false')
        status = self.rpc('status', (self.actor, row['id']))
        job = status['jobs'][0]
        self.assertEqual(set(status), {'schemaVersion', 'restaurantId', 'jobs'})
        self.assertIsNone(job['receipt'])
        self.assertEqual(job['requestOperationId'], queued['receipt']['operationId'])
        self.assertEqual(job['applyOperationId'], preview['receipt']['operationId'])
        self.assertEqual(job['proposal'], {k: v for k, v in result.items() if k != 'gemini_decision'})
        self.assertNotIn('fixture-provider-diagnostic', json.dumps(status))
        self.assertNotIn('original_row', json.dumps(status))
        self.assertNotIn('worker_token', json.dumps(status))
        self.assertNotIn('gemini_decision', json.dumps(status))
        self.assertEqual(self.worker('read', queued, token)['state'], 'draft')

    def test_request_cas_policy_ownership_and_source_identity(self):
        row = self.held()
        context = self.context(row)
        preview = self.admin_rpc('preview_request', context)
        self.sql('UPDATE public.restaurants SET updated_at=clock_timestamp() WHERE id=%s', (row['id'],))
        with self.assertRaisesRegex(self.driver.Error, 'STALE'):
            self.confirm(preview, 'request')
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.restaurant_evidence_recovery_jobs'), 0)
        for key in ('rowSha256', 'inputSha256'):
            context = self.context(row)
            context[key] = 'a' * 64
            with self.assertRaisesRegex(self.driver.Error, 'STALE'):
                self.admin_rpc('preview_request', context)
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET version=3')
        with self.assertRaisesRegex(self.driver.Error, 'POLICY_CHANGED'):
            self.admin_rpc('preview_request', {**self.context(row), 'policyVersion': 2})
        for changes in ({'status': 'approved'}, {'status': 'deleted'}, {'created_by': str(uuid.uuid4())},
                        {'updated_by_admin_id': self.actor}, {'source_type': 'manual'},
                        {'db_error_details': {'error_type': 'duplicate'}}, {'is_not_selected': True}):
            candidate = self.held(**changes)
            with self.assertRaisesRegex(self.driver.Error, 'PROTECTED'):
                self.context(candidate)
        for changes in ({'youtube_link': 'https://example.com/watch?v=ABCDEFGHIJK'}, {'trace_id': ''}, {'origin_name': ''}):
            candidate = self.held(**changes)
            with self.assertRaisesRegex(self.driver.Error, 'SOURCE_REQUIRED'):
                self.context(candidate)

    def test_old_active_expired_and_uncertain_work_blocks_but_source_missing_is_not_terminal(self):
        row = self.held()
        for state, reason in [('queued', 'missing_basis'), ('running', 'worker_lease_expired'), ('failed', 'gemini_result_uncertain')]:
            self.sql("INSERT INTO pipeline_control.restaurant_review_items(restaurant_id,fingerprint,decision,reason,state,lease_until) VALUES(%s,%s,'recheck',%s,%s,now()-interval '1 day')", (row['id'], uuid.uuid4().hex, reason, state))
            with self.assertRaisesRegex(self.driver.Error, 'WORK_OUTSTANDING'):
                self.context(row)
            self.sql('DELETE FROM pipeline_control.restaurant_review_items')
        self.sql("INSERT INTO pipeline_control.restaurant_review_items(restaurant_id,fingerprint,decision,reason,state) VALUES(%s,%s,'recheck','source_unavailable','failed')", (row['id'], uuid.uuid4().hex))
        self.assertEqual(self.context(row)['restaurantId'], row['id'])
        self.assertEqual(self.row(row['id'])['status'], 'hold')

    def test_claim_and_apply_concurrency_are_single_effect(self):
        row, queued = self.request()
        connections = [self.new_connection(), self.new_connection()]
        tokens = [str(uuid.uuid4()), str(uuid.uuid4())]
        def claim(index):
            try:
                return self.worker('claim', queued, tokens[index], connection=connections[index])
            except self.driver.Error as error:
                self.assertIn('EVIDENCE_RECOVERY_NOT_FOUND', str(error))
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(claim, range(2)))
        winners = [i for i, answer in enumerate(answers) if answer and 'restaurant' in answer]
        self.assertEqual(len(winners), 1)
        index = winners[0]
        draft = self.worker('complete', queued, tokens[index], self.result(answers[index]))
        preview = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda connection: self.confirm(preview, 'apply', connection), connections))
        self.assertEqual(receipts[0], receipts[1])
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 2)

    def test_expired_paid_lease_and_uncertain_fail_never_reclaim(self):
        row, queued = self.request()
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        self.sql("UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET lease_until=now()-interval '1 second'")
        self.assertNotIn('restaurant', self.worker('claim', queued, token))
        with self.assertRaisesRegex(self.driver.Error, 'NOT_FOUND'):
            self.worker('claim', queued, str(uuid.uuid4()))
        with self.assertRaisesRegex(self.driver.Error, 'LEASE_EXPIRED'):
            self.worker('complete', queued, token, self.result(claimed))
        uncertain = self.worker('fail', queued, token, {'code': 'worker_timeout'})
        self.assertEqual(uncertain['state'], 'uncertain')
        self.assertEqual(self.worker('fail', queued, token, {'code': 'worker_timeout'}), uncertain)
        self.assertNotIn('restaurant', self.worker('claim', queued, token))
        with self.assertRaisesRegex(self.driver.Error, 'WORK_OUTSTANDING'):
            self.context(row)
        self.assertEqual(self.row(row['id'])['status'], 'hold')

    def test_complete_rejects_wrong_binding_fields_and_incomplete_false_location(self):
        row, queued = self.request()
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        result = self.result(claimed)
        bad = []
        for changes in ({'status': 'approved'}, {'trace_id': 'forged'}, {'youtube_link': 'https://example.com'},
                        {'db_error_details': {}}, {'categories': ['bad']}, {'geocoding_success': 'true'}):
            bad.append({**result, **changes})
        wrong = copy.deepcopy(result)
        wrong['gemini_decision']['inputSha256'] = 'c' * 64
        bad.append(wrong)
        false_location = copy.deepcopy(result)
        false_location['evaluation_results']['location_match_TF'] = {
            'origin_name': row['origin_name'], 'eval_value': False, 'match_status': 'failed', 'evidence_families': [],
        }
        bad.append(false_location)
        wrong = copy.deepcopy(result)
        wrong['evaluation_results']['location_match_TF']['origin_name'] = 'different source'
        bad.append(wrong)
        for candidate in bad:
            with self.assertRaisesRegex(self.driver.Error, 'RESULT_INVALID'):
                self.worker('complete', queued, token, candidate)
        self.assertEqual(self.worker('read', queued, token)['state'], 'running')
        false_location['evaluation_results']['location_match_TF']['pending_reason'] = 'timeout'
        self.assertEqual(self.worker('complete', queued, token, false_location)['state'], 'draft')

    def test_new_result_bound_preview_and_explicit_confirmation_required(self):
        row, queued, token, result, draft = self.draft()
        with self.assertRaisesRegex(self.driver.Error, 'PREVIEW_REQUIRED'):
            self.admin_rpc('apply', draft, job=draft['jobId'], preview='a' * 64, confirmation='APPLY EVIDENCE RECOVERY')
        with self.assertRaisesRegex(self.driver.Error, 'IDEMPOTENCY_CONFLICT'):
            self.admin_rpc('preview_apply', draft, operation=queued['receipt']['operationId'], job=draft['jobId'])
        preview = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        with self.assertRaisesRegex(self.driver.Error, 'CONFIRMATION_REQUIRED'):
            self.admin_rpc('apply', draft, preview['receipt']['operationId'], draft['jobId'], preview['receipt']['previewHash'])
        with self.assertRaisesRegex(self.driver.Error, 'PREVIEW_MISMATCH'):
            self.admin_rpc('apply', draft, preview['receipt']['operationId'], draft['jobId'], 'a' * 64, 'APPLY EVIDENCE RECOVERY')
        changed = copy.deepcopy(result)
        changed['lat'] = 38
        with self.assertRaisesRegex(self.driver.Error, 'RESULT_CHANGED'):
            self.worker('complete', queued, token, changed)
        self.sql('UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET result=%s WHERE id=%s', (baseline.Json(changed), draft['jobId']))
        with self.assertRaisesRegex(self.driver.Error, 'RESULT_CHANGED'):
            self.confirm(preview, 'apply')
        self.assertEqual(self.row(row['id'])['status'], 'hold')

    def test_policy_changes_prevent_claim_complete_apply_and_status_stays_readable(self):
        row, queued = self.request()
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET version=3')
        retired = self.worker('claim', queued, str(uuid.uuid4()))
        self.assertEqual((retired['state'], retired['reason']), ('failed', 'policy_changed'))
        self.assertNotIn('restaurant', retired)
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET version=2')
        row, queued = self.request(row)
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET enabled=false')
        with self.assertRaisesRegex(self.driver.Error, 'POLICY_CHANGED'):
            self.worker('complete', queued, token, self.result(claimed))
        history = self.rpc('status', (self.actor, row['id']))['jobs']
        self.assertEqual(len(history), 2)
        self.assertEqual(next(job for job in history if job['jobId'] == queued['jobId'])['state'], 'running')
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET enabled=true')
        draft = self.worker('complete', queued, token, self.result(claimed))
        preview = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET version=3')
        with self.assertRaisesRegex(self.driver.Error, 'POLICY_CHANGED'):
            self.confirm(preview, 'apply')

    def test_status_latest_five_actor_scoped_and_no_non_draft_proposal(self):
        row = self.held(is_missing=True)
        for _ in range(6):
            _, queued = self.request(row)
            token = str(uuid.uuid4())
            self.worker('claim', queued, token)
            self.worker('fail', queued, token, {'code': 'source_provider_transient'})
        jobs = self.rpc('status', (self.actor, row['id']))['jobs']
        self.assertEqual(len(jobs), 5)
        self.assertEqual(jobs[0]['jobId'], queued['jobId'])
        for job in jobs:
            self.assertIsNone(job['receipt'])
            self.assertIsNone(job['proposal'])
            self.assertIsNone(job['applyOperationId'])
        other = str(uuid.uuid4())
        self.sql("INSERT INTO public.user_roles VALUES(%s,'admin'); INSERT INTO public.user_account_status VALUES(%s,'active')", (other, other))
        self.assertEqual(self.rpc('status', (other, row['id']))['jobs'], [])
        self.assertEqual(self.row(row['id'])['status'], 'hold')

    def test_service_only_invokers_rls_and_active_admin(self):
        row = self.held()
        for signature in [
            'public.restaurant_evidence_recovery_context(uuid,uuid)', 'public.restaurant_evidence_recovery_status(uuid,uuid)',
            'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
            'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)',
        ]:
            for role in ('anon', 'authenticated'):
                self.assertFalse(self.scalar('SELECT has_function_privilege(%s,%s,\'EXECUTE\')', (role, signature)))
            metadata = self.scalar("SELECT jsonb_build_object('definer',prosecdef,'config',proconfig) FROM pg_proc WHERE oid=%s::regprocedure", (signature,))
            self.assertFalse(metadata['definer'])
            self.assertIn('search_path=""', metadata['config'])
        self.assertTrue(self.scalar("SELECT relrowsecurity FROM pg_class WHERE oid='pipeline_control.restaurant_evidence_recovery_jobs'::regclass"))
        for role in ('anon', 'authenticated'):
            self.assertFalse(self.scalar("SELECT has_table_privilege(%s,'pipeline_control.restaurant_evidence_recovery_jobs','SELECT')", (role,)))
            with self.assertRaises(self.driver.Error):
                self.rpc('status', (self.actor, row['id']), role=role)
        self.sql("UPDATE public.user_account_status SET account_status='suspended'")
        with self.assertRaisesRegex(self.driver.Error, 'OPERATOR_INVALID'):
            self.context(row)
        with self.assertRaisesRegex(self.driver.Error, 'OPERATOR_INVALID'):
            self.rpc('status', (self.actor, row['id']))

    def test_apply_stale_source_and_readback_failure_roll_back_atomically(self):
        row, queued, token, result, draft = self.draft()
        preview = self.admin_rpc('preview_apply', draft, job=draft['jobId'])
        before = self.row(row['id'])
        self.sql('UPDATE public.restaurants SET updated_at=clock_timestamp() WHERE id=%s', (row['id'],))
        with self.assertRaisesRegex(self.driver.Error, 'STALE'):
            self.confirm(preview, 'apply')
        self.assertEqual(self.worker('read', queued, token)['state'], 'draft')
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 1)
        # Restore only this synthetic row's exact timestamp to exercise a distinct
        # downstream failure, not to bypass a stale real operation.
        self.sql('UPDATE public.restaurants SET updated_at=%s WHERE id=%s', (before['updated_at'], row['id']))
        self.sql("CREATE FUNCTION public.fixture_recovery_readback_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.origin_name:='fixture-unexpected-source-change'; RETURN NEW; END $$; CREATE TRIGGER fixture_recovery_readback_failure BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.fixture_recovery_readback_failure()")
        self.addCleanup(lambda: self.sql('DROP TRIGGER fixture_recovery_readback_failure ON public.restaurants; DROP FUNCTION public.fixture_recovery_readback_failure()'))
        with self.assertRaisesRegex(self.driver.Error, 'READBACK_FAILED'):
            self.confirm(preview, 'apply')
        self.assertEqual(self.row(row['id']), before)
        self.assertEqual(self.worker('read', queued, token)['state'], 'draft')
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 1)
        self.assertEqual(self.scalar('SELECT state FROM pipeline_control.admin_record_operations WHERE id=%s', (preview['receipt']['operationId'],)), 'preview')

    def test_pending_authorship_and_policy_operator_changes_cannot_adopt_a_job(self):
        for field, value in [('status', 'pending'), ('created_by', str(uuid.uuid4())), ('updated_by_admin_id', self.actor)]:
            row, queued = self.request()
            self.sql('UPDATE public.restaurants SET ' + field + '=%s WHERE id=%s', (value, row['id']))
            retired = self.worker('claim', queued, str(uuid.uuid4()))
            self.assertEqual((retired['state'], retired['reason']), ('failed', 'source_changed'))
            self.assertNotIn('restaurant', retired)
            self.assertEqual(self.row(row['id'])[field], value)
            self.assertIsNone(self.scalar('SELECT worker_token FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=%s', (queued['jobId'],)))
        row, queued = self.request()
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET operator_id=%s', (str(uuid.uuid4()),))
        retired = self.worker('claim', queued, str(uuid.uuid4()))
        self.assertEqual((retired['state'], retired['reason']), ('failed', 'policy_changed'))
        self.assertEqual(self.row(row['id'])['status'], 'hold')

    def test_status_resumes_lost_request_preview_ack_without_a_new_operation(self):
        row = self.held()
        preview = self.admin_rpc('preview_request', self.context(row))
        status = self.rpc('status', (self.actor, row['id']))
        self.assertEqual(len(status['jobs']), 1)
        job = status['jobs'][0]
        self.assertEqual(job['state'], 'preview')
        self.assertEqual(job['requestOperationId'], preview['receipt']['operationId'])
        self.assertIsNone(job['receipt'])
        self.assertIsNone(job['proposal'])
        resumed = self.admin_rpc('read', {'restaurantId': row['id']}, job['requestOperationId'], job['jobId'])
        self.assertEqual(resumed, preview)
        queued = self.confirm(resumed, 'request')
        self.assertEqual(self.rpc('status', (self.actor, row['id']))['jobs'][0]['jobId'], queued['jobId'])
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_operations'), 1)

    def test_status_does_not_advertise_expired_unconfirmed_request_preview(self):
        row = self.held()
        preview = self.admin_rpc('preview_request', self.context(row))
        self.sql("UPDATE pipeline_control.admin_record_operations SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.rpc('status', (self.actor, row['id']))['jobs'], [])
        with self.assertRaisesRegex(self.driver.Error, 'PREVIEW_EXPIRED'):
            self.confirm(preview, 'request')
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.restaurant_evidence_recovery_jobs'), 0)

    def test_domain_result_type_errors_are_fixed_and_real_rule_fields_survive(self):
        row, queued = self.request()
        token = str(uuid.uuid4())
        claimed = self.worker('claim', queued, token)
        result = self.result(claimed)
        bad = [[{'provider_raw': 'fixture-only'}], {'evaluation_results': []},
               {**result, 'evaluation_results': []}, {**result, 'lat': '37'},
               {**result, 'geocoding_false_stage': 2147483648}]
        wrong = copy.deepcopy(result)
        wrong['evaluation_results']['location_match_TF']['provider_raw'] = 'fixture-only'
        bad.append(wrong)
        for value in bad:
            with self.assertRaisesRegex(self.driver.Error, 'EVIDENCE_RECOVERY_RESULT_INVALID'):
                self.rpc('worker', ('complete', queued['jobId'], token, baseline.Json(value)))
        real = copy.deepcopy(result)
        location = real['evaluation_results']['location_match_TF']
        location.update(matched_provider='naver', matched_name=row['origin_name'],
                        origin_address='fixture source address', matched_address={'jibunAddress': 'fixture business'},
                        naver_address=[{'jibunAddress': 'fixture business'}], evidence_summary=['fixture public evidence'],
                        second_pass={'attempted': False}, identity_state='fixture_review',
                        auto_closed_store=False, auto_relocated=False)
        draft = self.worker('complete', queued, token, real)
        proposal = self.rpc('status', (self.actor, row['id']))['jobs'][0]['proposal']
        self.assertEqual(proposal['evaluation_results']['location_match_TF'], location)
        self.assertEqual(draft['state'], 'draft')

    def test_queued_stale_unspent_request_retires_without_restaurant_write(self):
        row, queued = self.request()
        self.sql('UPDATE public.restaurants SET updated_at=clock_timestamp() WHERE id=%s', (row['id'],))
        current = self.row(row['id'])
        retired = self.worker('claim', queued, str(uuid.uuid4()))
        self.assertEqual((retired['state'], retired['reason']), ('failed', 'source_changed'))
        self.assertEqual(self.row(row['id']), current)
        self.assertNotIn('restaurant', retired)
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 1)
        self.assertTrue(self.scalar('SELECT worker_token IS NULL AND finished_at IS NOT NULL FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=%s', (queued['jobId'],)))
        # A fresh explicit preview can queue the changed input after confirmed
        # unspent retirement; this is not automatic retry or a new producer.
        _, fresh = self.request(row)
        self.assertNotEqual(fresh['jobId'], queued['jobId'])
        self.assertNotEqual(fresh['rowSha256'], queued['rowSha256'])
        self.assertEqual(fresh['inputSha256'], queued['inputSha256'])
        self.assertEqual(self.scalar('SELECT count(*) FROM pipeline_control.admin_record_audit'), 2)

    def test_next_is_readonly_oldest_queued_metadata_including_old_policy(self):
        token = str(uuid.uuid4())
        def next_job():
            return self.rpc('worker', ('next', None, token, baseline.Json({})))
        self.assertIsNone(next_job())
        first_row, first = self.request()
        _, second = self.request(self.held(youtube_link='https://www.youtube.com/watch?v=ZZZZZZZZZZZ'))
        before = self.scalar('SELECT jsonb_agg(to_jsonb(j) ORDER BY created_at,id) FROM pipeline_control.restaurant_evidence_recovery_jobs j')
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET version=3')
        found = next_job()
        self.assertEqual(found['jobId'], first['jobId'])
        self.assertEqual(found['policyVersion'], 2)
        self.assertIsNone(found['receipt'])
        self.assertNotIn('restaurant', found)
        self.assertEqual(self.scalar('SELECT jsonb_agg(to_jsonb(j) ORDER BY created_at,id) FROM pipeline_control.restaurant_evidence_recovery_jobs j'), before)
        self.assertEqual(self.worker('claim', first, token)['reason'], 'policy_changed')
        self.assertEqual(next_job()['jobId'], second['jobId'])
        self.assertEqual(self.worker('claim', second, str(uuid.uuid4()))['reason'], 'policy_changed')
        self.assertIsNone(next_job())
        _, fresh = self.request(first_row)
        self.assertEqual(next_job()['jobId'], fresh['jobId'])
        self.sql('UPDATE pipeline_control.restaurant_review_policy SET enabled=false')
        self.assertIsNone(next_job())
        self.assertEqual(self.scalar('SELECT state FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=%s', (fresh['jobId'],)), 'queued')

    def test_new_rpc_catalog_slice_matches_exact_allowlist_and_grantee_matrix(self):
        # The existing G014 public-RPC predicate, scoped to the four new real
        # objects. This does not stand in for its full definer/owner assertions.
        signatures = [
            'public.restaurant_evidence_recovery_context(uuid,uuid)',
            'public.restaurant_evidence_recovery_status(uuid,uuid)',
            'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
            'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)',
        ]
        for signature in signatures:
            self.assertEqual(self.scalar('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=%s', (signature,)), 1)
            self.assertTrue(self.scalar("""SELECT EXISTS(
              SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
              JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature)
              JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE a.source_signature=%s AND a.function_schema=n.nspname AND a.function_name=p.proname
                AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role'
                AND p.proowner='postgres'::regrole AND NOT p.prosecdef
                AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND p.prokind='f')""", (signature,)))
            self.assertFalse(self.scalar("""SELECT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              CROSS JOIN (VALUES ('anon'::name),('authenticated'::name),('service_role'::name)) roles(grantee)
              WHERE p.oid=to_regprocedure(%s)
                AND has_function_privilege(roles.grantee,p.oid,'EXECUTE') IS DISTINCT FROM EXISTS(
                  SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a WHERE a.function_schema=n.nspname
                    AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee=roles.grantee))""", (signature,)))
            self.assertFalse(self.scalar("""SELECT EXISTS(SELECT 1 FROM pg_proc p,
              LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
              WHERE p.oid=to_regprocedure(%s) AND (acl.grantee=0 OR acl.is_grantable
                OR acl.grantee NOT IN (p.proowner,'service_role'::regrole)))""", (signature,)))

    def test_other_channel_is_rejected_and_missing_channel_is_not_fabricated(self):
        other = self.held(channel_name='different-channel')
        with self.assertRaisesRegex(self.driver.Error, 'SOURCE_REQUIRED'):
            self.context(other)
        for channel in (None, ''):
            row, queued = self.request(self.held(channel_name=channel))
            claimed = self.worker('claim', queued, str(uuid.uuid4()))
            self.assertEqual(claimed['restaurant']['channel_name'], channel)
            self.assertEqual(self.row(row['id'])['channel_name'], channel)
        row, queued = self.request()
        self.sql("UPDATE public.restaurants SET channel_name='different-channel' WHERE id=%s", (row['id'],))
        retired = self.worker('claim', queued, str(uuid.uuid4()))
        self.assertEqual((retired['state'], retired['reason']), ('failed', 'source_changed'))
        self.assertNotIn('restaurant', retired)

    def canonical_checks(self):
        self.sql('SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); SELECT pg_temp.catalog_invoker_loop()')

    def test_g014_exact_addition_preserves_previous_bytes_metadata_and_memberships(self):
        with self.conn.cursor() as c:
            current = self.assertion_state(c)
        addition = invoker_fixture.tagged(SOURCE.read_text(), 'recovery_invoker')
        for name in ('definer', 'catalog'):
            key = 'assert_g014_' + name + '_contract'
            before = self.g014_prior_metadata[key]
            after = current[key]
            self.assertEqual({k: v for k, v in before.items() if k != 'prosrc'},
                             {k: v for k, v in after.items() if k != 'prosrc'})
            inserted = addition if name == 'definer' else addition.replace('v_signature', 'v_expected.source_signature').replace('v_oid', 'v_procedure')
            self.assertEqual(after['prosrc'].count(inserted), 1)
            self.assertEqual(after['prosrc'].replace(inserted, '', 1), before['prosrc'])
        self.assertEqual(self.scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m"), self.g014_prior_memberships)
        self.assertIsNone(self.scalar("SELECT to_regprocedure('pg_temp.evidence_recovery_registration()')"))
        self.canonical_checks()

    def test_g014_modes_acl_overloads_and_previous_unknown_invoker_guards(self):
        signatures = [
            'public.restaurant_evidence_recovery_context(uuid,uuid)', 'public.restaurant_evidence_recovery_status(uuid,uuid)',
            'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
            'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)',
        ]
        for signature in signatures:
            self.sql('BEGIN')
            try:
                self.sql('ALTER FUNCTION ' + signature + ' SECURITY DEFINER')
                with self.assertRaisesRegex(self.driver.Error, 'SECURITY INVOKER contract mismatch'):
                    self.canonical_checks()
            finally:
                self.sql('ROLLBACK')
        for mutation, expected in [
            ('GRANT EXECUTE ON FUNCTION ' + signatures[0] + ' TO anon', 'grantee matrix'),
            ('REVOKE EXECUTE ON FUNCTION ' + signatures[2] + ' FROM service_role', 'grantee matrix'),
            ('ALTER FUNCTION ' + signatures[1] + " SET lock_timeout='2s'", 'SECURITY INVOKER contract mismatch'),
            ('ALTER FUNCTION ' + signatures[1] + ' VOLATILE', 'SECURITY INVOKER contract mismatch'),
            ("CREATE FUNCTION public.restaurant_evidence_recovery_context(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$", 'unexpected overload'),
            ("ALTER FUNCTION public.is_user_admin(uuid) SECURITY INVOKER", 'required SECURITY DEFINER'),
            ("CREATE FUNCTION public.fixture_unknown_invoker() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS 'SELECT true'; REVOKE ALL ON FUNCTION public.fixture_unknown_invoker() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fixture_unknown_invoker() TO service_role; INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public','fixture_unknown_invoker',p.proargtypes::text,'service_role','public.fixture_unknown_invoker()' FROM pg_proc p WHERE p.oid='public.fixture_unknown_invoker()'::regprocedure", 'required SECURITY DEFINER'),
        ]:
            self.sql('BEGIN')
            try:
                self.sql(mutation)
                with self.assertRaisesRegex(self.driver.Error, expected):
                    self.canonical_checks()
            finally:
                self.sql('ROLLBACK')
        self.canonical_checks()

    def test_g014_source_drift_registration_rolls_back_without_permission_changes(self):
        source = SOURCE.read_text()
        start = source.index('DO $evidence_recovery_registration$')
        end = source.index('END $evidence_recovery_registration$;', start) + len('END $evidence_recovery_registration$;')
        registration = source[start:end]
        with self.conn.cursor() as c:
            before = self.assertion_state(c)
        members = self.scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m")
        self.sql('BEGIN')
        try:
            for definition in self.g014_prior_definitions.values():
                self.sql(definition)
            self.sql("DELETE FROM privacy_retention.g014_public_rpc_allowlist WHERE function_name LIKE 'restaurant_evidence_recovery_%'")
            definition = self.scalar("SELECT pg_get_functiondef('privacy_retention.assert_g014_definer_contract()'::regprocedure)")
            self.sql(definition.replace('END;\n', 'END;\n\n', 1))
            with self.assertRaisesRegex(self.driver.Error, 'G014_EVIDENCE_SOURCE_DRIFT'):
                self.sql(registration)
        finally:
            self.sql('ROLLBACK')
        with self.conn.cursor() as c:
            self.assertEqual(self.assertion_state(c), before)
        self.assertEqual(self.scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m"), members)
        self.assertIsNone(self.scalar("SELECT to_regprocedure('pg_temp.evidence_recovery_registration()')"))
        self.canonical_checks()

    def test_g014_non_superuser_owner_lease_restores_memberships(self):
        # All cluster-role changes below are UNCOMMITTED in the explicitly
        # authorized synthetic fixture and unconditionally rolled back. Other
        # connections retain their original roles; no Docker/hosted action.
        source = SOURCE.read_text()
        start = source.index('DO $evidence_recovery_registration$')
        end = source.index('END $evidence_recovery_registration$;', start) + len('END $evidence_recovery_registration$;')
        role_before = self.scalar("SELECT to_jsonb(r) FROM pg_roles r WHERE rolname='postgres'")
        members_before = self.scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m")
        self.assertTrue(role_before['rolsuper'])
        self.assertTrue(role_before['rolcreaterole'])
        self.sql('BEGIN')
        try:
            for definition in self.g014_prior_definitions.values():
                self.sql(definition)
            self.sql("DELETE FROM privacy_retention.g014_public_rpc_allowlist WHERE function_name LIKE 'restaurant_evidence_recovery_%'")
            if os.environ['TZUDONG_EXPECTED_PG_MAJOR'] == '17':
                # Model the platform-granted ADMIN-only edge, separate from
                # the installer's short SET-only self-grant used by the bridge.
                # A distinct platform-like grantor avoids granting ADMIN back
                # to its own grantor. This role never commits or permits login.
                grantor = 'evidence_fixture_' + uuid.uuid4().hex
                self.sql('CREATE ROLE ' + grantor + ' NOLOGIN SUPERUSER; SET LOCAL ROLE ' + grantor + '; GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; RESET ROLE')
            self.sql('ALTER ROLE postgres NOSUPERUSER NOINHERIT NOBYPASSRLS')
            self.assertFalse(self.scalar("SELECT rolsuper FROM pg_roles WHERE rolname='postgres'"))
            self.sql(source[start:end])
            self.assertFalse(self.scalar("SELECT pg_has_role('postgres','privacy_workflow_owner','USAGE')"))
            predicate = 'SET' if os.environ['TZUDONG_EXPECTED_PG_MAJOR'] == '17' else 'MEMBER'
            self.assertFalse(self.scalar('SELECT pg_has_role(%s,%s,%s)', ('postgres', 'privacy_workflow_owner', predicate)))
        finally:
            self.sql('ROLLBACK')
        self.assertEqual(self.scalar("SELECT to_jsonb(r) FROM pg_roles r WHERE rolname='postgres'"), role_before)
        self.assertEqual(self.scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m"), members_before)
        self.assertIsNone(self.scalar("SELECT to_regprocedure('pg_temp.evidence_recovery_registration()')"))
        self.canonical_checks()

    def test_release_manifest_readback_binds_sources_and_rejects_permission_drift(self):
        manifest = json.loads((SOURCE.parents[3] / '.github/restaurant-evidence-recovery-installation.v1.json').read_text())
        entry = manifest['migration']
        self.assertEqual(entry['id'], 'restaurant_evidence_recovery')
        self.assertEqual(entry['sha256'], hashlib.sha256(SOURCE.read_bytes()).hexdigest())

        def observe(contract):
            with self.conn.cursor() as cursor:
                cursor.execute(contract['query'])
                return json.loads(cursor.fetchone()[0])

        self.assertEqual(observe(entry['terminalReadback']), entry['terminalReadback']['expected'])
        self.assertEqual(observe(entry['expectedPriorState']), {'restaurant_evidence_recovery_absent': False})
        for mutation in [
            'GRANT EXECUTE ON FUNCTION public.restaurant_evidence_recovery_context(uuid,uuid) TO anon',
            'REVOKE UPDATE ON pipeline_control.restaurant_evidence_recovery_jobs FROM service_role',
            'ALTER FUNCTION public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb) SECURITY DEFINER',
        ]:
            self.sql('BEGIN')
            try:
                self.sql(mutation)
                self.assertEqual(observe(entry['terminalReadback']), {'restaurant_evidence_recovery_verified': False})
            finally:
                self.sql('ROLLBACK')
        self.assertEqual(observe(entry['terminalReadback']), entry['terminalReadback']['expected'])


if __name__ == '__main__':
    unittest.main()
