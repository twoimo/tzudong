"""Real private-schema observations; no hosted mutation or fabricated approvals."""
import copy
import hashlib
import json
import os
import sys
import subprocess
import importlib.util
import py_compile
import ssl
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
        conn=Mock();conn.info.transaction_status=0;conn.cursor.side_effect=RuntimeError('private provider diagnostics')
        with self.assertRaisesRegex(observation.ObservationError,'^release_observation_unavailable$'):
            observation.collect(conn)
        conn.rollback.assert_called_once();conn.close.assert_called_once()

    def test_close_still_runs_after_rollback_failure(self):
        conn=Mock();conn.info.transaction_status=0;conn.cursor.side_effect=RuntimeError('provider detail')
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

    def test_existing_snapshot_is_rejected_and_fresh_connection_sees_new_policy(self):
        conn=self.psycopg.connect(host=self.tmp.name,dbname='postgres')
        conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        self.assertEqual(conn.execute('SELECT count(*) FROM privacy_retention.privacy_policy_versions').fetchone()[0],0)
        with self.psycopg.connect(host=self.tmp.name,dbname='postgres') as writer:
            writer.execute("INSERT INTO privacy_retention.privacy_policy_versions VALUES ('new-policy','ko-KR','published',%s,now()-interval '1 hour',now()-interval '1 hour','fixture-reference')",('a'*64,))
        with self.assertRaisesRegex(observation.ObservationError,'transaction_not_idle'):
            observation.collect(conn)
        self.assertTrue(conn.closed)
        self.assertEqual(self.collect()['policy']['version'],'new-policy')
        self.assertFalse(hasattr(observation,'receipt'))

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
    """Transport mocks are not hosted evidence; source/cache tests use real Git."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.names=['backend/supabase/scripts/release_readiness_observation.py',
                    'backend/supabase/scripts/release_readiness_observation.sql',
                    'backend/supabase/scripts/release_readiness_receipt.py',
                    'backend/supabase/certificates/prod-ca-2021.crt']
        for name in self.names:
            dest=self.root/name;dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes((observation.REPOSITORY_ROOT/name).read_bytes())
        self.git('init','-q');self.git('add','.');self.commit()
        self.sha=self.git('rev-parse','HEAD').decode().strip()
        path=self.root/self.names[2]
        spec=importlib.util.spec_from_file_location('test_receipt_launcher',path)
        self.launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.launcher)
        self.bundle=self.launcher.bundle_for(self.sha)
        self.value={'schemaVersion':1,'observedAt':'2026-09-05T00:00:00+00:00',
          'transactionReadOnly':True,'ledger':{'count':0,'terminalVersion':None},'policy':None,
          'retention':[{'code':code,'present':False,'configured':False} for code in sorted(observation.AUDIT_CLASSES)],
          'privateRelations':[],'unvalidatedPublicConstraints':0,'mutablePublicFunctionPaths':0}

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL)

    def commit(self):
        self.git('-c','user.name=Fixture','-c','user.email=fixture@local.invalid','commit','-qm','Fixture')

    def connection(self):
        conn=MagicMock()
        conn.info=SimpleNamespace(host=observation.DIRECT_HOST,hostaddr='1.1.1.1',dbname='postgres',
            port=5432,status=0,transaction_status=0,get_parameters=lambda:{'sslmode':'verify-full'})
        conn.pgconn=SimpleNamespace(ssl_in_use=True)
        conn.cursor.return_value.__enter__.return_value.fetchone.side_effect=[(True,True),(self.value,)]
        return conn

    def test_owned_connection_pins_trust_and_collects_committed_sql(self):
        executor=self.launcher.compiled_executor(self.bundle);conn=self.connection()
        captured={}
        def connect(**kwargs):
            captured.update(kwargs);captured['ca_bytes']=Path(kwargs['sslrootcert']).read_bytes()
            return conn
        with patch('psycopg.connect',side_effect=connect):
            result=executor['_receipt_from_bundle'](self.bundle,'fixture-role','fixture-pass')
        self.assertEqual(captured['host'],observation.DIRECT_HOST)
        self.assertEqual(captured['hostaddr'],'')
        self.assertEqual(captured['sslmode'],'verify-full')
        self.assertEqual(captured['ca_bytes'],self.bundle['ca_bytes'])
        self.assertTrue(captured['autocommit'])
        self.assertEqual(result['schemaVersion'],3)
        self.assertEqual(result['executorSha256'],hashlib.sha256(self.bundle['executor_bytes']).hexdigest())
        self.assertEqual(result['targetIdentity']['trustAnchorSha256'],'807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa')
        self.assertNotIn('fixture-pass',json.dumps(result))
        digest=result.pop('receiptSha256')
        self.assertEqual(digest,hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest())
        conn.rollback.assert_called_once();conn.close.assert_called_once()

    def test_nonidle_or_wrong_isolation_never_collects_metadata(self):
        executor=self.launcher.compiled_executor(self.bundle)
        for state,first in [(2,(True,True)),(0,(True,False))]:
            conn=self.connection();conn.info.transaction_status=state
            cursor=conn.cursor.return_value.__enter__.return_value
            cursor.fetchone.side_effect=[first,(self.value,)]
            with patch('psycopg.connect',return_value=conn):
                with self.assertRaises(executor['ObservationError']):
                    executor['_receipt_from_bundle'](self.bundle,'fixture-role','fixture-pass')
            self.assertLess(cursor.execute.call_count,3);conn.close.assert_called_once()

    def test_fake_ca_and_local_peer_are_denied(self):
        bad=dict(self.bundle)
        roots=ssl.create_default_context().get_ca_certs(binary_form=True)
        wrong=next(cert for cert in roots if hashlib.sha256(cert).hexdigest()!='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa')
        bad['ca_bytes']=ssl.DER_cert_to_PEM_cert(wrong).encode('ascii')
        executor=self.launcher.compiled_executor(bad)
        with patch('psycopg.connect') as connect:
            with self.assertRaises(executor['ObservationError']):
                executor['_receipt_from_bundle'](bad,'fixture-role','fixture-pass')
            connect.assert_not_called()
        executor=self.launcher.compiled_executor(self.bundle);conn=self.connection();conn.info.hostaddr='127.0.0.1'
        with patch('psycopg.connect',return_value=conn):
            with self.assertRaises(executor['ObservationError']):
                executor['_receipt_from_bundle'](self.bundle,'fixture-role','fixture-pass')
        conn.cursor.assert_not_called();conn.close.assert_called_once()

    def test_credentials_reject_peer_and_trust_overrides(self):
        with tempfile.TemporaryDirectory() as outside:
            p=Path(outside)/'credentials.json'
            for key in ['host','hostaddr','sslrootcert','sslmode','options','service']:
                p.write_text(json.dumps({'user':'fixture-role','password':'fixture-pass',key:'override'}));p.chmod(0o600)
                with self.assertRaises(self.launcher.ReceiptError):self.launcher.credentials_from(p)

    def test_fabricated_commit_or_changed_working_files_are_denied(self):
        with self.assertRaises(self.launcher.ReceiptError):self.launcher.bundle_for('f'*40)
        for name in self.names:
            p=self.root/name;original=p.read_bytes();p.write_bytes(original+b'\n')
            with self.assertRaises(self.launcher.ReceiptError):self.launcher.bundle_for(self.sha)
            p.write_bytes(original)

    def test_timestamp_cache_cannot_select_executor(self):
        p=self.root/self.names[0];good=p.read_bytes();stamp=p.stat().st_mtime
        bad=good.replace(b"PROJECT_REF = 'aqlcofblfxdrjhhdmarw'",b"PROJECT_REF = 'xxxxxxxxxxxxxxxxxxxx'")
        self.assertEqual(len(good),len(bad));self.assertNotEqual(good,bad)
        p.write_bytes(bad);os.utime(p,(stamp,stamp));py_compile.compile(str(p),doraise=True,invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
        p.write_bytes(good);os.utime(p,(stamp,stamp))
        control_spec=importlib.util.spec_from_file_location('poisoned_cache_control',p)
        control=importlib.util.module_from_spec(control_spec);control_spec.loader.exec_module(control)
        self.assertEqual(control.PROJECT_REF,'x'*20)
        run=subprocess.run([sys.executable,'-I',str(self.root/self.names[2]),'--source-sha',self.sha,'--verify-source-only'],capture_output=True,text=True)
        self.assertEqual(run.returncode,0)
        result=json.loads(run.stdout)
        self.assertTrue(result['sourceSnapshotCompiled'])
        self.assertEqual(result['projectRef'],observation.PROJECT_REF)
        self.assertEqual(result['executorSha256'],hashlib.sha256(good).hexdigest())

    def test_cli_argument_errors_do_not_echo_inputs(self):
        run=subprocess.run([sys.executable,'-I',str(self.root/self.names[2]),
            '--source-sha',self.sha,'--unexpected-private-input','private-fixture-value'],capture_output=True,text=True)
        self.assertEqual(run.returncode,1)
        self.assertEqual(run.stderr,'')
        self.assertNotIn('private-fixture-value',run.stdout)
        self.assertEqual(json.loads(run.stdout)['code'],'release_observation_receipt_unavailable')
