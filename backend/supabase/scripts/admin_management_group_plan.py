#!/usr/bin/env python3
"""Offline source-bound current52 -> 53 plans. No network and no blind trust pin."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import advisor_successor_plan as baseline

ROOT = Path(__file__).resolve().parents[3]
PROJECT = 'aqlcofblfxdrjhhdmarw'
VERSION = '20260906053936'
NAME = 'admin_management_group_catalog_slice'
SOURCE = ROOT / f'backend/supabase/migrations/{VERSION}_{NAME}.sql'
PREDECESSOR = ROOT / 'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql'
SOURCE_SHA = '4fea6a4912536cf1c1531b092d309f8206a7c6d28edd0558a9fceae940757b00'
PREDECESSOR_SHA = 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf'
PARSER_SHA = '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd'
# REQUIRED parent integration: independently review real post-first-RPC snapshot,
# retain it externally, then review a source change to this constant. No CLI override.
CURRENT52_SNAPSHOT_SHA256 = None
FIRST_VERSION = '20260906040116'
FIRST_NAME = 'admin_user_ids_catalog_slice'
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = baseline.canonical
literal = baseline.literal
DECLARATIONS = "v_owner oid := 'privacy_workflow_owner'::regrole; v_oid oid; v_signature text; v_rel text; v_forced boolean; v_owned boolean; v_cmd text;"


def source():
    raw = SOURCE.read_bytes()
    if sha(raw) != SOURCE_SHA or sha(PREDECESSOR.read_bytes()) != PREDECESSOR_SHA or sha(baseline.PARSER.read_bytes()) != PARSER_SHA:
        raise ValueError('admin_group_source_binding_denied')
    return raw.decode()


def section(kind):
    return source().split('-- BEGIN '+kind+' GUARD', 1)[1].split('\n',1)[1].split('-- END '+kind+' GUARD', 1)[0]


def group_snapshot_sql():
    return re.search(r'\$snapshot\$(.*?)\$snapshot\$', source(), re.S).group(1)


def snapshot_sql():
    # OIDs and metadata hashes remain internal or minimized; no application rows.
    return "SELECT jsonb_build_object('advisor',("+baseline.snapshot_sql()+"),'group',("+group_snapshot_sql()+"))"


def snapshot_plan():
    return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog;\nSET LOCAL statement_timeout='30s';\n"+snapshot_sql()+";\nROLLBACK;\n"


def vectors():
    raw = source().encode()
    p = subprocess.run(['node',str(baseline.PARSER),'--source',str(SOURCE),'--version',VERSION,'--sha256',SOURCE_SHA,'--size',str(len(raw))],capture_output=True,timeout=30)
    if p.returncode: raise ValueError('admin_group_parser_denied')
    rows = json.loads(p.stdout)['statements']
    if len(rows) != 2 or not rows[-1].startswith('NOTIFY pgrst,'): raise ValueError('admin_group_vector_denied')
    return rows


def preview(snapshot):
    source()
    if CURRENT52_SNAPSHOT_SHA256 is None:
        raise ValueError('trusted_current52_snapshot_not_yet_available')
    if not isinstance(snapshot,dict) or sha(canonical(snapshot).encode()) != CURRENT52_SNAPSHOT_SHA256:
        raise ValueError('current52_snapshot_binding_denied')
    if set(snapshot) != {'advisor','group'} or set(snapshot['advisor']) != baseline.SNAP_KEYS:
        raise ValueError('current52_snapshot_shape_denied')
    a=snapshot['advisor']; ledger=a['ledger']
    if len(ledger)!=52 or len({r['version'] for r in ledger})!=52 or ledger != sorted(ledger,key=lambda r:r['version']) or ledger[-1]['version']!=FIRST_VERSION or ledger[-1]['name']!=FIRST_NAME:
        raise ValueError('current52_ledger_denied')
    if not a['executor_ok'] or a['constraints_valid']!=4 or a['function_paths_fixed']!=26 or not a['touch_ok']:
        raise ValueError('advisor_baseline_denied')
    return {'schema':'admin-management-group-preview-v1','projectId':PROJECT,'source_sha256':SOURCE_SHA,'statement_vector_sha256':sha(canonical(vectors()).encode()),'snapshot':snapshot}


def receipt(p):
    return {'schema':'admin-management-group-rehearsal-v1','projectId':PROJECT,'preview_sha256':sha(canonical(p).encode()),'source_sha256':SOURCE_SHA,'rolled_back':True}


def plan(p,mode,rehearsal=None):
    if p != preview(p['snapshot']): raise ValueError('preview_binding_denied')
    if mode not in ('rehearse','apply','readback'): raise ValueError('mode_denied')
    if mode=='apply' and rehearsal!=receipt(p): raise ValueError('external_rehearsal_receipt_required')
    statements=vectors(); vector='ARRAY['+','.join(literal(s) for s in statements)+']::text[]'
    prior=literal(canonical(p['snapshot']))+'::jsonb'
    read=snapshot_sql()
    addition=f"jsonb_build_object('version','{VERSION}','name','{NAME}','statement_count',2,'statements_pg_json_sha256',encode(sha256(convert_to(to_jsonb({vector})::text,'UTF8')),'hex'))"
    expected=f"jsonb_set(prior,'{{advisor,ledger}}',(prior#>'{{advisor,ledger}}')||jsonb_build_array({addition}))"
    install='\n'.join('EXECUTE '+literal(s)+';' for s in statements)
    install+=f"\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('{VERSION}','{NAME}',{vector});\n"
    install+=f"SELECT ({read}) INTO actual; IF actual IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'admin_group_broad_post_drift'; END IF;"
    verify=section('DEPENDENCY')+section('TARGET')
    if mode=='readback':
        # Calls only read RPCs, and append with NULL actor/request. No synthetic audit.
        return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
DO $check$ DECLARE prior jsonb:={prior}; actual jsonb; {DECLARATIONS} BEGIN
 SELECT ({read}) INTO actual;
 IF actual IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'admin_group_readback_drift'; END IF;
 {verify}
END $check$;
SET LOCAL ROLE service_role;
DO $deny$ BEGIN
 BEGIN
  PERFORM public.append_admin_user_audit_event(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  RAISE EXCEPTION 'admin_group_null_actor_not_denied';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $deny$;
WITH ids AS (SELECT coalesce(array_agg(user_id ORDER BY user_id),ARRAY[]::uuid[]) ids FROM public.read_admin_user_ids_for_management()),
metadata AS (SELECT m.* FROM ids CROSS JOIN LATERAL public.read_admin_user_management_metadata(ids.ids) m WHERE cardinality(ids.ids)>0),
audit AS (SELECT * FROM public.read_admin_user_audit_events(50))
SELECT jsonb_build_object('metadata_count_matches',(SELECT count(*) FROM metadata)=(SELECT cardinality(ids) FROM ids),
 'metadata_within_limit',(SELECT count(*)<=200 FROM metadata),
 'metadata_distinct',(SELECT count(*)=count(DISTINCT user_id) FROM metadata),
 'audit_within_limit',(SELECT count(*)<=50 FROM audit),
 'audit_ids_nonnull_distinct',(SELECT count(*)=count(id) AND count(*)=count(DISTINCT id) FROM audit),
 'append_invalid_input_denied',true);
ROLLBACK;
"""
    rehearse=f"""BEGIN
 {install}
 rehearsal_finished := true;
 RAISE EXCEPTION USING ERRCODE='ZP003',MESSAGE='admin_group_intentional_rehearsal_rollback';
EXCEPTION WHEN SQLSTATE 'ZP003' THEN
 IF NOT rehearsal_finished THEN RAISE EXCEPTION 'admin_group_rehearsal_did_not_finish'; END IF;
END;
SELECT ({read}) INTO actual;
IF actual IS DISTINCT FROM prior THEN RAISE EXCEPTION 'admin_group_rehearsal_restore_drift'; END IF;
"""
    # Rehearse inside apply too: a supplied receipt cannot replace real transactional execution.
    work=rehearse if mode=='rehearse' else rehearse+'\n'+install
    tail=(f"SELECT {literal(canonical(receipt(p)))}::jsonb;\nROLLBACK;" if mode=='rehearse' else f"SELECT jsonb_build_object('verified_before_commit',true,'preview_sha256',{literal(sha(canonical(p).encode()))});\nCOMMIT;")
    return f"""-- Fixed project {PROJECT}; parent must verify transport routing. No retries.
-- Whole file, one transaction; output before COMMIT is not proof of committed state.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $plan$ DECLARE prior jsonb:={prior}; actual jsonb; rehearsal_finished boolean:=false; BEGIN
 SELECT ({read}) INTO actual;
 IF actual IS DISTINCT FROM prior THEN RAISE EXCEPTION 'admin_group_preview_drift'; END IF;
 {work}
END $plan$;
{tail}
"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref',required=True,choices=[PROJECT])
    parser.add_argument('--mode',required=True,choices=['snapshot','preview','rehearse','apply','readback'])
    parser.add_argument('--snapshot',type=Path); parser.add_argument('--rehearsal',type=Path)
    args=parser.parse_args()
    if args.mode=='snapshot': print(snapshot_plan()); return
    if args.snapshot is None: parser.error('--snapshot required')
    p=preview(json.loads(args.snapshot.read_text()))
    print(canonical(p) if args.mode=='preview' else plan(p,args.mode,json.loads(args.rehearsal.read_text()) if args.rehearsal else None))

if __name__=='__main__': main()
