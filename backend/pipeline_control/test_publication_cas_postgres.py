"""Real PostgreSQL publication CAS and ACL regression, in a disposable cluster.

Applies the original RPC and additive correction. The unrelated G014 catalog
assertion is omitted here; full catalog replay remains a separate CI gate.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('TZUDONG_TEST_POSTGRES_BIN'), 'isolated postgres opt-in absent')
class PublicationCasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.pg = psycopg2
        cls.tmp = tempfile.TemporaryDirectory(prefix='tzcas-', dir='/tmp')
        cls.addClassCleanup(cls.tmp.cleanup)
        bindir = Path(os.environ['TZUDONG_TEST_POSTGRES_BIN'])
        data = str(Path(cls.tmp.name) / 'data')
        def run(*args):
            subprocess.run([str(bindir / args[0]), *args[1:]], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run('initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8')
        run('pg_ctl', '-D', data, '-l', str(Path(cls.tmp.name) / 'server.log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{cls.tmp.name}'", '-w', 'start')
        cls.addClassCleanup(lambda: run('pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'))
        cls.dsn = f'dbname=postgres user=postgres host={cls.tmp.name}'
        migrations = Path(__file__).resolve().parents[1] / 'supabase/migrations'
        with cls.pg.connect(cls.dsn) as conn, conn.cursor() as cur:
            cur.execute('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; '
                        'CREATE SCHEMA pipeline_control; '
                        'CREATE TABLE public.restaurants(id uuid PRIMARY KEY, trace_id text, '
                        'updated_at timestamptz NOT NULL, approved_name text);')
            for name in ('20260901000200_pipeline_batch_upsert_publication_allowlist.sql',
                         '20260905015816_publication_nullable_trace_cas.sql'):
                sql = (migrations / name).read_text()
                cur.execute(sql.replace('SELECT privacy_retention.assert_g014_public_rpc_allowlist();', ''))

    def setUp(self):
        self.conn = self.pg.connect(self.dsn)
        self.addCleanup(self.conn.close)
        with self.conn.cursor() as cur:
            cur.execute('TRUNCATE public.restaurants')
            cur.execute("INSERT INTO public.restaurants VALUES "
                        "('00000000-0000-4000-8000-000000000111',NULL,'2026-09-01Z','before')")
        self.conn.commit()
        self.expected = {'id': '00000000-0000-4000-8000-000000000111',
                         'trace_id': None, 'updated_at': '2026-09-01T00:00:00Z'}

    def apply(self, expected, payload=None):
        with self.conn.cursor() as cur:
            cur.execute('SELECT pipeline_control.publish_upsert_restaurants(%s::jsonb)',
                        (json.dumps([{'op': 'update', 'expected': expected,
                                      'payload': payload or {'approved_name': 'after'}}]),))
            result = cur.fetchone()[0]
        self.conn.commit()
        return result

    def test_null_trace_matches_and_stale_timestamp_conflicts(self):
        result = self.apply(self.expected)
        self.assertEqual(result['updated_count'], 1)
        self.assertEqual(result['readback'][0]['approved_name'], 'after')
        self.assertIsNone(result['readback'][0]['trace_id'])
        with self.assertRaises(self.pg.errors.SerializationFailure):
            self.apply(self.expected)
        self.conn.rollback()

    def test_missing_required_fields_and_malformed_trace_fail_without_writes(self):
        cases = [{k: v for k, v in self.expected.items() if k != absent}
                 for absent in self.expected]
        cases += [{**self.expected, key: None} for key in ('id', 'updated_at')]
        cases += [{**self.expected, 'trace_id': value} for value in (True, 7, {}, [])]
        for expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaises(self.pg.errors.SerializationFailure):
                    self.apply(expected)
                self.conn.rollback()
                with self.conn.cursor() as cur:
                    cur.execute('SELECT approved_name FROM public.restaurants')
                    self.assertEqual(cur.fetchone()[0], 'before')

    def test_null_does_not_match_nonnull_and_matching_trace_succeeds(self):
        with self.conn.cursor() as cur:
            cur.execute("UPDATE public.restaurants SET trace_id='current'")
        self.conn.commit()
        for trace in (None, 'stale'):
            with self.assertRaises(self.pg.errors.SerializationFailure):
                self.apply({**self.expected, 'trace_id': trace})
            self.conn.rollback()
        self.assertEqual(self.apply({**self.expected, 'trace_id': 'current'})['updated_count'], 1)

    def test_column_allowlist_and_execute_acl_remain_closed(self):
        with self.assertRaises(self.pg.errors.InvalidParameterValue):
            self.apply(self.expected, {'unpublished_column': 'forbidden'})
        self.conn.rollback()
        with self.conn.cursor() as cur:
            for role in ('anon', 'authenticated', 'service_role'):
                cur.execute("SELECT has_function_privilege(%s,"
                            "'pipeline_control.publish_upsert_restaurants(jsonb)','EXECUTE')", (role,))
                self.assertIs(cur.fetchone()[0], False)
            cur.execute("SELECT pg_get_userbyid(proowner),prosecdef FROM pg_proc "
                        "WHERE oid='pipeline_control.publish_upsert_restaurants(jsonb)'::regprocedure")
            self.assertEqual(cur.fetchone(), ('postgres', True))


if __name__ == '__main__':
    unittest.main()
