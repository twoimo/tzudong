/** Local-only controller for the dedicated five-stage admin-record successor. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
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
  compileFiveMigrationBundle,
  executeMigrationBundle,
  fiveMigrationBundleSuffixRoot,
} from './supabase-migration-bundle.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const SUCCESSOR_MANIFEST_PATH = resolve(REPOSITORY_ROOT, '.github/admin-record-sql-successor.v1.json');

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const PURPOSE = 'admin-record-current-state-five-stage';
const ADMISSION_MAX_AGE_MS = 15 * 60 * 1000;
const PRIVATE_RECEIPT_FILES = Object.freeze({
  protectedMain: 'protected-main-receipt.json',
  rehearsal: 'rehearsal-receipt.json',
  rollback: 'rollback-readback-receipt.json',
  source: 'source-receipt.json',
});
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
  'SUCCESSOR_SOURCE_DRIFT',
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

function safeCode(error) {
  try { return typeof error?.code === 'string' ? error.code : ''; } catch { return ''; }
}

export function boundedSuccessorError(error) {
  const code = safeCode(error);
  if (FIXED_CONTROLLER_CODES.has(code)) return operationError(code);
  return boundedMigrationError(error);
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
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
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
    'projectRef',
    'protectedSource',
    'purpose',
    'requiredWriterFences',
    'schemaVersion',
    'serverMajor',
    'sourceRoot',
    'stateRootAlgorithm',
    'toolchain',
  ], 'SUCCESSOR_MANIFEST_INVALID');
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'admin_record_sql_successor_v1'
    || manifest.purpose !== PURPOSE
    || manifest.projectRef !== PROJECT_REF
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.serverMajor !== 17
    || manifest.advisoryLockKey !== '7311754282260165'
    || manifest.stateRootAlgorithm !== 'admin-record-successor-state/v1'
    || !Array.isArray(manifest.migrations)
    || manifest.migrations.length !== 5) fail('SUCCESSOR_MANIFEST_INVALID');
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
  assertToolchain(manifest);

  const expectedIds = [
    'admin_record_guarded_actions',
    'admin_evaluation_raw_warning_groups',
    'admin_evaluation_raw_warning_invoker_contract',
    'restaurant_review_manual_preview_eligibility',
    'admin_record_private_verification_cleanup',
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

export function buildSuccessorStateQuery(manifest, suffixRoot = fiveMigrationBundleSuffixRoot(manifest.migrations)) {
  const versions = manifest.migrations.map(migration => migration.version);
  const targetCount = manifest.migrations.length;
  const targetValues = versions.map(version => `(${quote(version)})`).join(',');
  const targets = versions.map(version => quote(version)).join(',');
  const exactRows = manifest.migrations.map(migration => `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)} AND name=${quote(migration.name)} AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(migration.originalStatementVector))}::jsonb)))`).join(' AND ');
  const schemas = "'public','pipeline_control','privacy_retention'";
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
   'relations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,${acl('c.relacl')} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'columns',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.attnum) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull,a.attidentity,a.attgenerated,coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN(${schemas}) AND a.attnum>0 AND NOT a.attisdropped) x),'[]'::jsonb),
   'constraints',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.constraint_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,k.conname AS constraint_name,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'indexes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.index_name) FROM (SELECT n.nspname AS schema_name,c.relname AS index_name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'triggers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.trigger_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,t.tgname AS trigger_name,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas}) AND NOT t.tgisinternal) x),'[]'::jsonb),
   'policies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema_name,x.relation_name,x.policy_name) FROM (SELECT n.nspname AS schema_name,c.relname AS relation_name,p.polname AS policy_name,p.polcmd,p.polpermissive,ARRAY(SELECT coalesce(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY coalesce(r.rolname,'PUBLIC')) AS roles,coalesce(pg_get_expr(p.polqual,p.polrelid),'') AS using_expression,coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'functions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signature) FROM (SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,format_type(p.prorettype,NULL) AS result_type,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,coalesce(p.proconfig,'{}'::text[]) AS config,${acl('p.proacl')} AS acl,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN(${schemas})) x),'[]'::jsonb),
   'roles',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name) FROM (SELECT r.rolname AS role_name,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls FROM pg_roles r) x),'[]'::jsonb),
   'memberships',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role_name,x.member_name) FROM (SELECT role.rolname AS role_name,member.rolname AS member_name,m.admin_option FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member) x),'[]'::jsonb),
   'defaultAcls',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.owner,x.schema_name,x.object_type) FROM (SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'') AS schema_name,d.defaclobjtype AS object_type,${acl('d.defaclacl')} AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) x),'[]'::jsonb)
  )::text AS material
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
   'ledgerRoot',encode(sha256(convert_to(ledger_all.material,'UTF8')),'hex'),
   'reviewItems',(SELECT count(*)::int FROM pipeline_control.restaurant_review_items),
   'reviewPolicyEnabled',coalesce((SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton),true),
   'reviewRuns',(SELECT count(*)::int FROM pipeline_control.restaurant_review_runs),
   'schemaRoot',encode(sha256(convert_to(catalog_material.material,'UTF8')),'hex'),
   'serverMajor',(current_setting('server_version_num')::int/10000),
   'sessionUser',session_user
  )
 )::text AS state
 FROM ledger_prefix,ledger_all,target_state,catalog_material) AS successor_state`;
}

function validateStageState(stage, index, manifest, suffixRoot, priorCount, prefixRoot) {
  exactKeys(stage, ['bundle', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(stage.bundle, ['ledgerCount', 'prefixRoot', 'priorCount', 'suffixRoot', 'targetCount'], 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(stage.state, [
    'activeReviewItems',
    'currentUser',
    'databaseName',
    'ledgerRoot',
    'reviewItems',
    'reviewPolicyEnabled',
    'reviewRuns',
    'schemaRoot',
    'serverMajor',
    'sessionUser',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (stage.bundle.ledgerCount !== priorCount + index
    || stage.bundle.priorCount !== priorCount
    || stage.bundle.prefixRoot !== prefixRoot
    || stage.bundle.targetCount !== index
    || stage.bundle.suffixRoot !== (index === manifest.migrations.length ? suffixRoot : null)
    || stage.state.activeReviewItems !== 0
    || stage.state.currentUser !== manifest.executorRole
    || stage.state.databaseName !== manifest.databaseName
    || stage.state.reviewItems !== 0
    || stage.state.reviewPolicyEnabled !== false
    || stage.state.reviewRuns !== 0
    || stage.state.serverMajor !== manifest.serverMajor
    || stage.state.sessionUser !== manifest.executorRole) fail('SUCCESSOR_ADMISSION_INVALID');
  assertHex(stage.state.ledgerRoot, 'SUCCESSOR_ADMISSION_INVALID');
  assertHex(stage.state.schemaRoot, 'SUCCESSOR_ADMISSION_INVALID');
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

function assertReceiptWindow(receipt, admission, createdAt, expiresAt, nowMs) {
  if (receipt.expiresAt !== admission.expiresAt) fail('SUCCESSOR_ADMISSION_INVALID');
  const observedAt = Date.parse(receipt.observedAt);
  if (!Number.isFinite(observedAt)
    || observedAt < createdAt
    || observedAt > nowMs + 30_000
    || Date.parse(receipt.expiresAt) !== expiresAt) fail('SUCCESSOR_ADMISSION_INVALID');
}

function validatePrivateReceipts(admission, manifestRecord, {
  createdAt,
  expiresAt,
  nowMs,
  receiptDirectory,
}) {
  const { manifest, manifestSha256 } = manifestRecord;
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

  const rehearsal = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.rehearsal,
    admission.rehearsalReceiptSha256,
  );
  exactKeys(rehearsal, [
    'expiresAt', 'id', 'kind', 'manifestSha256', 'observedAt', 'passed', 'projectRef',
    'purpose', 'schemaVersion', 'serverVersionNum', 'sourceRevision', 'sourceRoot',
    'stageStatesSha256', 'suffixRoot',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!common(rehearsal)
    || rehearsal.kind !== 'successor-rehearsal-receipt'
    || rehearsal.passed !== true
    || !Number.isSafeInteger(rehearsal.serverVersionNum)
    || Math.floor(rehearsal.serverVersionNum / 10_000) !== manifest.serverMajor
    || rehearsal.sourceRoot !== manifest.sourceRoot
    || rehearsal.suffixRoot !== fiveMigrationBundleSuffixRoot(manifest.migrations)
    || rehearsal.stageStatesSha256 !== sha256(JSON.stringify(canonical(admission.stageStates)))) {
    fail('SUCCESSOR_ADMISSION_INVALID');
  }
  assertReceiptWindow(rehearsal, admission, createdAt, expiresAt, nowMs);

  const rollback = readPrivateCanonicalReceipt(
    receiptDirectory,
    PRIVATE_RECEIPT_FILES.rollback,
    admission.rollback.readbackSha256,
  );
  exactKeys(rollback, [
    'deploymentSha', 'deploymentUrl', 'expiresAt', 'id', 'kind', 'manifestSha256',
    'observedAt', 'projectRef', 'purpose', 'schemaVersion', 'sourceRevision', 'state',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (!common(rollback)
    || rollback.kind !== 'rollback-readback-receipt'
    || rollback.deploymentSha !== admission.rollback.deploymentSha
    || rollback.deploymentUrl !== admission.rollback.deploymentUrl
    || rollback.state !== admission.rollback.state) fail('SUCCESSOR_ADMISSION_INVALID');
  assertReceiptWindow(rollback, admission, createdAt, expiresAt, nowMs);

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

export function validateSuccessorAdmission(admission, manifestRecord, {
  now = new Date(),
  receiptDirectory,
} = {}) {
  const { manifest, manifestSha256 } = manifestRecord;
  exactKeys(admission, [
    'attemptId',
    'createdAt',
    'expiresAt',
    'id',
    'journalPathSha256',
    'manifestSha256',
    'projectRef',
    'protectedMainReceiptSha256',
    'purpose',
    'rehearsalReceiptSha256',
    'rollback',
    'schemaVersion',
    'sourceReceiptSha256',
    'sourceRevision',
    'sourceRoot',
    'stageStates',
    'writerFences',
  ], 'SUCCESSOR_ADMISSION_INVALID');
  if (admission.schemaVersion !== 1
    || admission.id !== manifest.id
    || admission.purpose !== manifest.purpose
    || admission.projectRef !== manifest.projectRef
    || admission.manifestSha256 !== manifestSha256
    || admission.sourceRoot !== manifest.sourceRoot
    || !UUID.test(admission.attemptId)
    || !REVISION.test(admission.sourceRevision)) fail('SUCCESSOR_ADMISSION_INVALID');
  for (const field of ['protectedMainReceiptSha256', 'rehearsalReceiptSha256', 'sourceReceiptSha256']) {
    assertHex(admission[field], 'SUCCESSOR_ADMISSION_INVALID');
  }
  assertHex(admission.journalPathSha256, 'SUCCESSOR_ADMISSION_INVALID');
  exactKeys(admission.rollback, ['deploymentSha', 'deploymentUrl', 'readbackSha256', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
  if (!REVISION.test(admission.rollback.deploymentSha)) fail('SUCCESSOR_ADMISSION_INVALID');
  assertHex(admission.rollback.readbackSha256, 'SUCCESSOR_ADMISSION_INVALID');
  let rollbackUrl;
  try { rollbackUrl = new URL(admission.rollback.deploymentUrl); } catch { fail('SUCCESSOR_ADMISSION_INVALID'); }
  if (rollbackUrl.protocol !== 'https:'
    || !rollbackUrl.hostname.endsWith('.vercel.app')
    || rollbackUrl.pathname !== '/'
    || rollbackUrl.port
    || rollbackUrl.username
    || rollbackUrl.password
    || rollbackUrl.search
    || rollbackUrl.hash
    || admission.rollback.state !== 'ready') fail('SUCCESSOR_ADMISSION_INVALID');

  const createdAt = Date.parse(admission.createdAt);
  const expiresAt = Date.parse(admission.expiresAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || expiresAt - createdAt > ADMISSION_MAX_AGE_MS
    || createdAt > nowMs + 30_000
    || nowMs > expiresAt) fail('SUCCESSOR_ADMISSION_EXPIRED');

  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(admission.writerFences, fenceKeys, 'SUCCESSOR_ADMISSION_INVALID');
  for (const key of fenceKeys) {
    const fence = admission.writerFences[key];
    exactKeys(fence, ['evidenceSha256', 'state'], 'SUCCESSOR_ADMISSION_INVALID');
    if (fence.state !== manifest.requiredWriterFences[key]) fail('SUCCESSOR_ADMISSION_INVALID');
    assertHex(fence.evidenceSha256, 'SUCCESSOR_ADMISSION_INVALID');
  }

  if (!Array.isArray(admission.stageStates)
    || admission.stageStates.length !== manifest.migrations.length + 1) fail('SUCCESSOR_ADMISSION_INVALID');
  const suffixRoot = fiveMigrationBundleSuffixRoot(manifest.migrations);
  const priorCount = admission.stageStates[0]?.bundle?.priorCount;
  const prefixRoot = admission.stageStates[0]?.bundle?.prefixRoot;
  if (!Number.isSafeInteger(priorCount) || priorCount < 0) fail('SUCCESSOR_ADMISSION_INVALID');
  assertHex(prefixRoot, 'SUCCESSOR_ADMISSION_INVALID');
  admission.stageStates.forEach((stage, index) => validateStageState(
    stage,
    index,
    manifest,
    suffixRoot,
    priorCount,
    prefixRoot,
  ));
  const ledgerRoots = admission.stageStates.map(stage => stage.state.ledgerRoot);
  if (new Set(ledgerRoots).size !== ledgerRoots.length) fail('SUCCESSOR_ADMISSION_INVALID');
  validatePrivateReceipts(admission, manifestRecord, {
    createdAt,
    expiresAt,
    nowMs,
    receiptDirectory,
  });
  return Object.freeze({ createdAt, expiresAt, prefixRoot, priorCount, suffixRoot });
}

export function assertLaunchReady(manifest) {
  if (manifest.launchPolicy.state !== 'ready') fail('SUCCESSOR_LAUNCH_HELD');
}

export function compileSuccessorPlan(manifestRecord, admission) {
  const { manifest, materials } = manifestRecord;
  const suffixRoot = fiveMigrationBundleSuffixRoot(manifest.migrations);
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
  const compiled = compileFiveMigrationBundle({
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
  const guardedSql = `SET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${manifest.advisoryLockKey}::bigint); END ${lockTag};\n${compiled.sql}`;
  return Object.freeze({
    ...compiled,
    sql: guardedSql,
    stateQuery,
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

function writeJournalStart(path, entry) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeSync(descriptor, `${JSON.stringify(canonical(entry))}\n`);
    fsyncSync(descriptor);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (safeCode(error) === 'EEXIST') fail('SUCCESSOR_JOURNAL_EXISTS');
    fail('SUCCESSOR_JOURNAL_INVALID');
  }
}

function appendJournal(descriptor, entry) {
  try {
    writeSync(descriptor, `${JSON.stringify(canonical(entry))}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
  } catch {
    try { closeSync(descriptor); } catch { /* fixed outcome below */ }
    fail('SUCCESSOR_JOURNAL_APPEND_FAILED');
  }
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

export function currentProtectedMainReadback(manifest, { repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (!manifest?.protectedSource) fail('SUCCESSOR_CHECKOUT_INVALID');
  const run = args => {
    const result = spawnSync('/usr/bin/git', args, { cwd: repositoryRoot, encoding: 'utf8' });
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
  const error = operationError(sqlstate ? `MIGRATION_PSQL_FAILED_${sqlstate}` : 'MIGRATION_PSQL_FAILED');
  error.fixedSqlCode = /ERROR:\s+(?:[0-9A-Z]{5}:\s*)?(MIGRATION_[A-Z0-9_]{1,96})\b/m.exec(stderr)?.[1];
  return error;
}

export function createSuccessorPsqlRunner(databaseUrl, {
  environment = process.env,
  psql = environment.TZUDONG_SUCCESSOR_PSQL || 'psql',
  spawnImpl = spawnSync,
} = {}) {
  return (_databaseUrl, sql, singleTransaction) => {
    const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'];
    if (singleTransaction) args.splice(1, 0, '--single-transaction');
    args.push('--file=-');
    const result = spawnImpl(psql, args, {
      encoding: 'utf8',
      env: psqlConnectionEnvironment(databaseUrl, environment),
      input: `\\set VERBOSITY verbose\n${sql}`,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw transportError(result);
    return result.stdout || '';
  };
}

function parseReadback(output) {
  if (typeof output !== 'string' || !output.trim()) fail('SUCCESSOR_READBACK_INVALID');
  return parseJsonObject(output.trim(), 'SUCCESSOR_READBACK_INVALID');
}

export function runAdminRecordSuccessor({
  admissionPath,
  journalPath,
  environment = process.env,
}, {
  now = () => new Date(),
  gitFactsImpl = currentSuccessorGitFacts,
  loadManifestImpl = loadSuccessorManifest,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  runPsqlImpl,
} = {}) {
  const manifestRecord = loadManifestImpl();
  assertLaunchReady(manifestRecord.manifest);
  const admissionFile = assertPrivateAdmissionPath(admissionPath);
  const admissionBytes = readFileSync(admissionFile);
  const admission = parseJsonObject(admissionBytes, 'SUCCESSOR_ADMISSION_INVALID');
  validateSuccessorAdmission(admission, manifestRecord, {
    now: now(),
    receiptDirectory: dirname(admissionFile),
  });
  assertCheckout(admission, gitFactsImpl());
  assertProtectedSourceReadback(
    admission,
    manifestRecord.manifest,
    protectedMainReadbackImpl(manifestRecord.manifest),
  );
  const journalFile = assertJournalPath(journalPath);
  if (sha256(Buffer.from(journalFile)) !== admission.journalPathSha256) fail('SUCCESSOR_JOURNAL_BINDING_MISMATCH');
  const plan = compileSuccessorPlan(manifestRecord, admission);
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, manifestRecord.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });

  let observed;
  try {
    observed = parseReadback(transport(
      databaseUrl,
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${plan.stateQuery};`,
      true,
    ));
  } catch (error) {
    throw boundedSuccessorError(error);
  }
  if (!equal(observed, plan.priorReadback.expected)) fail('SUCCESSOR_PREFLIGHT_MISMATCH');

  const admissionSha256 = sha256(admissionBytes);
  const descriptor = writeJournalStart(journalFile, {
    admissionSha256,
    attemptId: admission.attemptId,
    event: 'started',
    manifestSha256: manifestRecord.manifestSha256,
    sourceRevision: admission.sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    startedAt: now().toISOString(),
  });
  let result;
  try {
    result = executeMigrationBundle(databaseUrl, plan, { runPsqlImpl: transport });
  } catch (error) {
    const bounded = boundedSuccessorError(error);
    appendJournal(descriptor, {
      attemptId: admission.attemptId,
      code: bounded.code,
      completedAt: now().toISOString(),
      event: 'terminal',
    });
    throw bounded;
  }
  appendJournal(descriptor, {
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_COMMITTED',
    completedAt: now().toISOString(),
    event: 'terminal',
  });
  return Object.freeze({
    attemptId: admission.attemptId,
    code: 'SUCCESSOR_COMMITTED',
    sourceRevision: admission.sourceRevision,
    status: 'committed',
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
  return runAdminRecordSuccessor({
    admissionPath: args.admission,
    journalPath: args.journal,
  }, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(main()));
  } catch (error) {
    const bounded = boundedSuccessorError(error);
    console.error(JSON.stringify({ code: bounded.code, status: 'failed' }));
    process.exitCode = 1;
  }
}
