/** Readiness11 admission. No credential lookup, DDL or logging at import time. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationEnvelope } from './supabase-migration-transaction.mjs';
import { readOriginalStatementVector, runPsql } from './apply-supabase-migration.mjs';
export const ID = 'review_media_readiness11_v1';
export const BUNDLE_SHA = '77b34753c68047d3b479484f156e44044d015c53b8e5d459da4b8d1d97f0d1d3';
export const GENERIC_SHA = '515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d';
export const MANIFEST_PATH = '.github/supabase-readiness-release-manifest.v1.json';
export const sha = value => createHash('sha256').update(value).digest('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${q(JSON.stringify(value))}::jsonb`;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const keys = (value, expected) => {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail('READINESS_MANIFEST_INVALID');
};
function read(root, path) {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..')) fail('READINESS_PATH_INVALID');
  const file = resolve(root, path);
  if (!file.startsWith(`${root}/`) || lstatSync(file).isSymbolicLink() || realpathSync(file) !== file) fail('READINESS_PATH_INVALID');
  return readFileSync(file);
}
export function loadRelease(root, expectedSha) {
  root = realpathSync(root);
  if (!/^[a-f0-9]{64}$/.test(expectedSha ?? '')) fail('READINESS_MANIFEST_PIN_REQUIRED');
  const bytes = read(root, MANIFEST_PATH);
  if (sha(bytes) !== expectedSha) fail('READINESS_MANIFEST_DIGEST_MISMATCH');
  const m = JSON.parse(bytes);
  keys(m, ['version','id','bundle','sources','dependencies','prior','final','ledger','evidence']);
  if (bytes.toString('utf8') !== `${JSON.stringify(m,null,2)}\n` || m.version !== 1 || m.id !== ID) fail('READINESS_MANIFEST_INVALID');
  keys(m.bundle, ['path','sha256','bytes']);
  if (m.bundle.path !== 'backend/supabase/release-bundles/readiness11-v1.sql' || m.bundle.sha256 !== BUNDLE_SHA || m.sources.length !== 11) fail('READINESS_SCOPE_INVALID');
  if (sha(read(root, '.github/supabase-migration-release-manifest.v1.json')) !== GENERIC_SHA) fail('READINESS_GENERIC_MANIFEST_DRIFT');
  for (const d of m.dependencies) {
    const raw = read(root,d.path);
    if (sha(raw) !== d.sha256 || raw.length !== d.bytes) fail('READINESS_DEPENDENCY_DRIFT');
  }
  let previous='';
  const plans=m.sources.map(s => {
    keys(s,['path','bytes','sha256','vectorSha256']);
    const raw=read(root,s.path);
    if (raw.length!==s.bytes) fail('READINESS_SOURCE_SIZE_MISMATCH');
    const p=migrationEnvelope(raw,s,readOriginalStatementVector(s,raw));
    if (p.version <= previous || p.vectorSha256 !== s.vectorSha256) fail('READINESS_SOURCE_VECTOR_DRIFT');
    previous=p.version; return p;
  });
  const bundle=read(root,m.bundle.path);
  if (sha(bundle)!==BUNDLE_SHA || bundle.length!==m.bundle.bytes) fail('READINESS_BUNDLE_DIGEST_MISMATCH');
  // Validate transaction structure with the same canonical envelope compiler.
  // The ledger uses the eleven ORIGINAL vectors, never this aggregate vector.
  const { statementSpans } = envelopeHelpers;
  const bp=migrationEnvelope(bundle,{path:'backend/supabase/migrations/20261013110000_readiness11_envelope_validation_only.sql',sha256:BUNDLE_SHA},statementSpans(bundle.toString('utf8')).map(s=>s.token));
  if (!bundle.subarray(0,7).equals(Buffer.from('BEGIN;\n')) || !bundle.subarray(-8).equals(Buffer.from('COMMIT;\n')) || !Buffer.from(bp.execution).equals(Buffer.concat([bundle.subarray(6,-8),Buffer.from('\n')]))) fail('READINESS_ENVELOPE_INVALID');
  return compileRelease(m,plans,bp.execution,expectedSha);
}
import * as envelopeHelpers from './supabase-migration-transaction.mjs';

export function compileRelease(manifest, plans, execution, manifestSha256) {
  if (plans.length!==11) fail('READINESS_SCOPE_INVALID');
  const versions=plans.map(p=>q(p.version)).join(',');
  const equals=plans.map(p=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${q(p.version)} AND name IS NOT DISTINCT FROM ${q(p.name)} AND statements IS NOT DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(${json(p.originalVector)})))`).join(' AND ');
  const ledger=`SELECT jsonb_build_object('targetCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${versions})), 'exact',(${equals}), 'prefixCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version NOT IN (${versions})), 'prefixSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(m)::text,E'\\n' ORDER BY m.version),''),'UTF8')),'hex') FROM supabase_migrations.schema_migrations m WHERE version NOT IN (${versions})))`;
  const surface=snapshotSql();
  const prior=json(manifest.prior), final=json(manifest.final);
  const prefix=`(${ledgerShapeSql()}) AND l->>'prefixSha256'=${q(manifest.ledger.prefixSha256)} AND (l->>'prefixCount')::int=${manifest.ledger.prefixCount}`;
  const status=`WITH observed AS (SELECT (${ledger}) AS l, (${surface}) AS s) SELECT jsonb_build_object('state',CASE WHEN ${prefix} AND (l->>'targetCount')::int=0 AND s=${prior} THEN 'prior' WHEN ${prefix} AND (l->>'targetCount')::int=11 AND (l->>'exact')::boolean AND s=${final} THEN 'final' ELSE 'conflict' END) FROM observed`;
  const reconciliation=`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY; SET LOCAL standard_conforming_strings=on; SET LOCAL search_path=pg_catalog,public; SET LOCAL statement_timeout='20s';\n${status};\n`;
  const insert=plans.map(p=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${q(p.version)},${q(p.name)},ARRAY(SELECT jsonb_array_elements_text(${json(p.originalVector)})));`).join('\n');
  const body=`DECLARE l jsonb; s jsonb; before_members jsonb; before_manifest jsonb;\nBEGIN
  SELECT (${ledger}),(${surface}) INTO l,s;
  IF NOT (${prefix}) THEN RAISE EXCEPTION 'READINESS_PREFIX_CONFLICT'; END IF;
  IF (l->>'targetCount')::int=11 AND (l->>'exact')::boolean THEN
    IF s IS DISTINCT FROM ${final} THEN RAISE EXCEPTION 'READINESS_FINAL_CONFLICT'; END IF;
    PERFORM set_config('readiness.release_outcome','already_applied',true); RETURN;
  END IF;
  IF (l->>'targetCount')::int<>0 THEN RAISE EXCEPTION 'READINESS_LEDGER_CONFLICT'; END IF;
  IF s IS DISTINCT FROM ${prior} THEN RAISE EXCEPTION 'READINESS_PRIOR_CONFLICT'; END IF;
  before_members:=s->'membershipSha256'; before_manifest:=s->'immutableManifestSha256';
  EXECUTE ${q(execution)};
  ${insert}
  SELECT (${ledger}),(${surface}) INTO l,s;
  IF NOT (${prefix}) OR (l->>'targetCount')::int<>11 OR NOT (l->>'exact')::boolean THEN RAISE EXCEPTION 'READINESS_LEDGER_READBACK_FAILED'; END IF;
  IF s IS DISTINCT FROM ${final} OR s->'membershipSha256' IS DISTINCT FROM before_members OR s->'immutableManifestSha256' IS DISTINCT FROM before_manifest THEN RAISE EXCEPTION 'READINESS_FINAL_CONFLICT'; END IF;
  PERFORM set_config('readiness.release_outcome','applied',true);
END;`;
  const tag=`$readiness_${sha(body).slice(0,24)}$`;
  if(body.includes(tag)) fail('READINESS_DELIMITER_CONFLICT');
  const sql=`SET LOCAL standard_conforming_strings=on; SET LOCAL search_path=pg_catalog,public; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='120s';
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
${ledgerContractGuard()}
DO ${tag}\n${body}\n${tag};
SELECT jsonb_build_object('state','final','outcome',current_setting('readiness.release_outcome'));
`;
  return Object.freeze({manifest,plans,execution,manifestSha256,reconciliation,sql});
}
function ledgerShapeSql() {
  return `EXISTS(SELECT 1 FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass AND relkind='r' AND relpersistence='p' AND NOT relrowsecurity)
AND (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped AND ((attname='version' AND atttypid='text'::regtype) OR (attname='name' AND atttypid='text'::regtype) OR (attname='statements' AND atttypid='text[]'::regtype)))=3
AND ((SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped)=3 OR ((SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped)=6 AND (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped AND NOT attnotnull AND NOT atthasdef AND ((attname IN ('created_by','idempotency_key') AND atttypid='text'::regtype) OR (attname='rollback' AND atttypid='text[]'::regtype)))=3))
AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass AND contype='p' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='version')]::smallint[])
AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='supabase_migrations.schema_migrations'::regclass AND NOT tgisinternal)
AND NOT EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class='supabase_migrations.schema_migrations'::regclass)`;
}
function ledgerContractGuard() {
  return `DO $readiness_ledger$ BEGIN
IF current_user<>'postgres' OR session_user<>'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR current_setting('server_version')<>'17.6' THEN RAISE EXCEPTION 'READINESS_ACTOR_DENIED'; END IF;
IF NOT (${ledgerShapeSql()}) THEN RAISE EXCEPTION 'READINESS_LEDGER_SHAPE_DENIED'; END IF;
END $readiness_ledger$;`;
}

export function snapshotSql() {
  // Catalogs and digests only. No auth/review/media row content, object names or SQL bodies leave PostgreSQL.
  return `SELECT jsonb_build_object(
'engine',current_setting('server_version'),'actor',current_user,'sessionActor',session_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
'membershipSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(m)::text,E'\\n' ORDER BY m.roleid,m.member,m.grantor),''),'UTF8')),'hex') FROM pg_auth_members m),
'immutableManifestCount',(SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest WHERE manifest_key->>'schema' IS DISTINCT FROM 'review_media_private'),
'immutableManifestSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key),'[]')::text,'UTF8')),'hex') FROM privacy_retention.g014_catalog_contract_manifest m WHERE manifest_key->>'schema' IS DISTINCT FROM 'review_media_private'),
'privateManifestSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key),'[]')::text,'UTF8')),'hex') FROM privacy_retention.g014_catalog_contract_manifest m WHERE manifest_key->>'schema'='review_media_private'),
'privateFunctions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention'),
'g041BodySha256',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('privacy_retention.g041_current_claim_user_id()')),
'adminBodySha256',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)')),
'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'acl',p.proacl::text,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='review_media_private' OR (n.nspname='public' AND p.proname IN ('mutate_review_with_media','queue_review_upload_cleanup','read_review_media_commit','pending_review_media_cleanup','finish_review_media_cleanup','review_media_delete_allowed','admin_review_verification_cleanup','admin_record_action','is_user_admin','has_role')) OR (n.nspname='pipeline_control' AND p.proname='bump_admin_evaluation_revision') OR (n.nspname='privacy_retention' AND p.proname IN ('g041_current_claim_user_id','g014_catalog_protected_relations'))),
'ownerBoundary',(SELECT jsonb_build_object('superuser',rolsuper,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'inherit',rolinherit,'authUsage',has_schema_privilege(oid,'auth','USAGE'),'authCreate',has_schema_privilege(oid,'auth','CREATE')) FROM pg_roles WHERE rolname='privacy_workflow_owner'),
'privateSchema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text,'anon',has_schema_privilege('anon',oid,'USAGE'),'authenticated',has_schema_privilege('authenticated',oid,'USAGE'),'service',has_schema_privilege('service_role',oid,'USAGE')) FROM pg_namespace WHERE nspname='review_media_private'),
'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.oid::regclass::text),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='review_media_private' AND c.relkind='r') OR c.oid IN (to_regclass('public.reviews'),to_regclass('storage.objects'))),
'policiesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('relation',p.polrelid::regclass::text,'name',p.polname,'cmd',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END ORDER BY x) FROM unnest(p.polroles) x),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polrelid::regclass::text,p.polname),'[]')::text,'UTF8')),'hex') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='review_media_private' OR p.polrelid IN (to_regclass('public.reviews'),to_regclass('storage.objects'))),
'constraintsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname),'[]')::text,'UTF8')),'hex') FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='review_media_private'),
'triggersSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY t.tgname),'[]')::text,'UTF8')),'hex') FROM pg_trigger t WHERE t.tgrelid='public.reviews'::regclass AND NOT t.tgisinternal),
'allowlistSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY source_signature),'[]')::text,'UTF8')),'hex') FROM privacy_retention.g014_public_rpc_allowlist a),
'bucket',(SELECT jsonb_build_object('public',public,'fileSizeLimit',file_size_limit,'allowedMimeTypes',allowed_mime_types) FROM storage.buckets WHERE id='review-verifications'),
'revisionSingletonCount',(SELECT count(*) FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton))`;
}
function parse(output) {
  try { const value=JSON.parse(output.trim()); if(['prior','final','conflict'].includes(value.state)) return value; } catch {}
  fail('READINESS_READBACK_INVALID');
}
export function executeRelease(databaseUrl, compiled, {runPsqlImpl=runPsql}={}) {
  const observe=()=>parse(runPsqlImpl(databaseUrl,compiled.reconciliation,true));
  let pre; try { pre=observe(); } catch { fail('READINESS_PREFLIGHT_UNAVAILABLE'); }
  if(pre.state==='final') return {outcome:'already_applied',writeAttempts:0};
  if(pre.state!=='prior') fail('READINESS_STATE_CONFLICT');
  let transactionOutcome;
  try {
    const post=parse(runPsqlImpl(databaseUrl,compiled.sql,true));
    if(post.state!=='final' || !['applied','already_applied'].includes(post.outcome)) fail('READINESS_READBACK_INVALID');
    transactionOutcome=post.outcome;
    // psql --single-transaction success includes COMMIT; then independent read-only verification.
  } catch {
    let reconciled; try { reconciled=observe(); } catch { fail('READINESS_RECONCILIATION_UNKNOWN'); }
    if(reconciled.state==='final') return {outcome:'committed_reconciled',writeAttempts:1};
    fail(reconciled.state==='prior'?'READINESS_NOT_APPLIED':'READINESS_RECONCILIATION_CONFLICT');
  }
  let post; try { post=observe(); } catch { fail('READINESS_RECONCILIATION_UNKNOWN'); }
  if(post.state!=='final') fail('READINESS_RECONCILIATION_CONFLICT');
  return {outcome:transactionOutcome==='already_applied'?'already_applied':'applied_verified',writeAttempts:1};
}
