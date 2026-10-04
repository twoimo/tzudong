#!/usr/bin/env python3
"""Exact-version local RPC checks in an owned, disposable database.

The supplied container must be local. No existing application schema is touched.
Nothing prints restaurant rows, credentials, or provider diagnostics.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
DATABASE = "tzudong_pipeline_perf_20261002"
LOCAL_PSQL = None
LOCAL_SOCKET = None
LOCAL_PORT = "18791"


def run(container, sql, *, database=DATABASE):
    command = ([LOCAL_PSQL, "-h", LOCAL_SOCKET, "-p", LOCAL_PORT] if LOCAL_PSQL else ["docker", "exec", "-i", container, "psql"])
    result = subprocess.run([*command, "-U", "postgres", "-d", database,
                             "-v", "ON_ERROR_STOP=1", "-At"], input=sql, text=True, capture_output=True, timeout=60)
    return result


def checked(container, sql, *, database=DATABASE):
    result = run(container, sql, database=database)
    if result.returncode:
        raise RuntimeError("LOCAL_CATALOG_SQL_FAILED")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--container')
    parser.add_argument('--psql')
    parser.add_argument('--socket-dir')
    args = parser.parse_args()
    global LOCAL_PSQL, LOCAL_SOCKET
    LOCAL_PSQL, LOCAL_SOCKET = args.psql, args.socket_dir
    container = args.container
    if not container and not (LOCAL_PSQL and LOCAL_SOCKET): raise RuntimeError('LOCAL_DATABASE_REQUIRED')
    version = checked(container, 'SHOW server_version;', database='postgres')
    if version != '15.8': raise RuntimeError('DATABASE_VERSION_MISMATCH')
    exists = checked(container, f"SELECT count(*) FROM pg_database WHERE datname='{DATABASE}';", database='postgres')
    if exists != '0': raise RuntimeError('FIXTURE_DATABASE_ALREADY_EXISTS')
    checked(container, f'CREATE DATABASE {DATABASE};', database='postgres')
    try:
        checked(container, '''CREATE TABLE public.restaurants (
          id uuid PRIMARY KEY, approved_name text, origin_name text, naver_name text,
          google_name text, status text, lat double precision, lng double precision,
          phone text, road_address text, jibun_address text, origin_address jsonb,
          is_missing boolean, is_not_selected boolean, geocoding_success boolean,
          geocoding_false_stage integer, youtube_link text, youtube_meta jsonb,
          created_at timestamptz, updated_at timestamptz, updated_by_admin_id uuid,
          db_error_details jsonb, db_error_message text, reasoning_basis text,
          description_map_url text, trace_id_name_source text, evaluation_results jsonb,
          categories text[], search_count bigint DEFAULT 0
        );
        ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON public.restaurants TO service_role;''')
        migration = ROOT / 'backend/supabase/migrations/20261001172315_admin_evaluation_pagination.sql'
        checked(container, migration.read_text())
        first = checked(container, 'SET ROLE service_role; SELECT public.admin_evaluation_revision();').splitlines()[-1]
        denied = []
        for role in ['anon', 'authenticated']:
            result = run(container, f'SET ROLE {role}; SELECT public.admin_evaluation_catalog_snapshot();')
            if result.returncode == 0: raise RuntimeError('PUBLIC_RPC_EXPOSED')
            denied.append(role)
        checked(container, "INSERT INTO public.restaurants(id,approved_name,status,youtube_link,created_at) VALUES ('00000000-0000-0000-0000-000000000001','fixture','pending','https://youtu.be/abcdefghijk',now());")
        snapshot = json.loads(checked(container, 'SET ROLE service_role; SELECT public.admin_evaluation_catalog_snapshot();').splitlines()[-1])
        if len(snapshot['records']) != 1 or snapshot['records'][0]['name'] != 'fixture' or int(snapshot['revision']) <= int(first):
            raise RuntimeError('SNAPSHOT_CONTRACT_FAILED')
        before = snapshot['revision']
        checked(container, "UPDATE public.restaurants SET search_count=search_count+1;")
        unchanged = checked(container, 'SET ROLE service_role; SELECT public.admin_evaluation_revision();').splitlines()[-1]
        if unchanged != before: raise RuntimeError('COUNTER_ONLY_INVALIDATED_INDEX')
        checked(container, "BEGIN; UPDATE public.restaurants SET status='approved'; ROLLBACK;")
        after = checked(container, 'SET ROLE service_role; SELECT public.admin_evaluation_revision();').splitlines()[-1]
        if after != before: raise RuntimeError('ROLLBACK_REVISION_CHANGED')
        checked(container, "UPDATE public.restaurants SET status='approved'; DELETE FROM public.restaurants;")
        final = json.loads(checked(container, 'SET ROLE service_role; SELECT public.admin_evaluation_catalog_snapshot();').splitlines()[-1])
        if final['records'] or int(final['revision']) != int(before) + 2: raise RuntimeError('WRITE_INVALIDATION_FAILED')
        print(json.dumps({'status':'passed', 'postgresVersion':version, 'publicRolesDenied':denied,
                          'snapshotRowsVerified':1, 'rollbackPreservedRevision':True,
                          'updateDeleteInvalidatedRevision':True, 'counterOnlyPreservedRevision':True, 'hostedWrites':0}))
    finally:
        checked(container, f'DROP DATABASE {DATABASE};', database='postgres')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('LOCAL_CATALOG_CHECK_FAILED') from None
