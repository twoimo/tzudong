#!/usr/bin/env python3
"""Offline, fixed-target current-state 50 -> advisor 51 SQL plans. No transport."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
PROJECT = 'aqlcofblfxdrjhhdmarw'
VERSION = '20260903174413'
NAME = 'advisor_followup_hardening'
SOURCE = ROOT / f'backend/supabase/migrations/{VERSION}_{NAME}.sql'
SOURCE_SHA = 'ae834917e3f6c6653d570dacd27d3894d15fcac2a4f09db86f0f9d0f51815148'
PARSER = ROOT / 'backend/supabase/scripts/g037_supabase_statement_vector.mjs'
PARSER_SHA = '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd'
VECTOR_SHA = '9bc0ce1bb00777a5f49e5176fee8d28ce936918d3d9372def9fa3bf2ab06b287'
CONSTRAINTS = (
 ('admin_audit_events', 'admin_audit_events_whitelisted_contract'),
 ('account_deletion_requests', 'account_deletion_requests_reason_code_allowed'),
 ('account_deletion_requests', 'account_deletion_requests_count_summary_safe'),
 ('account_deletion_request_items', 'account_deletion_request_items_reason_code_allowed'),
)
SCHEMA = 'advisor-current-state-successor-v1'

class Denied(ValueError):
    pass

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def vectors():
    raw = SOURCE.read_bytes()
    if len(raw) != 14235 or sha(raw) != SOURCE_SHA or sha(PARSER.read_bytes()) != PARSER_SHA:
        raise Denied('source_drift')
    result = subprocess.run(['node', str(PARSER), '--source', str(SOURCE), '--version', VERSION,
                             '--sha256', SOURCE_SHA, '--size', '14235'],
                            capture_output=True, timeout=30, check=False)
    if result.returncode:
        raise Denied('parser_denied')
    value = json.loads(result.stdout)
    statements = value['statements']
    if len(statements) != 17 or sha(canonical(statements).encode()) != VECTOR_SHA:
        raise Denied('vector_drift')
    return statements

def signatures():
    vectors()  # Pin the source before deriving this bounded list.
    block = SOURCE.read_text().split('v_signatures constant text[] := ARRAY[', 1)[1].split('];', 1)[0]
    result = re.findall(r"'([^']+)'", block)
    if len(result) != 26 or len(set(result)) != 26:
        raise Denied('signature_drift')
    return result

LEDGER_SQL = """SELECT coalesce(jsonb_agg(jsonb_build_object(
 'version',version,'name',name,'statement_count',cardinality(statements),
 'statements_pg_json_sha256',encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex'))
 ORDER BY version,name),'[]'::jsonb) FROM supabase_migrations.schema_migrations"""

def fingerprint(expression):
    return f"encode(sha256(convert_to(({expression})::text,'UTF8')),'hex')"

def snapshot_sql():
    """No user rows, SQL bodies or raw ACL/membership metadata leave this projection."""
    sigs = ','.join(f'({literal(s)})' for s in signatures())
    pairs = ','.join(f'({literal(t)},{literal(c)})' for t,c in CONSTRAINTS)
    # Normalize ONLY the two catalog fields changed by VALIDATE CONSTRAINT.
    # pg_get_constraintdef also loses its trailing NOT VALID.
    return f"""WITH expected(signature) AS (VALUES {sigs}),
 targets(relation,name) AS (VALUES {pairs}),
 ext AS (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
         WHERE e.extname='vector'),
 funcs AS (SELECT e.signature,p.* FROM expected e CROSS JOIN ext
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(replace(e.signature,'public.vector',quote_ident(ext.nspname)||'.vector'))),
 cons AS (SELECT t.*,c.oid,c.convalidated,c.contype,c.conrelid,
 {fingerprint("(to_jsonb(c)-'convalidated')")} AS stable
 FROM targets t LEFT JOIN pg_constraint c ON c.conname=t.name
 AND c.conrelid=to_regclass('public.'||t.relation)),
 manifest AS (SELECT m.manifest_kind,m.manifest_key,
 CASE WHEN m.manifest_kind='constraint' AND m.manifest_key->>'schema'='public'
 AND (m.manifest_key->>'relation',m.manifest_key->>'constraint') IN (SELECT relation,name FROM targets)
 THEN jsonb_set(jsonb_set(m.manifest_value,'{{validated}}','true'), '{{definition}}',
 to_jsonb(regexp_replace(m.manifest_value->>'definition',' NOT VALID$','')))
 ELSE m.manifest_value END AS normalized
 FROM privacy_retention.g014_catalog_contract_manifest m)
 SELECT jsonb_build_object(
 'ledger',({LEDGER_SQL}),
 'database',current_database(), 'server_major',current_setting('server_version_num')::int/10000,
 'executor_ok',current_user='postgres' AND session_user='postgres',
 'vector_schema',(SELECT nspname FROM ext),
 'function_count',(SELECT count(oid) FROM funcs),
 'function_configs_ok',(SELECT bool_and(NOT prosecdef AND
    (proconfig IS NULL OR proconfig=ARRAY['search_path=pg_catalog, public, extensions'])) FROM funcs),
 'function_paths_fixed',(SELECT count(*) FROM funcs WHERE proconfig=ARRAY['search_path=pg_catalog, public, extensions']),
 'functions_stable',{fingerprint("(SELECT jsonb_agg(jsonb_build_array(signature,to_jsonb(f)-'proconfig'-'signature') ORDER BY signature) FROM funcs f)")},
 'constraint_count',(SELECT count(oid) FROM cons WHERE contype='c'),
 'constraint_name_count',(SELECT count(*) FROM pg_constraint WHERE conname IN (SELECT name FROM targets)),
 'constraints_valid',(SELECT count(*) FROM cons WHERE convalidated),
 'constraints_stable',{fingerprint("(SELECT jsonb_agg(jsonb_build_array(relation,name,stable) ORDER BY relation,name) FROM cons)")},
 'manifest_target_count',(SELECT count(*) FROM manifest WHERE manifest_kind='constraint'
 AND manifest_key->>'schema'='public' AND (manifest_key->>'relation',manifest_key->>'constraint') IN (SELECT relation,name FROM targets)),
 'manifest_normalized',{fingerprint("(SELECT jsonb_agg(jsonb_build_array(manifest_kind,manifest_key,normalized) ORDER BY manifest_kind,manifest_key) FROM manifest)")},
 'membership',{fingerprint("(SELECT coalesce(jsonb_agg(to_jsonb(m)-'oid' ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_auth_members m WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)")},
 'relations',{fingerprint("(SELECT jsonb_agg(to_jsonb(c) - ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] ORDER BY oid) FROM pg_class c WHERE oid IN ('public.admin_audit_events'::regclass,'public.account_deletion_requests'::regclass,'public.account_deletion_request_items'::regclass,'privacy_retention.g014_catalog_contract_manifest'::regclass))")},
 'schemas',{fingerprint("(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n WHERE nspname IN ('public','extensions','privacy_retention'))")},
 'trigger_ok',(SELECT count(*)=1 AND bool_and(tgenabled='O' AND NOT tgisinternal)
 FROM pg_trigger WHERE tgrelid='privacy_retention.g014_catalog_contract_manifest'::regclass AND tgname='g014_catalog_manifest_immutable'),
 'triggers',{fingerprint("(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE tgrelid IN ('public.admin_audit_events'::regclass,'public.account_deletion_requests'::regclass,'public.account_deletion_request_items'::regclass,'privacy_retention.g014_catalog_contract_manifest'::regclass))")},
 'helpers',{fingerprint("(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE oid IN ('privacy_retention.assert_g014_catalog_manifest()'::regprocedure,'privacy_retention.g014_catalog_manifest_rows()'::regprocedure,'privacy_retention.g014_account_deletion_append_only()'::regprocedure))")},
 'policies',{fingerprint("(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY oid),'[]'::jsonb) FROM pg_policy p WHERE polrelid IN ('public.admin_audit_events'::regclass,'public.account_deletion_requests'::regclass,'public.account_deletion_request_items'::regclass,'privacy_retention.g014_catalog_contract_manifest'::regclass))")},
 'touch_ok',(SELECT proowner='postgres'::regrole AND NOT prosecdef AND prorettype='trigger'::regtype
 AND prosrc={literal(chr(10)+'BEGIN'+chr(10)+'  NEW.updated_at = pg_catalog.now();'+chr(10)+'  RETURN NEW;'+chr(10)+'END;'+chr(10))}
 AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',oid,'EXECUTE')
 AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee<>proowner)
 FROM pg_proc WHERE oid='public.touch_admin_workflow_updated_at()'::regprocedure)
 )"""

SNAP_KEYS = frozenset(('ledger','database','server_major','executor_ok','vector_schema','function_count',
 'function_configs_ok','function_paths_fixed','functions_stable','constraint_count','constraint_name_count',
 'constraints_valid','constraints_stable','manifest_target_count','manifest_normalized','membership',
 'relations','schemas','trigger_ok','triggers','touch_ok','helpers','policies'))

def validate_ledger(rows):
    if not isinstance(rows,list) or len(rows)!=50:
        raise Denied('prior_ledger_count')
    last=''
    for row in rows:
        if not isinstance(row,dict) or set(row)!={'version','name','statement_count','statements_pg_json_sha256'}:
            raise Denied('prior_ledger_fields')
        if (not isinstance(row['version'],str) or not re.fullmatch(r'\d{8,14}',row['version'])
            or row['version']<=last or not isinstance(row['name'],str)
            or not re.fullmatch(r'[A-Za-z0-9_]+',row['name'])
            or type(row['statement_count']) is not int or row['statement_count']<0
            or not isinstance(row['statements_pg_json_sha256'],str)
            or not re.fullmatch(r'[0-9a-f]{64}',row['statements_pg_json_sha256'])):
            raise Denied('prior_ledger_identity')
        last=row['version']
    if last!='20260804000500':
        raise Denied('prior_ledger_terminal')

def validate_snapshot(value):
    if not isinstance(value,dict) or set(value)!=SNAP_KEYS:
        raise Denied('snapshot_fields')
    validate_ledger(value['ledger'])
    expected={'database':'postgres','server_major':17,'executor_ok':True,'vector_schema':'public',
              'function_count':26,'function_configs_ok':True,'constraint_count':4,'constraint_name_count':4,
              'constraints_valid':0,'manifest_target_count':4,'trigger_ok':True,'touch_ok':True}
    if any(type(value[k]) is not type(v) or value[k]!=v for k,v in expected.items()):
        raise Denied('snapshot_precondition')
    if type(value['function_paths_fixed']) is not int or not 0<=value['function_paths_fixed']<=26:
        raise Denied('snapshot_paths')
    for k in ('functions_stable','constraints_stable','manifest_normalized','membership','relations','schemas','triggers','helpers','policies'):
        if not isinstance(value[k],str) or not re.fullmatch('[0-9a-f]{64}',value[k]):
            raise Denied('snapshot_hash')

def preview_sql():
    return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='5s';\nSET LOCAL search_path=pg_catalog,public,extensions;\n" + snapshot_sql() + ';\nROLLBACK;\n'

def preview(ledger_evidence, snapshot):
    if ledger_evidence.get('schema')!='hosted-current50-ledger-metadata-v1' or ledger_evidence.get('projectId')!=PROJECT:
        raise Denied('target_or_ledger_schema')
    validate_snapshot(snapshot)
    if ledger_evidence['ledger']!=snapshot['ledger']:
        raise Denied('external_ledger_drift')
    return {'schema':SCHEMA,'projectId':PROJECT,'source_sha256':SOURCE_SHA,'vector_sha256':VECTOR_SHA,
            'snapshot':snapshot}

def validate_preview(value):
    if not isinstance(value,dict) or set(value)!={'schema','projectId','source_sha256','vector_sha256','snapshot'}:
        raise Denied('preview_fields')
    if (value['schema'],value['projectId'],value['source_sha256'],value['vector_sha256'])!=(SCHEMA,PROJECT,SOURCE_SHA,VECTOR_SHA):
        raise Denied('preview_binding')
    validate_snapshot(value['snapshot'])

def plan(value, mode, rehearsal=None):
    validate_preview(value)
    if mode not in ('rehearse','apply','readback'):
        raise Denied('mode')
    statements=vectors()
    preview_hash=sha(canonical(value).encode())
    receipt={'schema':SCHEMA,'projectId':PROJECT,'preview_sha256':preview_hash,
             'source_sha256':SOURCE_SHA,'vector_sha256':VECTOR_SHA,'status':'rehearsed-rolled-back'}
    if mode=='apply' and rehearsal!=receipt:
        raise Denied('rehearsal_required')
    before=literal(canonical(value['snapshot']))+'::jsonb'
    vector='ARRAY['+','.join(literal(s) for s in statements)+']::text[]'
    read=snapshot_sql()
    expected=f"""expected := {before};
 expected := jsonb_set(expected,'{{constraints_valid}}','4');
 expected := jsonb_set(expected,'{{function_paths_fixed}}','26');
 expected := jsonb_set(expected,'{{ledger}}',expected->'ledger'||jsonb_build_array(jsonb_build_object(
 'version','{VERSION}','name','{NAME}','statement_count',17,
 'statements_pg_json_sha256',encode(sha256(convert_to(to_jsonb({vector})::text,'UTF8')),'hex'))));"""
    if mode=='readback':
        return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $advisor_readback$ DECLARE observed jsonb; expected jsonb; BEGIN
 {expected}
 observed := ({read});
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'advisor_successor_readback_denied'; END IF;
 PERFORM privacy_retention.assert_g014_catalog_manifest();
END $advisor_readback$;
SELECT jsonb_build_object('schema','{SCHEMA}','status','current51-observed','projectId','{PROJECT}',
 'preview_sha256','{preview_hash}','historical_closure',false) AS receipt;
ROLLBACK;
"""
    execution='\n'.join('EXECUTE '+literal(s)+';' for s in statements)
    rollback="RAISE EXCEPTION USING ERRCODE='P5101', MESSAGE='advisor_rehearsal_rollback';" if mode=='rehearse' else ''
    receipt['status']='apply-verified-uncommitted' if mode=='apply' else receipt['status']
    return f"""-- Fixed transport target: {PROJECT}. Never substitute project or retry this plan.
-- A returned apply receipt is PRECOMMIT; use separate current51 readback after transport completion.
BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT pg_advisory_xact_lock(6051,51);
LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.admin_audit_events,public.account_deletion_requests,
 public.account_deletion_request_items,privacy_retention.g014_catalog_contract_manifest IN ACCESS EXCLUSIVE MODE;
DO $advisor_successor$ DECLARE observed jsonb; expected jsonb; completed boolean := false; BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR current_setting('transaction_read_only')<>'off'
 OR current_setting('server_version_num')::int/10000<>17 OR current_database()<>'postgres'
 OR current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'advisor_executor_denied'; END IF;
 observed := ({read});
 IF observed IS DISTINCT FROM {before} THEN RAISE EXCEPTION 'advisor_preview_drift'; END IF;
 PERFORM privacy_retention.assert_g014_catalog_manifest();
 BEGIN
 {execution}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES ('{VERSION}','{NAME}',{vector});
 {expected}
 observed := ({read});
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'advisor_postcondition_denied'; END IF;
 completed := true;
 {rollback}
 EXCEPTION WHEN SQLSTATE 'P5101' THEN
   IF NOT completed OR {literal(mode)}<>'rehearse' THEN RAISE EXCEPTION 'advisor_rehearsal_denied'; END IF;
 END;
 IF {literal(mode)}='rehearse' THEN
   observed := ({read});
   IF observed IS DISTINCT FROM {before} THEN RAISE EXCEPTION 'advisor_rollback_denied'; END IF;
   PERFORM privacy_retention.assert_g014_catalog_manifest();
 END IF;
EXCEPTION WHEN OTHERS THEN
 RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='advisor_successor_denied';
END $advisor_successor$;
SELECT {literal(canonical(receipt))}::jsonb AS receipt;
COMMIT;
"""

def load(path, digest=None):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>131072:
        raise Denied('input_file')
    raw=path.read_bytes()
    if digest is not None and sha(raw)!=digest:
        raise Denied('input_digest')
    def unique(items):
        result={}
        for k,v in items:
            if k in result: raise Denied('duplicate_key')
            result[k]=v
        return result
    return json.loads(raw,object_pairs_hook=unique)

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=('snapshot','preview','rehearse','apply','readback'))
    p.add_argument('--project-ref',required=True,choices=(PROJECT,))
    p.add_argument('--ledger',type=Path)
    p.add_argument('--snapshot',type=Path)
    p.add_argument('--preview',type=Path)
    p.add_argument('--preview-sha256')
    p.add_argument('--rehearsal',type=Path)
    p.add_argument('--rehearsal-sha256')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(argv)
    try:
        vectors()
        if not a.output.is_absolute() or a.output.resolve().is_relative_to(ROOT):
            raise Denied('external_output_required')
        if a.mode=='snapshot': output=preview_sql()
        elif a.mode=='preview': output=canonical(preview(load(a.ledger),load(a.snapshot)))
        else:
            if not a.preview_sha256: raise Denied('external_preview_digest_required')
            evidence=load(a.rehearsal,a.rehearsal_sha256) if a.rehearsal and a.rehearsal_sha256 else None
            output=plan(load(a.preview,a.preview_sha256),a.mode,evidence)
        # Never overwrite an earlier plan/receipt. No network, credentials or retry paths.
        fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: f.write(output)
        print(canonical({'status':'generated-not-executed','mode':a.mode,'projectId':PROJECT,
                         'output_sha256':sha(output.encode())}))
        return 0
    except Exception:
        print(canonical({'status':'denied','code':'advisor_plan_denied'}))
        return 2

if __name__=='__main__':
    raise SystemExit(main())
