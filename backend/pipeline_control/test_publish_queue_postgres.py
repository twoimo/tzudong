"""Real local PostgreSQL contracts; opt in with TZUDONG_TEST_POSTGRES_BIN.

Creates an isolated cluster with private Unix socket, no TCP listener, no hosted
credentials and no access to any existing database. Always stops that cluster.
"""
from __future__ import annotations
import os
from decimal import Decimal
from datetime import date, datetime, timezone
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

from backend.pipeline_control.publish_queue import PublishQueueStore, PublishQueueConsumer, admit_runtime, canonical_pg_value, load_source_request, LOCAL_SEED_RESTAURANT_IDS
from backend.pipeline_control.publish_worker import PublishWorker, PublicationSet
from backend.pipeline_control.agent_action_store import PostgresAgentActionStore
from backend.pipeline_control import ops_agent as oa
from backend.pipeline_control.test_publish_apply_unittest import _publication_set, _request, _video_row, FakeHosted, _ACTIVE_SCHEDULE

ROOT = Path(__file__).resolve().parents[1]


class RuntimeAdmissionTests(unittest.TestCase):
    def test_seed_exclusion_covers_the_canonical_restaurant_fixtures(self):
        import re
        source = (ROOT / 'supabase/scripts/local-seed.sql').read_text()
        rows = source.split('INSERT INTO public.restaurants (', 1)[1].split('ON CONFLICT', 1)[0]
        identities = set(re.findall(r"'([0-9a-f]{8}-[0-9a-f-]{27})'", rows))
        self.assertEqual(identities, set(LOCAL_SEED_RESTAURANT_IDS))
    def test_postgres_scalars_are_lossless_and_scale_stable(self):
        identifier = uuid4()
        value = canonical_pg_value({'lat': Decimal('37.1234567890123456789012345678900'),
            'lng': Decimal('-0.000'), 'id': identifier, 'day': date(2026,9,5),
            'at': datetime(2026,9,5,tzinfo=timezone.utc), 'nested': [Decimal('1E+3')]})
        self.assertEqual(value['lat'], '37.12345678901234567890123456789')
        self.assertEqual(value['lng'], '0')
        self.assertEqual(value['id'], str(identifier))
        self.assertEqual(value['nested'], ['1000'])
        for invalid in ('NaN','Infinity','-Infinity'):
            with self.assertRaises(ValueError): canonical_pg_value(Decimal(invalid))

    def test_runtime_rejects_hosted_queue_and_uncleared_destination(self):
        base = {'TZUDONG_PUBLISH_QUEUE_ENABLED': '1', 'PIPELINE_CONTROL_DSN': 'postgresql://localhost/queue',
                'TZUDONG_PUBLICATION_DATA_ENV': 'local_db', 'TZUDONG_PUBLICATION_DSN': 'postgresql://[::1]/fixture'}
        self.assertEqual(admit_runtime(base), (base['PIPELINE_CONTROL_DSN'],base['TZUDONG_PUBLICATION_DSN']))
        for delta in (
            {'TZUDONG_PUBLISH_QUEUE_ENABLED': '0'},
            {'PIPELINE_CONTROL_DSN': 'postgresql://db.aqlcofblfxdrjhhdmarw.supabase.co/postgres'},
            {'TZUDONG_PUBLICATION_DATA_ENV': 'hosting_db',
             'TZUDONG_PUBLICATION_DSN': 'postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co/postgres?sslmode=verify-full'},
            {'TZUDONG_PUBLICATION_DATA_ENV': 'hosting_db', 'G037_WRITE_FREEZE': 'cleared',
             'TZUDONG_HOSTED_DATA_PLANE_APPROVED': '1',
             'TZUDONG_PUBLICATION_DSN': 'postgresql://postgres.aqlcofblfxdrjhhdmarw@invalid.example/postgres?sslmode=verify-full'},
        ):
            with self.assertRaises(Exception): admit_runtime({**base, **delta})


@unittest.skipUnless(os.environ.get('TZUDONG_TEST_POSTGRES_BIN'), 'isolated postgres opt-in absent')
class DurableBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.psycopg2 = psycopg2
        cls.tmp = tempfile.TemporaryDirectory(prefix='tzq-', dir='/tmp')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.bindir = Path(os.environ['TZUDONG_TEST_POSTGRES_BIN'])
        cls.data = Path(cls.tmp.name) / 'data'
        def run(*args):
            subprocess.run([str(cls.bindir / args[0]), *args[1:]], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.run_pg = staticmethod(run)
        run('initdb','-D',str(cls.data),'-A','trust','--no-locale','--encoding=UTF8')
        run('pg_ctl','-D',str(cls.data),'-l',str(Path(cls.tmp.name) / 'server.log'),
            '-o',f"-c listen_addresses='' -c unix_socket_directories='{cls.tmp.name}'",'-w','start')
        cls.addClassCleanup(lambda: run('pg_ctl','-D',str(cls.data),'-m','immediate','-w','stop'))
        cls.dsn = f'dbname=postgres host={cls.tmp.name}'
        with psycopg2.connect(cls.dsn) as c:
            with c.cursor() as cur:
                cur.execute('CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;')
                for name in ('20260901000100_local_analytics_schema.sql','20260905000100_local_agent_terminal_results.sql',
                             '20260905000200_local_agent_rate_budget.sql'):
                    cur.execute((ROOT / 'supabase/migrations' / name).read_text())

    def connection(self):
        conn = self.psycopg2.connect(self.dsn)
        self.addCleanup(conn.close)
        with conn.cursor() as cur: cur.execute('SET ROLE service_role')
        conn.commit()
        return conn

    def setUp(self):
        # This cluster belongs exclusively to this test class.
        with self.psycopg2.connect(self.dsn) as c:
            with c.cursor() as cur:
                cur.execute('TRUNCATE local_analytics.publish_jobs,local_analytics.publish_history,local_analytics.publish_audit_events')
                cur.execute('TRUNCATE local_analytics.agent_action_budget_claims,local_analytics.agent_action_results,local_analytics.agent_action_records')
        self.conn = self.connection()
        self.store = PublishQueueStore(self.conn)
        self.hosted = FakeHosted({'public.videos': ('id',)})
        self.rows = [_video_row('fixture-video')]
        self.worker = PublishWorker(_publication_set(), _ACTIVE_SCHEDULE, time.time)
        self.consumer = PublishQueueConsumer(self.store, self.worker,
            lambda job: {**_request(self.rows), 'publishJobId': job}, self.hosted)
        self.job_id = str(uuid4())
        with self.conn.cursor() as c:
            c.execute("INSERT INTO local_analytics.publish_jobs(publish_job_id,requested_by) VALUES(%s,'fixture-operator')",(self.job_id,))
        self.conn.commit()

    def scalar(self, sql, params=()):
        with self.conn.cursor() as c:
            c.execute(sql,params); row = c.fetchone()
        self.conn.commit()
        return row[0] if row else None

    def test_queue_moves_from_request_through_explicit_confirmation_to_durable_audit(self):
        preview = self.consumer.preview_once()
        self.assertEqual(preview['status'], 'preview')
        self.assertEqual(self.hosted.apply_calls, [])
        self.assertEqual(self.consumer.apply_once(), {'status': 'idle'})
        self.assertEqual(self.consumer.confirm(self.job_id, preview['previewHash'])['status'], 'confirmed')
        self.assertEqual(self.consumer.apply_once()['status'], 'succeeded')
        self.assertEqual(self.scalar('SELECT status FROM local_analytics.publish_jobs WHERE publish_job_id=%s',(self.job_id,)), 'succeeded')
        self.assertEqual(self.scalar('SELECT count(*) FROM local_analytics.publish_history WHERE publish_job_id=%s',(self.job_id,)), 4)
        self.assertEqual(self.scalar('SELECT count(*) FROM local_analytics.publish_audit_events WHERE publish_job_id=%s',(self.job_id,)), 4)
        self.assertEqual(self.consumer.apply_once(), {'status': 'idle'})
        self.assertEqual(len(self.hosted.apply_calls), 1)

    def test_confirmation_is_durable_before_apply_and_survives_claim_interruption(self):
        preview = self.consumer.preview_once()
        self.consumer.confirm(self.job_id, preview['previewHash'])
        self.assertEqual(self.hosted.apply_calls, [])
        other = self.connection()
        with other.cursor() as c:
            c.execute("SELECT h.preview_hash,a.result_code FROM local_analytics.publish_jobs j "
                      "JOIN local_analytics.publish_history h USING(publish_job_id) "
                      "JOIN local_analytics.publish_audit_events a USING(publish_job_id) "
                      "WHERE j.status='confirmed' AND h.stage='confirm' AND a.stage='confirm'")
            self.assertEqual(c.fetchone(), (preview['previewHash'], 'confirm_admitted'))
        other.commit()
        self.store.claim('confirmed')
        with other.cursor() as c:
            c.execute("SELECT count(*) FROM local_analytics.publish_history WHERE stage='confirm'")
            self.assertEqual(c.fetchone()[0], 1)
        self.assertEqual(self.hosted.apply_calls, [])

    def test_real_numeric_restaurant_rows_reach_preview_apply_and_readback(self):
        from backend.pipeline_control.publication_adapter import _RESTAURANT_COLUMNS
        table = PublishWorker.from_ledger().publication_set.tables['public.restaurants']
        worker = PublishWorker(PublicationSet(tables={table.key:table}, approval_status='approved',
            approval_reference_valid=True), _ACTIVE_SCHEDULE, time.time)
        with self.psycopg2.connect(self.dsn) as conn:
            with conn.cursor() as c:
                columns = ','.join(name + (' numeric' if name in {'lat','lng'} else ' text') for name in sorted(_RESTAURANT_COLUMNS))
                c.execute('CREATE TABLE public.restaurants(id uuid PRIMARY KEY,'+columns+')')
                c.execute('INSERT INTO public.restaurants(id,lat,lng) VALUES (%s,%s,%s)',
                    (str(uuid4()), Decimal('37.1234567890123456789012345678900'),Decimal('127.5000')))
                for seed_id in LOCAL_SEED_RESTAURANT_IDS:
                    c.execute('INSERT INTO public.restaurants(id,approved_name) VALUES (%s,%s)',
                              (seed_id, 'unmarked local fixture'))
                c.execute('GRANT SELECT ON public.restaurants TO service_role')
        hosted = FakeHosted({'public.restaurants': ('id',)})
        consumer = PublishQueueConsumer(self.store, worker,
            lambda job: load_source_request(self.conn, worker, job), hosted)
        preview = consumer.preview_once()
        self.assertEqual(preview['status'], 'preview')
        self.assertEqual(consumer.confirm(self.job_id, preview['previewHash'])['status'],'confirmed')
        self.assertEqual(consumer.apply_once()['status'], 'succeeded')
        row = next(iter(hosted.store['public.restaurants'].values()))
        self.assertEqual(len(hosted.store['public.restaurants']), 1)
        self.assertNotIn(row['id'], LOCAL_SEED_RESTAURANT_IDS)
        self.assertEqual(row['lat'], '37.12345678901234567890123456789')
        self.assertEqual(row['lng'], '127.5')

    def test_locked_request_and_committed_apply_claim_cannot_be_claimed_twice(self):
        self.assertIsNotNone(self.store.claim('requested'))
        other = PublishQueueStore(self.connection())
        self.assertIsNone(other.claim('requested'))
        self.conn.rollback()
        preview = self.consumer.preview_once()
        self.consumer.confirm(self.job_id, preview['previewHash'])
        self.assertIsNotNone(self.store.claim('confirmed'))
        self.assertIsNone(other.claim('confirmed'))
        self.assertEqual(self.scalar('SELECT status FROM local_analytics.publish_jobs'), 'applying')

    def test_changed_source_and_expired_confirmation_never_write(self):
        preview = self.consumer.preview_once()
        self.consumer.confirm(self.job_id, preview['previewHash'])
        self.rows = [_video_row('fixture-video', title='changed')]
        self.assertEqual(self.consumer.apply_once()['code'], 'preview_hash_mismatch')
        self.assertEqual(self.hosted.apply_calls, [])
        # A new request with its own immutable preview is independently expired.
        new_id = str(uuid4())
        self.scalar("INSERT INTO local_analytics.publish_jobs(publish_job_id,requested_by) VALUES(%s,'fixture') RETURNING publish_job_id",(new_id,))
        preview = self.consumer.preview_once()
        self.worker.clock = lambda: time.time() + 901
        self.assertEqual(self.consumer.confirm(new_id,preview['previewHash'])['code'], 'preview_expired')
        self.assertEqual(self.hosted.apply_calls, [])

    def test_partial_apply_retains_readback_even_when_job_fails(self):
        self.rows = [_video_row(f'v{i}') for i in range(450)]
        self.hosted.fail_on_batch = 1
        preview = self.consumer.preview_once()
        self.consumer.confirm(self.job_id,preview['previewHash'])
        self.assertEqual(self.consumer.apply_once()['code'], 'publish_apply_aborted')
        self.assertEqual(len(self.hosted.apply_calls), 2)
        self.assertEqual(self.scalar("SELECT matched_rows FROM local_analytics.publish_history WHERE stage='readback'"),200)
        self.assertEqual(self.scalar("SELECT count(*) FROM local_analytics.publish_audit_events WHERE stage='readback'"),1)

    def test_agent_terminal_results_survive_reconnect_and_are_append_only(self):
        store = PostgresAgentActionStore(self.scalar)
        action_id = str(uuid4())
        record = oa.AgentActionRecord(action_id,str(uuid4()),'high','restart_local_container')
        self.assertEqual(store.reserve(record),'created')
        self.assertEqual(store.reserve(record),'duplicate')
        self.assertTrue(store.record_result(action_id,oa.AGENT_ACTION_PERFORMED))
        self.assertTrue(store.record_result(action_id,oa.AGENT_ACTION_PERFORMED))
        self.assertFalse(store.record_result(action_id,oa.AGENT_ACTION_UNVERIFIED))
        with self.connection().cursor() as c:
            c.execute('SELECT result_code FROM local_analytics.agent_action_state WHERE action_id=%s',(action_id,))
            self.assertEqual(c.fetchone()[0],oa.AGENT_ACTION_PERFORMED)
        for table in ('agent_action_records','agent_action_results'):
            for sql in (f'DELETE FROM local_analytics.{table}',f'UPDATE local_analytics.{table} SET result_code=NULL'):
                with self.assertRaises(self.psycopg2.errors.InsufficientPrivilege):
                    self.scalar(sql)
                self.conn.rollback()
        self.assertFalse(store.record_result(str(uuid4()),oa.AGENT_ACTION_PERFORMED))
        self.conn.rollback()

    def test_agent_budget_is_atomic_across_connections_restarts_and_windows(self):
        from concurrent.futures import ThreadPoolExecutor
        limits = [{'windowMinutes':60,'maxActions':10}, {'windowMinutes':1440,'maxActions':12}]
        def attempt(_):
            with self.psycopg2.connect(self.dsn) as conn:
                with conn.cursor() as cur: cur.execute('SET ROLE service_role')
                conn.commit()
                def execute(sql, params):
                    with conn.cursor() as cur:
                        cur.execute(sql, params); row = cur.fetchone()
                    conn.commit()
                    return row[0] if row else None
                store = PostgresAgentActionStore(execute)
                record = oa.AgentActionRecord(str(uuid4()),str(uuid4()),'high','restart_local_container')
                self.assertEqual(store.reserve(record),'created')
                return store.claim_rate_budget(record.action_id,limits,0)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt,range(24)))
        self.assertEqual(results.count('created'),10)
        self.assertEqual(results.count('limited'),14)
        self.assertEqual(attempt(None),'limited')
        # Only this test's private owner advances stored fixture timestamps.
        with self.psycopg2.connect(self.dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE local_analytics.agent_action_budget_claims SET claimed_at=clock_timestamp()-interval '2 hours'")
        self.assertEqual([attempt(None) for _ in range(4)],['created','created','limited','limited'])
        self.assertEqual(self.scalar('SELECT count(*) FROM local_analytics.agent_action_budget_claims'),12)
        with self.assertRaises(self.psycopg2.errors.InsufficientPrivilege):
            self.scalar('DELETE FROM local_analytics.agent_action_budget_claims')
        self.conn.rollback()

if __name__ == '__main__': unittest.main()
