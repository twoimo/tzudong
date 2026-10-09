/** Dedicated held successor for the post-five admin user-management RPC forward. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundedMigrationError,
  readOriginalStatementVector,
  selectDirectDatabaseTransport,
} from './apply-supabase-migration.mjs';
import {
  atomicMigrationSql,
  migrationEnvelope,
  reconciliationOutcome,
  reconciliationSql,
  statementSpans,
} from './supabase-migration-transaction.mjs';
import {
  assertSuccessorDatabaseTarget,
  createSuccessorPsqlRunner,
} from './admin-record-sql-successor.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
export const FORWARD_MANIFEST_PATH = resolve(REPOSITORY_ROOT, '.github/admin-user-rpc-forward-successor.v1.json');

const PURPOSE = 'admin-user-rpc-post-five-forward';
const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const HEX = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const MAX_ADMISSION_AGE_MS = 15 * 60 * 1000;
const FIVE_IDS = [
  'admin_record_guarded_actions',
  'admin_evaluation_raw_warning_groups',
  'admin_evaluation_raw_warning_invoker_contract',
  'restaurant_review_manual_preview_eligibility',
  'admin_record_private_verification_cleanup',
];
const TARGET_SIGNATURES = [
  'public.read_admin_user_management_metadata(uuid[])',
  'public.read_admin_user_audit_events(integer)',
  'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)',
];
const TARGET_NAMES = [
  'read_admin_user_management_metadata',
  'read_admin_user_audit_events',
  'append_admin_user_audit_event',
];
const TARGET_BODY_HASHES = [
  'c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656',
  'b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e',
  '2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6',
];
const POST_FIVE_FUNCTIONS = [
  ['pipeline_control.admin_record_review_media(jsonb)', 'e2e2aea7a72440b151d69ceea13dab5855ba691199f74e065a2850b848004d99', ['search_path=""'], false],
  ['pipeline_control.admin_record_snapshot(text,uuid[])', '7132001985972c0e0fece15782ba7aac68338508f04ef3365733024a7c975cd5', ['search_path=""'], false],
  ['pipeline_control.admin_record_storage_snapshot(text,text)', '952f92d709f60b7f47168e0f4f6ff1b141ceae23f7cf3632db760f4ea2cd541d', ['search_path=""'], false],
  ['pipeline_control.lock_restaurant_review_catalog_revision()', '5fe3230899d7669896f562b5a7afa5e088761b3ecc26f531c13cf0953a569413', ['search_path=""', 'lock_timeout=2s'], true],
  ['pipeline_control.restaurant_review_manual_preview(uuid,text)', '2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1', ['search_path=""'], false],
  ['public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)', '7a73f41ceaf7e8cf106e073e6f2ee791aeaafd16d8a6d2a6d11af3d1a8289304', ['search_path=""'], false],
  ['public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)', 'ab9c11c438e482bcdd1373ec3bb43a2abf579f535aad919a18a452930ec1912c', ['search_path=""'], false],
  ['public.restaurant_review_automation_manual(uuid,text,text,text,uuid)', 'b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1', ['search_path=""', 'lock_timeout=2s'], false],
];
const POST_FIVE_ASSERTIONS = [
  ['privacy_retention.assert_g014_catalog_contract()', '50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01', true],
  ['privacy_retention.assert_g014_definer_contract()', 'b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a', true],
  ['privacy_retention.assert_g014_public_rpc_allowlist()', 'f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef', true],
  ['privacy_retention.assert_g014_workflow_owner_contract()', '345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d', false],
];

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

function exactKeys(value, keys, code = 'FORWARD_MANIFEST_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function parseObject(bytes, code) {
  let value;
  try { value = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes); } catch { fail(code); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function assertHex(value, code) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(code);
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

function validateFixedSource(entry, code) {
  exactKeys(entry, ['bytes', 'path', 'sha256'], code);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) fail(code);
  assertHex(entry.sha256, code);
  const bytes = readFileSync(resolve(REPOSITORY_ROOT, entry.path));
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail('FORWARD_SOURCE_DRIFT');
  return bytes;
}

export function loadForwardManifest({
  manifestPath = FORWARD_MANIFEST_PATH,
  readVectorImpl = readOriginalStatementVector,
} = {}) {
  if (resolve(manifestPath) !== FORWARD_MANIFEST_PATH) fail('FORWARD_MANIFEST_INVALID');
  const bytes = readFileSync(manifestPath);
  const manifest = parseObject(bytes, 'FORWARD_MANIFEST_INVALID');
  exactKeys(manifest, [
    'acceptedSource', 'advisoryLockKey', 'databaseName', 'executorRole', 'fiveStage',
    'id', 'launchPolicy', 'migration', 'operatingTransition', 'projectRef',
    'protectedSource', 'purpose', 'runner', 'schemaVersion', 'serverVersionNum',
    'stateRootAlgorithm', 'toolchain',
  ]);
  if (manifest.schemaVersion !== 1
    || manifest.id !== 'admin_user_rpc_forward_successor_v1'
    || manifest.purpose !== PURPOSE
    || manifest.projectRef !== PROJECT_REF
    || manifest.databaseName !== 'postgres'
    || manifest.executorRole !== 'postgres'
    || manifest.serverVersionNum !== 170006
    || manifest.advisoryLockKey !== '7311754282260165'
    || manifest.stateRootAlgorithm !== 'admin-user-rpc-forward-state/v1') fail('FORWARD_MANIFEST_INVALID');
  exactKeys(manifest.launchPolicy, ['code', 'reason', 'state']);
  if (!['held', 'ready'].includes(manifest.launchPolicy.state)
    || manifest.launchPolicy.code !== 'FORWARD_LAUNCH_HELD'
    || manifest.launchPolicy.reason !== 'fresh-protected-source-and-operating-readback-required') {
    fail('FORWARD_MANIFEST_INVALID');
  }
  exactKeys(manifest.protectedSource, ['ref', 'remote', 'repositoryUrl']);
  if (manifest.protectedSource.remote !== 'origin'
    || manifest.protectedSource.repositoryUrl !== 'https://github.com/twoimo/tzudong.git'
    || manifest.protectedSource.ref !== 'refs/heads/main') fail('FORWARD_MANIFEST_INVALID');
  exactKeys(manifest.operatingTransition, ['afterFive', 'afterForward', 'beforeFive']);
  if (!equal(manifest.operatingTransition, { beforeFive: 80, afterFive: 85, afterForward: 86 })) {
    fail('FORWARD_MANIFEST_INVALID');
  }
  exactKeys(manifest.runner, ['export', 'module']);
  if (manifest.runner.module !== 'apps/web/scripts/admin-record-sql-successor.mjs'
    || manifest.runner.export !== 'createSuccessorPsqlRunner') fail('FORWARD_MANIFEST_INVALID');

  const expectedToolchain = [
    'apps/web/scripts/admin-record-sql-successor.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
  ];
  if (!Array.isArray(manifest.toolchain)
    || !equal(manifest.toolchain.map(entry => entry?.path), expectedToolchain)) {
    fail('FORWARD_MANIFEST_INVALID');
  }
  for (const entry of manifest.toolchain) {
    exactKeys(entry, ['path', 'sha256']);
    assertHex(entry.sha256, 'FORWARD_MANIFEST_INVALID');
    if (sha256(readFileSync(resolve(REPOSITORY_ROOT, entry.path))) !== entry.sha256) {
      fail('FORWARD_TOOLCHAIN_DRIFT');
    }
  }

  validateFixedSource(manifest.acceptedSource, 'FORWARD_MANIFEST_INVALID');
  exactKeys(manifest.fiveStage, ['entries', 'path', 'sha256', 'sourceRoot']);
  if (manifest.fiveStage.path !== '.github/admin-record-sql-successor.v1.json'
    || manifest.fiveStage.entries !== 5) fail('FORWARD_MANIFEST_INVALID');
  assertHex(manifest.fiveStage.sha256, 'FORWARD_MANIFEST_INVALID');
  assertHex(manifest.fiveStage.sourceRoot, 'FORWARD_MANIFEST_INVALID');
  const fiveBytes = readFileSync(resolve(REPOSITORY_ROOT, manifest.fiveStage.path));
  if (sha256(fiveBytes) !== manifest.fiveStage.sha256) fail('FORWARD_SOURCE_DRIFT');
  const fiveManifest = parseObject(fiveBytes, 'FORWARD_SOURCE_DRIFT');
  if (fiveManifest.sourceRoot !== manifest.fiveStage.sourceRoot
    || !Array.isArray(fiveManifest.migrations)
    || fiveManifest.migrations.length !== 5) fail('FORWARD_SOURCE_DRIFT');
  const fiveMaterials = fiveManifest.migrations.map((migration, index) => {
    if (migration.id !== FIVE_IDS[index]
      || migration.version !== /^backend\/supabase\/migrations\/(\d{14})_/.exec(migration.path)?.[1]
      || !Array.isArray(migration.originalStatementVector)
      || migration.originalStatementVector.length !== migration.statementCount
      || sha256(JSON.stringify(migration.originalStatementVector)) !== migration.statementVectorSha256) {
      fail('FORWARD_SOURCE_DRIFT');
    }
    const sourceBytes = readFileSync(resolve(REPOSITORY_ROOT, migration.path));
    if (sourceBytes.length !== migration.bytes || sha256(sourceBytes) !== migration.sha256) fail('FORWARD_SOURCE_DRIFT');
    const vector = readVectorImpl(migration, sourceBytes);
    if (!equal(vector, migration.originalStatementVector)) fail('FORWARD_SOURCE_DRIFT');
    return { path: migration.path, bytes: sourceBytes, originalVector: vector };
  });
  if (sha256(JSON.stringify(fiveManifest.migrations.map(sourceProjection))) !== fiveManifest.sourceRoot) {
    fail('FORWARD_SOURCE_DRIFT');
  }

  exactKeys(manifest.migration, [
    'bytes', 'id', 'name', 'path', 'sha256', 'statementCount',
    'statementVectorSha256', 'version',
  ]);
  const migration = manifest.migration;
  const pathMatch = /^backend\/supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(migration.path);
  if (migration.id !== 'admin_user_management_rpc_forward'
    || !pathMatch
    || migration.version !== pathMatch[1]
    || migration.name !== pathMatch[2]
    || migration.id !== migration.name
    || migration.statementCount !== 2
    || !Number.isSafeInteger(migration.bytes)
    || migration.bytes <= 0) fail('FORWARD_MANIFEST_INVALID');
  assertHex(migration.sha256, 'FORWARD_MANIFEST_INVALID');
  assertHex(migration.statementVectorSha256, 'FORWARD_MANIFEST_INVALID');
  const sourceBytes = readFileSync(resolve(REPOSITORY_ROOT, migration.path));
  if (sourceBytes.length !== migration.bytes || sha256(sourceBytes) !== migration.sha256) fail('FORWARD_SOURCE_DRIFT');
  const originalVector = readVectorImpl(migration, sourceBytes);
  if (originalVector.length !== migration.statementCount
    || sha256(JSON.stringify(originalVector)) !== migration.statementVectorSha256) fail('FORWARD_SOURCE_DRIFT');

  return Object.freeze({
    bytes,
    fiveManifest,
    fiveMaterials: Object.freeze(fiveMaterials),
    manifest,
    manifestSha256: sha256(bytes),
    originalVector: Object.freeze(originalVector),
    sourceBytes,
  });
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(quote).join(',')}]::text[]`;
}

function exactAclPredicate(alias, owner) {
  return `(has_function_privilege('service_role',${alias}.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',${alias}.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',${alias}.oid,'EXECUTE')
    AND (SELECT count(*) FROM aclexplode(coalesce(${alias}.proacl,acldefault('f',${alias}.proowner))))=2
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(${alias}.proacl,acldefault('f',${alias}.proowner))) a
      WHERE a.grantee NOT IN (${owner}::regrole,'service_role'::regrole)
         OR a.privilege_type<>'EXECUTE' OR a.is_grantable))`;
}

function postFiveContractSql() {
  const functions = POST_FIVE_FUNCTIONS.map(([signature, body, config, definer]) =>
    `(${quote(signature)},${quote(body)},${sqlTextArray(config)},${definer})`).join(',');
  const assertions = POST_FIVE_ASSERTIONS.map(([signature, body, definer]) =>
    `(${quote(signature)},${quote(body)},${definer})`).join(',');
  return `(
    NOT EXISTS(
      SELECT 1 FROM (VALUES ${functions}) expected(signature,body_sha,config,security_definer)
      WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature)
        AND p.proowner='postgres'::regrole AND p.prosecdef=expected.security_definer
        AND p.proconfig IS NOT DISTINCT FROM expected.config
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
        AND ${exactAclPredicate('p', "'postgres'")})
    )
    AND NOT EXISTS(
      SELECT 1 FROM (VALUES ${assertions}) expected(signature,body_sha,security_definer)
      WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature)
        AND p.proowner='privacy_workflow_owner'::regrole
        AND p.prosecdef=expected.security_definer
        AND p.proconfig=ARRAY['search_path=""']::text[]
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
        AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=1
        AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>'privacy_workflow_owner'::regrole
             OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
    )
    AND (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature=ANY(ARRAY[
        'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
        'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)']))=2
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname LIKE 'pg_temp_%'
        AND p.proname IN ('admin_record_registration','admin_raw_warning_registration'))=0
    AND (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conname='admin_record_media_cleanup_bucket_check'
        AND c.conrelid=to_regclass('pipeline_control.admin_record_media_cleanup'))
      IS NOT DISTINCT FROM 'CHECK ((bucket = ANY (ARRAY[''review-photos''::text, ''review-verifications''::text])))'
  )`;
}

function membershipContractSql() {
  return `(
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
    AND (SELECT count(*) FROM pg_auth_members
      WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)=1
    AND EXISTS(SELECT 1 FROM pg_auth_members
      WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
        AND admin_option AND NOT inherit_option AND NOT set_option AND grantor<>'postgres'::regrole)
    AND NOT pg_has_role('postgres','privacy_workflow_owner','SET')
    AND NOT pg_has_role('postgres','privacy_workflow_owner','USAGE')
  )`;
}

function targetStateSql() {
  const bodyValues = TARGET_SIGNATURES.map((signature, index) =>
    `(${quote(signature)},${quote(TARGET_BODY_HASHES[index])})`).join(',');
  const signatures = TARGET_SIGNATURES.map(quote).join(',');
  const names = TARGET_NAMES.map(quote).join(',');
  const installed = `(
    (SELECT count(*) FROM pg_proc WHERE oid=ANY(ARRAY[${TARGET_SIGNATURES.map(value => `to_regprocedure(${quote(value)})`).join(',')}]))=3
    AND (SELECT count(*) FROM (VALUES ${bodyValues}) expected(signature,body_sha)
      JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef
        AND p.proconfig=ARRAY['search_path=""']::text[]
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
        AND ${exactAclPredicate('p', "'privacy_workflow_owner'")})=3
    AND (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist a
      JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature)
      WHERE a.source_signature=ANY(ARRAY[${signatures}])
        AND a.function_schema='public' AND a.function_name=p.proname
        AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')=3
  )`;
  const absent = `(
    (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[${names}]))=0
    AND (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature=ANY(ARRAY[${signatures}])
         OR (function_schema='public' AND function_name=ANY(ARRAY[${names}])))=0
  )`;
  return `CASE WHEN ${absent} THEN 'absent' WHEN ${installed} THEN 'installed' ELSE 'conflict' END`;
}

function protectedRootSql() {
  const postFiveProcedures = POST_FIVE_FUNCTIONS.map(([signature]) => `to_regprocedure(${quote(signature)})`).join(',');
  const assertionProcedures = POST_FIVE_ASSERTIONS.map(([signature]) => `to_regprocedure(${quote(signature)})`).join(',');
  const targetSignatures = TARGET_SIGNATURES.map(quote).join(',');
  return `encode(sha256(convert_to(jsonb_build_object(
    'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY oid),'[]'::jsonb) FROM pg_roles r
      WHERE rolname=ANY(ARRAY['postgres','privacy_workflow_owner','service_role','anon','authenticated'])),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)
      FROM pg_auth_members m WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole),
    'functions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p
      WHERE p.oid=ANY(ARRAY[${postFiveProcedures}])) ,
    'assertions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p
      WHERE p.oid=ANY(ARRAY[${assertionProcedures}])) ,
    'allowlist',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY source_signature),'[]'::jsonb)
      FROM privacy_retention.g014_public_rpc_allowlist a
      WHERE source_signature<>ALL(ARRAY[${targetSignatures}])),
    'manifest',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key),'[]'::jsonb)::text,'UTF8')),'hex')
      FROM privacy_retention.g014_catalog_contract_manifest m),
    'cleanupConstraint',(SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conname='admin_record_media_cleanup_bucket_check'
        AND c.conrelid=to_regclass('pipeline_control.admin_record_media_cleanup'))
  )::text,'UTF8')),'hex')`;
}

function fiveLedgerExactSql(fiveMigrations) {
  return fiveMigrations.map(migration => `EXISTS(
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version=${quote(migration.version)} AND name=${quote(migration.name)}
      AND statements=ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(migration.originalStatementVector))}::jsonb))
  )`).join(' AND ');
}

export function buildForwardPriorStateQuery(record) {
  const { manifest, fiveManifest } = record;
  const fiveVersions = fiveManifest.migrations.map(migration => migration.version);
  const excludedVersions = [...fiveVersions, manifest.migration.version];
  const fiveVersionSql = fiveVersions.map(quote).join(',');
  const excludedSql = excludedVersions.map(quote).join(',');
  return `SELECT * FROM (WITH
 ledger_prefix AS (
   SELECT count(*)::int AS row_count,
     coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text AS material
   FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${excludedSql}])
 ), ledger_all AS (
   SELECT count(*)::int AS row_count,
     coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text AS material
   FROM supabase_migrations.schema_migrations
 )
 SELECT json_build_object('prior',json_build_object(
   'serverVersionNum',current_setting('server_version_num')::int,
   'databaseName',current_database(),
   'currentUser',current_user,
   'sessionUser',session_user,
   'ledgerCount',ledger_all.row_count,
   'prefixCount',ledger_prefix.row_count,
   'prefixRoot',encode(sha256(convert_to(ledger_prefix.material,'UTF8')),'hex'),
   'ledgerRoot',encode(sha256(convert_to(ledger_all.material,'UTF8')),'hex'),
   'fiveLedgerRows',(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${fiveVersionSql}])),
   'fiveExact',(${fiveLedgerExactSql(fiveManifest.migrations)}),
   'forwardLedgerRows',(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version=${quote(manifest.migration.version)}),
   'targetState',${targetStateSql()},
   'postFiveContract',${postFiveContractSql()},
   'membershipContract',${membershipContractSql()},
   'protectedRoot',${protectedRootSql()}
 ))::text AS state FROM ledger_prefix,ledger_all) forward_prior`;
}

export function buildForwardTerminalStateQuery() {
  return `SELECT json_build_object('terminal',json_build_object(
    'serverVersionNum',current_setting('server_version_num')::int,
    'databaseName',current_database(),
    'currentUser',current_user,
    'sessionUser',session_user,
    'targetState',${targetStateSql()},
    'postFiveContract',${postFiveContractSql()},
    'membershipContract',${membershipContractSql()},
    'protectedRoot',${protectedRootSql()}
  ))::text AS state`;
}

function validatePriorState(value, manifest) {
  exactKeys(value, ['prior'], 'FORWARD_ADMISSION_INVALID');
  exactKeys(value.prior, [
    'currentUser', 'databaseName', 'fiveExact', 'fiveLedgerRows', 'forwardLedgerRows',
    'ledgerCount', 'ledgerRoot', 'membershipContract', 'postFiveContract', 'prefixCount',
    'prefixRoot', 'protectedRoot', 'serverVersionNum', 'sessionUser', 'targetState',
  ], 'FORWARD_ADMISSION_INVALID');
  const prior = value.prior;
  if (prior.serverVersionNum !== manifest.serverVersionNum
    || prior.databaseName !== manifest.databaseName
    || prior.currentUser !== manifest.executorRole
    || prior.sessionUser !== manifest.executorRole
    || prior.ledgerCount !== manifest.operatingTransition.afterFive
    || prior.prefixCount !== manifest.operatingTransition.beforeFive
    || prior.fiveLedgerRows !== manifest.fiveStage.entries
    || prior.fiveExact !== true
    || prior.forwardLedgerRows !== 0
    || prior.targetState !== 'absent'
    || prior.postFiveContract !== true
    || prior.membershipContract !== true) fail('FORWARD_ADMISSION_INVALID');
  for (const field of ['prefixRoot', 'ledgerRoot', 'protectedRoot']) {
    assertHex(prior[field], 'FORWARD_ADMISSION_INVALID');
  }
}

export function expectedForwardTerminal(priorState) {
  const prior = priorState.prior;
  return Object.freeze({ terminal: {
    serverVersionNum: prior.serverVersionNum,
    databaseName: prior.databaseName,
    currentUser: prior.currentUser,
    sessionUser: prior.sessionUser,
    targetState: 'installed',
    postFiveContract: true,
    membershipContract: true,
    protectedRoot: prior.protectedRoot,
  } });
}

export function validateForwardAdmission(admission, record, { now = new Date() } = {}) {
  const { manifest, manifestSha256 } = record;
  exactKeys(admission, [
    'createdAt', 'expiresAt', 'id', 'manifestSha256', 'operatingReadbackSha256',
    'priorState', 'projectRef', 'protectedSourceReadbackSha256', 'purpose',
    'schemaVersion', 'sourceRevision',
  ], 'FORWARD_ADMISSION_INVALID');
  if (admission.schemaVersion !== 1
    || admission.id !== manifest.id
    || admission.purpose !== manifest.purpose
    || admission.projectRef !== manifest.projectRef
    || admission.manifestSha256 !== manifestSha256
    || !REVISION.test(admission.sourceRevision ?? '')) fail('FORWARD_ADMISSION_INVALID');
  assertHex(admission.protectedSourceReadbackSha256, 'FORWARD_ADMISSION_INVALID');
  assertHex(admission.operatingReadbackSha256, 'FORWARD_ADMISSION_INVALID');
  if (admission.protectedSourceReadbackSha256
    !== protectedSourceReadbackBinding(manifest, admission.sourceRevision).sha256) {
    fail('FORWARD_ADMISSION_INVALID');
  }
  const createdAt = Date.parse(admission.createdAt);
  const expiresAt = Date.parse(admission.expiresAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
    || expiresAt - createdAt > MAX_ADMISSION_AGE_MS
    || createdAt > nowMs + 30_000
    || nowMs > expiresAt) fail('FORWARD_ADMISSION_EXPIRED');
  validatePriorState(admission.priorState, manifest);
  return Object.freeze({ createdAt, expiresAt });
}

export function assertForwardLaunchReady(manifest) {
  if (manifest.launchPolicy.state !== 'ready') fail('FORWARD_LAUNCH_HELD');
}

export function compileForwardPlan(record, admission) {
  validatePriorState(admission.priorState, record.manifest);
  const expectedTerminal = expectedForwardTerminal(admission.priorState);
  const migration = {
    ...record.manifest.migration,
    expectedPriorState: { query: buildForwardPriorStateQuery(record), expected: admission.priorState },
    terminalReadback: { query: buildForwardTerminalStateQuery(), expected: expectedTerminal },
  };
  const envelope = migrationEnvelope(record.sourceBytes, migration, record.originalVector);
  if (envelope.vectorSha256 !== record.manifest.migration.statementVectorSha256) fail('FORWARD_SOURCE_DRIFT');
  const lockTag = `$forward_${sha256(record.manifest.advisoryLockKey).slice(0, 20)}$`;
  const sql = `SET LOCAL idle_in_transaction_session_timeout='30s';\nDO ${lockTag} BEGIN PERFORM pg_advisory_xact_lock(${record.manifest.advisoryLockKey}::bigint); END ${lockTag};\n${atomicMigrationSql(envelope, migration)}`;
  if (statementSpans(sql).some(span => /^(?:BEGIN|COMMIT|END|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(span.token.trim()))) {
    fail('FORWARD_PLAN_INVALID');
  }
  return Object.freeze({ envelope, expectedTerminal, migration, sql });
}

function parseReadback(output, code = 'FORWARD_READBACK_INVALID') {
  if (typeof output !== 'string' || !output.trim()) fail(code);
  return parseObject(output.trim().split(/\r?\n/).filter(Boolean).at(-1), code);
}

function boundedForwardError(error) {
  let code = '';
  try { code = error?.code ?? ''; } catch { /* fixed fallback below */ }
  if (['FORWARD_READBACK_INVALID', 'FORWARD_PREFLIGHT_MISMATCH'].includes(code)) return operationError(code);
  return boundedMigrationError(error);
}

export function executeForwardPlan(databaseUrl, plan, { runPsqlImpl } = {}) {
  if (typeof runPsqlImpl !== 'function') fail('FORWARD_EXECUTOR_REQUIRED');
  let applyError;
  try {
    const observed = parseReadback(runPsqlImpl(databaseUrl, plan.sql, true));
    if (!equal(observed, plan.expectedTerminal)) fail('MIGRATION_TERMINAL_READBACK_FAILED');
    return observed;
  } catch (error) {
    applyError = boundedForwardError(error);
  }
  let outcome = 'unknown';
  try {
    const observed = parseReadback(runPsqlImpl(
      databaseUrl,
      reconciliationSql(plan.envelope, plan.migration),
      true,
    ));
    outcome = reconciliationOutcome(observed, plan.migration);
  } catch {
    outcome = 'unknown';
  }
  if (outcome === 'committed') fail('FORWARD_OUTCOME_UNCONFIRMED');
  if (outcome === 'not_applied') throw applyError;
  fail(outcome === 'partial_conflict' ? 'FORWARD_RECONCILIATION_CONFLICT' : 'FORWARD_RECONCILIATION_UNKNOWN');
}

export function currentForwardGitFacts({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const run = args => {
    const result = spawnSync('/usr/bin/git', args, { cwd: repositoryRoot, encoding: 'utf8' });
    if (result.error || result.status !== 0) fail('FORWARD_CHECKOUT_INVALID');
    return result.stdout.trim();
  };
  const revision = run(['rev-parse', 'HEAD']);
  const dirty = run(['status', '--porcelain=v1']);
  const symbolic = spawnSync('/usr/bin/git', ['symbolic-ref', '-q', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (symbolic.error || ![0, 1].includes(symbolic.status)) fail('FORWARD_CHECKOUT_INVALID');
  return { revision, clean: dirty === '', detached: symbolic.status === 1 };
}

export function protectedSourceReadbackBinding(manifest, revision) {
  if (!manifest || !REVISION.test(revision ?? '')) fail('FORWARD_ADMISSION_INVALID');
  exactKeys(manifest.protectedSource, ['ref', 'remote', 'repositoryUrl'], 'FORWARD_ADMISSION_INVALID');
  const readback = Object.freeze({
    schemaVersion: 1,
    projectRef: manifest.projectRef,
    repositoryUrl: manifest.protectedSource.repositoryUrl,
    ref: manifest.protectedSource.ref,
    revision,
  });
  return Object.freeze({ readback, sha256: sha256(JSON.stringify(canonical(readback))) });
}

export function currentProtectedMainReadback(manifest, { repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (!manifest?.protectedSource) fail('FORWARD_PROTECTED_SOURCE_INVALID');
  const run = args => {
    const result = spawnSync('/usr/bin/git', args, { cwd: repositoryRoot, encoding: 'utf8' });
    if (result.error || result.status !== 0) fail('FORWARD_PROTECTED_SOURCE_INVALID');
    return result.stdout.trim();
  };
  const repositoryUrl = run(['remote', 'get-url', manifest.protectedSource.remote]);
  if (repositoryUrl !== manifest.protectedSource.repositoryUrl) fail('FORWARD_PROTECTED_SOURCE_INVALID');
  const output = run(['ls-remote', '--exit-code', '--refs', manifest.protectedSource.remote, manifest.protectedSource.ref]);
  const rows = output.split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) fail('FORWARD_PROTECTED_SOURCE_INVALID');
  const match = /^([0-9a-f]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[2] !== manifest.protectedSource.ref) fail('FORWARD_PROTECTED_SOURCE_INVALID');
  return protectedSourceReadbackBinding(manifest, match[1]).readback;
}

function assertCheckout(admission, facts) {
  if (!facts || facts.revision !== admission.sourceRevision || facts.clean !== true || facts.detached !== true) {
    fail('FORWARD_CHECKOUT_INVALID');
  }
}

function assertProtectedSourceReadback(admission, manifest, observed) {
  const expected = protectedSourceReadbackBinding(manifest, admission.sourceRevision);
  if (!equal(observed, expected.readback)
    || admission.protectedSourceReadbackSha256 !== expected.sha256) {
    fail('FORWARD_PROTECTED_SOURCE_MISMATCH');
  }
}

function loadPrivateAdmission(path) {
  if (typeof path !== 'string' || !path) fail('FORWARD_ADMISSION_INVALID');
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (!status.isFile() || status.isSymbolicLink() || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) {
    fail('FORWARD_ADMISSION_INVALID');
  }
  return parseObject(readFileSync(absolute), 'FORWARD_ADMISSION_INVALID');
}

export function runAdminUserRpcForward({
  admissionPath,
  environment = process.env,
}, {
  gitFactsImpl = currentForwardGitFacts,
  loadManifestImpl = loadForwardManifest,
  now = () => new Date(),
  protectedMainReadbackImpl = currentProtectedMainReadback,
  runPsqlImpl,
} = {}) {
  const record = loadManifestImpl();
  assertForwardLaunchReady(record.manifest);
  const admission = loadPrivateAdmission(admissionPath);
  validateForwardAdmission(admission, record, { now: now() });
  assertCheckout(admission, gitFactsImpl());
  assertProtectedSourceReadback(
    admission,
    record.manifest,
    protectedMainReadbackImpl(record.manifest),
  );
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, record.manifest);
  const transport = runPsqlImpl ?? createSuccessorPsqlRunner(databaseUrl, { environment });
  const priorQuery = buildForwardPriorStateQuery(record);
  let observed;
  try {
    observed = parseReadback(transport(
      databaseUrl,
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${priorQuery};`,
      true,
    ));
  } catch (error) {
    throw boundedForwardError(error);
  }
  if (!equal(observed, admission.priorState)) fail('FORWARD_PREFLIGHT_MISMATCH');
  const plan = compileForwardPlan(record, admission);
  const terminal = executeForwardPlan(databaseUrl, plan, { runPsqlImpl: transport });
  return Object.freeze({
    code: 'FORWARD_COMMITTED',
    sourceRevision: admission.sourceRevision,
    status: 'committed',
    terminal,
  });
}

export function main(argv = process.argv.slice(2), dependencies) {
  if (argv.length !== 2 || argv[0] !== '--admission' || !argv[1] || argv[1].startsWith('--')) {
    fail('FORWARD_ARGUMENT_INVALID');
  }
  return runAdminUserRpcForward({ admissionPath: argv[1] }, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(main()));
  } catch (error) {
    console.error(JSON.stringify({ code: error?.code ?? 'FORWARD_FAILED', status: 'failed' }));
    process.exitCode = 1;
  }
}
