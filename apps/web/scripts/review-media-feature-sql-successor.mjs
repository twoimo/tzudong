#!/usr/bin/env node
/** Protected four-stage feature successor chained to the review-media 86->97 controller. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundedMigrationError,
  readOriginalStatementVector,
  selectDirectDatabaseTransport,
} from './apply-supabase-migration.mjs';
import {
  REPOSITORY_ROOT,
  assertSuccessorDatabaseTarget,
  createSuccessorPsqlRunner,
  currentProtectedMainReadback,
  currentSuccessorGitFacts,
  loadSuccessorManifest,
  protectedSourceReadbackBinding,
  validateSuccessorAdmission,
} from './review-media-sql-successor.mjs';
import {
  compileMigrationBundle,
  executeMigrationBundle,
  migrationBundleSuffixRoot,
} from './supabase-migration-bundle.mjs';
import {
  atomicMigrationSql,
  migrationEnvelope,
  statementSpans,
} from './supabase-migration-transaction.mjs';
import {
  TZUDONG_GITHUB_REPOSITORY,
  TZUDONG_PRODUCTION_ALIASES,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  captureVercelRollbackReadbackSync,
} from './vercel-rollback-readback.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const FEATURE_SUCCESSOR_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  '.github/review-media-feature-sql-successor.v1.json',
);
export const FEATURE_SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER =
  '-- feature-successor-pre-commit-expiry-guard';

const MAX_WINDOW_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const PURPOSE = 'review-media-feature-four-stage';

export const FEATURE_SUCCESSOR_FILES = Object.freeze({
  baseAdmission: 'apply-admission.json',
  baseJournal: 'apply-journal.jsonl',
  applyAdmission: 'feature-apply-admission.json',
  applyJournal: 'feature-apply-journal.jsonl',
  rehearsalAdmission: 'feature-rehearsal-admission.json',
  rehearsalJournal: 'feature-rehearsal-journal.jsonl',
  rehearsalReceipt: 'feature-rehearsal-receipt.json',
});

const FIXED_CODES = new Set([
  'FEATURE_SUCCESSOR_ADMISSION_EXPIRED',
  'FEATURE_SUCCESSOR_ADMISSION_INVALID',
  'FEATURE_SUCCESSOR_ARGUMENT_INVALID',
  'FEATURE_SUCCESSOR_CHECKOUT_INVALID',
  'FEATURE_SUCCESSOR_JOURNAL_EXISTS',
  'FEATURE_SUCCESSOR_JOURNAL_INVALID',
  'FEATURE_SUCCESSOR_LAUNCH_HELD',
  'FEATURE_SUCCESSOR_MANIFEST_INVALID',
  'FEATURE_SUCCESSOR_OUTPUT_EXISTS',
  'FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED',
  'FEATURE_SUCCESSOR_PREFLIGHT_MISMATCH',
  'FEATURE_SUCCESSOR_READBACK_INVALID',
  'FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID',
  'FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID',
  'FEATURE_SUCCESSOR_REHEARSAL_RESTORE_INVALID',
  'FEATURE_SUCCESSOR_ROLLBACK_INCOMPATIBLE',
  'FEATURE_SUCCESSOR_ROLLBACK_READBACK_INVALID',
  'FEATURE_SUCCESSOR_SOURCE_DRIFT',
  'FEATURE_SUCCESSOR_WRITE_FAILED',
]);

const operationError = code => {
  const error = new Error(code);
  error.code = code;
  return error;
};
const fail = code => { throw operationError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function safeCode(error) {
  try { return typeof error?.code === 'string' ? error.code : ''; } catch { return ''; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalBytes = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function exactKeys(value, keys, code = 'FEATURE_SUCCESSOR_ADMISSION_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code);
}

function assertHex(value, code = 'FEATURE_SUCCESSOR_ADMISSION_INVALID') {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) fail(code);
}

function parseJsonObject(value, code) {
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value); } catch { fail(code); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(code);
  return parsed;
}

export function boundedFeatureSuccessorError(error) {
  const code = safeCode(error);
  if (FIXED_CODES.has(code)) return operationError(code);
  const bounded = boundedMigrationError(error);
  return operationError(typeof bounded?.code === 'string' ? bounded.code : 'MIGRATION_OPERATION_FAILED');
}

export function featureSuccessorFailureResult(error) {
  return Object.freeze({ code: boundedFeatureSuccessorError(error).code, status: 'failed' });
}

function sourceProjection(migration) {
  return {
    bytes: migration.bytes,
    id: migration.id,
    name: migration.name,
    originalStatementVector: migration.originalStatementVector,
    path: migration.path,
    sha256: migration.sha256,
    statementCount: migration.statementCount,
    statementVectorSha256: migration.statementVectorSha256,
    version: migration.version,
  };
}

export function loadFeatureSuccessorManifest({
  manifestPath = FEATURE_SUCCESSOR_MANIFEST_PATH,
  readVectorImpl = readOriginalStatementVector,
  loadPredecessorImpl = loadSuccessorManifest,
} = {}) {
  if (resolve(manifestPath) !== FEATURE_SUCCESSOR_MANIFEST_PATH) {
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  let bytes;
  let manifest;
  try {
    bytes = readFileSync(manifestPath);
    manifest = parseJsonObject(bytes, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  } catch (error) {
    if (safeCode(error).startsWith('FEATURE_SUCCESSOR_')) throw error;
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  exactKeys(manifest, [
    'advisoryLockKey', 'databaseName', 'executorRole', 'id', 'launchPolicy', 'migrations',
    'operatingTransition', 'predecessor', 'projectRef', 'protectedSource', 'purpose',
    'requiredWriterFences', 'schemaVersion', 'serverMajor', 'sourceRoot',
    'stateRootAlgorithm', 'toolchain',
  ], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'review_media_feature_sql_successor_v1'
    || manifest.purpose !== PURPOSE
    || manifest.projectRef !== PROJECT_REF
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.serverMajor !== 17
    || manifest.advisoryLockKey !== '7311754282260212'
    || manifest.stateRootAlgorithm !== 'review-media-feature-successor-state/v1'
    || !Array.isArray(manifest.migrations)
    || manifest.migrations.length !== 4) fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.operatingTransition, ['afterFour', 'beforeFour'], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  if (!equal(manifest.operatingTransition, { beforeFour: 97, afterFour: 101 })) {
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  exactKeys(manifest.protectedSource, ['ref', 'remote', 'repositoryUrl'], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  if (!equal(manifest.protectedSource, {
    ref: 'refs/heads/main',
    remote: 'origin',
    repositoryUrl: 'https://github.com/twoimo/tzudong.git',
  })) fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state'], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  if (!['held', 'ready'].includes(manifest.launchPolicy.state)
    || manifest.launchPolicy.code !== 'FEATURE_SUCCESSOR_LAUNCH_HELD'
    || manifest.launchPolicy.reason !== 'protected-feature-release-and-fresh-admission-required') {
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  const expectedFences = {
    adminRecordMutationsHold: 'active',
    automaticReviewer: 'stopped',
    browserRpc: 'stopped',
    dashboard: 'stopped',
    directSql: 'stopped',
    g037WriteFreeze: 'active',
    providerIngress: 'stopped',
  };
  if (!equal(manifest.requiredWriterFences, expectedFences)) fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.predecessor, [
    'afterLedger', 'id', 'manifestPath', 'manifestSha256', 'sourceRoot',
  ], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  assertHex(manifest.predecessor.manifestSha256, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  const predecessor = loadPredecessorImpl();
  if (manifest.predecessor.id !== predecessor.manifest.id
    || manifest.predecessor.manifestPath !== '.github/review-media-sql-successor.v1.json'
    || manifest.predecessor.manifestSha256 !== predecessor.manifestSha256
    || manifest.predecessor.sourceRoot !== predecessor.manifest.sourceRoot
    || manifest.predecessor.afterLedger !== predecessor.manifest.operatingTransition.afterEleven
    || manifest.predecessor.afterLedger !== 97) fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');

  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length !== 6) {
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  const expectedToolchain = [
    'apps/web/scripts/review-media-feature-sql-successor.mjs',
    'apps/web/scripts/review-media-sql-successor.mjs',
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'apps/web/scripts/vercel-rollback-readback.mjs',
  ];
  manifest.toolchain.forEach((entry, index) => {
    exactKeys(entry, ['path', 'sha256'], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
    assertHex(entry.sha256, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
    if (entry.path !== expectedToolchain[index]
      || sha256(readFileSync(resolve(REPOSITORY_ROOT, entry.path))) !== entry.sha256) {
      fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
    }
  });

  const expectedIds = [
    'storyboard_gemini_execution_v1',
    'durable_receipt_ocr_results',
    'g014_feature_rpc_catalog_contract',
    'review_verification_immutable_key_fence',
  ];
  const materials = manifest.migrations.map((migration, index) => {
    exactKeys(migration, [
      'bytes', 'id', 'name', 'originalStatementVector', 'path', 'sha256',
      'statementCount', 'statementVectorSha256', 'version',
    ], 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
    const match = /^backend\/supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(migration.path);
    if (!match
      || migration.id !== expectedIds[index]
      || migration.name !== expectedIds[index]
      || migration.version !== match[1]
      || migration.name !== match[2]
      || !Number.isSafeInteger(migration.bytes)
      || migration.bytes <= 0
      || !Number.isSafeInteger(migration.statementCount)
      || migration.statementCount <= 0
      || !Array.isArray(migration.originalStatementVector)
      || migration.originalStatementVector.length !== migration.statementCount) {
      fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
    }
    assertHex(migration.sha256, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
    assertHex(migration.statementVectorSha256, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
    if (sha256(JSON.stringify(migration.originalStatementVector)) !== migration.statementVectorSha256) {
      fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
    }
    const sourceBytes = readFileSync(resolve(REPOSITORY_ROOT, migration.path));
    if (sourceBytes.length !== migration.bytes || sha256(sourceBytes) !== migration.sha256) {
      fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
    }
    const originalVector = readVectorImpl(migration, sourceBytes);
    if (!equal(originalVector, migration.originalStatementVector)) {
      fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
    }
    return Object.freeze({ bytes: sourceBytes, originalVector, path: migration.path });
  });
  assertHex(manifest.sourceRoot, 'FEATURE_SUCCESSOR_MANIFEST_INVALID');
  if (sha256(JSON.stringify(manifest.migrations.map(sourceProjection))) !== manifest.sourceRoot) {
    fail('FEATURE_SUCCESSOR_MANIFEST_INVALID');
  }
  return Object.freeze({
    bytes,
    manifest,
    manifestSha256: sha256(bytes),
    materials: Object.freeze(materials),
    predecessor,
  });
}

function sortedAclSql(expression) {
  return `ARRAY(SELECT value::text FROM unnest(coalesce(${expression},'{}')) value ORDER BY value::text)`;
}

export function buildFeatureSuccessorStateQuery(
  manifestRecord,
  suffixRoot = migrationBundleSuffixRoot(manifestRecord.manifest.migrations),
) {
  const { manifest, predecessor } = manifestRecord;
  const versions = manifest.migrations.map(migration => migration.version);
  const targets = versions.map(quote).join(',');
  const targetValues = versions.map(version => `(${quote(version)})`).join(',');
  const targetRows = manifest.migrations.map(migration =>
    `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(migration.originalStatementVector))}::jsonb)))`).join(' AND ');
  const predecessorRows = predecessor.manifest.migrations.map(migration =>
    `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(migration.originalStatementVector))}::jsonb)))`).join(' AND ');
  const schemas = "'ocr_private','pipeline_control','privacy_retention','public','review_media_private','storage'";
  const acl = expression => sortedAclSql(expression);
  const ocrFunctions = [
    'public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)',
    'public.mark_receipt_ocr_dispatched(uuid,uuid)',
    'public.complete_receipt_ocr_result(uuid,uuid,jsonb)',
    'public.mark_receipt_ocr_result_indeterminate(uuid,uuid)',
    'public.release_receipt_ocr_claim(uuid,uuid)',
    'public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)',
    'public.get_review_receipt_ocr_generation(uuid,uuid)',
    'public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)',
    'public.get_feature_runtime_capability(uuid)',
    'public.get_owned_review_storage_objects(uuid,uuid,text,text[])',
    'public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamp with time zone,text,text[],text[],uuid,uuid,uuid,text,timestamp with time zone,text,jsonb)',
  ];
  const ocrValues = ocrFunctions.map(quote).join(',');
  return `SELECT * FROM (WITH
 target_versions(version) AS (VALUES ${targetValues}),
 ledger_prefix AS (
  SELECT count(*)::int AS row_count,coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text AS material
  FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${targets}])
 ),
 ledger_all AS (
  SELECT count(*)::int AS row_count,coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text AS material
  FROM supabase_migrations.schema_migrations
 ),
 target_state AS (
  SELECT count(*)::int AS target_count FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${targets}])
 ),
 catalog_material AS (
  SELECT jsonb_build_object(
   'schemas',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name) FROM (SELECT n.nspname AS schema_name,pg_get_userbyid(n.nspowner) AS owner,${acl('n.nspacl')} AS acl FROM pg_namespace n WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'relations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,${acl('c.reloptions')} AS reloptions,${acl('c.relacl')} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'columns',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.attnum) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull,a.attidentity,a.attgenerated,coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_expression,${acl('a.attacl')} AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN(${schemas}) AND a.attnum>0 AND NOT a.attisdropped) x),'[]'::jsonb),
   'constraints',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.constraint_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,k.conname AS constraint_name,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'indexes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.index_name) FROM (SELECT n.nspname AS schema_name,c.relname AS index_name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'triggers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.trigger_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,t.tgname AS trigger_name,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas}) AND NOT t.tgisinternal) x),'[]'::jsonb),
   'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.policy_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,p.polname AS policy_name,p.polcmd,p.polpermissive,ARRAY(SELECT coalesce(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY coalesce(r.rolname,'PUBLIC')) AS roles,coalesce(pg_get_expr(p.polqual,p.polrelid),'') AS using_expression,coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'functions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signature) FROM (SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,format_type(p.prorettype,NULL) AS result_type,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,coalesce(p.proconfig,'{}'::text[]) AS config,${acl('p.proacl')} AS acl,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'defaultAcls',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.owner,x.schema_name,x.object_type) FROM (SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'') AS schema_name,d.defaclobjtype AS object_type,${acl('d.defaclacl')} AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) x),'[]'::jsonb)
  )::text AS material
 ),
 role_material AS (
  SELECT jsonb_build_object(
   'roles',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name) FROM (SELECT r.rolname AS role_name,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls FROM pg_roles r) x),'[]'::jsonb),
   'memberships',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name,x.member_name,x.grantor_name) FROM (SELECT role.rolname AS role_name,member.rolname AS member_name,grantor.rolname AS grantor_name,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member JOIN pg_roles grantor ON grantor.oid=m.grantor) x),'[]'::jsonb)
  )::text AS material
 ),
 g014_material AS (
  SELECT jsonb_build_object(
   'manifest',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m),'[]'::jsonb),
   'allowlist',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY function_schema,function_name,identity_arguments,grantee) FROM privacy_retention.g014_public_rpc_allowlist a),'[]'::jsonb),
   'nested',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY source_signature) FROM privacy_retention.g014_nested_helper_allowlist n),'[]'::jsonb)
  )::text AS material
 ),
 storage_material AS (
  SELECT jsonb_build_object(
   'buckets',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM (SELECT id,name,owner,public,avif_autodetection,file_size_limit,allowed_mime_types,owner_id,type,versioning_status,lifecycle_configuration,lifecycle_configuration_generation FROM storage.buckets WHERE id IN('review-photos','review-verifications')) b),'[]'::jsonb),
   'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.policy_name) FROM (SELECT p.polname AS policy_name,p.polcmd,p.polpermissive,ARRAY(SELECT coalesce(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY coalesce(r.rolname,'PUBLIC')) AS roles,coalesce(pg_get_expr(p.polqual,p.polrelid),'') AS using_expression,coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') AS check_expression FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass) x),'[]'::jsonb),
   'triggers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.trigger_name) FROM (SELECT t.tgname AS trigger_name,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t WHERE t.tgrelid='storage.objects'::regclass AND NOT t.tgisinternal) x),'[]'::jsonb)
  )::text AS material
 ),
 storyboard_material AS (
  SELECT jsonb_build_object(
   'projects',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY workflow,status) FROM (SELECT request->>'workflow' AS workflow,status,count(*)::int AS count FROM public.admin_storyboard_production_projects GROUP BY request->>'workflow',status) x),'[]'::jsonb),
   'jobs',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY workflow,status) FROM (SELECT p.request->>'workflow' AS workflow,j.status,count(*)::int AS count FROM public.admin_storyboard_production_jobs j JOIN public.admin_storyboard_production_projects p ON p.id=j.project_id GROUP BY p.request->>'workflow',j.status) x),'[]'::jsonb),
   'events',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY workflow,operation,error_code) FROM (SELECT p.request->>'workflow' AS workflow,e.operation,e.error_code,count(*)::int AS count FROM public.admin_storyboard_production_events e JOIN public.admin_storyboard_production_projects p ON p.id=e.project_id GROUP BY p.request->>'workflow',e.operation,e.error_code) x),'[]'::jsonb)
  )::text AS material
 ),
 contract AS (
  SELECT
   (${predecessorRows}) AS predecessor_ready,
   to_regprocedure('public.finish_review_media_cleanup()') IS NOT NULL
    AND (SELECT count(*)=9 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname=ANY(ARRAY['review_media_safe_delete','review_media_safe_insert','review_media_safe_update','review_verifications_owner_read','review_verifications_owner_insert','review_verifications_owner_delete','review_verifications_safe_delete','review_photos_food_insert','review_photos_food_update']))
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcanlogin AND NOT rolbypassrls) AS base_review_ready,
   to_regprocedure('public.storyboard_production_reject_archived_write()') IS NOT NULL
    AND (SELECT count(*)=6 FROM pg_trigger WHERE tgname=ANY(ARRAY['storyboard_archive_projects_write_guard','storyboard_archive_jobs_write_guard','storyboard_archive_assets_write_guard','storyboard_archive_events_write_guard','storyboard_archive_revisions_write_guard','storyboard_archive_restores_write_guard']) AND NOT tgisinternal) AS storyboard_ready,
   to_regclass('ocr_private.receipt_results') IS NOT NULL
    AND (SELECT count(*)=4 AND bool_and(
      NOT a.attnotnull
      AND a.atttypmod = -1
      AND a.attidentity = ''
      AND a.attgenerated = ''
      AND CASE a.attname
        WHEN 'receipt_hash' THEN a.atttypid='text'::regtype AND d.oid IS NULL
        WHEN 'receipt_data' THEN a.atttypid='jsonb'::regtype AND d.oid IS NULL
        WHEN 'is_duplicate' THEN a.atttypid='boolean'::regtype AND pg_get_expr(d.adbin,d.adrelid)='false'
        WHEN 'ocr_processed_at' THEN a.atttypid='timestamp with time zone'::regtype AND d.oid IS NULL
        ELSE false
      END)
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid='public.reviews'::regclass
       AND a.attnum>0 AND NOT a.attisdropped
       AND a.attname=ANY(ARRAY['receipt_hash','receipt_data','is_duplicate','ocr_processed_at']))
    AND (SELECT count(*)=3 AND bool_and(
      c.relkind='i'
      AND i.indrelid='public.reviews'::regclass
      AND am.amname='btree'
      AND i.indnkeyatts=1 AND i.indnatts=1
      AND i.indexprs IS NULL
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisprimary AND NOT i.indisexclusion
      AND CASE c.relname
        WHEN 'idx_reviews_receipt_hash' THEN i.indisunique
          AND pg_get_indexdef(c.oid,1,true)='receipt_hash'
          AND pg_get_expr(i.indpred,i.indrelid)='(receipt_hash IS NOT NULL)'
        WHEN 'reviews_ocr_pending_idx' THEN NOT i.indisunique
          AND pg_get_indexdef(c.oid,1,true)='ocr_processed_at'
          AND pg_get_expr(i.indpred,i.indrelid)='(verification_photo IS NOT NULL)'
        WHEN 'reviews_duplicate_idx' THEN NOT i.indisunique
          AND pg_get_indexdef(c.oid,1,true)='is_duplicate'
          AND i.indpred IS NULL
        ELSE false
      END)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_index i ON i.indexrelid=c.oid
     JOIN pg_am am ON am.oid=c.relam
     WHERE n.nspname='public'
       AND c.relname=ANY(ARRAY['idx_reviews_receipt_hash','reviews_ocr_pending_idx','reviews_duplicate_idx']))
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[${ocrValues}]) signature WHERE to_regprocedure(signature) IS NULL) AS ocr_ready,
   (SELECT count(*)=11 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(ARRAY[${ocrValues}]) AND grantee='service_role') AS g014_ready,
   EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='review_verifications_immutable_update' AND polcmd='w' AND NOT polpermissive)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='a01_review_verification_immutable_update' AND NOT tgisinternal)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='a01_review_verification_guard_delete' AND NOT tgisinternal)
    AND to_regprocedure('review_media_private.reject_verification_object_update()') IS NOT NULL
    AND to_regprocedure('review_media_private.guard_verification_object_delete()') IS NOT NULL AS immutable_ready
 )
 SELECT json_build_object(
  'bundle',json_build_object(
   'ledgerCount',ledger_all.row_count,
   'priorCount',ledger_prefix.row_count,
   'prefixRoot',encode(sha256(convert_to(ledger_prefix.material,'UTF8')),'hex'),
   'targetCount',target_state.target_count,
   'suffixRoot',CASE WHEN target_state.target_count=4 AND ${targetRows} THEN ${quote(suffixRoot)} ELSE NULL END
  ),
  'state',json_build_object(
   'activeReviewItems',(SELECT count(*)::int FROM pipeline_control.restaurant_review_items WHERE state IN('queued','running')),
   'baseReviewReady',contract.base_review_ready,
   'catalogRoot',encode(sha256(convert_to(catalog_material.material,'UTF8')),'hex'),
   'currentUser',current_user,
   'databaseName',current_database(),
   'featureRuntimeReady',contract.storyboard_ready AND contract.ocr_ready AND contract.g014_ready AND contract.immutable_ready,
   'g014Ready',contract.g014_ready,
   'g014Root',encode(sha256(convert_to(g014_material.material,'UTF8')),'hex'),
   'immutableReady',contract.immutable_ready,
   'ledgerRoot',encode(sha256(convert_to(ledger_all.material,'UTF8')),'hex'),
   'ocrReady',contract.ocr_ready,
   'predecessorReady',contract.predecessor_ready,
   'reviewPolicyEnabled',coalesce((SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton),true),
   'reviewRuns',(SELECT count(*)::int FROM pipeline_control.restaurant_review_runs),
   'roleRoot',encode(sha256(convert_to(role_material.material,'UTF8')),'hex'),
   'serverMajor',(current_setting('server_version_num')::int/10000),
   'sessionUser',session_user,
   'storageRoot',encode(sha256(convert_to(storage_material.material,'UTF8')),'hex'),
   'storyboardReady',contract.storyboard_ready,
   'storyboardRoot',encode(sha256(convert_to(storyboard_material.material,'UTF8')),'hex')
  )
 )::text AS state
 FROM ledger_prefix,ledger_all,target_state,catalog_material,role_material,g014_material,storage_material,storyboard_material,contract) AS feature_successor_state`;
}

function validateFeatureStageState(stage, index, manifest, binding) {
  exactKeys(stage, ['bundle', 'state']);
  exactKeys(stage.bundle, ['ledgerCount', 'prefixRoot', 'priorCount', 'suffixRoot', 'targetCount']);
  exactKeys(stage.state, [
    'activeReviewItems', 'baseReviewReady', 'catalogRoot', 'currentUser', 'databaseName',
    'featureRuntimeReady', 'g014Ready', 'g014Root', 'immutableReady', 'ledgerRoot', 'ocrReady',
    'predecessorReady', 'reviewPolicyEnabled', 'reviewRuns', 'roleRoot', 'serverMajor',
    'sessionUser', 'storageRoot', 'storyboardReady', 'storyboardRoot',
  ]);
  const readiness = [
    [false, false, false, false],
    [true, false, false, false],
    [true, true, false, false],
    [true, true, true, false],
    [true, true, true, true],
  ][index];
  if (stage.bundle.ledgerCount !== binding.priorCount + index
    || stage.bundle.priorCount !== binding.priorCount
    || stage.bundle.prefixRoot !== binding.prefixRoot
    || stage.bundle.targetCount !== index
    || stage.bundle.suffixRoot !== (index === 4 ? binding.suffixRoot : null)
    || stage.state.activeReviewItems !== 0
    || stage.state.baseReviewReady !== true
    || stage.state.currentUser !== manifest.executorRole
    || stage.state.databaseName !== manifest.databaseName
    || stage.state.featureRuntimeReady !== (index === 4)
    || stage.state.g014Ready !== readiness[2]
    || stage.state.immutableReady !== readiness[3]
    || stage.state.ocrReady !== readiness[1]
    || stage.state.predecessorReady !== true
    || stage.state.reviewPolicyEnabled !== false
    || stage.state.reviewRuns !== 0
    || stage.state.serverMajor !== manifest.serverMajor
    || stage.state.sessionUser !== manifest.executorRole
    || stage.state.storyboardReady !== readiness[0]) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  for (const key of [
    'catalogRoot', 'g014Root', 'ledgerRoot', 'roleRoot', 'storageRoot', 'storyboardRoot',
  ]) assertHex(stage.state[key]);
  if (index === 0 && stage.state.ledgerRoot !== binding.prefixRoot) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
}

export function validateFeatureStageStates(stageStates, manifest) {
  if (!Array.isArray(stageStates) || stageStates.length !== 5) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  const binding = {
    prefixRoot: stageStates[0]?.bundle?.prefixRoot,
    priorCount: manifest.operatingTransition.beforeFour,
    suffixRoot: migrationBundleSuffixRoot(manifest.migrations),
  };
  assertHex(binding.prefixRoot);
  stageStates.forEach((stage, index) => validateFeatureStageState(stage, index, manifest, binding));
  const roots = key => stageStates.map(stage => stage.state[key]);
  if (new Set(roots('ledgerRoot')).size !== 5
    || new Set(roots('catalogRoot')).size !== 5
    || new Set(roots('roleRoot')).size !== 1
    || new Set(roots('g014Root').slice(0, 3)).size !== 1
    || new Set(roots('g014Root').slice(3)).size !== 1
    || roots('g014Root')[2] === roots('g014Root')[3]
    || new Set(roots('storageRoot').slice(0, 4)).size !== 1
    || roots('storageRoot')[3] === roots('storageRoot')[4]
    || new Set(roots('storyboardRoot').slice(1)).size !== 1) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  return Object.freeze(binding);
}

function assertCustodyDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const absolute = resolve(path);
  let status;
  let real;
  try {
    status = lstatSync(absolute);
    real = realpathSync(absolute);
  } catch { fail('FEATURE_SUCCESSOR_ADMISSION_INVALID'); }
  const rel = relative(realpathSync(REPOSITORY_ROOT), real);
  if (!status.isDirectory()
    || status.isSymbolicLink()
    || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)
    || !rel
    || (rel !== '..' && !rel.startsWith(`..${sep}`))) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  return real;
}

function assertCustodyPath(custody, path, expectedName, { mustExist = true } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const absolute = resolve(path);
  if (absolute !== join(custody, expectedName)) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  if (mustExist) {
    try {
      const status = lstatSync(absolute);
      if (!status.isFile()
        || status.isSymbolicLink()
        || dirname(realpathSync(absolute)) !== custody
        || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) {
        fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
      }
    } catch (error) {
      if (safeCode(error).startsWith('FEATURE_SUCCESSOR_')) throw error;
      fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
    }
  } else if (existsSync(absolute)) {
    fail('FEATURE_SUCCESSOR_OUTPUT_EXISTS');
  }
  return absolute;
}

function readBoundedPrivate(path, code = 'FEATURE_SUCCESSOR_ADMISSION_INVALID') {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const status = fstatSync(descriptor);
    const named = lstatSync(path);
    if (!status.isFile()
      || named.isSymbolicLink()
      || status.dev !== named.dev
      || status.ino !== named.ino
      || status.size <= 0
      || status.size > MAX_PRIVATE_FILE_BYTES
      || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) fail(code);
    const bytes = Buffer.allocUnsafe(status.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(count) || count < 0) fail(code);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== status.size || fstatSync(descriptor).size !== status.size) fail(code);
    return bytes.subarray(0, offset);
  } catch (error) {
    if (safeCode(error) === code) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded read outcome */ }
    }
  }
}

function readCanonicalPrivate(path, code = 'FEATURE_SUCCESSOR_ADMISSION_INVALID') {
  const bytes = readBoundedPrivate(path, code);
  const value = parseJsonObject(bytes, code);
  if (!bytes.equals(canonicalBytes(value))) fail(code);
  return Object.freeze({ bytes, value });
}

function readCanonicalJournal(path, code = 'FEATURE_SUCCESSOR_ADMISSION_INVALID') {
  const bytes = readBoundedPrivate(path, code);
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) fail(code);
  const lines = text.slice(0, -1).split('\n');
  if (lines.length === 0 || lines.some(line => !line)) fail(code);
  const entries = lines.map(line => {
    const value = parseJsonObject(line, code);
    if (`${JSON.stringify(canonical(value))}\n` !== `${line}\n`) fail(code);
    return value;
  });
  return Object.freeze({ bytes, entries });
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0) fail('FEATURE_SUCCESSOR_WRITE_FAILED');
    offset += count;
  }
}

function syncDirectory(path, fsyncImpl = fsyncSync) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    fsyncImpl(descriptor);
  } catch { fail('FEATURE_SUCCESSOR_WRITE_FAILED'); }
  finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* durability already bounded */ }
    }
  }
}

function writeExclusiveCanonical(path, value, fsyncImpl = fsyncSync) {
  const bytes = canonicalBytes(value);
  if (bytes.length === 0 || bytes.length > MAX_PRIVATE_FILE_BYTES) {
    fail('FEATURE_SUCCESSOR_WRITE_FAILED');
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | constants.O_NOFOLLOW, 0o600);
    writeAll(descriptor, bytes);
    fsyncImpl(descriptor);
  } catch (error) {
    if (safeCode(error) === 'EEXIST') fail('FEATURE_SUCCESSOR_OUTPUT_EXISTS');
    if (safeCode(error).startsWith('FEATURE_SUCCESSOR_')) throw error;
    fail('FEATURE_SUCCESSOR_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* fsync already established outcome */ }
    }
  }
  syncDirectory(dirname(path), fsyncImpl);
  return Object.freeze({ bytes, sha256: sha256(bytes) });
}

function assertWindow(createdAtValue, expiresAtValue, now) {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(nowMs)
    || expiresAt <= createdAt
    || expiresAt - createdAt > MAX_WINDOW_MS
    || createdAt > nowMs + CLOCK_SKEW_MS
    || nowMs >= expiresAt) fail('FEATURE_SUCCESSOR_ADMISSION_EXPIRED');
  return Object.freeze({ createdAt, expiresAt, nowMs });
}

function validateRollback(rollback, sourceRevision) {
  exactKeys(rollback, [
    'deploymentId', 'deploymentSha', 'deploymentUrl', 'gitRef', 'productionAliases',
    'projectId', 'readbackSha256', 'readyState', 'repository', 'state', 'target', 'teamId',
  ]);
  if (rollback.deploymentSha !== sourceRevision
    || rollback.gitRef !== 'main'
    || rollback.projectId !== TZUDONG_VERCEL_PROJECT_ID
    || rollback.teamId !== TZUDONG_VERCEL_TEAM_ID
    || rollback.repository !== TZUDONG_GITHUB_REPOSITORY
    || !equal(rollback.productionAliases, TZUDONG_PRODUCTION_ALIASES)
    || rollback.readyState !== 'READY'
    || rollback.target !== 'production'
    || rollback.state !== 'ready') fail('FEATURE_SUCCESSOR_ROLLBACK_INCOMPATIBLE');
  assertHex(rollback.readbackSha256);
}

function validateBaseJournal(journal, parentAdmission, parentAdmissionSha256, window, nowMs) {
  if (journal.entries.length !== 2) fail('FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED');
  const [started, terminal] = journal.entries;
  exactKeys(started, [
    'admissionSha256', 'attemptId', 'event', 'manifestSha256', 'sourceRevision',
    'sourceRoot', 'startedAt',
  ], 'FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED');
  exactKeys(terminal, [
    'attemptId', 'code', 'completedAt', 'event',
  ], 'FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED');
  const startedAt = Date.parse(started.startedAt);
  const completedAt = Date.parse(terminal.completedAt);
  if (started.event !== 'started'
    || started.admissionSha256 !== parentAdmissionSha256
    || started.attemptId !== parentAdmission.attemptId
    || started.manifestSha256 !== parentAdmission.manifestSha256
    || started.sourceRevision !== parentAdmission.sourceRevision
    || started.sourceRoot !== parentAdmission.sourceRoot
    || terminal.event !== 'terminal'
    || terminal.code !== 'SUCCESSOR_COMMITTED'
    || terminal.attemptId !== parentAdmission.attemptId
    || !Number.isFinite(startedAt)
    || !Number.isFinite(completedAt)
    || startedAt < window.createdAt
    || completedAt < startedAt
    || startedAt > nowMs + CLOCK_SKEW_MS
    || completedAt > nowMs + CLOCK_SKEW_MS
    || completedAt >= window.expiresAt) fail('FEATURE_SUCCESSOR_PARENT_NOT_COMMITTED');
}

function validateParentCustody(custody, now, { predecessorRecord } = {}) {
  const predecessor = predecessorRecord ?? loadSuccessorManifest();
  const admissionPath = assertCustodyPath(
    custody,
    join(custody, FEATURE_SUCCESSOR_FILES.baseAdmission),
    FEATURE_SUCCESSOR_FILES.baseAdmission,
  );
  const journalPath = assertCustodyPath(
    custody,
    join(custody, FEATURE_SUCCESSOR_FILES.baseJournal),
    FEATURE_SUCCESSOR_FILES.baseJournal,
  );
  const admissionRecord = readCanonicalPrivate(admissionPath);
  const journalRecord = readCanonicalJournal(journalPath);
  let window;
  try {
    window = validateSuccessorAdmission(admissionRecord.value, predecessor, {
      now,
      receiptDirectory: custody,
    });
  } catch (error) {
    if (safeCode(error) === 'SUCCESSOR_ADMISSION_EXPIRED') {
      fail('FEATURE_SUCCESSOR_ADMISSION_EXPIRED');
    }
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  validateRollback(admissionRecord.value.rollback, admissionRecord.value.sourceRevision);
  validateBaseJournal(
    journalRecord,
    admissionRecord.value,
    sha256(admissionRecord.bytes),
    window,
    now.getTime(),
  );
  return Object.freeze({
    admission: admissionRecord.value,
    admissionSha256: sha256(admissionRecord.bytes),
    journalSha256: sha256(journalRecord.bytes),
    predecessor,
    window,
  });
}

function validateFeatureEnvelope(admission, manifestRecord, custody, now, expectedKind) {
  const common = [
    'attemptId', 'baseAdmissionSha256', 'baseApplyEvidenceMapSha256',
    'baseApplyQuiescenceReadbackSha256', 'baseJournalSha256',
    'baseRehearsalAdmissionSha256', 'createdAt', 'expiresAt', 'id',
    'journalPathSha256', 'kind', 'manifestSha256', 'predecessorSourceRoot',
    'projectRef', 'purpose', 'rollback', 'schemaVersion', 'sourceRevision',
    'sourceRoot', 'writerFences',
  ];
  const keys = expectedKind === 'feature-successor-rehearsal-admission'
    ? [...common, 'receiptPathSha256']
    : [...common, 'rehearsalJournalSha256', 'rehearsalReceiptSha256', 'stageStates'];
  exactKeys(admission, keys);
  const { manifest, manifestSha256 } = manifestRecord;
  if (admission.schemaVersion !== 1
    || admission.kind !== expectedKind
    || admission.id !== manifest.id
    || admission.purpose !== manifest.purpose
    || admission.projectRef !== manifest.projectRef
    || admission.manifestSha256 !== manifestSha256
    || admission.sourceRoot !== manifest.sourceRoot
    || admission.predecessorSourceRoot !== manifest.predecessor.sourceRoot
    || !UUID.test(admission.attemptId)
    || !REVISION.test(admission.sourceRevision)) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const window = assertWindow(admission.createdAt, admission.expiresAt, now);
  validateRollback(admission.rollback, admission.sourceRevision);
  assertHex(admission.baseAdmissionSha256);
  assertHex(admission.baseApplyEvidenceMapSha256);
  assertHex(admission.baseApplyQuiescenceReadbackSha256);
  assertHex(admission.baseJournalSha256);
  assertHex(admission.baseRehearsalAdmissionSha256);
  assertHex(admission.journalPathSha256);
  if (expectedKind === 'feature-successor-rehearsal-admission') {
    assertHex(admission.receiptPathSha256);
  } else {
    assertHex(admission.rehearsalJournalSha256);
    assertHex(admission.rehearsalReceiptSha256);
    validateFeatureStageStates(admission.stageStates, manifest);
  }
  const parent = validateParentCustody(custody, now, {
    predecessorRecord: manifestRecord.predecessor,
  });
  if (parent.admissionSha256 !== admission.baseAdmissionSha256
    || parent.admission.applyEvidenceMapSha256 !== admission.baseApplyEvidenceMapSha256
    || parent.admission.applyQuiescenceReadbackSha256
      !== admission.baseApplyQuiescenceReadbackSha256
    || parent.journalSha256 !== admission.baseJournalSha256
    || parent.admission.rehearsalAdmissionSha256
      !== admission.baseRehearsalAdmissionSha256
    || parent.admission.createdAt !== admission.createdAt
    || parent.admission.expiresAt !== admission.expiresAt
    || parent.admission.sourceRevision !== admission.sourceRevision
    || parent.admission.sourceRoot !== admission.predecessorSourceRoot
    || !equal(parent.admission.rollback, admission.rollback)
    || !equal(parent.admission.writerFences, admission.writerFences)) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(admission.writerFences, fenceKeys);
  for (const key of fenceKeys) {
    exactKeys(admission.writerFences[key], ['evidenceSha256', 'state']);
    assertHex(admission.writerFences[key].evidenceSha256);
    if (admission.writerFences[key].state !== manifest.requiredWriterFences[key]) {
      fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
    }
  }
  return Object.freeze({ ...window, parent });
}

export function prepareFeatureRehearsalAdmission({
  custodyDirectory,
  fsyncImpl = fsyncSync,
  loadManifestImpl = loadFeatureSuccessorManifest,
  now = new Date(),
} = {}) {
  const custody = assertCustodyDirectory(custodyDirectory);
  const manifestRecord = loadManifestImpl();
  const parent = validateParentCustody(custody, now, {
    predecessorRecord: manifestRecord.predecessor,
  });
  const admissionPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalAdmission), FEATURE_SUCCESSOR_FILES.rehearsalAdmission, { mustExist: false });
  const journalPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalJournal), FEATURE_SUCCESSOR_FILES.rehearsalJournal, { mustExist: false });
  const receiptPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalReceipt), FEATURE_SUCCESSOR_FILES.rehearsalReceipt, { mustExist: false });
  const admission = {
    attemptId: randomUUID(),
    baseAdmissionSha256: parent.admissionSha256,
    baseApplyEvidenceMapSha256: parent.admission.applyEvidenceMapSha256,
    baseApplyQuiescenceReadbackSha256: parent.admission.applyQuiescenceReadbackSha256,
    baseJournalSha256: parent.journalSha256,
    baseRehearsalAdmissionSha256: parent.admission.rehearsalAdmissionSha256,
    createdAt: parent.admission.createdAt,
    expiresAt: parent.admission.expiresAt,
    id: manifestRecord.manifest.id,
    journalPathSha256: sha256(Buffer.from(journalPath)),
    kind: 'feature-successor-rehearsal-admission',
    manifestSha256: manifestRecord.manifestSha256,
    predecessorSourceRoot: manifestRecord.manifest.predecessor.sourceRoot,
    projectRef: manifestRecord.manifest.projectRef,
    purpose: manifestRecord.manifest.purpose,
    receiptPathSha256: sha256(Buffer.from(receiptPath)),
    rollback: structuredClone(parent.admission.rollback),
    schemaVersion: 1,
    sourceRevision: parent.admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    writerFences: structuredClone(parent.admission.writerFences),
  };
  validateFeatureEnvelope(admission, manifestRecord, custody, now, admission.kind);
  const written = writeExclusiveCanonical(admissionPath, admission, fsyncImpl);
  return Object.freeze({
    admissionPath,
    admissionSha256: written.sha256,
    expiresAt: admission.expiresAt,
    journalPath,
    mode: 'rehearsal',
    receiptPath,
    status: 'prepared',
  });
}

function assertFeatureCheckout(admission, manifest, gitFacts, protectedReadback) {
  if (!gitFacts
    || gitFacts.clean !== true
    || gitFacts.detached !== true
    || gitFacts.revision !== admission.sourceRevision
    || !equal(protectedReadback, protectedSourceReadbackBinding(
      manifest,
      admission.sourceRevision,
    ))) fail('FEATURE_SUCCESSOR_CHECKOUT_INVALID');
}

function assertLiveRollback(admission, observed, window, checkedAt) {
  exactKeys(observed, [
    'deploymentId', 'deploymentUrl', 'gitRef', 'gitSha', 'kind', 'observedAt',
    'productionAliases', 'projectId', 'readyState', 'repository', 'schemaVersion',
    'target', 'teamId',
  ], 'FEATURE_SUCCESSOR_ROLLBACK_READBACK_INVALID');
  const observedAt = Date.parse(observed.observedAt);
  if (observed.schemaVersion !== 1
    || observed.kind !== 'vercel-rollback-readback'
    || observed.deploymentId !== admission.rollback.deploymentId
    || observed.deploymentUrl !== admission.rollback.deploymentUrl
    || observed.gitRef !== admission.rollback.gitRef
    || observed.gitSha !== admission.sourceRevision
    || observed.gitSha !== admission.rollback.deploymentSha
    || !equal(observed.productionAliases, admission.rollback.productionAliases)
    || observed.projectId !== admission.rollback.projectId
    || observed.readyState !== admission.rollback.readyState
    || observed.repository !== admission.rollback.repository
    || observed.target !== admission.rollback.target
    || observed.teamId !== admission.rollback.teamId
    || !Number.isFinite(observedAt)
    || observedAt < window.createdAt
    || observedAt >= window.expiresAt
    || observedAt > checkedAt.getTime()) fail('FEATURE_SUCCESSOR_ROLLBACK_READBACK_INVALID');
}

function readFeatureAdmission(custody, name, manifestRecord, now, expectedKind) {
  const path = assertCustodyPath(custody, join(custody, name), name);
  const record = readCanonicalPrivate(path);
  const window = validateFeatureEnvelope(record.value, manifestRecord, custody, now, expectedKind);
  return Object.freeze({ ...record, path, window });
}

function assertJournalOutputPath(custody, name, admission) {
  const path = assertCustodyPath(custody, join(custody, name), name, { mustExist: false });
  if (sha256(Buffer.from(path)) !== admission.journalPathSha256) {
    fail('FEATURE_SUCCESSOR_JOURNAL_INVALID');
  }
  return path;
}

function writeJournalStart(path, entry, fsyncImpl = fsyncSync) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | constants.O_NOFOLLOW, 0o600);
    writeAll(descriptor, canonicalBytes(entry));
    fsyncImpl(descriptor);
    syncDirectory(dirname(path), fsyncImpl);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded below */ }
    }
    if (safeCode(error) === 'EEXIST') fail('FEATURE_SUCCESSOR_JOURNAL_EXISTS');
    if (safeCode(error).startsWith('FEATURE_SUCCESSOR_')) throw error;
    fail('FEATURE_SUCCESSOR_WRITE_FAILED');
  }
}

function appendJournal(descriptor, entry, fsyncImpl = fsyncSync) {
  try {
    writeAll(descriptor, canonicalBytes(entry));
    fsyncImpl(descriptor);
    closeSync(descriptor);
  } catch {
    try { closeSync(descriptor); } catch { /* fixed failure */ }
    fail('FEATURE_SUCCESSOR_WRITE_FAILED');
  }
}

function assertFresh(window, now) {
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(nowMs) || nowMs >= window.expiresAt) {
    fail('FEATURE_SUCCESSOR_ADMISSION_EXPIRED');
  }
}

function parseSingleState(output, code = 'FEATURE_SUCCESSOR_READBACK_INVALID') {
  if (typeof output !== 'string' || !output.trim()) fail(code);
  return parseJsonObject(output.trim(), code);
}

function featureExpirySql(admission, suffix, { armTransactionTimeout = false } = {}) {
  const tag = `$feature_expiry_${sha256(`${admission.expiresAt}:${suffix}`).slice(0, 18)}$`;
  const timeout = armTransactionTimeout
    ? `\n PERFORM set_config('transaction_timeout',least(${MAX_WINDOW_MS},greatest(1,ceil(extract(epoch FROM (${quote(admission.expiresAt)}::timestamptz-transaction_timestamp()))*1000)::bigint))::text,true);`
    : '';
  return `DO ${tag} BEGIN IF clock_timestamp() >= ${quote(admission.expiresAt)}::timestamptz THEN RAISE EXCEPTION 'SUCCESSOR_ADMISSION_EXPIRED'; END IF;${timeout} END ${tag};`;
}

function featureStageSql(stateQuery, index) {
  return `SELECT json_build_object('index',${index},'kind','feature-successor-rehearsal-stage','serverVersionNum',current_setting('server_version_num')::int,'state',(${stateQuery})::jsonb)::text;`;
}

function compileFeatureSources(manifestRecord) {
  return Object.freeze(manifestRecord.manifest.migrations.map((migration, index) => {
    const material = manifestRecord.materials[index];
    const plan = migrationEnvelope(material.bytes, migration, material.originalVector);
    if (plan.vectorSha256 !== migration.statementVectorSha256) {
      fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
    }
    return Object.freeze(plan);
  }));
}

export function validateFeatureBaseline(stage, manifest) {
  const binding = {
    prefixRoot: stage?.bundle?.prefixRoot,
    priorCount: manifest.operatingTransition.beforeFour,
    suffixRoot: migrationBundleSuffixRoot(manifest.migrations),
  };
  assertHex(binding.prefixRoot, 'FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  try { validateFeatureStageState(stage, 0, manifest, binding); }
  catch { fail('FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID'); }
  return Object.freeze(binding);
}

export function compileFeatureRehearsalPlan(manifestRecord, admission, baseline) {
  const { manifest } = manifestRecord;
  validateFeatureBaseline(baseline, manifest);
  const sources = compileFeatureSources(manifestRecord);
  const stateQuery = buildFeatureSuccessorStateQuery(manifestRecord);
  const lockTag = `$feature_rehearsal_${sha256(manifest.advisoryLockKey).slice(0, 18)}$`;
  const baselineTag = `$feature_baseline_${sha256(JSON.stringify(canonical(baseline))).slice(0, 18)}$`;
  const parts = [
    'BEGIN;',
    "SET LOCAL lock_timeout='2s';",
    "SET LOCAL statement_timeout='15s';",
    "SET LOCAL idle_in_transaction_session_timeout='30s';",
    `DO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${manifest.advisoryLockKey}::bigint); END ${lockTag};`,
    featureExpirySql(admission, 'after-lock', { armTransactionTimeout: true }),
    'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;',
    `DO ${baselineTag} BEGIN IF (${stateQuery})::jsonb IS DISTINCT FROM ${quote(JSON.stringify(canonical(baseline)))}::jsonb THEN RAISE EXCEPTION 'FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID'; END IF; END ${baselineTag};`,
    featureStageSql(stateQuery, 0),
  ];
  sources.forEach((source, index) => {
    const ledgerTag = `$feature_ledger_${sha256(manifest.migrations[index].id).slice(0, 18)}$`;
    parts.push(
      featureExpirySql(admission, `before-${index + 1}`),
      '\\o /dev/null',
      source.execution,
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(source.version)},${quote(source.name)},ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(source.originalVector))}::jsonb)));`,
      `DO ${ledgerTag} BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(source.version)} AND name=${quote(source.name)} AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(source.originalVector))}::jsonb))) THEN RAISE EXCEPTION 'MIGRATION_LEDGER_READBACK_FAILED'; END IF; END ${ledgerTag};`,
      '\\o',
      featureStageSql(stateQuery, index + 1),
    );
  });
  parts.push(featureExpirySql(admission, 'before-rollback'), 'ROLLBACK;');
  return Object.freeze({
    sql: parts.join('\n'),
    stateQuery,
    suffixRoot: migrationBundleSuffixRoot(manifest.migrations),
    transactionMode: 'explicit-rollback-only',
  });
}

function parseFeatureRehearsalStages(output, manifest, expectedBaseline) {
  if (typeof output !== 'string') fail('FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 5) fail('FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  let serverVersionNum;
  const stages = lines.map((line, index) => {
    const value = parseJsonObject(line, 'FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
    exactKeys(value, ['index', 'kind', 'serverVersionNum', 'state'], 'FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
    if (value.kind !== 'feature-successor-rehearsal-stage'
      || value.index !== index
      || !Number.isSafeInteger(value.serverVersionNum)
      || Math.floor(value.serverVersionNum / 10_000) !== manifest.serverMajor
      || (serverVersionNum !== undefined && serverVersionNum !== value.serverVersionNum)) {
      fail('FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
    }
    serverVersionNum = value.serverVersionNum;
    return value.state;
  });
  try { validateFeatureStageStates(stages, manifest); }
  catch { fail('FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID'); }
  if (!equal(stages[0], expectedBaseline)) fail('FEATURE_SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  return Object.freeze({ serverVersionNum, stages: Object.freeze(stages) });
}

export function runFeatureSuccessorRehearsal({
  custodyDirectory,
  environment = process.env,
} = {}, {
  clock = () => new Date(),
  fsyncImpl = fsyncSync,
  gitFactsImpl = currentSuccessorGitFacts,
  loadManifestImpl = loadFeatureSuccessorManifest,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  rollbackReadbackImpl = captureVercelRollbackReadbackSync,
  runPsqlImpl,
} = {}) {
  const custody = assertCustodyDirectory(custodyDirectory);
  const manifestRecord = loadManifestImpl();
  const admissionRecord = readFeatureAdmission(
    custody,
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
    manifestRecord,
    clock(),
    'feature-successor-rehearsal-admission',
  );
  const { value: admission, window } = admissionRecord;
  assertFeatureCheckout(
    admission,
    manifestRecord.manifest,
    gitFactsImpl(),
    protectedMainReadbackImpl(manifestRecord.manifest),
  );
  let rollback;
  try {
    rollback = rollbackReadbackImpl({
      expected: {
        deploymentId: admission.rollback.deploymentId,
        deploymentUrl: admission.rollback.deploymentUrl,
        gitRef: admission.rollback.gitRef,
        gitSha: admission.sourceRevision,
      },
      now: clock,
    });
  } catch { fail('FEATURE_SUCCESSOR_ROLLBACK_READBACK_INVALID'); }
  const rollbackCheckedAt = clock();
  assertFresh(window, rollbackCheckedAt);
  assertLiveRollback(admission, rollback, window, rollbackCheckedAt);
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, manifestRecord.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });
  const stateQuery = buildFeatureSuccessorStateQuery(manifestRecord);
  let baseline;
  try {
    baseline = parseSingleState(transport(
      databaseUrl,
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='15s';\n${stateQuery};`,
      true,
    ), 'FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID');
    validateFeatureBaseline(baseline, manifestRecord.manifest);
  } catch (error) {
    if (safeCode(error).startsWith('FEATURE_SUCCESSOR_')) throw error;
    fail('FEATURE_SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  }
  const plan = compileFeatureRehearsalPlan(manifestRecord, admission, baseline);
  const journalPath = assertJournalOutputPath(custody, FEATURE_SUCCESSOR_FILES.rehearsalJournal, admission);
  const receiptPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalReceipt), FEATURE_SUCCESSOR_FILES.rehearsalReceipt, { mustExist: false });
  if (sha256(Buffer.from(receiptPath)) !== admission.receiptPathSha256) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  const admissionSha256 = sha256(admissionRecord.bytes);
  const started = {
    admissionSha256,
    attemptId: admission.attemptId,
    event: 'started',
    manifestSha256: manifestRecord.manifestSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: admission.sourceRoot,
    startedAt: clock().toISOString(),
  };
  const descriptor = writeJournalStart(journalPath, started, fsyncImpl);
  let parsed;
  let written;
  try {
    assertFresh(window, clock());
    parsed = parseFeatureRehearsalStages(
      transport(databaseUrl, plan.sql, false),
      manifestRecord.manifest,
      baseline,
    );
    let restored;
    try {
      restored = parseSingleState(transport(
        databaseUrl,
        `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='15s';\n${stateQuery};`,
        true,
      ));
    } catch { fail('FEATURE_SUCCESSOR_REHEARSAL_RESTORE_INVALID'); }
    if (!equal(restored, baseline)) fail('FEATURE_SUCCESSOR_REHEARSAL_RESTORE_INVALID');
    const observedAt = clock();
    assertFresh(window, observedAt);
    const receipt = {
      admissionSha256,
      attemptId: admission.attemptId,
      expiresAt: admission.expiresAt,
      id: manifestRecord.manifest.id,
      kind: 'feature-successor-rehearsal-receipt',
      manifestSha256: manifestRecord.manifestSha256,
      observedAt: observedAt.toISOString(),
      passed: true,
      preflightStateSha256: sha256(Buffer.from(JSON.stringify(canonical(baseline)))),
      projectRef: manifestRecord.manifest.projectRef,
      purpose: manifestRecord.manifest.purpose,
      restoredStateSha256: sha256(Buffer.from(JSON.stringify(canonical(restored)))),
      schemaVersion: 1,
      serverVersionNum: parsed.serverVersionNum,
      sourceRevision: admission.sourceRevision,
      sourceRoot: admission.sourceRoot,
      stageStates: parsed.stages,
      stageStatesSha256: sha256(Buffer.from(JSON.stringify(canonical(parsed.stages)))),
      suffixRoot: plan.suffixRoot,
    };
    written = writeExclusiveCanonical(receiptPath, receipt, fsyncImpl);
  } catch (error) {
    const bounded = boundedFeatureSuccessorError(error);
    appendJournal(descriptor, {
      attemptId: admission.attemptId,
      code: bounded.code,
      completedAt: clock().toISOString(),
      event: 'terminal',
    }, fsyncImpl);
    throw bounded;
  }
  appendJournal(descriptor, {
    attemptId: admission.attemptId,
    code: 'FEATURE_SUCCESSOR_REHEARSAL_PASSED',
    completedAt: clock().toISOString(),
    event: 'terminal',
    receiptSha256: written.sha256,
  }, fsyncImpl);
  return Object.freeze({
    attemptId: admission.attemptId,
    code: 'FEATURE_SUCCESSOR_REHEARSAL_PASSED',
    receiptSha256: written.sha256,
    sourceRevision: admission.sourceRevision,
    status: 'rolled_back',
  });
}

function validateFeatureRehearsalArtifacts(custody, rehearsalAdmission, manifestRecord, now) {
  const journalPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalJournal), FEATURE_SUCCESSOR_FILES.rehearsalJournal);
  const receiptPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.rehearsalReceipt), FEATURE_SUCCESSOR_FILES.rehearsalReceipt);
  const journal = readCanonicalJournal(journalPath);
  const receipt = readCanonicalPrivate(receiptPath);
  if (journal.entries.length !== 2) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  const [started, terminal] = journal.entries;
  exactKeys(started, [
    'admissionSha256', 'attemptId', 'event', 'manifestSha256', 'sourceRevision',
    'sourceRoot', 'startedAt',
  ]);
  exactKeys(terminal, [
    'attemptId', 'code', 'completedAt', 'event', 'receiptSha256',
  ]);
  exactKeys(receipt.value, [
    'admissionSha256', 'attemptId', 'expiresAt', 'id', 'kind', 'manifestSha256',
    'observedAt', 'passed', 'preflightStateSha256', 'projectRef', 'purpose',
    'restoredStateSha256', 'schemaVersion', 'serverVersionNum', 'sourceRevision',
    'sourceRoot', 'stageStates', 'stageStatesSha256', 'suffixRoot',
  ]);
  const admissionSha256 = sha256(canonicalBytes(rehearsalAdmission));
  const receiptSha256 = sha256(receipt.bytes);
  const startedAt = Date.parse(started.startedAt);
  const completedAt = Date.parse(terminal.completedAt);
  const observedAt = Date.parse(receipt.value.observedAt);
  const window = assertWindow(rehearsalAdmission.createdAt, rehearsalAdmission.expiresAt, now);
  if (sha256(Buffer.from(journalPath)) !== rehearsalAdmission.journalPathSha256
    || sha256(Buffer.from(receiptPath)) !== rehearsalAdmission.receiptPathSha256
    || started.event !== 'started'
    || started.admissionSha256 !== admissionSha256
    || started.attemptId !== rehearsalAdmission.attemptId
    || started.manifestSha256 !== manifestRecord.manifestSha256
    || started.sourceRevision !== rehearsalAdmission.sourceRevision
    || started.sourceRoot !== rehearsalAdmission.sourceRoot
    || terminal.event !== 'terminal'
    || terminal.code !== 'FEATURE_SUCCESSOR_REHEARSAL_PASSED'
    || terminal.attemptId !== rehearsalAdmission.attemptId
    || terminal.receiptSha256 !== receiptSha256
    || receipt.value.schemaVersion !== 1
    || receipt.value.kind !== 'feature-successor-rehearsal-receipt'
    || receipt.value.passed !== true
    || receipt.value.admissionSha256 !== admissionSha256
    || receipt.value.attemptId !== rehearsalAdmission.attemptId
    || receipt.value.expiresAt !== rehearsalAdmission.expiresAt
    || receipt.value.id !== manifestRecord.manifest.id
    || receipt.value.manifestSha256 !== manifestRecord.manifestSha256
    || receipt.value.projectRef !== manifestRecord.manifest.projectRef
    || receipt.value.purpose !== manifestRecord.manifest.purpose
    || receipt.value.sourceRevision !== rehearsalAdmission.sourceRevision
    || receipt.value.sourceRoot !== rehearsalAdmission.sourceRoot
    || receipt.value.suffixRoot !== migrationBundleSuffixRoot(manifestRecord.manifest.migrations)
    || receipt.value.stageStatesSha256 !== sha256(Buffer.from(JSON.stringify(canonical(receipt.value.stageStates))))
    || receipt.value.preflightStateSha256 !== sha256(Buffer.from(JSON.stringify(canonical(receipt.value.stageStates[0]))))
    || receipt.value.restoredStateSha256 !== receipt.value.preflightStateSha256
    || !Number.isSafeInteger(receipt.value.serverVersionNum)
    || Math.floor(receipt.value.serverVersionNum / 10_000) !== manifestRecord.manifest.serverMajor
    || !Number.isFinite(startedAt)
    || !Number.isFinite(completedAt)
    || !Number.isFinite(observedAt)
    || startedAt < window.createdAt
    || observedAt < startedAt
    || completedAt < observedAt
    || startedAt > window.nowMs + CLOCK_SKEW_MS
    || observedAt > window.nowMs + CLOCK_SKEW_MS
    || completedAt > window.nowMs + CLOCK_SKEW_MS
    || completedAt >= window.expiresAt) fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  validateFeatureStageStates(receipt.value.stageStates, manifestRecord.manifest);
  return Object.freeze({
    journalSha256: sha256(journal.bytes),
    receipt: receipt.value,
    receiptSha256,
  });
}

export function prepareFeatureApplyAdmission({
  custodyDirectory,
  fsyncImpl = fsyncSync,
  loadManifestImpl = loadFeatureSuccessorManifest,
  now = new Date(),
} = {}) {
  const custody = assertCustodyDirectory(custodyDirectory);
  const manifestRecord = loadManifestImpl();
  const rehearsalRecord = readFeatureAdmission(
    custody,
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
    manifestRecord,
    now,
    'feature-successor-rehearsal-admission',
  );
  const artifacts = validateFeatureRehearsalArtifacts(
    custody,
    rehearsalRecord.value,
    manifestRecord,
    now,
  );
  const admissionPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.applyAdmission), FEATURE_SUCCESSOR_FILES.applyAdmission, { mustExist: false });
  const journalPath = assertCustodyPath(custody, join(custody, FEATURE_SUCCESSOR_FILES.applyJournal), FEATURE_SUCCESSOR_FILES.applyJournal, { mustExist: false });
  const admission = {
    attemptId: randomUUID(),
    baseAdmissionSha256: rehearsalRecord.value.baseAdmissionSha256,
    baseApplyEvidenceMapSha256: rehearsalRecord.value.baseApplyEvidenceMapSha256,
    baseApplyQuiescenceReadbackSha256:
      rehearsalRecord.value.baseApplyQuiescenceReadbackSha256,
    baseJournalSha256: rehearsalRecord.value.baseJournalSha256,
    baseRehearsalAdmissionSha256: rehearsalRecord.value.baseRehearsalAdmissionSha256,
    createdAt: rehearsalRecord.value.createdAt,
    expiresAt: rehearsalRecord.value.expiresAt,
    id: manifestRecord.manifest.id,
    journalPathSha256: sha256(Buffer.from(journalPath)),
    kind: 'feature-successor-apply-admission',
    manifestSha256: manifestRecord.manifestSha256,
    predecessorSourceRoot: manifestRecord.manifest.predecessor.sourceRoot,
    projectRef: manifestRecord.manifest.projectRef,
    purpose: manifestRecord.manifest.purpose,
    rehearsalJournalSha256: artifacts.journalSha256,
    rehearsalReceiptSha256: artifacts.receiptSha256,
    rollback: structuredClone(rehearsalRecord.value.rollback),
    schemaVersion: 1,
    sourceRevision: rehearsalRecord.value.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    stageStates: structuredClone(artifacts.receipt.stageStates),
    writerFences: structuredClone(rehearsalRecord.value.writerFences),
  };
  validateFeatureEnvelope(admission, manifestRecord, custody, now, admission.kind);
  const written = writeExclusiveCanonical(admissionPath, admission, fsyncImpl);
  return Object.freeze({
    admissionPath,
    admissionSha256: written.sha256,
    expiresAt: admission.expiresAt,
    journalPath,
    mode: 'apply',
    status: 'prepared',
  });
}

function stripCompiledReadback(sql) {
  const spans = statementSpans(sql);
  const read = spans.at(-1);
  if (!read || !/^SELECT\b/i.test(read.token)) fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
  return sql.slice(0, read.start).trimEnd();
}

function guardFeatureStages(compiled, migrations, admission) {
  const stages = compiled.plans.map((plan, index) => stripCompiledReadback(
    atomicMigrationSql(plan, migrations[index]),
  ));
  const prefix = stages.join('\n');
  if (!compiled.sql.startsWith(`${prefix}\n`)) fail('FEATURE_SUCCESSOR_SOURCE_DRIFT');
  const tail = compiled.sql.slice(prefix.length + 1);
  return `${stages.map((stage, index) => `${stage}\n${featureExpirySql(admission, `stage-${index + 1}`)}`).join('\n')}\n${tail}${FEATURE_SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER}\n${featureExpirySql(admission, 'pre-commit')}\n`;
}

export function compileFeatureApplyPlan(manifestRecord, admission) {
  const { manifest, materials } = manifestRecord;
  const binding = validateFeatureStageStates(admission.stageStates, manifest);
  const stateQuery = buildFeatureSuccessorStateQuery(manifestRecord, binding.suffixRoot);
  const migrations = manifest.migrations.map((migration, index) => ({
    expectedPriorState: { expected: admission.stageStates[index], query: stateQuery },
    id: migration.id,
    path: migration.path,
    sha256: migration.sha256,
    statementVectorSha256: migration.statementVectorSha256,
    terminalReadback: { expected: admission.stageStates[index + 1], query: stateQuery },
  }));
  const compiled = compileMigrationBundle({
    finalReadback: { expected: admission.stageStates[4], query: stateQuery },
    id: manifest.id,
    migrations,
    prefixRoot: binding.prefixRoot,
    priorCount: binding.priorCount,
    priorReadback: { expected: admission.stageStates[0], query: stateQuery },
    schemaVersion: 1,
    suffixRoot: binding.suffixRoot,
  }, materials);
  const lockTag = `$feature_apply_${sha256(manifest.advisoryLockKey).slice(0, 18)}$`;
  const guarded = guardFeatureStages(compiled, migrations, admission);
  return Object.freeze({
    ...compiled,
    sql: `SET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\nSET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${manifest.advisoryLockKey}::bigint); END ${lockTag};\n${featureExpirySql(admission, 'post-lock', { armTransactionTimeout: true })}\n${guarded}`,
    stateQuery,
  });
}

function assertFeatureLaunchReady(manifest) {
  if (manifest.launchPolicy.state !== 'ready') fail('FEATURE_SUCCESSOR_LAUNCH_HELD');
}

export function runFeatureSuccessorApply({
  custodyDirectory,
  environment = process.env,
} = {}, {
  clock = () => new Date(),
  fsyncImpl = fsyncSync,
  gitFactsImpl = currentSuccessorGitFacts,
  loadManifestImpl = loadFeatureSuccessorManifest,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  rollbackReadbackImpl = captureVercelRollbackReadbackSync,
  runPsqlImpl,
} = {}) {
  const manifestRecord = loadManifestImpl();
  assertFeatureLaunchReady(manifestRecord.manifest);
  const custody = assertCustodyDirectory(custodyDirectory);
  const admissionRecord = readFeatureAdmission(
    custody,
    FEATURE_SUCCESSOR_FILES.applyAdmission,
    manifestRecord,
    clock(),
    'feature-successor-apply-admission',
  );
  const { value: admission, window } = admissionRecord;
  const rehearsalAdmission = readFeatureAdmission(
    custody,
    FEATURE_SUCCESSOR_FILES.rehearsalAdmission,
    manifestRecord,
    clock(),
    'feature-successor-rehearsal-admission',
  );
  const artifacts = validateFeatureRehearsalArtifacts(
    custody,
    rehearsalAdmission.value,
    manifestRecord,
    clock(),
  );
  if (admission.rehearsalJournalSha256 !== artifacts.journalSha256
    || admission.rehearsalReceiptSha256 !== artifacts.receiptSha256
    || !equal(admission.stageStates, artifacts.receipt.stageStates)) {
    fail('FEATURE_SUCCESSOR_ADMISSION_INVALID');
  }
  assertFeatureCheckout(
    admission,
    manifestRecord.manifest,
    gitFactsImpl(),
    protectedMainReadbackImpl(manifestRecord.manifest),
  );
  const readRollback = () => {
    let observed;
    try {
      observed = rollbackReadbackImpl({
        expected: {
          deploymentId: admission.rollback.deploymentId,
          deploymentUrl: admission.rollback.deploymentUrl,
          gitRef: admission.rollback.gitRef,
          gitSha: admission.sourceRevision,
        },
        now: clock,
      });
    } catch { fail('FEATURE_SUCCESSOR_ROLLBACK_READBACK_INVALID'); }
    const checkedAt = clock();
    assertFresh(window, checkedAt);
    assertLiveRollback(admission, observed, window, checkedAt);
  };
  readRollback();
  const plan = compileFeatureApplyPlan(manifestRecord, admission);
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, manifestRecord.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });
  let observed;
  try {
    observed = parseSingleState(transport(
      databaseUrl,
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='15s';\n${plan.stateQuery};`,
      true,
    ));
  } catch { fail('FEATURE_SUCCESSOR_READBACK_INVALID'); }
  if (!equal(observed, admission.stageStates[0])) fail('FEATURE_SUCCESSOR_PREFLIGHT_MISMATCH');
  readRollback();
  const journalPath = assertJournalOutputPath(custody, FEATURE_SUCCESSOR_FILES.applyJournal, admission);
  const admissionSha256 = sha256(admissionRecord.bytes);
  const descriptor = writeJournalStart(journalPath, {
    admissionSha256,
    attemptId: admission.attemptId,
    event: 'started',
    manifestSha256: manifestRecord.manifestSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: admission.sourceRoot,
    startedAt: clock().toISOString(),
  }, fsyncImpl);
  let terminal;
  try {
    assertFresh(window, clock());
    terminal = executeMigrationBundle(databaseUrl, plan, { runPsqlImpl: transport });
  } catch (error) {
    const bounded = boundedFeatureSuccessorError(error);
    appendJournal(descriptor, {
      attemptId: admission.attemptId,
      code: bounded.code,
      completedAt: clock().toISOString(),
      event: 'terminal',
    }, fsyncImpl);
    throw bounded;
  }
  appendJournal(descriptor, {
    attemptId: admission.attemptId,
    code: 'FEATURE_SUCCESSOR_COMMITTED',
    completedAt: clock().toISOString(),
    event: 'terminal',
  }, fsyncImpl);
  return Object.freeze({
    attemptId: admission.attemptId,
    code: 'FEATURE_SUCCESSOR_COMMITTED',
    sourceRevision: admission.sourceRevision,
    status: 'committed',
    terminal,
  });
}

export function parseFeatureSuccessorArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4
    || argv[0] !== '--mode'
    || !['prepare-rehearsal', 'rehearsal', 'prepare-apply', 'apply'].includes(argv[1])
    || argv[2] !== '--custody-dir'
    || typeof argv[3] !== 'string'
    || !argv[3]) fail('FEATURE_SUCCESSOR_ARGUMENT_INVALID');
  return Object.freeze({ custodyDirectory: argv[3], mode: argv[1] });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseFeatureSuccessorArguments(argv);
  if (args.mode === 'prepare-rehearsal') {
    return prepareFeatureRehearsalAdmission(args, dependencies);
  }
  if (args.mode === 'rehearsal') return runFeatureSuccessorRehearsal(args, dependencies);
  if (args.mode === 'prepare-apply') return prepareFeatureApplyAdmission(args, dependencies);
  return runFeatureSuccessorApply(args, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(await main()));
  } catch (error) {
    console.error(JSON.stringify(featureSuccessorFailureResult(error)));
    process.exitCode = 1;
  }
}
