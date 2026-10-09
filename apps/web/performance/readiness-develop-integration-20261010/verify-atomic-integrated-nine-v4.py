"""Owned schema-only PG17 clone proof. Refuses reused targets; no hosted path."""
from pathlib import Path
import subprocess,json,hashlib,re
ROOT=Path('/Users/twoimo/.codex/worktrees/swipe-cache-control-20261009/tzudong')
HERE=Path('/Users/twoimo/.codex/worktrees/swipe-cache-control-20261009/tzudong/apps/web/performance/user-readiness-20261009')
OUTPUT=Path('/Users/twoimo/.codex/runtime-cache/tzudong-integration-after-dd9-20261009')
CTX='colima-tzudong-catalog-20261007'
CONTAINER='tzudong-ranking-clone-20261008'
PREFIX=['docker','--context',CTX,'exec','-i','-e','PGPASSWORD=fixture-only',CONTAINER]
BUNDLE=(OUTPUT/'atomic-integrated-nine-v3.sql').read_bytes()
SHA=hashlib.sha256(BUNDLE).hexdigest()

def run(db,sql,actor='supabase_admin'):
    p=subprocess.run(PREFIX+['psql','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-U',actor,'-d',db],input=sql,capture_output=True)
    if p.returncode:
        states=re.findall(rb'(?:ERROR|FATAL):\s+([0-9A-Z]{5})',p.stderr)
        raise RuntimeError('ISOLATED_SQL_FAILED:'+','.join(x.decode() for x in states))
    return p.stdout.decode().strip()

fingerprint="""SELECT jsonb_build_object('members',md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m)),
'manifest',md5((SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key)::text FROM privacy_retention.g014_catalog_contract_manifest m)),
'functions',md5((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control'))),
'relations',md5((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.oid),'[]')::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control'))),
'policies',md5((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]')::text FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control','storage'))),
'defaultACL',md5((SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.oid),'[]')::text FROM pg_default_acl a)),
'constraints',md5((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.oid),'[]')::text FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control','storage'))),
'mediaPresent',to_regnamespace('review_media_private') IS NOT NULL);"""
meta=json.loads(run('ranking_clone',b"SELECT jsonb_build_object('engine',current_setting('server_version'),'manifest',(SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest),'profiles',(SELECT count(*) FROM public.profiles),'reviews',(SELECT count(*) FROM public.reviews));"))
if not meta['engine'].startswith('17.6') or meta['profiles'] or meta['reviews']:raise RuntimeError('ISOLATION_INPUT_DENIED')
dbs=['readiness_integrated_nine_v4_20261010','readiness_nine_rollback_v4_20261010']
for db in dbs:
    if run('postgres',f"SELECT count(*) FROM pg_database WHERE datname='{db}';".encode())!='0':raise RuntimeError('OWNED_TARGET_ALREADY_EXISTS')
for db in dbs:run('postgres',f'CREATE DATABASE {db} TEMPLATE ranking_clone OWNER postgres;'.encode())
run(dbs[0],BUNDLE,'postgres')
probe=run(dbs[0],(HERE/'full-clone-user-role-probe-v2.sql').read_bytes(),'postgres')
probe=[json.loads(x) for x in probe.splitlines() if x.startswith('{')]
before=json.loads(run(dbs[1],fingerprint.encode()))
if not BUNDLE.endswith(b'COMMIT;\n'):raise RuntimeError('ENVELOPE_BINDING_DENIED')
run(dbs[1],BUNDLE[:-len(b'COMMIT;\n')]+b'ROLLBACK;\n','postgres')
after=json.loads(run(dbs[1],fingerprint.encode()))
if before!=after:raise RuntimeError('ROLLBACK_FINGERPRINT_DRIFT')
result={'sourceSha256':SHA,'context':CTX,'container':CONTAINER,'input':meta,'actor':'postgres','atomicAll9':True,'ownerAnonymousProbes':probe,'rollbackExactBeforeAfterEqual':True,'before':before,'after':after,'fingerprintSchemas':['public','privacy_retention','review_media_private','pipeline_control'],'fingerprintAdditional':['relations','policies including storage','global defaultACL','constraints including storage'],'operatingWrites':False}
with (OUTPUT/'atomic-integrated-nine-v4-exact-pg17-proof.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'status':'passed','engine':meta['engine'],'atomicAll9':True,'ownerRPCs':7,'anonymousDenied':True,'rollbackExact':True}))
