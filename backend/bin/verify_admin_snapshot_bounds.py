#!/usr/bin/env python3
"""Private PostgreSQL 15.8 fixture; no production credentials or data."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid

ROOT=Path(__file__).resolve().parents[2]
MIGRATION=ROOT/'backend/supabase/migrations/20261001172315_admin_evaluation_pagination.sql'
RUNTIME=Path('/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-15.8')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    database='pipeline_perf_'+uuid.uuid4().hex[:16]
    common=['-U','postgres','-h',str(RUNTIME/'socket'),'-p','18791']
    psql=[str(RUNTIME/'installed/bin/psql'),*common,'-X','-A','-t','-v','ON_ERROR_STOP=1']
    def query(sql,*,ok=True):
        result=subprocess.run([*psql,'-d',database],input=sql,text=True,capture_output=True,timeout=60)
        if ok and result.returncode:raise RuntimeError('SNAPSHOT_FIXTURE_QUERY_FAILED')
        return result
    version=subprocess.run([*psql,'-d','postgres'],input="SELECT current_setting('server_version');",text=True,capture_output=True,check=True).stdout.strip()
    if version!='15.8':raise RuntimeError('POSTGRES_VERSION_MISMATCH')
    subprocess.run([str(RUNTIME/'installed/bin/createdb'),*common,database],capture_output=True,check=True)
    try:
        source=MIGRATION.read_text()
        fields=[field.strip() for field in re.search(r'UPDATE OF (.*?) OR DELETE',source,re.S).group(1).split(',')]
        fields+=['updated_at','search_count']
        json_fields={'origin_address','youtube_meta','db_error_details','evaluation_results'}
        bool_fields={'is_missing','is_not_selected','geocoding_success'}
        number_fields={'lat','lng','geocoding_false_stage','search_count'}
        def kind(field):
            if field=='id':return 'uuid PRIMARY KEY'
            if field in json_fields:return 'jsonb'
            if field in bool_fields:return 'boolean'
            if field in number_fields:return 'numeric'
            if field=='categories':return 'text[]'
            if field in {'created_at','updated_at'}:return 'timestamptz'
            return 'text'
        if any(not re.fullmatch(r'[a-z_]+',field) for field in fields):raise RuntimeError('FIXTURE_SCHEMA_INVALID')
        query('CREATE TABLE public.restaurants ('+','.join(field+' '+kind(field) for field in fields)+');\n'
              +'GRANT SELECT ON public.restaurants TO service_role;\n'+source)
        denied=[]
        for role in ['anon','authenticated']:
            rejected=query(f'SET ROLE {role}; SELECT public.admin_evaluation_catalog_snapshot();',ok=False)
            if not rejected.returncode or 'permission denied for function' not in rejected.stderr:raise RuntimeError('RPC_GRANT_INVALID')
            denied.append(role)
        query("INSERT INTO public.restaurants(id,approved_name,status,created_at) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'fixture-'||i,'pending',now() FROM generate_series(1,1127) i; ANALYZE public.restaurants;")
        rows=int(query("SET ROLE service_role; SELECT jsonb_array_length(public.admin_evaluation_catalog_snapshot()->'records');").stdout.splitlines()[-1])
        if rows!=1127:raise RuntimeError('SNAPSHOT_ROWS_INVALID')
        revision=query('SELECT public.admin_evaluation_revision();').stdout.strip()
        query('UPDATE public.restaurants SET search_count=1;')
        if query('SELECT public.admin_evaluation_revision();').stdout.strip()!=revision:raise RuntimeError('COUNTER_REVISION_INVALID')
        query('BEGIN; UPDATE public.restaurants SET approved_name=\'rollback-fixture\'; ROLLBACK;')
        if query('SELECT public.admin_evaluation_revision();').stdout.strip()!=revision:raise RuntimeError('ROLLBACK_REVISION_INVALID')
        # The page read's primary-key plan is inspected directly, not inferred
        # from a function's opaque top-level Result node.
        plan=json.loads(query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM public.restaurants ORDER BY id LIMIT 50;').stdout)
        revision_after=query('UPDATE public.restaurants SET approved_name=approved_name; SELECT public.admin_evaluation_revision();').stdout.splitlines()[-1]
        if revision_after==revision:raise RuntimeError('MUTATION_REVISION_INVALID')
        query("UPDATE public.restaurants SET reasoning_basis=repeat('x',33554433) WHERE id='00000000-0000-0000-0000-000000000001';")
        overflow=query('SET ROLE service_role; SELECT public.admin_evaluation_catalog_snapshot();',ok=False)
        if not overflow.returncode or 'EVALUATION_CATALOG_CAPACITY_EXCEEDED' not in overflow.stderr:raise RuntimeError('BYTE_BOUND_INVALID')
        query("UPDATE public.restaurants SET reasoning_basis=NULL; INSERT INTO public.restaurants(id,status) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'pending' FROM generate_series(1128,50001) i;")
        overflow=query('SET ROLE service_role; SELECT public.admin_evaluation_catalog_snapshot();',ok=False)
        if not overflow.returncode or 'EVALUATION_CATALOG_CAPACITY_EXCEEDED' not in overflow.stderr:raise RuntimeError('ROW_BOUND_INVALID')
        result={'kind':'isolated_postgresql_synthetic_fixture','status':'passed','liveEvidenceEligible':False,
                'postgresVersion':version,'migrationSha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
                'snapshotRowsVerified':rows,'publicRolesDenied':denied,'byteBoundMiB':32,'rowBound':50000,
                'overflowRejectedBeforeReturn':True,'counterOnlyPreservedRevision':True,'rollbackPreservedRevision':True,
                'mutationInvalidatedRevision':True,'hostedWrites':0,'pagePrimaryKeyQueryPlan':plan}
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({key:value for key,value in result.items() if key!='pagePrimaryKeyQueryPlan'}))
    finally:
        subprocess.run([str(RUNTIME/'installed/bin/dropdb'),*common,database],capture_output=True,check=True)


if __name__=='__main__':main()
