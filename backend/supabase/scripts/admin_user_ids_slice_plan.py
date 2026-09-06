#!/usr/bin/env python3
"""Offline plans for one reviewed current51 -> current52 RPC slice. No transport."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import advisor_successor_plan as baseline

ROOT = Path(__file__).resolve().parents[3]
PROJECT = 'aqlcofblfxdrjhhdmarw'
VERSION = '20260906040116'
NAME = 'admin_user_ids_catalog_slice'
SOURCE = ROOT / f'backend/supabase/migrations/{VERSION}_{NAME}.sql'
# Recomputed deliberately only when reviewing a change to this new migration.
SOURCE_SHA = 'f1b5a6878752c3004f74e057cf230bf26acca432271415f609c103b2bd1cb492'
PARSER_SHA = '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd'
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = baseline.canonical
literal = baseline.literal

def vectors():
    raw = SOURCE.read_bytes()
    if sha(raw) != SOURCE_SHA or sha(baseline.PARSER.read_bytes()) != PARSER_SHA:
        raise ValueError('source_binding_denied')
    p = subprocess.run(['node',str(baseline.PARSER),'--source',str(SOURCE),'--version',VERSION,'--sha256',SOURCE_SHA,'--size',str(len(raw))],capture_output=True,timeout=30)
    if p.returncode: raise ValueError('parser_denied')
    rows = json.loads(p.stdout)['statements']
    if len(rows)!=2 or not rows[-1].startswith('NOTIFY pgrst,'): raise ValueError('vector_denied')
    return rows

def preview(snapshot):
    if set(snapshot) != baseline.SNAP_KEYS or len(snapshot['ledger']) != 51 or snapshot['ledger'][-1]['version'] != baseline.VERSION or snapshot['ledger'][-1]['name'] != baseline.NAME:
        raise ValueError('current51_required')
    ledger=snapshot['ledger']
    if len({r['version'] for r in ledger})!=51 or ledger!=sorted(ledger,key=lambda r:r['version']): raise ValueError('ledger_order_denied')
    if not snapshot['executor_ok'] or snapshot['constraints_valid']!=4 or snapshot['function_paths_fixed']!=26 or not snapshot['touch_ok']: raise ValueError('advisor_baseline_denied')
    return {'projectId':PROJECT,'source_sha256':SOURCE_SHA,'statement_vector_sha256':sha(canonical(vectors()).encode()),'snapshot':snapshot}

def receipt(p):
    return {'schema':'admin-ids-slice-rehearsal-v1','projectId':PROJECT,'preview_sha256':sha(canonical(p).encode()),'source_sha256':SOURCE_SHA,'rolled_back':True}

def plan(p,mode,rehearsal=None):
    if p != preview(p['snapshot']): raise ValueError('preview_binding_denied')
    if mode not in ('rehearse','apply','readback'): raise ValueError('mode_denied')
    if mode=='apply' and rehearsal!=receipt(p): raise ValueError('external_rehearsal_receipt_required')
    statements=vectors()
    vector='ARRAY['+','.join(literal(s) for s in statements)+']::text[]'
    prior=literal(canonical(p['snapshot']))+'::jsonb'
    read=baseline.snapshot_sql()
    addition=f"jsonb_build_object('version','{VERSION}','name','{NAME}','statement_count',2,'statements_pg_json_sha256',encode(sha256(convert_to(to_jsonb({vector})::text,'UTF8')),'hex'))"
    expected=f"jsonb_set(prior,'{{ledger}}',(prior->'ledger')||jsonb_build_array({addition}))"
    install='\n'.join('EXECUTE '+literal(s)+';' for s in statements)
    install+=f"\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('{VERSION}','{NAME}',{vector});\n"
    install+=f"SELECT ({read}) INTO actual; IF actual IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'admin_ids_broad_post_drift'; END IF;"
    if mode=='readback':
        return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL statement_timeout='30s';
DO $readback$ DECLARE prior jsonb:={prior}; actual jsonb; BEGIN
 SELECT ({read}) INTO actual;
 IF actual IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'admin_ids_readback_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_admin_user_ids_for_management()')
   AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.provolatile='s'
   AND p.proretset AND p.prorettype='uuid'::regtype AND p.pronargs=0
   AND p.proconfig=ARRAY['search_path=""']::text[]
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='be57e320d7a79e6e7382bce9e942b3e684fc50246beb44deaa67c408cb553acd'
   AND has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'service_role'::regrole) OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.read_admin_user_ids_for_management()')<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.read_admin_user_ids_for_management()' AND grantee='service_role' AND function_schema='public' AND function_name='read_admin_user_ids_for_management' AND identity_arguments='') THEN
 RAISE EXCEPTION 'admin_ids_target_readback_drift'; END IF;
END $readback$;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('nonempty',count(*)>0,'within_limit',count(*)<=200,'uuid_nonnull',count(user_id)=count(*),'distinct_ids',count(DISTINCT user_id)=count(*)) AS admin_ids_functional_readback
FROM public.read_admin_user_ids_for_management();
ROLLBACK;
"""
    if mode=='rehearse':
        work=f"""BEGIN
 {install}
 RAISE EXCEPTION USING ERRCODE='ZP001',MESSAGE='admin_ids_intentional_rehearsal_rollback';
EXCEPTION WHEN SQLSTATE 'ZP001' THEN NULL;
END;
SELECT ({read}) INTO actual;
IF actual IS DISTINCT FROM prior THEN RAISE EXCEPTION 'admin_ids_rehearsal_restore_drift'; END IF;"""
        tail=f"SELECT {literal(canonical(receipt(p)))}::jsonb AS admin_ids_rehearsal;\nROLLBACK;"
    else:
        work=install
        tail=f"SELECT jsonb_build_object('verified_before_commit',true,'preview_sha256',{literal(sha(canonical(p).encode()))}) AS admin_ids_pending_commit;\nCOMMIT;"
    return f"""-- Fixed project {PROJECT}; transport routing is parent's responsibility.
-- Whole-file execution only. No retries; ambiguous result requires independent readback.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $plan$ DECLARE prior jsonb:={prior}; actual jsonb; BEGIN
 SELECT ({read}) INTO actual;
 IF actual IS DISTINCT FROM prior THEN RAISE EXCEPTION 'admin_ids_preview_drift'; END IF;
 {work}
END $plan$;
{tail}
"""

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project-ref',required=True,choices=[PROJECT]);p.add_argument('--snapshot',required=True,type=Path)
    p.add_argument('--mode',required=True,choices=['preview','rehearse','apply','readback']);p.add_argument('--rehearsal',type=Path)
    a=p.parse_args()
    bound=preview(json.loads(a.snapshot.read_text()))
    print(canonical(bound) if a.mode=='preview' else plan(bound,a.mode,json.loads(a.rehearsal.read_text()) if a.rehearsal else None))
