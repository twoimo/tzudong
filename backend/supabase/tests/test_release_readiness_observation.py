"""Real private-schema observations; no hosted mutation or fabricated approvals."""
import copy
import hashlib
import json
import os
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import release_readiness_observation as observation
from backend.supabase.tests import test_g037_readonly_transaction_postgres as postgres_fixture


class CleanupTests(unittest.TestCase):
    def test_provider_error_is_fixed_code_and_connection_closes(self):
        conn=Mock();conn.cursor.side_effect=RuntimeError('private provider diagnostics')
        with self.assertRaisesRegex(observation.ObservationError,'^release_observation_unavailable$'):
            observation.collect(conn)
        conn.rollback.assert_called_once();conn.close.assert_called_once()

    def test_close_still_runs_after_rollback_failure(self):
        conn=Mock();conn.cursor.side_effect=RuntimeError('provider detail')
        conn.rollback.side_effect=RuntimeError('sensitive cleanup detail')
        with self.assertRaisesRegex(observation.ObservationError,'^release_observation_cleanup_failed$'):
            observation.collect(conn)
        conn.close.assert_called_once()


@unittest.skipUnless(os.environ.get('TZUDONG_TEST_POSTGRES_BIN'),'isolated postgres opt-in absent')
class ObservationPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        postgres_fixture.ReadonlyTransactionTests.setUpClass.__func__(cls)
        with cls.psycopg.connect(host=cls.tmp.name,dbname='postgres') as conn:
            conn.execute('''CREATE SCHEMA privacy_retention;
                CREATE TABLE privacy_retention.privacy_policy_versions(
                 version text,locale text,status text,content_sha256 text,effective_at timestamptz,
                 published_at timestamptz,operator_approval_ref text);
                CREATE TABLE privacy_retention.privacy_retention_classes(
                 code text PRIMARY KEY,data_class text,basis_code text,trigger_type text,
                 retention_period interval,status text,approved_evidence_ref text,version text,activated_at timestamptz);
                CREATE TABLE privacy_retention.privacy_audit_events(id integer);
                ALTER TABLE privacy_retention.privacy_policy_versions ENABLE ROW LEVEL SECURITY;
                ALTER TABLE privacy_retention.privacy_retention_classes ENABLE ROW LEVEL SECURITY;
                ALTER TABLE privacy_retention.privacy_audit_events ENABLE ROW LEVEL SECURITY;
                ALTER TABLE privacy_retention.privacy_audit_events FORCE ROW LEVEL SECURITY;''')

    def setUp(self):
        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as conn:
            conn.execute('TRUNCATE privacy_retention.privacy_policy_versions,privacy_retention.privacy_retention_classes')

    def collect(self):
        conn=self.psycopg.connect(host=self.tmp.name,dbname='postgres')
        value=observation.collect(conn)
        self.assertTrue(conn.closed)
        return value

    def test_missing_policy_and_classes_are_observed_without_false_readiness(self):
        value=self.collect()
        self.assertTrue(value['transactionReadOnly'])
        self.assertIsNone(value['policy'])
        self.assertEqual(value['ledger'],{'count':0,'terminalVersion':None})
        self.assertEqual(len(value['retention']),6)
        self.assertTrue(all(not x['present'] and not x['configured'] for x in value['retention']))
        self.assertTrue(all(x['rls'] for x in value['privateRelations']))
        self.assertTrue(next(x for x in value['privateRelations'] if x['name']=='privacy_audit_events')['forceRls'])

    def test_exact_private_schema_policy_and_configured_classes_are_minimized(self):
        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as conn:
            conn.execute("INSERT INTO privacy_retention.privacy_policy_versions VALUES ('fixture-v1','ko-KR','published',%s,now()-interval '1 hour',now()-interval '1 hour','private-reference-not-for-output')",('a'*64,))
            conn.execute("INSERT INTO privacy_retention.privacy_retention_classes VALUES ('privacy_identity_audit','privacy_identity_audit','fixture_basis','event_occurred',interval '1 hour','active','private-reference-not-for-output','fixture-v1',now()-interval '1 hour')")
        value=self.collect()
        self.assertEqual(value['policy']['version'],'fixture-v1')
        self.assertTrue(value['policy']['approval_reference_present'])
        self.assertEqual([x['code'] for x in value['retention'] if x['configured']],['privacy_identity_audit'])
        self.assertNotIn('private-reference-not-for-output',json.dumps(value))

    def test_real_local_cluster_cannot_issue_production_receipt(self):
        conn=self.psycopg.connect(host=self.tmp.name,dbname='postgres')
        with self.assertRaisesRegex(observation.ObservationError,'^release_observation_target_unverified$'):
            observation.receipt(conn,source_sha='f'*40)
        self.assertTrue(conn.closed)

    def test_schema_rejects_extra_sensitive_fields_duplicates_and_write_transaction(self):
        value=self.collect()
        for mutate in (lambda x:x.update(rawProviderError='sensitive'),
                       lambda x:x.update(transactionReadOnly=False),
                       lambda x:x['retention'].__setitem__(1,copy.deepcopy(x['retention'][0])),
                       lambda x:x['ledger'].update(count=True),
                       lambda x:x['ledger'].update(terminalVersion='20260905')):
            invalid=copy.deepcopy(value);mutate(invalid)
            with self.assertRaises(observation.ObservationError):observation.validate(invalid)

    def test_active_label_without_period_or_wrong_trigger_is_not_configured(self):
        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as conn:
            conn.execute("INSERT INTO privacy_retention.privacy_retention_classes VALUES ('privacy_identity_audit','privacy_identity_audit','fixture_basis','event_occurred',NULL,'active','fixture-reference','fixture-v1',now())")
        value=self.collect()
        row=next(x for x in value['retention'] if x['code']=='privacy_identity_audit')
        self.assertTrue(row['present']);self.assertFalse(row['configured'])

        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as conn:
            conn.execute("UPDATE privacy_retention.privacy_retention_classes SET retention_period=interval '1 hour',trigger_type='different_trigger'")
        row=next(x for x in self.collect()['retention'] if x['code']=='privacy_identity_audit')
        self.assertFalse(row['configured'])

    def test_operational_class_does_not_inherit_audit_only_trigger_requirement(self):
        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as conn:
            conn.execute("INSERT INTO privacy_retention.privacy_retention_classes VALUES ('notifications_operational','notification','fixture_basis','created_at',interval '1 hour','active','fixture-reference','fixture-v1',now())")
        row=next(x for x in self.collect()['retention'] if x['code']=='notifications_operational')
        self.assertTrue(row['configured'])


class ReceiptBindingTests(unittest.TestCase):
    """Mock TLS transport tests are never hosted-production evidence."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        directory=self.root/'backend/supabase/scripts';directory.mkdir(parents=True)
        (directory/observation.SQL_PATH.name).write_bytes(observation.SQL_PATH.read_bytes())
        (directory/'release_readiness_observation.py').write_bytes(observation.EXECUTOR_BYTES)
        self.git('init','-q');self.git('add','.')
        self.git('-c','user.name=Fixture','-c','user.email=fixture@local.invalid','commit','-qm','Source fixture')
        self.sha=self.git('rev-parse','HEAD').decode().strip()
        self.addCleanup(patch.stopall)
        patch.object(observation,'REPOSITORY_ROOT',self.root).start()
        self.value={'schemaVersion':1,'observedAt':'2026-09-05T00:00:00+00:00',
          'transactionReadOnly':True,'ledger':{'count':0,'terminalVersion':None},'policy':None,
          'retention':[{'code':code,'present':False,'configured':False} for code in sorted(observation.AUDIT_CLASSES)],
          'privateRelations':[],'unvalidatedPublicConstraints':0,'mutablePublicFunctionPaths':0}

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL)

    def connection(self):
        conn=MagicMock()
        conn.info=SimpleNamespace(host=observation.DIRECT_HOST,dbname='postgres',port=5432,status=0,
                                 get_parameters=lambda:{'sslmode':'verify-full'})
        conn.pgconn=SimpleNamespace(ssl_in_use=True)
        conn.cursor.return_value.__enter__.return_value.fetchone.return_value=(self.value,)
        return conn

    def test_receipt_binds_verified_transport_and_real_committed_files(self):
        conn=self.connection()
        result=observation.receipt(conn,source_sha=self.sha)
        self.assertEqual(result['sourceSha'],self.sha)
        self.assertEqual(result['projectRef'],observation.PROJECT_REF)
        self.assertEqual(result['executorSha256'],hashlib.sha256(observation.EXECUTOR_BYTES).hexdigest())
        digest=result.pop('receiptSha256')
        self.assertEqual(digest,hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest())
        self.assertFalse(result['releaseApprovalEstablished'])
        conn.rollback.assert_called_once();conn.close.assert_called_once()

    def test_wrong_project_pooler_database_and_unverified_tls_are_denied_before_query(self):
        for field,value in [('host','db.wrong-project.supabase.co'),('host','127.0.0.1'),
                            ('host','aws-0-ap-southeast-1.pooler.supabase.com'),
                            ('dbname','other'),('port',6543),('status',1)]:
            with self.subTest(field=field,value=value):
                conn=self.connection();setattr(conn.info,field,value)
                with self.assertRaisesRegex(observation.ObservationError,'target_unverified'):
                    observation.receipt(conn,source_sha=self.sha)
                conn.cursor.assert_not_called();conn.close.assert_called_once()
        for mode,tls in [('require',True),('verify-ca',True),('verify-full',False)]:
            conn=self.connection();conn.info.get_parameters=lambda:{'sslmode':mode};conn.pgconn.ssl_in_use=tls
            with self.assertRaisesRegex(observation.ObservationError,'target_unverified'):
                observation.receipt(conn,source_sha=self.sha)
            conn.cursor.assert_not_called();conn.close.assert_called_once()

    def test_nonexistent_commit_and_changed_sql_or_executor_are_denied(self):
        conn=self.connection()
        with self.assertRaisesRegex(observation.ObservationError,'source_unverified'):
            observation.receipt(conn,source_sha='f'*40)
        conn.cursor.assert_not_called();conn.close.assert_called_once()
        for name in ['release_readiness_observation.sql','release_readiness_observation.py']:
            (self.root/'backend/supabase/scripts/release_readiness_observation.sql').write_bytes(observation.SQL_PATH.read_bytes())
            (self.root/'backend/supabase/scripts/release_readiness_observation.py').write_bytes(observation.EXECUTOR_BYTES)
            file=self.root/'backend/supabase/scripts'/name
            file.write_bytes(file.read_bytes()+b'\n')
            self.git('add','.');self.git('-c','user.name=Fixture','-c','user.email=fixture@local.invalid','commit','-qm','Changed fixture')
            sha=self.git('rev-parse','HEAD').decode().strip();conn=self.connection()
            with self.assertRaisesRegex(observation.ObservationError,'source_unverified'):
                observation.receipt(conn,source_sha=sha)
            conn.cursor.assert_not_called();conn.close.assert_called_once()

    def test_query_uses_captured_verified_sql_even_if_disk_changes(self):
        copied=self.root/'backend/supabase/scripts/release_readiness_observation.sql'
        sql=copied.read_bytes()
        with patch.object(observation,'SQL_PATH',copied):
            conn=self.connection();cursor=conn.cursor.return_value.__enter__.return_value
            def execute(command):
                if command.startswith('BEGIN'):copied.write_bytes(b'SELECT 0;')
            cursor.execute.side_effect=execute
            result=observation.receipt(conn,source_sha=self.sha)
        self.assertEqual(cursor.execute.call_args_list[1].args[0],sql.decode())
        self.assertEqual(result['sqlSha256'],hashlib.sha256(sql).hexdigest())
