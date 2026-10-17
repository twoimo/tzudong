/** Local-only controller for the atomic eleven-stage review-media successor. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundedMigrationError,
  psqlConnectionEnvironment,
  readOriginalStatementVector,
  selectDirectDatabaseTransport,
} from './apply-supabase-migration.mjs';
import {
  compileElevenMigrationRehearsalSources,
  compileElevenMigrationBundle,
  executeMigrationBundle,
  elevenMigrationBundleSuffixRoot,
} from './supabase-migration-bundle.mjs';
import {
  atomicMigrationSql,
  statementSpans,
} from './supabase-migration-transaction.mjs';
import {
  TZUDONG_GITHUB_REPOSITORY,
  TZUDONG_PRODUCTION_ALIASES,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  captureVercelRollbackReadbackSync,
  normalizeVercelRollbackExpected,
} from './vercel-rollback-readback.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const SUCCESSOR_MANIFEST_PATH = resolve(REPOSITORY_ROOT, '.github/review-media-sql-successor.v1.json');
export const SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER = '-- successor-pre-commit-expiry-guard';

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL_ID = /^[1-9][0-9]*$/;
const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const PURPOSE = 'review-media-current-state-eleven-stage';
const ADMISSION_MAX_AGE_MS = 15 * 60 * 1000;
const PREFLIGHT_TIMEOUT_MS = 30_000;
const PSQL_MAX_TIMEOUT_MS = ADMISSION_MAX_AGE_MS + 30_000;
const GIT_REMOTE_READ_TIMEOUT_MS = 15_000;
const PRIVATE_RECEIPT_FILES = Object.freeze({
  applyEvidenceMap: 'apply-operating-evidence-map.json',
  applyMachine: 'apply-machine-operating-observations.json',
  applyQuiescence: 'apply-quiescence-readback.json',
  attestation: 'operator-custody-attestation.json',
  bundle: 'vercel-operating-bundle.json',
  protectedMain: 'protected-main-receipt.json',
  rehearsal: 'rehearsal-receipt.json',
  rehearsalAdmission: 'rehearsal-admission.json',
  rehearsalJournal: 'rehearsal-journal.jsonl',
  rollback: 'rollback-readback-receipt.json',
  source: 'source-receipt.json',
});
const OPERATOR_CUSTODY_FENCES = Object.freeze([
  'browserRpc', 'dashboard', 'directSql', 'providerIngress',
]);
const PHASE_STABLE_FENCES = Object.freeze([
  'adminRecordMutationsHold', ...OPERATOR_CUSTODY_FENCES,
]);
const QUIESCENCE_RELATIONS = Object.freeze([
  'pipeline_control.admin_record_media_cleanup',
  'pipeline_control.admin_record_operations',
  'public.reviews',
  'storage.objects',
]);
const applyWriterFenceFile = fence => `apply-writer-fence-${fence}.json`;
const FIXED_CONTROLLER_CODES = new Set([
  'MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED',
  'MIGRATION_BUNDLE_READBACK_INVALID',
  'MIGRATION_BUNDLE_RECONCILIATION_CONFLICT',
  'MIGRATION_BUNDLE_RECONCILIATION_UNKNOWN',
  'MIGRATION_BUNDLE_TERMINAL_READBACK_FAILED',
  'SUCCESSOR_ADMISSION_EXPIRED',
  'SUCCESSOR_ADMISSION_INVALID',
  'SUCCESSOR_ARGUMENT_INVALID',
  'SUCCESSOR_CHECKOUT_INVALID',
  'SUCCESSOR_DATABASE_TARGET_INVALID',
  'SUCCESSOR_JOURNAL_APPEND_FAILED',
  'SUCCESSOR_JOURNAL_BINDING_MISMATCH',
  'SUCCESSOR_JOURNAL_EXISTS',
  'SUCCESSOR_JOURNAL_INVALID',
  'SUCCESSOR_LAUNCH_HELD',
  'SUCCESSOR_MANIFEST_INVALID',
  'SUCCESSOR_PREFLIGHT_MISMATCH',
  'SUCCESSOR_READBACK_INVALID',
  'SUCCESSOR_REHEARSAL_ARGUMENT_INVALID',
  'SUCCESSOR_REHEARSAL_BASELINE_INVALID',
  'SUCCESSOR_REHEARSAL_OUTCOME_UNCONFIRMED',
  'SUCCESSOR_REHEARSAL_OUTPUT_INVALID',
  'SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED',
  'SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED',
  'SUCCESSOR_REHEARSAL_RESTORE_CONFLICT',
  'SUCCESSOR_REHEARSAL_RESTORE_UNKNOWN',
  'SUCCESSOR_ROLLBACK_READBACK_INVALID',
  'SUCCESSOR_SOURCE_DRIFT',
]);
const FIXED_JOURNAL_OPERATION_CODES = new Set([
  ...FIXED_CONTROLLER_CODES,
  'SUCCESSOR_COMMITTED',
]);

const operationError = code => {
  const error = new Error(code);
  error.code = code;
  return error;
};
const fail = code => { throw operationError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function equal(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function safeCode(error, key = 'code') {
  try {
    const value = error?.[key];
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

function safeTrue(error, key) {
  try { return error?.[key] === true; } catch { return false; }
}

export function boundedSuccessorError(error) {
  const code = safeCode(error);
  if (FIXED_CONTROLLER_CODES.has(code)) {
    const bounded = operationError(code);
    if (code === 'SUCCESSOR_JOURNAL_APPEND_FAILED') {
      const operationCode = safeCode(error, 'operationCode');
      if (FIXED_JOURNAL_OPERATION_CODES.has(operationCode)) bounded.operationCode = operationCode;
    }
    return bounded;
  }
  return boundedMigrationError(error);
}

export function successorFailureResult(error) {
  const bounded = boundedSuccessorError(error);
  return {
    code: bounded.code,
    ...(bounded.operationCode ? { operationCode: bounded.operationCode } : {}),
    status: 'failed',
  };
}

function journalFailure(operationCode) {
  const error = operationError('SUCCESSOR_JOURNAL_APPEND_FAILED');
  if (FIXED_JOURNAL_OPERATION_CODES.has(operationCode)) error.operationCode = operationCode;
  return error;
}

function parseJsonObject(bytes, code) {
  let value;
  try { value = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes); } catch { fail(code); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function assertHex(value, code) {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) fail(code);
}

function sourceProjection(migration) {
  return {
    id: migration.id,
    version: migration.version,
    name: migration.name,
    path: migration.path,
    bytes: migration.bytes,
    sha256: migration.sha256,
    statementCount: migration.statementCount,
    statementVectorSha256: migration.statementVectorSha256,
    originalStatementVector: migration.originalStatementVector,
  };
}

function assertToolchain(manifest) {
  const expected = [
    'apps/web/scripts/review-media-sql-successor.mjs',
    'apps/web/scripts/review-media-sql-rehearsal.mjs',
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'apps/web/scripts/vercel-rollback-readback.mjs',
    'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
  ];
  if (!Array.isArray(manifest.toolchain) || manifest.toolchain.length !== expected.length) fail('SUCCESSOR_MANIFEST_INVALID');
  manifest.toolchain.forEach((entry, index) => {
    exactKeys(entry, ['path', 'sha256'], 'SUCCESSOR_MANIFEST_INVALID');
    if (entry.path !== expected[index]) fail('SUCCESSOR_MANIFEST_INVALID');
    assertHex(entry.sha256, 'SUCCESSOR_MANIFEST_INVALID');
    const bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path));
    if (sha256(bytes) !== entry.sha256) fail('SUCCESSOR_SOURCE_DRIFT');
  });
  exactKeys(manifest.legacyReleaseManifest, ['entries', 'path', 'sha256'], 'SUCCESSOR_MANIFEST_INVALID');
  if (manifest.legacyReleaseManifest.path !== '.github/supabase-migration-release-manifest.v1.json'
    || manifest.legacyReleaseManifest.entries !== 3) fail('SUCCESSOR_MANIFEST_INVALID');
  const legacyBytes = readFileSync(resolve(REPOSITORY_ROOT, manifest.legacyReleaseManifest.path));
  if (sha256(legacyBytes) !== manifest.legacyReleaseManifest.sha256) fail('SUCCESSOR_SOURCE_DRIFT');
  const legacy = parseJsonObject(legacyBytes, 'SUCCESSOR_SOURCE_DRIFT');
  if (!Array.isArray(legacy.migrations) || legacy.migrations.length !== 3) fail('SUCCESSOR_SOURCE_DRIFT');
}

export function loadSuccessorManifest({
  manifestPath = SUCCESSOR_MANIFEST_PATH,
  readVectorImpl = readOriginalStatementVector,
} = {}) {
  if (resolve(manifestPath) !== SUCCESSOR_MANIFEST_PATH) fail('SUCCESSOR_MANIFEST_INVALID');
  const bytes = readFileSync(manifestPath);
  const manifest = parseJsonObject(bytes, 'SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest, [
    'advisoryLockKey',
    'databaseName',
    'executorRole',
    'id',
    'launchPolicy',
    'legacyReleaseManifest',
    'migrations',
    'operatingTransition',
    'projectRef',
    'protectedSource',
    'purpose',
    'requiredWriterFences',
    'schemaVersion',
    'serverMajor',
    'sourceRoot',
    'stateRootAlgorithm',
    'terminalContract',
    'toolchain',
  ], 'SUCCESSOR_MANIFEST_INVALID');
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'review_media_sql_successor_v1'
    || manifest.purpose !== PURPOSE
    || manifest.projectRef !== PROJECT_REF
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.serverMajor !== 17
    || manifest.advisoryLockKey !== '7311754282260211'
    || manifest.stateRootAlgorithm !== 'review-media-successor-state/v1'
    || !Array.isArray(manifest.migrations)
    || manifest.migrations.length !== 11) fail('SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.operatingTransition, ['afterEleven', 'beforeEleven'], 'SUCCESSOR_MANIFEST_INVALID');
  if (!equal(manifest.operatingTransition, { beforeEleven: 86, afterEleven: 97 })) {
    fail('SUCCESSOR_MANIFEST_INVALID');
  }
  exactKeys(manifest.protectedSource, ['ref', 'remote', 'repositoryUrl'], 'SUCCESSOR_MANIFEST_INVALID');
  if (manifest.protectedSource.remote !== 'origin'
    || manifest.protectedSource.ref !== 'refs/heads/main'
    || manifest.protectedSource.repositoryUrl !== 'https://github.com/twoimo/tzudong.git') {
    fail('SUCCESSOR_MANIFEST_INVALID');
  }
  assertHex(manifest.sourceRoot, 'SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state'], 'SUCCESSOR_MANIFEST_INVALID');
  if (!['held', 'ready'].includes(manifest.launchPolicy.state)
    || manifest.launchPolicy.code !== 'SUCCESSOR_LAUNCH_HELD'
    || manifest.launchPolicy.reason !== 'protected-release-and-fresh-admission-required') {
    fail('SUCCESSOR_MANIFEST_INVALID');
  }
  exactKeys(manifest.requiredWriterFences, [
    'adminRecordMutationsHold',
    'automaticReviewer',
    'browserRpc',
    'dashboard',
    'directSql',
    'g037WriteFreeze',
    'providerIngress',
  ], 'SUCCESSOR_MANIFEST_INVALID');
  if (!equal(manifest.requiredWriterFences, {
    adminRecordMutationsHold: 'active',
    automaticReviewer: 'stopped',
    browserRpc: 'stopped',
    dashboard: 'stopped',
    directSql: 'stopped',
    g037WriteFreeze: 'active',
    providerIngress: 'stopped',
  })) fail('SUCCESSOR_MANIFEST_INVALID');
  exactKeys(manifest.terminalContract, [
    'finishPostimageSha256',
    'finishPreimageSha256',
    'requiredFunctionBodySha256',
    'requiredFunctions',
    'requiredPolicies',
  ], 'SUCCESSOR_MANIFEST_INVALID');
  const terminalContract = {
    finishPreimageSha256: 'f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',
    finishPostimageSha256: 'a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9',
    requiredFunctionBodySha256: {
      'public.admin_review_verification_cleanup(uuid,text,text[])': '468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b',
      'public.finish_review_media_cleanup()': 'a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9',
      'public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])': 'd5d6646a4294c0e7bd0cd75ea47a996c9c57bac6c32a39ac53fbb7a8b1e7e323',
      'review_media_private.enqueue_removed()': 'cbf6a87e453e8c2e14d67acd73a92e399fbba4b4f24ac27966806e13ef1fd905',
      'review_media_private.guard_references()': '94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1',
    },
    requiredFunctions: [
      'public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])',
      'public.queue_review_upload_cleanup(uuid,text[])',
      'public.read_review_media_commit(uuid,uuid,text)',
      'public.pending_review_media_cleanup()',
      'public.finish_review_media_cleanup()',
      'public.review_media_delete_allowed(text)',
      'public.review_media_upload_allowed(text,text)',
      'public.admin_review_verification_cleanup(uuid,text,text[])',
    ],
    requiredPolicies: [
      'review_media_safe_delete',
      'review_media_safe_insert',
      'review_media_safe_update',
      'review_verifications_owner_read',
      'review_verifications_owner_insert',
      'review_verifications_owner_delete',
      'review_verifications_safe_delete',
      'review_photos_food_insert',
      'review_photos_food_update',
    ],
  };
  if (!equal(manifest.terminalContract, terminalContract)) fail('SUCCESSOR_MANIFEST_INVALID');
  assertToolchain(manifest);

  const expectedIds = [
    'review_media_commit_cleanup',
    'review_verification_private',
    'review_media_catalog_integration',
    'admin_review_media_completion',
    'review_legacy_shared_cleanup',
    'admin_evaluation_revision_safeupdate',
    'admin_record_expired_preview_readback',
    'admin_verification_durable_staging',
    'review_media_storage_retirement_fence',
    'review_storage_caller_bound_admin_policy',
    'review_owner_cleanup_completion',
  ];
  const materials = manifest.migrations.map((migration, index) => {
    exactKeys(migration, [
      'bytes',
      'id',
      'name',
      'originalStatementVector',
      'path',
      'sha256',
      'statementCount',
      'statementVectorSha256',
      'version',
    ], 'SUCCESSOR_MANIFEST_INVALID');
    const pathMatch = /^backend\/supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(migration.path);
    if (migration.id !== expectedIds[index]
      || !pathMatch
      || migration.version !== pathMatch[1]
      || migration.name !== pathMatch[2]
      || migration.id !== migration.name
      || !Number.isSafeInteger(migration.bytes)
      || migration.bytes <= 0
      || !Number.isSafeInteger(migration.statementCount)
      || migration.statementCount <= 0
      || !Array.isArray(migration.originalStatementVector)
      || migration.originalStatementVector.length !== migration.statementCount) fail('SUCCESSOR_MANIFEST_INVALID');
    assertHex(migration.sha256, 'SUCCESSOR_MANIFEST_INVALID');
    assertHex(migration.statementVectorSha256, 'SUCCESSOR_MANIFEST_INVALID');
    if (sha256(JSON.stringify(migration.originalStatementVector)) !== migration.statementVectorSha256) {
      fail('SUCCESSOR_MANIFEST_INVALID');
    }
    const sourceBytes = readFileSync(resolve(REPOSITORY_ROOT, migration.path));
    if (sourceBytes.length !== migration.bytes || sha256(sourceBytes) !== migration.sha256) fail('SUCCESSOR_SOURCE_DRIFT');
    const observedVector = readVectorImpl(migration, sourceBytes);
    if (!equal(observedVector, migration.originalStatementVector)) fail('SUCCESSOR_SOURCE_DRIFT');
    return { path: migration.path, bytes: sourceBytes, originalVector: observedVector };
  });
  if (sha256(JSON.stringify(manifest.migrations.map(sourceProjection))) !== manifest.sourceRoot) {
    fail('SUCCESSOR_MANIFEST_INVALID');
  }
  return Object.freeze({
    bytes,
    manifest,
    manifestSha256: sha256(bytes),
    materials: Object.freeze(materials),
  });
}

function sortedAclSql(expression) {
  return `ARRAY(SELECT value::text FROM unnest(coalesce(${expression},'{}')) value ORDER BY value::text)`;
}

export function buildSuccessorStateQuery(manifest, suffixRoot = elevenMigrationBundleSuffixRoot(manifest.migrations)) {
  const versions = manifest.migrations.map(migration => migration.version);
  const targetCount = manifest.migrations.length;
  const targetValues = versions.map(version => `(${quote(version)})`).join(',');
  const targets = versions.map(version => quote(version)).join(',');
  const exactRows = manifest.migrations.map(migration => `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(migration.originalStatementVector))}::jsonb)))`).join(' AND ');
  const schemas = "'public','pipeline_control','privacy_retention','review_media_private','storage'";
  const acl = expression => sortedAclSql(expression);
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
   'relations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,${acl('c.reloptions')} AS reloptions,CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,true) ELSE '' END AS view_definition,${acl('c.relacl')} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'columns',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.attnum) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull,a.attidentity,a.attgenerated,coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_expression,${acl('a.attacl')} AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN(${schemas}) AND a.attnum>0 AND NOT a.attisdropped) x),'[]'::jsonb),
   'constraints',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.constraint_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,k.conname AS constraint_name,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'indexes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.index_name) FROM (SELECT n.nspname AS schema_name,c.relname AS index_name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'triggers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.trigger_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,t.tgname AS trigger_name,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas}) AND NOT t.tgisinternal) x),'[]'::jsonb),
   'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.policy_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,p.polname AS policy_name,p.polcmd,p.polpermissive,ARRAY(SELECT coalesce(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY coalesce(r.rolname,'PUBLIC')) AS roles,coalesce(pg_get_expr(p.polqual,p.polrelid),'') AS using_expression,coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'functions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signature) FROM (SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,format_type(p.prorettype,NULL) AS result_type,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,coalesce(p.proconfig,'{}'::text[]) AS config,${acl('p.proacl')} AS acl,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'roles',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name) FROM (SELECT r.rolname AS role_name,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls FROM pg_roles r) x),'[]'::jsonb),
   'memberships',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name,x.member_name,x.grantor_name) FROM (SELECT role.rolname AS role_name,member.rolname AS member_name,grantor.rolname AS grantor_name,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member JOIN pg_roles grantor ON grantor.oid=m.grantor) x),'[]'::jsonb),
   'defaultAcls',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.owner,x.schema_name,x.object_type) FROM (SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'') AS schema_name,d.defaclobjtype AS object_type,${acl('d.defaclacl')} AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) x),'[]'::jsonb)
  )::text AS material
 ),
 g014_material AS (
  SELECT jsonb_build_object(
   'manifest',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m),'[]'::jsonb),
   'allowlist',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY function_schema,function_name,identity_arguments,grantee) FROM privacy_retention.g014_public_rpc_allowlist a),'[]'::jsonb)
  )::text AS material
 ),
 storage_material AS (
  SELECT jsonb_build_object(
   'buckets',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM (
     SELECT id,name,owner,public,avif_autodetection,file_size_limit,allowed_mime_types,owner_id,type,
       versioning_status,lifecycle_configuration,lifecycle_configuration_generation
     FROM storage.buckets WHERE id IN('review-photos','review-verifications')) b),'[]'::jsonb),
   'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.policy_name) FROM (SELECT p.polname AS policy_name,p.polcmd,p.polpermissive,ARRAY(SELECT coalesce(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY coalesce(r.rolname,'PUBLIC')) AS roles,coalesce(pg_get_expr(p.polqual,p.polrelid),'') AS using_expression,coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') AS check_expression FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass) x),'[]'::jsonb)
  )::text AS material
 ),
 contract AS (
  SELECT
   (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=to_regprocedure('public.finish_review_media_cleanup()')) AS finish_hash,
   EXISTS(SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls)
    AND EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='privacy_workflow_owner'::regrole AND m.member='postgres'::regrole AND m.admin_option AND m.grantor<>'postgres'::regrole)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='privacy_workflow_owner'::regrole AND m.member='postgres'::regrole AND m.admin_option AND m.grantor='postgres'::regrole) AS owner_authority_ready,
   to_regclass('review_media_private.commits') IS NOT NULL
    AND to_regclass('review_media_private.cleanup') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
      'public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])',
      'public.queue_review_upload_cleanup(uuid,text[])','public.read_review_media_commit(uuid,uuid,text)',
      'public.pending_review_media_cleanup()','public.finish_review_media_cleanup()',
      'public.review_media_delete_allowed(text)','public.review_media_upload_allowed(text,text)',
      'public.admin_review_verification_cleanup(uuid,text,text[])']) signature WHERE to_regprocedure(signature) IS NULL)
    AND (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])'))='d5d6646a4294c0e7bd0cd75ea47a996c9c57bac6c32a39ac53fbb7a8b1e7e323'
    AND (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('review_media_private.enqueue_removed()'))='cbf6a87e453e8c2e14d67acd73a92e399fbba4b4f24ac27966806e13ef1fd905'
    AND (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('review_media_private.guard_references()'))='94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1'
    AND (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.admin_review_verification_cleanup(uuid,text,text[])'))='468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b'
    AND (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.finish_review_media_cleanup()'))='a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9'
    AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
      'public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])',
      'public.queue_review_upload_cleanup(uuid,text[])','public.read_review_media_commit(uuid,uuid,text)',
      'public.pending_review_media_cleanup()','public.finish_review_media_cleanup()',
      'public.review_media_delete_allowed(text)','public.review_media_upload_allowed(text,text)']) signature
      WHERE NOT coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)
       OR coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false)
       OR coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false))
    AND coalesce(has_function_privilege('service_role',to_regprocedure('public.admin_review_verification_cleanup(uuid,text,text[])'),'EXECUTE'),false)
    AND NOT coalesce(has_function_privilege('anon',to_regprocedure('public.admin_review_verification_cleanup(uuid,text,text[])'),'EXECUTE'),false)
    AND NOT coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_review_verification_cleanup(uuid,text,text[])'),'EXECUTE'),false)
    AND NOT coalesce(has_function_privilege('anon',to_regprocedure('public.is_user_admin(uuid)'),'EXECUTE'),false)
    AND NOT coalesce(has_function_privilege('authenticated',to_regprocedure('public.is_user_admin(uuid)'),'EXECUTE'),false)
    AND NOT coalesce(has_function_privilege('service_role',to_regprocedure('public.is_user_admin(uuid)'),'EXECUTE'),false)
    AND (SELECT count(*)=9 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname=ANY(ARRAY[
      'review_media_safe_delete','review_media_safe_insert','review_media_safe_update',
      'review_verifications_owner_read','review_verifications_owner_insert','review_verifications_owner_delete',
      'review_verifications_safe_delete','review_photos_food_insert','review_photos_food_update']))
    AND EXISTS(SELECT 1 FROM storage.buckets WHERE id='review-verifications' AND NOT public) AS terminal_ready
 )
 SELECT json_build_object(
  'bundle',json_build_object(
   'ledgerCount',ledger_all.row_count,
   'priorCount',ledger_prefix.row_count,
   'prefixRoot',encode(sha256(convert_to(ledger_prefix.material,'UTF8')),'hex'),
   'targetCount',target_state.target_count,
   'suffixRoot',CASE WHEN target_state.target_count=${targetCount} AND ${exactRows} THEN ${quote(suffixRoot)} ELSE NULL END
  ),
  'state',json_build_object(
   'activeReviewItems',(SELECT count(*)::int FROM pipeline_control.restaurant_review_items WHERE state IN('queued','running')),
   'currentUser',current_user,
   'databaseName',current_database(),
   'finishCleanupBodySha256',contract.finish_hash,
   'g014Root',encode(sha256(convert_to(g014_material.material,'UTF8')),'hex'),
   'ledgerRoot',encode(sha256(convert_to(ledger_all.material,'UTF8')),'hex'),
   'ownerAuthorityReady',contract.owner_authority_ready,
   'reviewItems',(SELECT count(*)::int FROM pipeline_control.restaurant_review_items),
   'reviewPolicyEnabled',coalesce((SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton),true),
   'reviewRuns',(SELECT count(*)::int FROM pipeline_control.restaurant_review_runs),
   'schemaRoot',encode(sha256(convert_to(catalog_material.material,'UTF8')),'hex'),
   'serverMajor',(current_setting('server_version_num')::int/10000),
   'sessionUser',session_user,
   'storageRoot',encode(sha256(convert_to(storage_material.material,'UTF8')),'hex'),
   'terminalContractReady',contract.terminal_ready
  )
 )::text AS state
 FROM ledger_prefix,ledger_all,target_state,catalog_material,g014_material,storage_material,contract) AS successor_state`;
}

function validateStageState(stage, index, manifest, suffixRoot, priorCount, prefixRoot) {
  exactKeys(stage, ['bundle', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(stage.bundle, ['ledgerCount', 'prefixRoot', 'priorCount', 'suffixRoot', 'targetCount'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(stage.state, [
    'activeReviewItems',
    'currentUser',
    'databaseName',
    'finishCleanupBodySha256',
    'g014Root',
    'ledgerRoot',
    'ownerAuthorityReady',
    'reviewItems',
    'reviewPolicyEnabled',
    'reviewRuns',
    'schemaRoot',
    'serverMajor',
    'sessionUser',
    'storageRoot',
    'terminalContractReady',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (stage.bundle.ledgerCount !== priorCount + index
    || stage.bundle.priorCount !== priorCount
    || stage.bundle.prefixRoot !== prefixRoot
    || stage.bundle.targetCount !== index
    || stage.bundle.suffixRoot !== (index === manifest.migrations.length ? suffixRoot : null)
    || stage.state.activeReviewItems !== 0
    || stage.state.currentUser !== manifest.executorRole
    || stage.state.databaseName !== manifest.databaseName
    || stage.state.ownerAuthorityReady !== true
    || stage.state.reviewItems !== 0
    || stage.state.reviewPolicyEnabled !== false
    || stage.state.reviewRuns !== 0
    || stage.state.serverMajor !== manifest.serverMajor
    || stage.state.sessionUser !== manifest.executorRole
    || stage.state.terminalContractReady !== (index === manifest.migrations.length)) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  assertHex(stage.state.ledgerRoot, 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(stage.state.schemaRoot, 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(stage.state.g014Root, 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(stage.state.storageRoot, 'SUCCESSOR_ADMISSION_INVALID');
  if (stage.state.finishCleanupBodySha256 !== null) {
    assertHex(stage.state.finishCleanupBodySha256, 'SUCCESSOR_ADMISSION_INVALID');
  }
  if (index === manifest.migrations.length - 1
    && stage.state.finishCleanupBodySha256 !== manifest.terminalContract.finishPreimageSha256) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  if (index === manifest.migrations.length
    && stage.state.finishCleanupBodySha256 !== manifest.terminalContract.finishPostimageSha256) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  if (index === 0 && stage.state.ledgerRoot !== prefixRoot) fail('SUCCESSOR_ADMISSION_INVALID');
}

function canonicalReceiptBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`);
}

function readPrivateCanonicalReceipt(directory, fileName, expectedSha256) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || typeof fileName !== 'string') {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  let bytes;
  let receiptPath;
  let receiptDirectory;
  try {
    const directoryStatus = lstatSync(directory);
    if (!directoryStatus.isDirectory()
      || directoryStatus.isSymbolicLink()
      || (process.platform !== 'win32' && (directoryStatus.mode & 0o077) !== 0)) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
    receiptDirectory = realpathSync(directory);
    receiptPath = assertPrivateAdmissionPath(join(directory, fileName));
    bytes = readFileSync(receiptPath);
  } catch {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  if (dirname(realpathSync(receiptPath)) !== receiptDirectory) fail('SUCCESSOR_ADMISSION_INVALID');
  if (sha256(bytes) !== expectedSha256) fail('SUCCESSOR_ADMISSION_INVALID');
  const receipt = parseJsonObject(bytes, 'SUCCESSOR_ADMISSION_INVALID');
  if (!bytes.equals(canonicalReceiptBytes(receipt))) fail('SUCCESSOR_ADMISSION_INVALID');
  return receipt;
}

function readPrivateCanonicalJournal(directory, fileName, expectedSha256) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || typeof fileName !== 'string') {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  let bytes;
  let journalPath;
  let receiptDirectory;
  try {
    const directoryStatus = lstatSync(directory);
    if (!directoryStatus.isDirectory()
      || directoryStatus.isSymbolicLink()
      || (process.platform !== 'win32' && (directoryStatus.mode & 0o077) !== 0)) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
    receiptDirectory = realpathSync(directory);
    journalPath = assertPrivateAdmissionPath(join(directory, fileName));
    bytes = readFileSync(journalPath);
  } catch {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  if (dirname(realpathSync(journalPath)) !== receiptDirectory
    || sha256(bytes) !== expectedSha256) fail('SUCCESSOR_ADMISSION_INVALID');
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) fail('SUCCESSOR_ADMISSION_INVALID');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== 3 || lines.some(line => !line)) fail('SUCCESSOR_ADMISSION_INVALID');
  return Object.freeze(lines.map(line => {
    const entry = parseJsonObject(line, 'SUCCESSOR_ADMISSION_INVALID');
    if (`${JSON.stringify(canonical(entry))}\n` !== `${line}\n`) fail('SUCCESSOR_ADMISSION_INVALID');
    return entry;
  }));
}

function assertReceiptWindow(receipt, admission, createdAt, expiresAt, nowMs) {
  if (receipt.expiresAt !== admission.expiresAt) fail('SUCCESSOR_ADMISSION_INVALID');
  const observedAt = Date.parse(receipt.observedAt);
  if (!Number.isFinite(observedAt)
    || observedAt < createdAt
    || observedAt >= expiresAt
    || observedAt > nowMs + 30_000
    || Date.parse(receipt.expiresAt) !== expiresAt) fail('SUCCESSOR_ADMISSION_INVALID');
}

function assertPriorReceiptWindow(receipt, expiresAt, nowMs) {
  const observedAt = Date.parse(receipt.observedAt);
  const receiptExpiresAt = Date.parse(receipt.expiresAt);
  const receiptLeaseStartedAt = receiptExpiresAt - ADMISSION_MAX_AGE_MS;
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(receiptExpiresAt)
    || receiptExpiresAt <= observedAt
    || receiptExpiresAt - observedAt > ADMISSION_MAX_AGE_MS
    || observedAt < receiptLeaseStartedAt
    || observedAt > nowMs + 30_000
    || receiptExpiresAt < expiresAt
    || nowMs >= receiptExpiresAt) fail('SUCCESSOR_ADMISSION_INVALID');
}

function validateApplyOperatingEvidence(admission, manifestRecord, {
  createdAt,
  expiresAt,
  minimumObservedAt,
  nowMs,
  receiptDirectory,
}) {
  const { manifest, manifestSha256 } = manifestRecord;
  const map = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.applyEvidenceMap,
    admission.applyEvidenceMapSha256,
  );
  exactKeys(map, [
    'attestationSha256', 'bundleSha256', 'kind', 'machineSha256', 'quiescenceSha256',
    'receiptProvenance', 'schemaVersion', 'sourceRevision',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (map.schemaVersion !== 1
    || map.kind !== 'review-media-successor-apply-operating-evidence-map'
    || map.sourceRevision !== admission.sourceRevision
    || map.quiescenceSha256 !== admission.applyQuiescenceReadbackSha256) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const attestation = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.attestation,
    map.attestationSha256,
  );
  exactKeys(attestation, [
    'assertedAt', 'authority', 'basis', 'event', 'fences', 'kind', 'noticeState',
    'operatorRole', 'repository', 'runAttempt', 'runId', 'schemaVersion', 'scope',
    'sourceRevision', 'workflowRef',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(attestation.fences, OPERATOR_CUSTODY_FENCES, 'SUCCESSOR_ADMISSION_INVALID');
  if (attestation.schemaVersion !== 1
    || attestation.kind !== 'review-media-successor-operator-custody-attestation'
    || attestation.authority !== 'authenticated-repository-owner-workflow-dispatch'
    || attestation.basis !== 'standing-custody-confirmation-bound-by-owner-dispatch'
    || attestation.event !== 'workflow_dispatch'
    || attestation.noticeState !== 'not-issued'
    || attestation.operatorRole !== 'repository-owner'
    || attestation.repository !== TZUDONG_GITHUB_REPOSITORY
    || !DECIMAL_ID.test(attestation.runAttempt ?? '')
    || !DECIMAL_ID.test(attestation.runId ?? '')
    || attestation.scope !== 'stopped-until-application-result'
    || attestation.sourceRevision !== admission.sourceRevision
    || typeof attestation.workflowRef !== 'string'
    || !attestation.workflowRef.startsWith(`${TZUDONG_GITHUB_REPOSITORY}/.github/workflows/`)
    || !attestation.workflowRef.endsWith('@refs/heads/main')
    || Object.values(attestation.fences).some(state => state !== 'stopped')) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const bundle = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.bundle,
    map.bundleSha256,
  );
  exactKeys(bundle, [
    'adminRecordMutationsHold', 'createdAt', 'expiresAt', 'kind', 'manifestSha256',
    'protectedMain', 'rollbackPolicy', 'rollbackReadback', 'schemaVersion',
    'sourceRevision', 'sourceRoot', 'storyboardPolicy',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(bundle.storyboardPolicy, [
    'deployment', 'policy', 'schemaVersion',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(bundle.storyboardPolicy.deployment, [
    'branch', 'deploymentId', 'sourceCommit',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(bundle.storyboardPolicy.policy, [
    'canonicalPolicySha256',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (bundle.schemaVersion !== 1
    || bundle.kind !== 'review-media-successor-vercel-operating-bundle'
    || bundle.manifestSha256 !== manifestSha256
    || bundle.sourceRevision !== admission.sourceRevision
    || bundle.sourceRoot !== manifest.sourceRoot
    || bundle.createdAt !== admission.createdAt
    || bundle.expiresAt !== admission.expiresAt
    || bundle.adminRecordMutationsHold?.holdActive !== true
    || bundle.adminRecordMutationsHold?.deploymentId !== admission.rollback.deploymentId
    || bundle.adminRecordMutationsHold?.commit !== admission.sourceRevision
    || bundle.rollbackReadback?.deploymentId !== admission.rollback.deploymentId
    || bundle.rollbackReadback?.gitSha !== admission.rollback.deploymentSha
    || bundle.storyboardPolicy.schemaVersion !== 1
    || bundle.storyboardPolicy.deployment.branch !== 'main'
    || bundle.storyboardPolicy.deployment.deploymentId !== admission.rollback.deploymentId
    || bundle.storyboardPolicy.deployment.sourceCommit !== admission.sourceRevision
    || !HEX_SHA256.test(bundle.storyboardPolicy.policy.canonicalPolicySha256 ?? '')) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const machine = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.applyMachine,
    map.machineSha256,
  );
  exactKeys(machine, [
    'adminRuntimeHold', 'automaticReviewer', 'g037WriteFreeze', 'inFlightQuiescence',
    'kind', 'schemaVersion', 'sourceRevision',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(machine.adminRuntimeHold, ['deploymentId', 'holdActive', 'observedAt'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(machine.automaticReviewer, ['observedAt', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(machine.g037WriteFreeze, ['observedAt', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(machine.inFlightQuiescence, [
    'coverage', 'inFlightWriters', 'lockMode', 'observedAt',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (machine.schemaVersion !== 1
    || machine.kind !== 'review-media-successor-machine-operating-observations'
    || machine.sourceRevision !== admission.sourceRevision
    || machine.adminRuntimeHold.holdActive !== true
    || machine.adminRuntimeHold.deploymentId !== admission.rollback.deploymentId
    || machine.adminRuntimeHold.observedAt !== bundle.adminRecordMutationsHold.observedAt
    || machine.automaticReviewer.state !== 'stopped'
    || machine.g037WriteFreeze.state !== 'active'
    || !equal(machine.inFlightQuiescence.coverage, QUIESCENCE_RELATIONS)
    || machine.inFlightQuiescence.inFlightWriters !== 0
    || machine.inFlightQuiescence.lockMode !== 'SHARE') {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const quiescence = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.applyQuiescence,
    admission.applyQuiescenceReadbackSha256,
  );
  exactKeys(quiescence, [
    'coverage', 'expiresAt', 'id', 'inFlightWriters', 'kind', 'lockMode',
    'manifestSha256', 'observedAt', 'projectRef', 'purpose', 'schemaVersion',
    'sourceRevision',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (quiescence.schemaVersion !== 1
    || quiescence.kind !== 'apply-in-flight-quiescence-readback'
    || quiescence.id !== manifest.id
    || quiescence.projectRef !== manifest.projectRef
    || quiescence.purpose !== manifest.purpose
    || quiescence.manifestSha256 !== manifestSha256
    || quiescence.sourceRevision !== admission.sourceRevision
    || !equal(quiescence.coverage, QUIESCENCE_RELATIONS)
    || quiescence.inFlightWriters !== 0
    || quiescence.lockMode !== 'SHARE'
    || !equal(quiescence.coverage, machine.inFlightQuiescence.coverage)
    || quiescence.inFlightWriters !== machine.inFlightQuiescence.inFlightWriters
    || quiescence.lockMode !== machine.inFlightQuiescence.lockMode
    || quiescence.observedAt !== machine.inFlightQuiescence.observedAt) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  assertReceiptWindow(quiescence, admission, createdAt, expiresAt, nowMs);

  const freshTimes = [
    machine.automaticReviewer.observedAt,
    machine.g037WriteFreeze.observedAt,
    machine.inFlightQuiescence.observedAt,
  ].map(value => Date.parse(value));
  if (freshTimes.some(value => !Number.isFinite(value)
    || value < minimumObservedAt
    || value >= expiresAt
    || value > nowMs + 30_000)) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(map.receiptProvenance, fenceKeys, 'SUCCESSOR_ADMISSION_INVALID');
  for (const key of fenceKeys) {
    const fence = readPrivateCanonicalReceipt(
      receiptDirectory,
      applyWriterFenceFile(key),
      admission.writerFences[key].evidenceSha256,
    );
    exactKeys(fence, [
      'expiresAt', 'fence', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef',
      'purpose', 'schemaVersion', 'sourceRevision', 'state',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    exactKeys(map.receiptProvenance[key], [
      'evidenceSha256', 'provenance', 'receiptSha256',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    const operator = OPERATOR_CUSTODY_FENCES.includes(key);
    const expectedProvenance = operator
      ? 'authenticated-owner-custody-commitment'
      : key === 'adminRecordMutationsHold'
        ? 'immutable-deployment-machine-observation'
        : 'fresh-machine-observation';
    const expectedEvidenceSha256 = operator
      ? map.attestationSha256
      : key === 'adminRecordMutationsHold'
        ? map.bundleSha256
        : map.machineSha256;
    const expectedObservedAt = operator
      ? attestation.assertedAt
      : key === 'adminRecordMutationsHold'
        ? bundle.adminRecordMutationsHold.observedAt
        : key === 'automaticReviewer'
          ? machine.automaticReviewer.observedAt
          : machine.g037WriteFreeze.observedAt;
    if (fence.schemaVersion !== 1
      || fence.id !== manifest.id
      || fence.projectRef !== manifest.projectRef
      || fence.purpose !== manifest.purpose
      || fence.manifestSha256 !== manifestSha256
      || fence.sourceRevision !== admission.sourceRevision
      || fence.kind !== 'writer-fence-readback-receipt'
      || fence.fence !== key
      || fence.state !== manifest.requiredWriterFences[key]
      || fence.observedAt !== expectedObservedAt
      || map.receiptProvenance[key].provenance !== expectedProvenance
      || map.receiptProvenance[key].evidenceSha256 !== expectedEvidenceSha256
      || map.receiptProvenance[key].receiptSha256 !== admission.writerFences[key].evidenceSha256) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
    assertReceiptWindow(fence, admission, createdAt, expiresAt, nowMs);
    if (['automaticReviewer', 'g037WriteFreeze'].includes(key)
      && Date.parse(fence.observedAt) < minimumObservedAt) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
  }
}

function validatePrivateReceipts(admission, manifestRecord, {
  createdAt,
  expiresAt,
  includeRehearsal = true,
  nowMs,
  receiptDirectory,
}) {
  const { manifest, manifestSha256 } = manifestRecord;
  let rehearsalPublishedAt;
  const common = receipt => receipt.schemaVersion === 1
    && receipt.id === manifest.id
    && receipt.projectRef === manifest.projectRef
    && receipt.purpose === manifest.purpose
    && receipt.manifestSha256 === manifestSha256
    && receipt.sourceRevision === admission.sourceRevision;

  const source = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.source,
    admission.sourceReceiptSha256,
  );
  exactKeys(source, [
    'expiresAt', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef', 'purpose',
    'schemaVersion', 'sourceRevision', 'sourceRoot',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!common(source)
    || source.kind !== 'successor-source-receipt'
    || source.sourceRoot !== manifest.sourceRoot) fail('SUCCESSOR_ADMISSION_INVALID');
  assertReceiptWindow(source, admission, createdAt, expiresAt, nowMs);

  const protectedMain = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.protectedMain,
    admission.protectedMainReceiptSha256,
  );
  exactKeys(protectedMain, [
    'expiresAt', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef', 'purpose',
    'ref', 'remote', 'repositoryUrl', 'revision', 'schemaVersion', 'sourceRevision',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!common(protectedMain)
    || protectedMain.kind !== 'protected-main-readback-receipt'
    || protectedMain.remote !== manifest.protectedSource.remote
    || protectedMain.ref !== manifest.protectedSource.ref
    || protectedMain.repositoryUrl !== manifest.protectedSource.repositoryUrl
    || protectedMain.revision !== admission.sourceRevision) fail('SUCCESSOR_ADMISSION_INVALID');
  assertReceiptWindow(protectedMain, admission, createdAt, expiresAt, nowMs);

  if (includeRehearsal) {
    const rehearsalAdmission = readPrivateCanonicalReceipt(
      receiptDirectory,
      PRIVATE_RECEIPT_FILES.rehearsalAdmission,
      admission.rehearsalAdmissionSha256,
    );
    const rehearsalWindow = validateSuccessorRehearsalAdmission(rehearsalAdmission, manifestRecord, {
      now: new Date(nowMs),
      receiptDirectory,
    });
    if (rehearsalWindow.createdAt > createdAt
      || rehearsalWindow.expiresAt < expiresAt
      || rehearsalAdmission.sourceReceiptSha256 !== admission.sourceReceiptSha256
      || rehearsalAdmission.protectedMainReceiptSha256 !== admission.protectedMainReceiptSha256
      || !equal(rehearsalAdmission.rollback, admission.rollback)
      || Object.keys(manifest.requiredWriterFences).some(key => (
        rehearsalAdmission.writerFences[key].state !== admission.writerFences[key].state
      ))
      || PHASE_STABLE_FENCES.some(key => (
        rehearsalAdmission.writerFences[key].evidenceSha256
          !== admission.writerFences[key].evidenceSha256
      ))
      || rehearsalAdmission.journalPathSha256 !== sha256(Buffer.from(resolve(
        receiptDirectory, PRIVATE_RECEIPT_FILES.rehearsalJournal,
      )))
      || rehearsalAdmission.receiptPathSha256 !== sha256(Buffer.from(resolve(
        receiptDirectory, PRIVATE_RECEIPT_FILES.rehearsal,
      )))) fail('SUCCESSOR_ADMISSION_INVALID');
    const rehearsal = readPrivateCanonicalReceipt(
      receiptDirectory,
      PRIVATE_RECEIPT_FILES.rehearsal,
      admission.rehearsalReceiptSha256,
    );
    exactKeys(rehearsal, [
      'admissionSha256', 'attemptId', 'expiresAt', 'id', 'journalPathSha256', 'kind',
      'manifestSha256', 'observedAt', 'passed',
      'preflightStateSha256', 'projectRef', 'purpose', 'restoredStateSha256',
      'schemaVersion', 'serverVersionNum', 'sourceRevision', 'sourceRoot', 'stageStates',
      'stageStatesSha256', 'suffixRoot',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    const stageStatesSha256 = sha256(JSON.stringify(canonical(admission.stageStates)));
    const priorStateSha256 = sha256(JSON.stringify(canonical(admission.stageStates[0])));
    if (!common(rehearsal)
      || rehearsal.kind !== 'successor-rehearsal-receipt'
      || rehearsal.passed !== true
      || rehearsal.attemptId !== rehearsalAdmission.attemptId
      || rehearsal.admissionSha256 !== admission.rehearsalAdmissionSha256
      || rehearsal.expiresAt !== rehearsalAdmission.expiresAt
      || rehearsal.journalPathSha256 !== sha256(Buffer.from(resolve(
        receiptDirectory,
        PRIVATE_RECEIPT_FILES.rehearsalJournal,
      )))
      || !Number.isSafeInteger(rehearsal.serverVersionNum)
      || Math.floor(rehearsal.serverVersionNum / 10_000) !== manifest.serverMajor
      || rehearsal.sourceRoot !== manifest.sourceRoot
      || rehearsal.suffixRoot !== elevenMigrationBundleSuffixRoot(manifest.migrations)
      || rehearsal.stageStatesSha256 !== stageStatesSha256
      || rehearsal.preflightStateSha256 !== priorStateSha256
      || rehearsal.restoredStateSha256 !== priorStateSha256
      || !equal(rehearsal.stageStates, admission.stageStates)) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
    assertPriorReceiptWindow(rehearsal, expiresAt, nowMs);

    const journal = readPrivateCanonicalJournal(
      receiptDirectory,
      PRIVATE_RECEIPT_FILES.rehearsalJournal,
      admission.rehearsalJournalSha256,
    );
    const [started, verification, publication] = journal;
    exactKeys(started, [
      'admissionSha256', 'attemptId', 'event', 'manifestSha256', 'sourceRevision',
      'sourceRoot', 'startedAt',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    exactKeys(verification, [
      'admissionSha256', 'attemptId', 'code', 'event', 'manifestSha256',
      'receiptSha256', 'sourceRevision', 'sourceRoot', 'verifiedAt',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    exactKeys(publication, [
      'admissionSha256', 'attemptId', 'code', 'event', 'manifestSha256',
      'publishedAt', 'receiptSha256', 'sourceRevision', 'sourceRoot',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    const startedAt = Date.parse(started.startedAt);
    const verifiedAt = Date.parse(verification.verifiedAt);
    const publishedAt = Date.parse(publication.publishedAt);
    rehearsalPublishedAt = publishedAt;
    const observedAt = Date.parse(rehearsal.observedAt);
    const rehearsalLeaseStartedAt = rehearsalWindow.createdAt;
    if (started.event !== 'started'
      || verification.event !== 'verification'
      || verification.code !== 'SUCCESSOR_REHEARSAL_VERIFIED'
      || publication.event !== 'publication'
      || publication.code !== 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED'
      || started.attemptId !== rehearsal.attemptId
      || verification.attemptId !== rehearsal.attemptId
      || publication.attemptId !== rehearsal.attemptId
      || started.admissionSha256 !== rehearsal.admissionSha256
      || verification.admissionSha256 !== rehearsal.admissionSha256
      || publication.admissionSha256 !== rehearsal.admissionSha256
      || started.manifestSha256 !== manifestSha256
      || verification.manifestSha256 !== manifestSha256
      || publication.manifestSha256 !== manifestSha256
      || started.sourceRevision !== admission.sourceRevision
      || verification.sourceRevision !== admission.sourceRevision
      || publication.sourceRevision !== admission.sourceRevision
      || started.sourceRoot !== manifest.sourceRoot
      || verification.sourceRoot !== manifest.sourceRoot
      || publication.sourceRoot !== manifest.sourceRoot
      || verification.receiptSha256 !== admission.rehearsalReceiptSha256
      || publication.receiptSha256 !== admission.rehearsalReceiptSha256
      || !Number.isFinite(startedAt)
      || !Number.isFinite(verifiedAt)
      || !Number.isFinite(publishedAt)
      || startedAt < rehearsalLeaseStartedAt
      || observedAt < rehearsalLeaseStartedAt
      || verifiedAt < rehearsalLeaseStartedAt
      || publishedAt < rehearsalLeaseStartedAt
      || startedAt > observedAt
      || verifiedAt < observedAt
      || publishedAt < verifiedAt
      || verifiedAt >= Date.parse(rehearsal.expiresAt)
      || publishedAt >= Date.parse(rehearsal.expiresAt)
      || verifiedAt > nowMs + 30_000
      || publishedAt > nowMs + 30_000) fail('SUCCESSOR_ADMISSION_INVALID');
  }

  const rollback = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.rollback,
    admission.rollback.readbackSha256,
  );
  exactKeys(rollback, [
    'deploymentId', 'deploymentSha', 'deploymentUrl', 'expiresAt', 'gitRef', 'id', 'kind',
    'manifestSha256', 'observedAt', 'productionAliases', 'projectId', 'projectRef',
    'purpose', 'readyState', 'repository', 'schemaVersion', 'sourceRevision', 'state',
    'target', 'teamId',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!common(rollback)
    || rollback.kind !== 'rollback-readback-receipt'
    || rollback.deploymentId !== admission.rollback.deploymentId
    || rollback.deploymentSha !== admission.rollback.deploymentSha
    || rollback.deploymentUrl !== admission.rollback.deploymentUrl
    || rollback.gitRef !== admission.rollback.gitRef
    || !equal(rollback.productionAliases, admission.rollback.productionAliases)
    || rollback.projectId !== admission.rollback.projectId
    || rollback.readyState !== admission.rollback.readyState
    || rollback.repository !== admission.rollback.repository
    || rollback.state !== admission.rollback.state
    || rollback.target !== admission.rollback.target
    || rollback.teamId !== admission.rollback.teamId) fail('SUCCESSOR_ADMISSION_INVALID');
  assertReceiptWindow(rollback, admission, createdAt, expiresAt, nowMs);

  if (includeRehearsal) {
    validateApplyOperatingEvidence(admission, manifestRecord, {
      createdAt,
      expiresAt,
      minimumObservedAt: rehearsalPublishedAt,
      nowMs,
      receiptDirectory,
    });
    return;
  }
  for (const key of Object.keys(manifest.requiredWriterFences).sort()) {
    const fence = readPrivateCanonicalReceipt(
      receiptDirectory,
      `writer-fence-${key}.json`,
      admission.writerFences[key].evidenceSha256,
    );
    exactKeys(fence, [
      'expiresAt', 'fence', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef',
      'purpose', 'schemaVersion', 'sourceRevision', 'state',
    ], 'SUCCESSOR_ADMISSION_INVALID');
    if (!common(fence)
      || fence.kind !== 'writer-fence-readback-receipt'
      || fence.fence !== key
      || fence.state !== manifest.requiredWriterFences[key]) fail('SUCCESSOR_ADMISSION_INVALID');
    assertReceiptWindow(fence, admission, createdAt, expiresAt, nowMs);
  }
}

function validateAdmissionEnvelope(admission, manifestRecord, {
  expectedKind,
  includeRehearsal,
  now,
  receiptDirectory,
  requiredReceiptHashes,
}) {
  const { manifest, manifestSha256 } = manifestRecord;
  if (admission.schemaVersion !== 1
    || admission.id !== manifest.id
    || admission.purpose !== manifest.purpose
    || admission.projectRef !== manifest.projectRef
    || admission.manifestSha256 !== manifestSha256
    || admission.sourceRoot !== manifest.sourceRoot
    || (expectedKind !== undefined && admission.kind !== expectedKind)
    || !UUID.test(admission.attemptId)
    || !REVISION.test(admission.sourceRevision)) fail('SUCCESSOR_ADMISSION_INVALID');
  for (const field of requiredReceiptHashes) {
    assertHex(admission[field], 'SUCCESSOR_ADMISSION_INVALID');
  }
  assertHex(admission.journalPathSha256, 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(admission.rollback, [
    'deploymentId', 'deploymentSha', 'deploymentUrl', 'gitRef', 'productionAliases',
    'projectId', 'readbackSha256', 'readyState', 'repository', 'state', 'target', 'teamId',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!REVISION.test(admission.rollback.deploymentSha)) fail('SUCCESSOR_ADMISSION_INVALID');
  assertHex(admission.rollback.readbackSha256, 'SUCCESSOR_ADMISSION_INVALID');
  let normalizedRollback;
  try {
    normalizedRollback = normalizeVercelRollbackExpected({
      deploymentId: admission.rollback.deploymentId,
      deploymentUrl: admission.rollback.deploymentUrl,
      gitRef: admission.rollback.gitRef,
      gitSha: admission.rollback.deploymentSha,
    });
  } catch { fail('SUCCESSOR_ADMISSION_INVALID'); }
  if (normalizedRollback.deploymentUrl !== admission.rollback.deploymentUrl
    || admission.rollback.projectId !== TZUDONG_VERCEL_PROJECT_ID
    || admission.rollback.teamId !== TZUDONG_VERCEL_TEAM_ID
    || admission.rollback.repository !== TZUDONG_GITHUB_REPOSITORY
    || !equal(admission.rollback.productionAliases, TZUDONG_PRODUCTION_ALIASES)
    || admission.rollback.readyState !== 'READY'
    || admission.rollback.target !== 'production'
    || admission.rollback.state !== 'ready') fail('SUCCESSOR_ADMISSION_INVALID');

  const createdAt = Date.parse(admission.createdAt);
  const expiresAt = Date.parse(admission.expiresAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || expiresAt - createdAt > ADMISSION_MAX_AGE_MS
    || createdAt > nowMs + 30_000
    || nowMs >= expiresAt) fail('SUCCESSOR_ADMISSION_EXPIRED');

  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(admission.writerFences, fenceKeys, 'SUCCESSOR_ADMISSION_INVALID');
  for (const key of fenceKeys) {
    const fence = admission.writerFences[key];
    exactKeys(fence, ['evidenceSha256', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
    if (fence.state !== manifest.requiredWriterFences[key]) fail('SUCCESSOR_ADMISSION_INVALID');
    assertHex(fence.evidenceSha256, 'SUCCESSOR_ADMISSION_INVALID');
  }
  validatePrivateReceipts(admission, manifestRecord, {
    createdAt,
    expiresAt,
    includeRehearsal,
    nowMs,
    receiptDirectory,
  });
  return Object.freeze({ createdAt, expiresAt });
}

export function validateSuccessorAdmission(admission, manifestRecord, {
  now = new Date(),
  receiptDirectory,
} = {}) {
  const { manifest } = manifestRecord;
  exactKeys(admission, [
    'applyEvidenceMapSha256',
    'applyQuiescenceReadbackSha256',
    'attemptId',
    'createdAt',
    'expiresAt',
    'id',
    'journalPathSha256',
    'manifestSha256',
    'projectRef',
    'protectedMainReceiptSha256',
    'purpose',
    'rehearsalAdmissionSha256',
    'rehearsalJournalSha256',
    'rehearsalReceiptSha256',
    'rollback',
    'schemaVersion',
    'sourceReceiptSha256',
    'sourceRevision',
    'sourceRoot',
    'stageStates',
    'writerFences',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(admission.applyEvidenceMapSha256, 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(admission.applyQuiescenceReadbackSha256, 'SUCCESSOR_ADMISSION_INVALID');
  const envelope = validateAdmissionEnvelope(admission, manifestRecord, {
    includeRehearsal: true,
    now,
    receiptDirectory,
    requiredReceiptHashes: [
      'protectedMainReceiptSha256',
      'rehearsalAdmissionSha256',
      'rehearsalJournalSha256',
      'rehearsalReceiptSha256',
      'sourceReceiptSha256',
    ],
  });

  const stageBinding = validateSuccessorStageStates(admission.stageStates, manifest);
  return Object.freeze({ ...envelope, ...stageBinding });
}

export function validateSuccessorStageStates(stageStates, manifest) {
  if (!Array.isArray(stageStates)
    || stageStates.length !== manifest.migrations.length + 1) fail('SUCCESSOR_ADMISSION_INVALID');
  const suffixRoot = elevenMigrationBundleSuffixRoot(manifest.migrations);
  const priorCount = stageStates[0]?.bundle?.priorCount;
  const prefixRoot = stageStates[0]?.bundle?.prefixRoot;
  if (priorCount !== manifest.operatingTransition.beforeEleven
    || priorCount + manifest.migrations.length !== manifest.operatingTransition.afterEleven) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  assertHex(prefixRoot, 'SUCCESSOR_ADMISSION_INVALID');
  stageStates.forEach((stage, index) => validateStageState(
    stage,
    index,
    manifest,
    suffixRoot,
    priorCount,
    prefixRoot,
  ));
  const g014Roots = stageStates.map(stage => stage.state.g014Root);
  if (g014Roots[1] !== g014Roots[0]
    || g014Roots[2] !== g014Roots[0]
    || new Set(g014Roots.slice(4)).size !== 1) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  const ledgerRoots = stageStates.map(stage => stage.state.ledgerRoot);
  if (new Set(ledgerRoots).size !== ledgerRoots.length) fail('SUCCESSOR_ADMISSION_INVALID');
  return Object.freeze({ prefixRoot, priorCount, suffixRoot });
}

export function validateSuccessorRehearsalAdmission(admission, manifestRecord, {
  now = new Date(),
  receiptDirectory,
} = {}) {
  exactKeys(admission, [
    'attemptId',
    'createdAt',
    'expiresAt',
    'id',
    'journalPathSha256',
    'kind',
    'manifestSha256',
    'projectRef',
    'protectedMainReceiptSha256',
    'purpose',
    'receiptPathSha256',
    'rollback',
    'schemaVersion',
    'sourceReceiptSha256',
    'sourceRevision',
    'sourceRoot',
    'writerFences',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(admission.receiptPathSha256, 'SUCCESSOR_ADMISSION_INVALID');
  return validateAdmissionEnvelope(admission, manifestRecord, {
    expectedKind: 'successor-rehearsal-admission',
    includeRehearsal: false,
    now,
    receiptDirectory,
    requiredReceiptHashes: ['protectedMainReceiptSha256', 'sourceReceiptSha256'],
  });
}

function assertAdmissionFresh(expiresAt, value) {
  const nowMs = value instanceof Date ? value.getTime() : NaN;
  if (!Number.isFinite(nowMs) || nowMs >= expiresAt) fail('SUCCESSOR_ADMISSION_EXPIRED');
}

function assertLiveRollbackReadback(admission, observed, { checkedAt, createdAt, expiresAt }) {
  exactKeys(observed, [
    'deploymentId', 'deploymentUrl', 'gitRef', 'gitSha', 'kind', 'observedAt',
    'productionAliases', 'projectId', 'readyState', 'repository', 'schemaVersion',
    'target', 'teamId',
  ], 'SUCCESSOR_ROLLBACK_READBACK_INVALID');
  const liveObservedAt = Date.parse(observed.observedAt);
  if (observed.schemaVersion !== 1
    || observed.kind !== 'vercel-rollback-readback'
    || observed.deploymentId !== admission.rollback.deploymentId
    || observed.deploymentUrl !== admission.rollback.deploymentUrl
    || observed.gitRef !== admission.rollback.gitRef
    || observed.gitSha !== admission.rollback.deploymentSha
    || !equal(observed.productionAliases, admission.rollback.productionAliases)
    || observed.projectId !== admission.rollback.projectId
    || observed.readyState !== admission.rollback.readyState
    || observed.repository !== admission.rollback.repository
    || observed.target !== admission.rollback.target
    || observed.teamId !== admission.rollback.teamId
    || !Number.isFinite(liveObservedAt)
    || liveObservedAt < createdAt
    || liveObservedAt >= expiresAt
    || liveObservedAt > checkedAt.getTime()) fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
}

export function assertLaunchReady(manifest) {
  if (manifest.launchPolicy.state !== 'ready') fail('SUCCESSOR_LAUNCH_HELD');
}

function successorExpirySql(admission, suffix, {
  armTransactionTimeout = false,
  maxTransactionTimeoutMs = ADMISSION_MAX_AGE_MS,
} = {}) {
  const tag = `$successor_expiry_${sha256(`${admission.expiresAt}:${suffix}`).slice(0, 18)}$`;
  const armTimeout = armTransactionTimeout
    ? `\n PERFORM set_config('transaction_timeout',least(${maxTransactionTimeoutMs},greatest(1,ceil(extract(epoch FROM (${quote(admission.expiresAt)}::timestamptz-transaction_timestamp()))*1000)::bigint))::text,true);`
    : '';
  return `DO ${tag} BEGIN IF clock_timestamp() >= ${quote(admission.expiresAt)}::timestamptz THEN RAISE EXCEPTION 'SUCCESSOR_ADMISSION_EXPIRED'; END IF;${armTimeout} END ${tag};`;
}

function stripCompiledStageReadback(sql) {
  const spans = statementSpans(sql);
  const read = spans.at(-1);
  if (!read || !/^SELECT\b/i.test(read.token)) fail('SUCCESSOR_SOURCE_DRIFT');
  return sql.slice(0, read.start).trimEnd();
}

function guardCompiledSuccessorStages(compiled, migrations, admission) {
  const stages = compiled.plans.map((plan, index) => stripCompiledStageReadback(
    atomicMigrationSql(plan, migrations[index]),
  ));
  const compiledPrefix = stages.join('\n');
  if (!compiled.sql.startsWith(`${compiledPrefix}\n`)) fail('SUCCESSOR_SOURCE_DRIFT');
  const tail = compiled.sql.slice(compiledPrefix.length + 1);
  return `${stages.map((stage, index) => `${stage}\n${successorExpirySql(admission, `stage-${index + 1}`)}`).join('\n')}\n${tail}${SUCCESSOR_PRE_COMMIT_EXPIRY_MARKER}\n${successorExpirySql(admission, 'pre-commit')}\n`;
}

export function compileSuccessorPlan(manifestRecord, admission) {
  const { manifest, materials } = manifestRecord;
  const suffixRoot = elevenMigrationBundleSuffixRoot(manifest.migrations);
  const stateQuery = buildSuccessorStateQuery(manifest, suffixRoot);
  const migrations = manifest.migrations.map((migration, index) => ({
    id: migration.id,
    path: migration.path,
    sha256: migration.sha256,
    statementVectorSha256: migration.statementVectorSha256,
    expectedPriorState: { query: stateQuery, expected: admission.stageStates[index] },
    terminalReadback: { query: stateQuery, expected: admission.stageStates[index + 1] },
  }));
  const prior = admission.stageStates[0];
  const terminal = admission.stageStates.at(-1);
  const compiled = compileElevenMigrationBundle({
    schemaVersion: 1,
    id: manifest.id,
    priorCount: prior.bundle.priorCount,
    prefixRoot: prior.bundle.prefixRoot,
    suffixRoot,
    migrations,
    priorReadback: { query: stateQuery, expected: prior },
    finalReadback: { query: stateQuery, expected: terminal },
  }, materials);
  const lockTag = `$successor_${sha256(manifest.advisoryLockKey).slice(0, 20)}$`;
  const guardedStages = guardCompiledSuccessorStages(compiled, migrations, admission);
  const guardedSql = `SET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\nSET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${manifest.advisoryLockKey}::bigint); END ${lockTag};\n${successorExpirySql(admission, 'post-lock', { armTransactionTimeout: true })}\n${guardedStages}`;
  return Object.freeze({
    ...compiled,
    sql: guardedSql,
    stateQuery,
  });
}

export function validateSuccessorBaseline(stage, manifest) {
  const suffixRoot = elevenMigrationBundleSuffixRoot(manifest.migrations);
  const priorCount = stage?.bundle?.priorCount;
  const prefixRoot = stage?.bundle?.prefixRoot;
  if (priorCount !== manifest.operatingTransition.beforeEleven) {
    fail('SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  }
  try {
    assertHex(prefixRoot, 'SUCCESSOR_ADMISSION_INVALID');
    validateStageState(stage, 0, manifest, suffixRoot, priorCount, prefixRoot);
  } catch {
    fail('SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  }
  return Object.freeze({ prefixRoot, priorCount, suffixRoot });
}

function rehearsalExpirySql(admission, suffix) {
  const tag = `$successor_rehearsal_expiry_${sha256(`${admission.expiresAt}:${suffix}`).slice(0, 18)}$`;
  return `DO ${tag} BEGIN IF clock_timestamp() >= ${quote(admission.expiresAt)}::timestamptz THEN RAISE EXCEPTION 'SUCCESSOR_ADMISSION_EXPIRED'; END IF; END ${tag};`;
}

function rehearsalStageSql(stateQuery, index) {
  return `SELECT json_build_object('index',${index},'kind','successor-rehearsal-stage','serverVersionNum',current_setting('server_version_num')::int,'state',(${stateQuery})::jsonb)::text;`;
}

export function compileSuccessorStateReadQuery(manifestRecord) {
  const stateQuery = buildSuccessorStateQuery(manifestRecord.manifest);
  return Object.freeze({
    sql: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='15s';\nSELECT json_build_object('kind','successor-rehearsal-readback','serverVersionNum',current_setting('server_version_num')::int,'state',(${stateQuery})::jsonb)::text;`,
    stateQuery,
  });
}

export function compileSuccessorRehearsalPlan(manifestRecord, admission, expectedBaseline) {
  const { manifest, materials } = manifestRecord;
  validateSuccessorBaseline(expectedBaseline, manifest);
  const sources = compileElevenMigrationRehearsalSources(manifest.migrations, materials);
  const suffixRoot = elevenMigrationBundleSuffixRoot(manifest.migrations);
  const stateQuery = buildSuccessorStateQuery(manifest, suffixRoot);
  const lockTag = `$successor_rehearsal_${sha256(manifest.advisoryLockKey).slice(0, 18)}$`;
  const baselineTag = `$successor_rehearsal_baseline_${sha256(JSON.stringify(canonical(expectedBaseline))).slice(0, 18)}$`;
  const parts = [
    'BEGIN;',
    "SET LOCAL lock_timeout='2s';",
    "SET LOCAL statement_timeout='15s';",
    "SET LOCAL idle_in_transaction_session_timeout='30s';",
    `DO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${manifest.advisoryLockKey}::bigint); END ${lockTag};`,
    rehearsalExpirySql(admission, 'after-lock'),
    'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;',
    `DO ${baselineTag} BEGIN
 IF NOT has_schema_privilege(current_user,'supabase_migrations','USAGE')
  OR NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT')
  OR NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
  OR (${stateQuery})::jsonb IS DISTINCT FROM ${quote(JSON.stringify(canonical(expectedBaseline)))}::jsonb
 THEN RAISE EXCEPTION 'SUCCESSOR_REHEARSAL_BASELINE_INVALID'; END IF;
END ${baselineTag};`,
    rehearsalStageSql(stateQuery, 0),
  ];
  sources.forEach((source, index) => {
    const migration = manifest.migrations[index];
    const ledgerTag = `$successor_rehearsal_ledger_${sha256(migration.id).slice(0, 18)}$`;
    parts.push(
      rehearsalExpirySql(admission, `before-${index + 1}`),
      '\\o /dev/null',
      source.execution,
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(source.version)},${quote(source.name)},ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(source.originalVector))}::jsonb)));`,
      `DO ${ledgerTag} BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(source.version)} AND name IS NOT DISTINCT FROM ${quote(source.name)} AND statements IS NOT DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(source.originalVector))}::jsonb)))
 THEN RAISE EXCEPTION 'MIGRATION_LEDGER_READBACK_FAILED'; END IF;
END ${ledgerTag};`,
      '\\o',
      rehearsalStageSql(stateQuery, index + 1),
    );
  });
  parts.push(rehearsalExpirySql(admission, 'before-rollback'), 'ROLLBACK;');
  return Object.freeze({
    sql: parts.join('\n'),
    stateQuery,
    suffixRoot,
    transactionMode: 'explicit-rollback-only',
  });
}

function checkoutPath(path, code, { mustExist = true } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  const comparison = mustExist ? realpathSync(absolute) : realpathSync(dirname(absolute));
  const rel = relative(realpathSync(REPOSITORY_ROOT), comparison);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`))) fail(code);
  return absolute;
}

function assertPrivateAdmissionPath(path) {
  const absolute = checkoutPath(path, 'SUCCESSOR_ADMISSION_INVALID');
  const status = lstatSync(absolute);
  if (!status.isFile() || status.isSymbolicLink()) fail('SUCCESSOR_ADMISSION_INVALID');
  if (process.platform !== 'win32' && (status.mode & 0o077) !== 0) fail('SUCCESSOR_ADMISSION_INVALID');
  return absolute;
}

function assertJournalPath(path) {
  const absolute = checkoutPath(path, 'SUCCESSOR_JOURNAL_INVALID', { mustExist: false });
  if (existsSync(absolute)) fail('SUCCESSOR_JOURNAL_EXISTS');
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink()) fail('SUCCESSOR_JOURNAL_INVALID');
  if (process.platform !== 'win32' && (parent.mode & 0o077) !== 0) fail('SUCCESSOR_JOURNAL_INVALID');
  return absolute;
}

function syncDirectory(path, fsyncImpl = fsyncSync) {
  const descriptor = openSync(path, 'r');
  try { fsyncImpl(descriptor); } finally { closeSync(descriptor); }
}

function writeJournalStart(path, entry, { fsyncImpl = fsyncSync } = {}) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeAllSync(descriptor, Buffer.from(`${JSON.stringify(canonical(entry))}\n`));
    fsyncImpl(descriptor);
    syncDirectory(dirname(path), fsyncImpl);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* preserve the bounded original failure */ }
    }
    if (safeCode(error) === 'EEXIST') fail('SUCCESSOR_JOURNAL_EXISTS');
    fail('SUCCESSOR_JOURNAL_INVALID');
  }
}

function writeAllSync(descriptor, bytes, code = 'SUCCESSOR_JOURNAL_APPEND_FAILED') {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(written) || written <= 0) fail(code);
    offset += written;
  }
}

export function appendJournal(descriptor, entry, {
  close = true,
  fsyncImpl = fsyncSync,
  closeImpl = closeSync,
} = {}) {
  let durable = false;
  try {
    writeAllSync(descriptor, Buffer.from(`${JSON.stringify(canonical(entry))}\n`));
    fsyncImpl(descriptor);
    durable = true;
    if (close) closeImpl(descriptor);
  } catch {
    try { closeSync(descriptor); } catch { /* fixed outcome below */ }
    const error = operationError('SUCCESSOR_JOURNAL_APPEND_FAILED');
    error.publicationAuditReadbackEligible = durable;
    throw error;
  }
}

function assertDurableRehearsalArtifacts(directory, admission, fsyncImpl) {
  // Visibility after a failed publication fsync is not evidence of durability.
  // Reconfirm the exact admitted files before any new database mutation.
  try {
    const directoryStatus = lstatSync(directory);
    if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()
      || (process.platform !== 'win32' && (directoryStatus.mode & 0o077) !== 0)) {
      fail('SUCCESSOR_ADMISSION_INVALID');
    }
    for (const [fileName, expected] of [
      [PRIVATE_RECEIPT_FILES.rehearsalAdmission, admission.rehearsalAdmissionSha256],
      [PRIVATE_RECEIPT_FILES.rehearsal, admission.rehearsalReceiptSha256],
      [PRIVATE_RECEIPT_FILES.rehearsalJournal, admission.rehearsalJournalSha256],
    ]) {
      const path = join(directory, fileName);
      const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const status = fstatSync(descriptor);
        const named = lstatSync(path);
        if (!status.isFile() || named.isSymbolicLink()
          || status.dev !== named.dev || status.ino !== named.ino
          || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)
          || sha256(readFileSync(descriptor)) !== expected) fail('SUCCESSOR_ADMISSION_INVALID');
        fsyncImpl(descriptor);
      } finally { closeSync(descriptor); }
    }
    syncDirectory(directory, fsyncImpl);
  } catch { fail('SUCCESSOR_ADMISSION_INVALID'); }
}

function gitCommand(args, repositoryRoot = REPOSITORY_ROOT) {
  const result = spawnSync('/usr/bin/git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) fail('SUCCESSOR_CHECKOUT_INVALID');
  return result.stdout.trim();
}

export function currentSuccessorGitFacts({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const revision = gitCommand(['rev-parse', 'HEAD'], repositoryRoot);
  const dirty = gitCommand(['status', '--porcelain=v1'], repositoryRoot);
  const symbolic = spawnSync('/usr/bin/git', ['symbolic-ref', '-q', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (symbolic.error || ![0, 1].includes(symbolic.status)) fail('SUCCESSOR_CHECKOUT_INVALID');
  return { revision, clean: dirty === '', detached: symbolic.status === 1 };
}

export function protectedSourceReadbackBinding(manifest, revision) {
  if (!manifest?.protectedSource || !REVISION.test(revision ?? '')) fail('SUCCESSOR_ADMISSION_INVALID');
  exactKeys(manifest.protectedSource, ['ref', 'remote', 'repositoryUrl'], 'SUCCESSOR_ADMISSION_INVALID');
  return Object.freeze({
    projectRef: manifest.projectRef,
    ref: manifest.protectedSource.ref,
    remote: manifest.protectedSource.remote,
    repositoryUrl: manifest.protectedSource.repositoryUrl,
    revision,
    schemaVersion: 1,
  });
}

export function currentProtectedMainReadback(manifest, {
  repositoryRoot = REPOSITORY_ROOT,
  spawnImpl = spawnSync,
} = {}) {
  if (!manifest?.protectedSource) fail('SUCCESSOR_CHECKOUT_INVALID');
  const run = args => {
    const result = spawnImpl('/usr/bin/git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: GIT_REMOTE_READ_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) fail('SUCCESSOR_CHECKOUT_INVALID');
    return result.stdout.trim();
  };
  const repositoryUrl = run(['remote', 'get-url', manifest.protectedSource.remote]);
  if (repositoryUrl !== manifest.protectedSource.repositoryUrl) fail('SUCCESSOR_CHECKOUT_INVALID');
  const output = run([
    'ls-remote',
    '--exit-code',
    '--refs',
    manifest.protectedSource.remote,
    manifest.protectedSource.ref,
  ]);
  const rows = output.split(/\r?\n/).filter(Boolean);
  const match = rows.length === 1 ? /^([0-9a-f]{40})\t(.+)$/.exec(rows[0]) : null;
  if (!match || match[2] !== manifest.protectedSource.ref) fail('SUCCESSOR_CHECKOUT_INVALID');
  return protectedSourceReadbackBinding(manifest, match[1]);
}

function assertCheckout(admission, facts) {
  if (!facts || facts.revision !== admission.sourceRevision || facts.clean !== true || facts.detached !== true) {
    fail('SUCCESSOR_CHECKOUT_INVALID');
  }
}

function assertProtectedSourceReadback(admission, manifest, observed) {
  const expected = protectedSourceReadbackBinding(manifest, admission.sourceRevision);
  if (!equal(observed, expected)) fail('SUCCESSOR_CHECKOUT_INVALID');
}

export function assertSuccessorDatabaseTarget(databaseUrl, manifest) {
  let target;
  try { target = new URL(databaseUrl); } catch { fail('SUCCESSOR_DATABASE_TARGET_INVALID'); }
  const malformedPercentEncoding = value => /%(?![0-9a-f]{2})/i.test(value);
  const queryKeys = [...target.searchParams.keys()];
  const sslModes = target.searchParams.getAll('sslmode');
  const safeQuery = queryKeys.length === 0
    || (queryKeys.length === 1
      && queryKeys[0] === 'sslmode'
      && sslModes.length === 1
      && ['require', 'verify-ca', 'verify-full'].includes(sslModes[0]));
  const directHost = target.hostname === `db.${manifest.projectRef}.supabase.co`;
  const sharedPoolerHost = /^aws-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/.test(target.hostname);
  const directTarget = directHost
    && target.username === 'postgres'
    && ['5432', '6543'].includes(target.port);
  const sharedPoolerTarget = sharedPoolerHost
    && target.username === `postgres.${manifest.projectRef}`
    && ['5432', '6543'].includes(target.port);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || target.hash
    || malformedPercentEncoding(target.username)
    || malformedPercentEncoding(target.password)
    || malformedPercentEncoding(target.pathname)
    || malformedPercentEncoding(target.search)
    || target.pathname !== `/${manifest.databaseName}`
    || !safeQuery
    || (!directTarget && !sharedPoolerTarget)) fail('SUCCESSOR_DATABASE_TARGET_INVALID');
}

function transportError(result) {
  if (result.error) return operationError('MIGRATION_PSQL_EXECUTION_FAILED');
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/m.exec(stderr)?.[1];
  if (/ERROR:\s+(?:[0-9A-Z]{5}:\s*)?SUCCESSOR_ADMISSION_EXPIRED\b/m.test(stderr)) {
    return operationError('SUCCESSOR_ADMISSION_EXPIRED');
  }
  const error = operationError(sqlstate ? `MIGRATION_PSQL_FAILED_${sqlstate}` : 'MIGRATION_PSQL_FAILED');
  error.fixedSqlCode = /ERROR:\s+(?:[0-9A-Z]{5}:\s*)?(MIGRATION_[A-Z0-9_]{1,96})\b/m.exec(stderr)?.[1];
  return error;
}

export function createSuccessorPsqlRunner(databaseUrl, {
  environment = process.env,
  psql = environment.TZUDONG_SUCCESSOR_PSQL || 'psql',
  spawnImpl = spawnSync,
} = {}) {
  return (_databaseUrl, sql, singleTransaction, { timeoutMs = PSQL_MAX_TIMEOUT_MS } = {}) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PSQL_MAX_TIMEOUT_MS) {
      fail('SUCCESSOR_ARGUMENT_INVALID');
    }
    const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'];
    if (singleTransaction) args.splice(1, 0, '--single-transaction');
    args.push('--file=-');
    const result = spawnImpl(psql, args, {
      encoding: 'utf8',
      env: psqlConnectionEnvironment(databaseUrl, environment),
      input: `\\set VERBOSITY verbose\n${sql}`,
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
      // A stalled client must not keep spawnSync waiting after SIGTERM.
      killSignal: 'SIGKILL',
    });
    if (result.error || result.status !== 0) throw transportError(result);
    return result.stdout || '';
  };
}

function parseReadback(output) {
  if (typeof output !== 'string' || !output.trim()) fail('SUCCESSOR_READBACK_INVALID');
  return parseJsonObject(output.trim(), 'SUCCESSOR_READBACK_INVALID');
}

function parseRehearsalReadback(output, manifest) {
  let value;
  try {
    value = parseJsonObject(output.trim(), 'SUCCESSOR_REHEARSAL_BASELINE_INVALID');
    exactKeys(value, ['kind', 'serverVersionNum', 'state'], 'SUCCESSOR_REHEARSAL_BASELINE_INVALID');
    if (value.kind !== 'successor-rehearsal-readback'
      || !Number.isSafeInteger(value.serverVersionNum)
      || Math.floor(value.serverVersionNum / 10_000) !== manifest.serverMajor) {
      fail('SUCCESSOR_REHEARSAL_BASELINE_INVALID');
    }
    validateSuccessorBaseline(value.state, manifest);
  } catch {
    fail('SUCCESSOR_REHEARSAL_BASELINE_INVALID');
  }
  return value;
}

function parseRehearsalStages(output, manifest, expectedBaseline, expectedServerVersionNum) {
  if (typeof output !== 'string') fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== manifest.migrations.length + 1) fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  let stages;
  try {
    stages = lines.map((line, index) => {
      const value = parseJsonObject(line, 'SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
      exactKeys(value, ['index', 'kind', 'serverVersionNum', 'state'], 'SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
      if (value.kind !== 'successor-rehearsal-stage'
        || value.index !== index
        || value.serverVersionNum !== expectedServerVersionNum) {
        fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
      }
      return value.state;
    });
    validateSuccessorStageStates(stages, manifest);
  } catch {
    fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  }
  if (!equal(stages[0], expectedBaseline)) fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  return Object.freeze(stages);
}

function assertRehearsalReceiptPath(path, admissionFile) {
  let absolute;
  try {
    absolute = checkoutPath(path, 'SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED', { mustExist: false });
    if (absolute !== resolve(dirname(admissionFile), PRIVATE_RECEIPT_FILES.rehearsal)
      || existsSync(absolute)) fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
    const parent = lstatSync(dirname(absolute));
    if (!parent.isDirectory()
      || parent.isSymbolicLink()
      || (process.platform !== 'win32' && (parent.mode & 0o077) !== 0)) {
      fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
    }
  } catch {
    fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  }
  return absolute;
}

function assertRehearsalJournalPath(path, admissionFile) {
  const absolute = assertJournalPath(path);
  if (absolute !== resolve(dirname(admissionFile), PRIVATE_RECEIPT_FILES.rehearsalJournal)) {
    fail('SUCCESSOR_JOURNAL_BINDING_MISMATCH');
  }
  return absolute;
}

function assertPendingRehearsalReceiptPath(receiptFile, attemptId) {
  let pendingFile;
  try {
    pendingFile = checkoutPath(
      `${receiptFile}.${attemptId}.pending`,
      'SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED',
      { mustExist: false },
    );
    if (dirname(pendingFile) !== dirname(receiptFile) || existsSync(pendingFile)) {
      fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
    }
  } catch {
    fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  }
  return pendingFile;
}

function writePendingReceipt(path, receipt) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeAllSync(
      descriptor,
      canonicalReceiptBytes(receipt),
      'SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED',
    );
    fsyncSync(descriptor);
    closeSync(descriptor);
  } catch {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* fixed outcome below */ }
    }
    fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  }
}

function publishPendingReceipt(pendingPath, receiptPath) {
  let directoryDescriptor;
  try {
    linkSync(pendingPath, receiptPath);
  } catch {
    const error = operationError('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
    error.publicationReadbackEligible = false;
    throw error;
  }
  try {
    directoryDescriptor = openSync(dirname(receiptPath), 'r');
    fsyncSync(directoryDescriptor);
  } catch {
    if (directoryDescriptor !== undefined) {
      try { closeSync(directoryDescriptor); } catch { /* fixed outcome below */ }
    }
    const error = operationError('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
    error.publicationReadbackEligible = false;
    throw error;
  }
  try {
    closeSync(directoryDescriptor);
  } catch {
    const error = operationError('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
    error.publicationReadbackEligible = true;
    throw error;
  }
}

function publishedReceiptMatches(path, expectedBytes) {
  try {
    const status = lstatSync(path);
    if (!status.isFile()
      || status.isSymbolicLink()
      || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) return false;
    return readFileSync(path).equals(expectedBytes);
  } catch {
    return false;
  }
}

function canonicalJournalBytes(entries) {
  return Buffer.from(entries
    .map(entry => JSON.stringify(canonical(entry)))
    .join('\n') + '\n');
}

function publishedJournalMatches(path, entries) {
  try {
    const status = lstatSync(path);
    if (!status.isFile()
      || status.isSymbolicLink()
      || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)
      || dirname(realpathSync(path)) !== realpathSync(dirname(path))) return false;
    return readFileSync(path).equals(canonicalJournalBytes(entries));
  } catch {
    return false;
  }
}

function appendRehearsalTerminal(descriptor, admission, code, now, {
  binding,
  appendJournalImpl = appendJournal,
} = {}) {
  const entry = {
    attemptId: admission.attemptId,
    code,
    completedAt: now().toISOString(),
    event: 'terminal',
    ...(binding ?? {}),
  };
  try {
    appendJournalImpl(descriptor, entry);
  } catch {
    try { closeSync(descriptor); } catch { /* append implementation may already have closed it */ }
    throw journalFailure(code);
  }
}

function appendRehearsalVerification(descriptor, entry, {
  appendJournalImpl = appendJournal,
} = {}) {
  try {
    appendJournalImpl(descriptor, entry, { close: false });
  } catch {
    try { closeSync(descriptor); } catch { /* append implementation may already have closed it */ }
    fail('SUCCESSOR_JOURNAL_APPEND_FAILED');
  }
}

function assertFreshRehearsalBoundary(descriptor, admission, expiresAt, now, {
  binding,
  appendJournalImpl = appendJournal,
} = {}) {
  const checkedAt = now();
  try {
    assertAdmissionFresh(expiresAt, checkedAt);
  } catch {
    appendRehearsalTerminal(
      descriptor,
      admission,
      'SUCCESSOR_ADMISSION_EXPIRED',
      () => checkedAt,
      { binding, appendJournalImpl },
    );
    fail('SUCCESSOR_ADMISSION_EXPIRED');
  }
  return checkedAt;
}

export function runReviewMediaSuccessorRehearsal({
  admissionPath,
  journalPath,
  receiptPath,
  environment = process.env,
}, {
  now = () => new Date(),
  gitFactsImpl = currentSuccessorGitFacts,
  loadManifestImpl = loadSuccessorManifest,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  rollbackReadbackImpl = captureVercelRollbackReadbackSync,
  runPsqlImpl,
  writePendingReceiptImpl = writePendingReceipt,
  publishReceiptImpl = publishPendingReceipt,
  appendJournalImpl = appendJournal,
  fsyncImpl = fsyncSync,
} = {}) {
  const manifestRecord = loadManifestImpl();
  const admissionFile = assertPrivateAdmissionPath(admissionPath);
  const admissionBytes = readFileSync(admissionFile);
  const admission = parseJsonObject(admissionBytes, 'SUCCESSOR_ADMISSION_INVALID');
  const admissionWindow = validateSuccessorRehearsalAdmission(admission, manifestRecord, {
    now: now(),
    receiptDirectory: dirname(admissionFile),
  });
  assertCheckout(admission, gitFactsImpl());
  assertProtectedSourceReadback(
    admission,
    manifestRecord.manifest,
    protectedMainReadbackImpl(manifestRecord.manifest),
  );
  let rollbackReadback;
  try {
    rollbackReadback = rollbackReadbackImpl({
      expected: {
        deploymentId: admission.rollback.deploymentId,
        deploymentUrl: admission.rollback.deploymentUrl,
        gitRef: admission.rollback.gitRef,
        gitSha: admission.rollback.deploymentSha,
      },
      now,
    });
  } catch {
    fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  }
  const rollbackCheckedAt = now();
  assertAdmissionFresh(admissionWindow.expiresAt, rollbackCheckedAt);
  assertLiveRollbackReadback(admission, rollbackReadback, {
    ...admissionWindow,
    checkedAt: rollbackCheckedAt,
  });

  const journalFile = assertRehearsalJournalPath(journalPath, admissionFile);
  if (sha256(Buffer.from(journalFile)) !== admission.journalPathSha256) {
    fail('SUCCESSOR_JOURNAL_BINDING_MISMATCH');
  }
  const receiptFile = assertRehearsalReceiptPath(receiptPath, admissionFile);
  if (sha256(Buffer.from(receiptFile)) !== admission.receiptPathSha256) {
    fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  }
  const pendingReceiptFile = assertPendingRehearsalReceiptPath(receiptFile, admission.attemptId);
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, manifestRecord.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });
  const readPlan = compileSuccessorStateReadQuery(manifestRecord);

  let preflight;
  try {
    preflight = parseRehearsalReadback(
      transport(databaseUrl, readPlan.sql, true),
      manifestRecord.manifest,
    );
  } catch (error) {
    const code = safeCode(error) === 'SUCCESSOR_REHEARSAL_BASELINE_INVALID'
      ? 'SUCCESSOR_REHEARSAL_BASELINE_INVALID'
      : boundedSuccessorError(error).code;
    fail(code);
  }

  let finalRollbackReadback;
  try {
    finalRollbackReadback = rollbackReadbackImpl({
      expected: {
        deploymentId: admission.rollback.deploymentId,
        deploymentUrl: admission.rollback.deploymentUrl,
        gitRef: admission.rollback.gitRef,
        gitSha: admission.rollback.deploymentSha,
      },
      now,
    });
  } catch {
    fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  }
  const finalRollbackCheckedAt = now();
  assertAdmissionFresh(admissionWindow.expiresAt, finalRollbackCheckedAt);
  assertLiveRollbackReadback(admission, finalRollbackReadback, {
    ...admissionWindow,
    checkedAt: finalRollbackCheckedAt,
  });

  const plan = compileSuccessorRehearsalPlan(manifestRecord, admission, preflight.state);
  const admissionSha256 = sha256(admissionBytes);
  const startedEntry = {
    admissionSha256,
    attemptId: admission.attemptId,
    event: 'started',
    manifestSha256: manifestRecord.manifestSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    startedAt: now().toISOString(),
  };
  const descriptor = writeJournalStart(journalFile, startedEntry, { fsyncImpl });

  let transactionOutput;
  let transactionError;
  try {
    assertAdmissionFresh(admissionWindow.expiresAt, now());
    transactionOutput = transport(databaseUrl, plan.sql, false);
  } catch (error) {
    transactionError = error;
  }

  let restored;
  try {
    restored = parseRehearsalReadback(
      transport(databaseUrl, readPlan.sql, true),
      manifestRecord.manifest,
    );
  } catch {
    appendRehearsalTerminal(descriptor, admission, 'SUCCESSOR_REHEARSAL_RESTORE_UNKNOWN', now, {
      appendJournalImpl,
    });
    fail('SUCCESSOR_REHEARSAL_RESTORE_UNKNOWN');
  }
  if (restored.serverVersionNum !== preflight.serverVersionNum
    || !equal(restored.state, preflight.state)) {
    appendRehearsalTerminal(descriptor, admission, 'SUCCESSOR_REHEARSAL_RESTORE_CONFLICT', now, {
      appendJournalImpl,
    });
    fail('SUCCESSOR_REHEARSAL_RESTORE_CONFLICT');
  }
  if (transactionError) {
    const bounded = boundedSuccessorError(transactionError);
    const code = bounded.code === 'SUCCESSOR_ADMISSION_EXPIRED'
      ? bounded.code
      : 'SUCCESSOR_REHEARSAL_OUTCOME_UNCONFIRMED';
    appendRehearsalTerminal(descriptor, admission, code, now, {
      appendJournalImpl,
    });
    fail(code);
  }

  let stageStates;
  try {
    stageStates = parseRehearsalStages(
      transactionOutput,
      manifestRecord.manifest,
      preflight.state,
      preflight.serverVersionNum,
    );
  } catch {
    appendRehearsalTerminal(descriptor, admission, 'SUCCESSOR_REHEARSAL_OUTPUT_INVALID', now, {
      appendJournalImpl,
    });
    fail('SUCCESSOR_REHEARSAL_OUTPUT_INVALID');
  }
  const receiptObservedAt = assertFreshRehearsalBoundary(
    descriptor,
    admission,
    admissionWindow.expiresAt,
    now,
    { appendJournalImpl },
  );
  const priorStateSha256 = sha256(JSON.stringify(canonical(preflight.state)));
  const receipt = {
    admissionSha256,
    attemptId: admission.attemptId,
    expiresAt: admission.expiresAt,
    id: manifestRecord.manifest.id,
    kind: 'successor-rehearsal-receipt',
    journalPathSha256: sha256(Buffer.from(journalFile)),
    manifestSha256: manifestRecord.manifestSha256,
    observedAt: receiptObservedAt.toISOString(),
    passed: true,
    preflightStateSha256: priorStateSha256,
    projectRef: manifestRecord.manifest.projectRef,
    purpose: manifestRecord.manifest.purpose,
    restoredStateSha256: priorStateSha256,
    schemaVersion: 1,
    serverVersionNum: preflight.serverVersionNum,
    sourceRevision: admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    stageStates,
    stageStatesSha256: sha256(JSON.stringify(canonical(stageStates))),
    suffixRoot: plan.suffixRoot,
  };
  const receiptSha256 = sha256(canonicalReceiptBytes(receipt));
  try {
    writePendingReceiptImpl(pendingReceiptFile, receipt);
  } catch {
    appendRehearsalTerminal(descriptor, admission, 'SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED', now, {
      appendJournalImpl,
    });
    fail('SUCCESSOR_REHEARSAL_RECEIPT_WRITE_FAILED');
  }
  const verificationBinding = {
    admissionSha256,
    manifestSha256: manifestRecord.manifestSha256,
    receiptSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
  };
  const verificationCheckedAt = assertFreshRehearsalBoundary(
    descriptor,
    admission,
    admissionWindow.expiresAt,
    now,
    { binding: verificationBinding, appendJournalImpl },
  );
  const verificationEntry = {
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_REHEARSAL_VERIFIED',
    event: 'verification',
    verifiedAt: verificationCheckedAt.toISOString(),
    ...verificationBinding,
  };
  appendRehearsalVerification(descriptor, verificationEntry, {
    appendJournalImpl,
  });
  assertFreshRehearsalBoundary(
    descriptor,
    admission,
    admissionWindow.expiresAt,
    now,
    { binding: verificationBinding, appendJournalImpl },
  );
  const receiptBytes = canonicalReceiptBytes(receipt);
  let publishFailed = false;
  let publicationReadbackEligible = false;
  try {
    publishReceiptImpl(pendingReceiptFile, receiptFile);
  } catch (error) {
    publishFailed = true;
    publicationReadbackEligible = safeTrue(error, 'publicationReadbackEligible');
  }
  if ((publishFailed && !publicationReadbackEligible)
    || !publishedReceiptMatches(receiptFile, receiptBytes)) {
    appendRehearsalTerminal(
      descriptor,
      admission,
      'SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED',
      now,
      { appendJournalImpl },
    );
    fail('SUCCESSOR_REHEARSAL_RECEIPT_PUBLISH_FAILED');
  }
  const publicationCheckedAt = assertFreshRehearsalBoundary(
    descriptor,
    admission,
    admissionWindow.expiresAt,
    now,
    { binding: verificationBinding, appendJournalImpl },
  );
  const publicationEntry = {
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_REHEARSAL_PUBLICATION_CONFIRMED',
    event: 'publication',
    publishedAt: publicationCheckedAt.toISOString(),
    ...verificationBinding,
  };
  let publicationAuditReadback = 'confirmed';
  try {
    appendJournalImpl(descriptor, publicationEntry);
  } catch (error) {
    publicationAuditReadback = safeTrue(error, 'publicationAuditReadbackEligible') && publishedJournalMatches(
      journalFile,
      [startedEntry, verificationEntry, publicationEntry],
    ) ? 'reconciled' : 'unconfirmed';
    try { closeSync(descriptor); } catch { /* append implementation may already have closed it */ }
    if (publicationAuditReadback === 'unconfirmed') fail('SUCCESSOR_JOURNAL_APPEND_FAILED');
  }
  assertAdmissionFresh(admissionWindow.expiresAt, now());
  return Object.freeze({
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_REHEARSAL_PASSED',
    publicationAuditReadback,
    receiptSha256,
    publicationReadback: publishFailed ? 'reconciled' : 'confirmed',
    sourceRevision: admission.sourceRevision,
    status: 'rolled_back',
  });
}

export function runReviewMediaSuccessor({
  admissionPath,
  journalPath,
  environment = process.env,
}, {
  now = () => new Date(),
  gitFactsImpl = currentSuccessorGitFacts,
  loadManifestImpl = loadSuccessorManifest,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  rollbackReadbackImpl = captureVercelRollbackReadbackSync,
  runPsqlImpl,
  fsyncImpl = fsyncSync,
  appendJournalImpl = appendJournal,
} = {}) {
  const manifestRecord = loadManifestImpl();
  assertLaunchReady(manifestRecord.manifest);
  const admissionFile = assertPrivateAdmissionPath(admissionPath);
  const admissionBytes = readFileSync(admissionFile);
  const admission = parseJsonObject(admissionBytes, 'SUCCESSOR_ADMISSION_INVALID');
  const admissionWindow = validateSuccessorAdmission(admission, manifestRecord, {
    now: now(),
    receiptDirectory: dirname(admissionFile),
  });
  assertCheckout(admission, gitFactsImpl());
  assertProtectedSourceReadback(
    admission,
    manifestRecord.manifest,
    protectedMainReadbackImpl(manifestRecord.manifest),
  );
  let rollbackReadback;
  try {
    rollbackReadback = rollbackReadbackImpl({
      expected: {
        deploymentId: admission.rollback.deploymentId,
        deploymentUrl: admission.rollback.deploymentUrl,
        gitRef: admission.rollback.gitRef,
        gitSha: admission.rollback.deploymentSha,
      },
      now,
    });
  } catch {
    fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  }
  const rollbackCheckedAt = now();
  assertAdmissionFresh(admissionWindow.expiresAt, rollbackCheckedAt);
  try {
    assertLiveRollbackReadback(admission, rollbackReadback, {
      ...admissionWindow,
      checkedAt: rollbackCheckedAt,
    });
  } catch {
    fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  }
  const journalFile = assertJournalPath(journalPath);
  if (sha256(Buffer.from(journalFile)) !== admission.journalPathSha256) fail('SUCCESSOR_JOURNAL_BINDING_MISMATCH');
  const plan = compileSuccessorPlan(manifestRecord, admission);
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, manifestRecord.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });

  let observed;
  try {
    const preflightAt = now();
    assertAdmissionFresh(admissionWindow.expiresAt, preflightAt);
    const timeoutMs = Math.min(PREFLIGHT_TIMEOUT_MS, admissionWindow.expiresAt - preflightAt.getTime());
    const preflightSql = [
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
      'SET LOCAL standard_conforming_strings=on;',
      "SET LOCAL lock_timeout='2s';",
      "SET LOCAL statement_timeout='15s';",
      "SET LOCAL idle_in_transaction_session_timeout='30s';",
      successorExpirySql(admission, 'preflight', {
        armTransactionTimeout: true,
        maxTransactionTimeoutMs: PREFLIGHT_TIMEOUT_MS,
      }),
      `${plan.stateQuery};`,
      successorExpirySql(admission, 'post-preflight'),
    ].join('\n');
    observed = parseReadback(transport(
      databaseUrl,
      preflightSql,
      true,
      { timeoutMs },
    ));
  } catch (error) {
    throw boundedSuccessorError(error);
  }
  if (!equal(observed, plan.priorReadback.expected)) fail('SUCCESSOR_PREFLIGHT_MISMATCH');

  let finalRollbackReadback;
  try {
    finalRollbackReadback = rollbackReadbackImpl({
      expected: {
        deploymentId: admission.rollback.deploymentId,
        deploymentUrl: admission.rollback.deploymentUrl,
        gitRef: admission.rollback.gitRef,
        gitSha: admission.rollback.deploymentSha,
      },
      now,
    });
  } catch {
    fail('SUCCESSOR_ROLLBACK_READBACK_INVALID');
  }
  const finalRollbackCheckedAt = now();
  assertAdmissionFresh(admissionWindow.expiresAt, finalRollbackCheckedAt);
  assertLiveRollbackReadback(admission, finalRollbackReadback, {
    ...admissionWindow,
    checkedAt: finalRollbackCheckedAt,
  });

  const admissionSha256 = sha256(admissionBytes);
  assertDurableRehearsalArtifacts(dirname(admissionFile), admission, fsyncImpl);
  const startedEntry = {
    admissionSha256,
    attemptId: admission.attemptId,
    event: 'started',
    manifestSha256: manifestRecord.manifestSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    startedAt: now().toISOString(),
  };
  const descriptor = writeJournalStart(journalFile, startedEntry, { fsyncImpl });
  let result;
  try {
    assertAdmissionFresh(admissionWindow.expiresAt, now());
    result = executeMigrationBundle(databaseUrl, plan, { runPsqlImpl: transport });
  } catch (error) {
    const bounded = boundedSuccessorError(error);
    try {
      appendJournalImpl(descriptor, {
        attemptId: admission.attemptId,
        code: bounded.code,
        completedAt: now().toISOString(),
        event: 'terminal',
      });
    } catch {
      try { closeSync(descriptor); } catch { /* append may already have closed it */ }
      throw journalFailure(bounded.code);
    }
    throw bounded;
  }
  const terminalEntry = {
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_COMMITTED',
    completedAt: now().toISOString(),
    event: 'terminal',
  };
  let terminalAuditReadback = 'confirmed';
  try {
    appendJournalImpl(descriptor, terminalEntry);
  } catch (error) {
    terminalAuditReadback = safeTrue(error, 'publicationAuditReadbackEligible') && publishedJournalMatches(
      journalFile,
      [startedEntry, terminalEntry],
    ) ? 'reconciled' : 'unconfirmed';
    try { closeSync(descriptor); } catch { /* append implementation may already have closed it */ }
    if (terminalAuditReadback === 'unconfirmed') throw journalFailure('SUCCESSOR_COMMITTED');
  }
  return Object.freeze({
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_COMMITTED',
    sourceRevision: admission.sourceRevision,
    status: 'committed',
    terminalAuditReadback,
    terminal: result,
  });
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--admission', '--journal'].includes(option) || !value || value.startsWith('--') || option.slice(2) in result) {
      fail('SUCCESSOR_ARGUMENT_INVALID');
    }
    result[option.slice(2)] = value;
  }
  if (argv.length !== 4 || !result.admission || !result.journal) fail('SUCCESSOR_ARGUMENT_INVALID');
  return result;
}

export function main(argv = process.argv.slice(2), dependencies) {
  const args = parseArguments(argv);
  return runReviewMediaSuccessor({
    admissionPath: args.admission,
    journalPath: args.journal,
  }, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(main()));
  } catch (error) {
    console.error(JSON.stringify(successorFailureResult(error)));
    process.exitCode = 1;
  }
}
