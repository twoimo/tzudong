#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const DOCKER_CONTEXT = 'colima-tzudong-catalog-20261007';
const SOURCE_CONTAINER = 'tzudong-ranking-clone-20261008';
const IMAGE = 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const OWNER_LABEL = 'tzudong.review-rehearsal.owner';
const OWNER_TOKEN = randomBytes(16).toString('hex');
const CONTAINER = `tzudong-feature-sql-replay-${process.pid}-${OWNER_TOKEN.slice(0, 12)}`;
const PASSWORD = randomBytes(24).toString('hex');
const HARNESS_PATH = 'apps/web/performance/feature-sql-integration-20261013/verify-feature-migrations.mjs';
const OUTPUT_NAME = (() => {
  if (process.argv.length === 2) return null;
  if (process.argv.length !== 4 || process.argv[2] !== '--output'
    || !/^pg17-existing-catalog-replay-[a-z0-9-]+\.json$/.test(process.argv[3])) {
    throw new Error('FEATURE_SQL_OUTPUT_ARGUMENT_INVALID');
  }
  return process.argv[3];
})();
const FEATURE_PATHS = Object.freeze([
  'backend/supabase/migrations/20261013093518_storyboard_gemini_execution_v1.sql',
  'backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql',
  'backend/supabase/migrations/20261013190100_g014_feature_rpc_catalog_contract.sql',
  'backend/supabase/migrations/20261013190200_review_verification_immutable_key_fence.sql',
]);
const PREDECESSOR_PATHS = Object.freeze([
  'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql',
  'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql',
  'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql',
  'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql',
  'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql',
  'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql',
]);
const REQUIRED_ROLES = Object.freeze([
  'cli_login_postgres',
  'privacy_auth_bridge',
  'privacy_retention_activation_operator',
  'privacy_retention_legal_approver',
  'privacy_retention_operator_approver',
  'privacy_workflow_owner',
  'supabase_privileged_role',
  'supabase_realtime_admin',
  'tzudong_g037_readonly',
]);
const SUCCESSOR_MANIFEST_PATH = '.github/review-media-sql-successor.v1.json';
const EXPECTED_FEATURE_RPC_ALLOWLIST = Object.freeze([
  'public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)',
  'public.complete_receipt_ocr_result(uuid,uuid,jsonb)',
  'public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb)',
  'public.get_feature_runtime_capability(uuid)',
  'public.get_owned_review_storage_objects(uuid,uuid,text,text[])',
  'public.get_review_receipt_ocr_generation(uuid,uuid)',
  'public.mark_receipt_ocr_dispatched(uuid,uuid)',
  'public.mark_receipt_ocr_result_indeterminate(uuid,uuid)',
  'public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)',
  'public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)',
  'public.release_receipt_ocr_claim(uuid,uuid)',
]);

const ids = Object.freeze({
  owner: '00000000-0000-4000-8000-000000000101',
  worker: '00000000-0000-4000-8000-000000000102',
  queuedProject: '00000000-0000-4000-8000-000000000103',
  queuedRequest: '00000000-0000-4000-8000-000000000104',
  queuedJob: '00000000-0000-4000-8000-000000000105',
  queuedJobRequest: '00000000-0000-4000-8000-000000000106',
  claimedProject: '00000000-0000-4000-8000-000000000107',
  claimedRequest: '00000000-0000-4000-8000-000000000108',
  claimedJob: '00000000-0000-4000-8000-000000000109',
  claimedJobRequest: '00000000-0000-4000-8000-000000000110',
  lease: '00000000-0000-4000-8000-000000000111',
  restaurant: '00000000-0000-4000-8000-000000000112',
  preservedReview: '00000000-0000-4000-8000-000000000113',
  ocrOperation: '00000000-0000-4000-8000-000000000114',
  verificationObject: '00000000-0000-4000-8000-000000000115',
  foodObject: '00000000-0000-4000-8000-000000000116',
  createdReview: '00000000-0000-4000-8000-000000000117',
  wrongUser: '00000000-0000-4000-8000-000000000118',
  staleReview: '00000000-0000-4000-8000-000000000119',
  staleRevision: '00000000-0000-4000-8000-000000000120',
  wrongOwnerReview: '00000000-0000-4000-8000-000000000121',
  raceRequest: '00000000-0000-4000-8000-000000000122',
  ocrRefreshOperation: '00000000-0000-4000-8000-000000000123',
  createWinsVerificationObject: '00000000-0000-4000-8000-000000000124',
  createWinsFoodObject: '00000000-0000-4000-8000-000000000125',
  createWinsReview: '00000000-0000-4000-8000-000000000126',
  deleteWinsVerificationObject: '00000000-0000-4000-8000-000000000127',
  deleteWinsFoodObject: '00000000-0000-4000-8000-000000000128',
  deleteWinsReview: '00000000-0000-4000-8000-000000000129',
  orphanVerificationObject: '00000000-0000-4000-8000-000000000130',
  authenticatedReview: '00000000-0000-4000-8000-000000000131',
  authenticatedOcrOperation: '00000000-0000-4000-8000-000000000132',
  authenticatedRefreshOperation: '00000000-0000-4000-8000-000000000133',
  authenticatedVerificationObject: '00000000-0000-4000-8000-000000000134',
  authenticatedFoodObject: '00000000-0000-4000-8000-000000000135',
  authenticatedBarrierOperation: '00000000-0000-4000-8000-000000000136',
  authenticatedOwnerEditOperation: '00000000-0000-4000-8000-000000000137',
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function writeImmutable(path, bytes) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${OWNER_TOKEN}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function docker(args, { input, allowFailure = false, maxBuffer = 96 * 1024 * 1024 } = {}) {
  const result = spawnSync('docker', ['--context', DOCKER_CONTEXT, ...args], {
    encoding: 'utf8', input, maxBuffer,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const line = (result.stderr || '').split(/\r?\n/).find(value => /(?:ERROR|FATAL):/.test(value));
    fail('FEATURE_SQL_COMMAND_FAILED', `${result.status}:${line?.replace(/\s+/g, ' ').slice(0, 220) || ''}`);
  }
  return result;
}

function psql(sql, { actor = 'postgres', role = null, database = 'postgres', allowFailure = false } = {}) {
  if (role !== null && !/^[a-z_][a-z0-9_]*$/.test(role)) fail('FEATURE_SQL_ROLE_INVALID');
  const input = role === null ? sql : `SET ROLE ${role};\n${sql}`;
  return docker([
    'exec', '-i', '-e', `PGPASSWORD=${PASSWORD}`, CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
    '-h', '127.0.0.1', '-U', actor, '-d', database, '--file=-',
  ], { input, allowFailure });
}

function sourceHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) {
    fail('FEATURE_SQL_SOURCE_HEAD_INVALID');
  }
  return result.stdout.trim();
}

function startPsqlSession(applicationName, actor = 'postgres') {
  if (!/^[a-z0-9_]{1,63}$/.test(applicationName)) fail('FEATURE_SQL_APPLICATION_NAME_INVALID');
  if (!['postgres', 'supabase_admin'].includes(actor)) fail('FEATURE_SQL_ACTOR_INVALID');
  const child = spawn('docker', [
    '--context', DOCKER_CONTEXT,
    'exec', '-i', '-e', `PGPASSWORD=${PASSWORD}`, '-e', `PGAPPNAME=${applicationName}`, CONTAINER,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
    '-h', '127.0.0.1', '-U', actor, '-d', 'postgres', '--file=-',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise((resolveCompleted, rejectCompleted) => {
    child.once('error', rejectCompleted);
    child.once('close', (status, signal) => resolveCompleted(Object.freeze({
      status,
      signal,
      stdout,
      stderr,
    })));
  });
  return Object.freeze({
    child,
    completed,
    output: () => Object.freeze({ stdout, stderr }),
  });
}

async function waitUntil(predicate, code, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  fail(code);
}

async function closePsqlSession(session) {
  if (session.child.exitCode === null && !session.child.stdin.destroyed) {
    session.child.stdin.end('ROLLBACK;\n\\q\n');
  }
  return session.completed;
}

function scalar(sql, role = null) {
  return psql(`${sql}\n`, { role }).stdout.trim();
}

function json(sql, role = null) {
  const output = scalar(sql, role);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('FEATURE_SQL_JSON_SHAPE_INVALID', String(lines.length));
  try { return JSON.parse(lines[0]); } catch { fail('FEATURE_SQL_JSON_INVALID'); }
}

function deterministicDump(bytes) {
  return bytes.replace(/^\\(?:un)?restrict [^\n]*\n/gm, '');
}

function sourceDump() {
  return docker(['exec', SOURCE_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'ranking_clone']).stdout;
}

function targetSchemaSha256() {
  const dump = docker(['exec', CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only']).stdout;
  return sha256(deterministicDump(dump));
}

function inspectOwnedContainer() {
  const result = docker(['container', 'inspect', CONTAINER], { allowFailure: true });
  if (result.status !== 0) return null;
  const values = JSON.parse(result.stdout);
  if (!Array.isArray(values) || values.length !== 1) fail('FEATURE_SQL_CONTAINER_INSPECTION_INVALID');
  const value = values[0];
  if (value.Name?.replace(/^\//, '') !== CONTAINER
    || value.Config?.Labels?.[OWNER_LABEL] !== OWNER_TOKEN
    || !/^[0-9a-f]{12,64}$/.test(value.Id || '')) {
    fail('FEATURE_SQL_CONTAINER_OWNERSHIP_UNPROVEN');
  }
  return value.Id;
}

function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = docker([
      'exec', '-e', `PGPASSWORD=${PASSWORD}`, CONTAINER,
      'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
    ], { allowFailure: true });
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  fail('FEATURE_SQL_CONTAINER_NOT_READY');
}

function createRequiredRoles() {
  const roleArray = `ARRAY[${REQUIRED_ROLES.map(quote).join(',')}]`;
  psql(`DO $roles$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ${roleArray} LOOP
  IF to_regrole(role_name) IS NULL THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
  END IF;
 END LOOP;
 ALTER ROLE privacy_auth_bridge INHERIT;
 ALTER ROLE privacy_retention_activation_operator NOINHERIT;
 ALTER ROLE privacy_retention_legal_approver NOINHERIT;
 ALTER ROLE privacy_retention_operator_approver NOINHERIT;
 ALTER ROLE privacy_workflow_owner NOINHERIT;
END $roles$;`);
  psql(`GRANT privacy_auth_bridge TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_activation_operator TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_legal_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_operator_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;`, { actor: 'supabase_admin' });
  psql('GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;');
}

function insertLedger(path, statement = 'feature integration replay') {
  const version = basename(path).slice(0, 14);
  const name = basename(path).slice(15, -4);
  psql(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES(${quote(version)},ARRAY[${quote(statement)}],${quote(name)});`);
}

function applyFile(path, bytes = readFileSync(resolve(ROOT, path), 'utf8')) {
  psql(bytes);
}

function seedPredecessorLedger() {
  psql(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
SELECT lpad(value::text,14,'0'),ARRAY['local schema-only predecessor fixture'],format('local_predecessor_%s',value)
FROM generate_series(1,86) value;
INSERT INTO pipeline_control.restaurant_review_policy(singleton,enabled)
VALUES(true,false) ON CONFLICT(singleton) DO UPDATE SET enabled=false,operator_id=NULL,last_run_at=NULL;
INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision)
VALUES(true,1) ON CONFLICT(singleton) DO NOTHING;`);
}

function roleSnapshot() {
  const bytes = scalar(`SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) ORDER BY rolname)
      FROM pg_roles WHERE rolname !~ '^pg_'),
    'memberships',(SELECT jsonb_agg(jsonb_build_array(r.rolname,m.rolname,g.rolname,a.admin_option,a.inherit_option,a.set_option) ORDER BY r.rolname,m.rolname,g.rolname)
      FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor)
  )::text;`);
  return Object.freeze({ sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) });
}

function roleSignature() {
  return roleSnapshot().sha256;
}

function g014Signature() {
  return sha256(scalar(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_signature)::text,'[]')
    FROM privacy_retention.g014_public_rpc_allowlist x;`));
}

function g014AllowlistRows() {
  return json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
    'sourceSignature',source_signature,'grantee',grantee
  ) ORDER BY source_signature,grantee),'[]'::jsonb)::text
  FROM privacy_retention.g014_public_rpc_allowlist;`);
}

function g014CatalogManifestSignature() {
  return sha256(scalar(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.manifest_kind,x.manifest_key)::text,'[]')
    FROM privacy_retention.g014_catalog_contract_manifest x;`));
}

function g014EffectiveMatrixDiff() {
  return json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature',format('%I.%I(%s)',namespace.nspname,procedure.proname,
        pg_get_function_identity_arguments(procedure.oid)),
      'grantee',role_matrix.grantee,
      'effective',has_function_privilege(role_matrix.grantee,procedure.oid,'EXECUTE'),
      'allowlisted',EXISTS(
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist allowed
        WHERE allowed.function_schema=namespace.nspname
          AND allowed.function_name=procedure.proname
          AND allowed.identity_arguments=procedure.proargtypes::text
          AND allowed.grantee=role_matrix.grantee
      )
    ) ORDER BY namespace.nspname,procedure.proname,
      pg_get_function_identity_arguments(procedure.oid),role_matrix.grantee),'[]'::jsonb)::text
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
  CROSS JOIN (VALUES ('anon'::name),('authenticated'::name),('service_role'::name)) role_matrix(grantee)
  WHERE namespace.nspname='public'
    AND NOT (
      pg_get_userbyid(procedure.proowner)='supabase_admin'
      AND EXISTS (
        SELECT 1 FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid=dependency.refobjid
        JOIN pg_namespace extension_namespace ON extension_namespace.oid=extension.extnamespace
        WHERE dependency.classid='pg_proc'::regclass
          AND dependency.objid=procedure.oid
          AND dependency.refclassid='pg_extension'::regclass
          AND dependency.deptype='e'
          AND extension.extname='vector'
          AND extension_namespace.nspname='public'
          AND pg_get_userbyid(extension.extowner)='supabase_admin'
      )
    )
    AND has_function_privilege(role_matrix.grantee,procedure.oid,'EXECUTE')
      IS DISTINCT FROM EXISTS(
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist allowed
        WHERE allowed.function_schema=namespace.nspname
          AND allowed.function_name=procedure.proname
          AND allowed.identity_arguments=procedure.proargtypes::text
          AND allowed.grantee=role_matrix.grantee
      );`);
}

function g014MatrixKey(value) {
  return `${value.signature}\u0000${value.grantee}\u0000${value.effective}\u0000${value.allowlisted}`;
}

function g014MatrixDelta(before, after) {
  const beforeKeys = new Set(before.map(g014MatrixKey));
  const afterKeys = new Set(after.map(g014MatrixKey));
  return Object.freeze({
    added: after.filter(value => !beforeKeys.has(g014MatrixKey(value))),
    removed: before.filter(value => !afterKeys.has(g014MatrixKey(value))),
  });
}

function g014AssertionResults() {
  const helper = `feature_sql_g014_assertions_${OWNER_TOKEN.slice(0, 16)}`;
  const membershipBefore = roleSignature();
  const output = psql(`CREATE FUNCTION pg_temp.${helper}()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $helper$
DECLARE
  assertion name;
  results jsonb := '[]'::jsonb;
BEGIN
  FOREACH assertion IN ARRAY ARRAY[
    'assert_g014_public_rpc_allowlist'::name,
    'assert_g014_definer_contract'::name,
    'assert_g014_catalog_contract'::name
  ] LOOP
    BEGIN
      EXECUTE pg_catalog.format('SELECT privacy_retention.%I()', assertion);
      results := results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'assertion', assertion,
        'passed', true,
        'error', null
      ));
    EXCEPTION WHEN OTHERS THEN
      results := results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'assertion', assertion,
        'passed', false,
        'error', pg_catalog.left(pg_catalog.regexp_replace(SQLERRM, '\\s+', ' ', 'g'), 240)
      ));
    END;
  END LOOP;
  RETURN results;
END
$helper$;
ALTER FUNCTION pg_temp.${helper}() OWNER TO privacy_auth_bridge;
REVOKE ALL ON FUNCTION pg_temp.${helper}() FROM PUBLIC, anon, authenticated, service_role;
SELECT pg_temp.${helper}()::text;
DROP FUNCTION pg_temp.${helper}();`, { actor: 'supabase_admin' });
  const lines = output.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('FEATURE_SQL_G014_ASSERTION_SHAPE_INVALID', String(lines.length));
  let results;
  try { results = JSON.parse(lines[0]); } catch { fail('FEATURE_SQL_G014_ASSERTION_JSON_INVALID'); }
  if (!Array.isArray(results) || results.length !== 3
    || results.some(result => typeof result?.assertion !== 'string'
      || typeof result?.passed !== 'boolean'
      || (result.error !== null && typeof result.error !== 'string'))) {
    fail('FEATURE_SQL_G014_ASSERTION_RESULT_INVALID');
  }
  if (roleSignature() !== membershipBefore) fail('FEATURE_SQL_G014_ASSERTION_ROLE_DRIFT');
  return Object.freeze(results.map(Object.freeze));
}

function g014FeatureRpcCatalogState() {
  const registry = EXPECTED_FEATURE_RPC_ALLOWLIST
    .map(sourceSignature => `(${quote(sourceSignature)})`)
    .join(',\n');
  return json(`WITH registry(source_signature) AS (VALUES ${registry}),
  catalog AS (
    SELECT
      registry.source_signature,
      'ocr_private.' || substr(
        registry.source_signature,
        length('public.') + 1
      ) AS helper_signature,
      to_regprocedure(registry.source_signature) AS wrapper_oid,
      to_regprocedure('ocr_private.' || substr(
        registry.source_signature,
        length('public.') + 1
      )) AS helper_oid
    FROM registry
  )
  SELECT jsonb_build_object(
    'rpcs',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'sourceSignature',catalog.source_signature,
      'wrapperOwner',pg_get_userbyid(wrapper.proowner),
      'wrapperSecurityDefiner',wrapper.prosecdef,
      'wrapperLanguage',wrapper_language.lanname,
      'wrapperConfig',wrapper.proconfig,
      'wrapperVolatility',wrapper.provolatile,
      'wrapperReturnType',wrapper.prorettype::regtype::text,
      'wrapperReturnsSet',wrapper.proretset,
      'wrapperServiceRoleExecute',has_function_privilege('service_role',catalog.wrapper_oid,'EXECUTE'),
      'wrapperAnonExecute',has_function_privilege('anon',catalog.wrapper_oid,'EXECUTE'),
      'wrapperAuthenticatedExecute',has_function_privilege('authenticated',catalog.wrapper_oid,'EXECUTE'),
      'allowlistCount',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist allowed
        WHERE allowed.source_signature=catalog.source_signature
          AND allowed.grantee='service_role'),
      'helperSignature',catalog.helper_signature,
      'helperOwner',pg_get_userbyid(helper.proowner),
      'helperSecurityDefiner',helper.prosecdef,
      'helperLanguage',helper_language.lanname,
      'helperConfig',helper.proconfig,
      'helperVolatility',helper.provolatile,
      'helperReturnType',helper.prorettype::regtype::text,
      'helperReturnsSet',helper.proretset,
      'helperWorkflowOwnerExecute',has_function_privilege('privacy_workflow_owner',catalog.helper_oid,'EXECUTE'),
      'helperServiceRoleExecute',has_function_privilege('service_role',catalog.helper_oid,'EXECUTE'),
      'helperAnonExecute',has_function_privilege('anon',catalog.helper_oid,'EXECUTE'),
      'helperAuthenticatedExecute',has_function_privilege('authenticated',catalog.helper_oid,'EXECUTE'),
      'nestedHelperAllowlistCount',(SELECT count(*) FROM privacy_retention.g014_nested_helper_allowlist allowed
        WHERE allowed.source_signature=catalog.helper_signature)
    ) ORDER BY catalog.source_signature)
    FROM catalog
    JOIN pg_proc wrapper ON wrapper.oid=catalog.wrapper_oid
    JOIN pg_language wrapper_language ON wrapper_language.oid=wrapper.prolang
    JOIN pg_proc helper ON helper.oid=catalog.helper_oid
    JOIN pg_language helper_language ON helper_language.oid=helper.prolang),'[]'::jsonb),
    'generationTrigger',(
      SELECT jsonb_build_object(
        'owner',pg_get_userbyid(procedure.proowner),
        'securityDefiner',procedure.prosecdef,
        'language',language.lanname,
        'config',procedure.proconfig,
        'returnType',procedure.prorettype::regtype::text,
        'returnsSet',procedure.proretset,
        'triggerCount',(SELECT count(*) FROM pg_trigger trigger_row
          WHERE trigger_row.tgfoid=procedure.oid
            AND trigger_row.tgrelid='public.reviews'::regclass
            AND trigger_row.tgname IN ('review_ocr_generation_on_insert','review_ocr_generation_on_reset')
            AND trigger_row.tgenabled='O'
            AND NOT trigger_row.tgisinternal),
        'serviceRoleExecute',has_function_privilege('service_role',procedure.oid,'EXECUTE'),
        'anonExecute',has_function_privilege('anon',procedure.oid,'EXECUTE'),
        'authenticatedExecute',has_function_privilege('authenticated',procedure.oid,'EXECUTE'),
        'nestedAllowlistCount',(SELECT count(*) FROM privacy_retention.g014_nested_helper_allowlist allowed
          WHERE allowed.source_signature='ocr_private.register_review_ocr_generation()')
      )
      FROM pg_proc procedure
      JOIN pg_language language ON language.oid=procedure.prolang
      WHERE procedure.oid=to_regprocedure('ocr_private.register_review_ocr_generation()')
    ),
    'archiveTrigger',(
      SELECT jsonb_build_object(
        'owner',pg_get_userbyid(procedure.proowner),
        'securityDefiner',procedure.prosecdef,
        'language',language.lanname,
        'config',procedure.proconfig,
        'returnType',procedure.prorettype::regtype::text,
        'returnsSet',procedure.proretset,
        'triggerCount',(SELECT count(*) FROM pg_trigger trigger_row
          WHERE trigger_row.tgfoid=procedure.oid AND NOT trigger_row.tgisinternal),
        'serviceRoleExecute',has_function_privilege('service_role',procedure.oid,'EXECUTE'),
        'anonExecute',has_function_privilege('anon',procedure.oid,'EXECUTE'),
        'authenticatedExecute',has_function_privilege('authenticated',procedure.oid,'EXECUTE'),
        'workflowOwnerExecute',has_function_privilege('privacy_workflow_owner',procedure.oid,'EXECUTE'),
        'allowlistCount',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist allowed
          WHERE allowed.source_signature='public.storyboard_production_reject_archived_write()'
             OR (allowed.function_schema='public'
               AND allowed.function_name='storyboard_production_reject_archived_write'))
      )
      FROM pg_proc procedure
      JOIN pg_language language ON language.oid=procedure.prolang
      WHERE procedure.oid=to_regprocedure('public.storyboard_production_reject_archived_write()')
    )
  )::text;`);
}

function g014FeatureRpcCatalogVerified(state) {
  const expectedSignatures = [...EXPECTED_FEATURE_RPC_ALLOWLIST].sort();
  const actualSignatures = state.rpcs.map(row => row.sourceSignature).sort();
  if (JSON.stringify(actualSignatures) !== JSON.stringify(expectedSignatures)) return false;
  const expectedType = sourceSignature => sourceSignature.includes('get_owned_review_storage_objects')
    ? ['record', true]
    : sourceSignature.includes('create_review_with_receipt_ocr')
      ? ['uuid', false]
      : ['jsonb', false];
  const expectedVolatility = sourceSignature => (
    sourceSignature.includes('read_receipt_ocr_result')
      || sourceSignature.includes('get_review_receipt_ocr_generation')
      || sourceSignature.includes('get_feature_runtime_capability')
  ) ? 's' : 'v';
  if (state.rpcs.some(row => {
    const [returnType, returnsSet] = expectedType(row.sourceSignature);
    const volatility = expectedVolatility(row.sourceSignature);
    return row.wrapperOwner !== 'privacy_workflow_owner'
      || row.wrapperSecurityDefiner !== true
      || row.wrapperLanguage !== 'sql'
      || JSON.stringify(row.wrapperConfig) !== JSON.stringify(['search_path=""'])
      || row.wrapperVolatility !== volatility
      || row.wrapperReturnType !== returnType
      || row.wrapperReturnsSet !== returnsSet
      || row.wrapperServiceRoleExecute !== true
      || row.wrapperAnonExecute !== false
      || row.wrapperAuthenticatedExecute !== false
      || Number(row.allowlistCount) !== 1
      || row.helperSignature !== row.sourceSignature.replace(/^public\./, 'ocr_private.')
      || row.helperOwner !== 'postgres'
      || row.helperSecurityDefiner !== true
      || row.helperLanguage !== 'plpgsql'
      || JSON.stringify(row.helperConfig) !== JSON.stringify(['search_path=""'])
      || row.helperVolatility !== volatility
      || row.helperReturnType !== returnType
      || row.helperReturnsSet !== returnsSet
      || row.helperWorkflowOwnerExecute !== true
      || row.helperServiceRoleExecute !== false
      || row.helperAnonExecute !== false
      || row.helperAuthenticatedExecute !== false
      || Number(row.nestedHelperAllowlistCount) !== 1;
  })) return false;
  const generationTrigger = state.generationTrigger;
  if (generationTrigger?.owner !== 'postgres'
    || generationTrigger.securityDefiner !== true
    || generationTrigger.language !== 'plpgsql'
    || JSON.stringify(generationTrigger.config) !== JSON.stringify(['search_path=""'])
    || generationTrigger.returnType !== 'trigger'
    || generationTrigger.returnsSet !== false
    || Number(generationTrigger.triggerCount) !== 2
    || generationTrigger.serviceRoleExecute !== false
    || generationTrigger.anonExecute !== false
    || generationTrigger.authenticatedExecute !== false
    || Number(generationTrigger.nestedAllowlistCount) !== 1) return false;
  const trigger = state.archiveTrigger;
  return trigger?.owner === 'postgres'
    && trigger.securityDefiner === false
    && trigger.language === 'plpgsql'
    && JSON.stringify(trigger.config) === JSON.stringify(['search_path=""'])
    && trigger.returnType === 'trigger'
    && trigger.returnsSet === false
    && Number(trigger.triggerCount) === 6
    && trigger.serviceRoleExecute === false
    && trigger.anonExecute === false
    && trigger.authenticatedExecute === false
    && trigger.workflowOwnerExecute === false
    && Number(trigger.allowlistCount) === 0;
}

function storageContractState() {
  return json(`SELECT jsonb_build_object(
    'buckets',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'public',public,'fileSizeLimit',file_size_limit,'allowedMimeTypes',allowed_mime_types
    ) ORDER BY id) FROM storage.buckets WHERE id IN ('review-photos','review-verifications')),'[]'::jsonb),
    'reviewVerificationPolicyCount',(SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND (coalesce(qual,'') LIKE '%review-verifications%' OR coalesce(with_check,'') LIKE '%review-verifications%')),
    'reviewVerificationPolicies',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'name',policyname,'command',cmd,'roles',roles
    ) ORDER BY policyname) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND (coalesce(qual,'') LIKE '%review-verifications%' OR coalesce(with_check,'') LIKE '%review-verifications%')),'[]'::jsonb),
    'authenticatedUpdatePolicyCount',(SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects' AND cmd='UPDATE'
        AND 'authenticated'=ANY(roles)
        AND (coalesce(qual,'') LIKE '%review-verifications%' OR coalesce(with_check,'') LIKE '%review-verifications%')),
    'immutablePolicy',(SELECT jsonb_build_object(
      'name',policyname,'command',cmd,'permissive',permissive,'roles',roles,'using',qual,'check',with_check)
      FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname='review_verifications_immutable_update'),
    'immutableTrigger',(SELECT jsonb_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'type',trigger_row.tgtype,
      'function',trigger_row.tgfoid::regprocedure::text)
      FROM pg_trigger trigger_row WHERE trigger_row.tgrelid='storage.objects'::regclass
        AND trigger_row.tgname='a01_review_verification_immutable_update' AND NOT trigger_row.tgisinternal),
    'immutableFunction',(SELECT jsonb_build_object(
      'owner',pg_get_userbyid(procedure.proowner),'securityDefiner',procedure.prosecdef,
      'config',procedure.proconfig,'returnType',procedure.prorettype::regtype::text)
      FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('review_media_private.reject_verification_object_update()')),
    'immutableFunctionExecuteExposureCount',(SELECT count(*)
      FROM pg_proc procedure
      CROSS JOIN (VALUES ('anon'::name),('authenticated'::name),('service_role'::name),
        ('supabase_storage_admin'::name),('postgres'::name)) role_matrix(role_name)
      WHERE procedure.oid=to_regprocedure('review_media_private.reject_verification_object_update()')
        AND has_function_privilege(role_matrix.role_name,procedure.oid,'EXECUTE')),
    'deleteTrigger',(SELECT jsonb_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'type',trigger_row.tgtype,
      'function',trigger_row.tgfoid::regprocedure::text)
      FROM pg_trigger trigger_row WHERE trigger_row.tgrelid='storage.objects'::regclass
        AND trigger_row.tgname='a01_review_verification_guard_delete' AND NOT trigger_row.tgisinternal),
    'deleteFunction',(SELECT jsonb_build_object(
      'owner',pg_get_userbyid(procedure.proowner),'securityDefiner',procedure.prosecdef,
      'config',procedure.proconfig,'returnType',procedure.prorettype::regtype::text)
      FROM pg_proc procedure
      WHERE procedure.oid=to_regprocedure('review_media_private.guard_verification_object_delete()')),
    'deleteFunctionExecuteExposureCount',(SELECT count(*)
      FROM pg_proc procedure
      CROSS JOIN (VALUES ('anon'::name),('authenticated'::name),('service_role'::name),
        ('supabase_storage_admin'::name),('postgres'::name)) role_matrix(role_name)
      WHERE procedure.oid=to_regprocedure('review_media_private.guard_verification_object_delete()')
        AND has_function_privilege(role_matrix.role_name,procedure.oid,'EXECUTE')),
    'objectsRls',(SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass),
    'objectsForceRls',(SELECT relforcerowsecurity FROM pg_class WHERE oid='storage.objects'::regclass)
  )::text;`);
}

function seedFeatureRows() {
  const legacyRequest = JSON.stringify({ workflow: 'storyboard-mlx-v1' });
  psql(`INSERT INTO auth.users(id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('${ids.owner}','authenticated','authenticated','fixture-owner@example.invalid',now(),now(),'{}','{}'),
 ('${ids.wrongUser}','authenticated','authenticated','fixture-wrong@example.invalid',now(),now(),'{}','{}');
INSERT INTO public.restaurants(id,approved_name,status,created_at,updated_at)
VALUES('${ids.restaurant}','Fixture Restaurant','approved',now(),now());
INSERT INTO public.user_roles(user_id,role)
VALUES('${ids.owner}','admin')
ON CONFLICT(user_id,role) DO NOTHING;
INSERT INTO public.user_account_status(user_id,account_status,disabled_at,updated_at)
VALUES('${ids.owner}','active',NULL,now())
ON CONFLICT(user_id) DO UPDATE SET account_status='active',disabled_at=NULL,updated_at=EXCLUDED.updated_at;
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos,admin_note,is_pinned,is_edited_by_admin,edited_by_admin_id,edited_at)
VALUES('${ids.preservedReview}','${ids.owner}','${ids.restaurant}','preserved title','preserved content',
  '2026-10-12T00:00:00Z',
  '${ids.owner}/reviews/${ids.preservedReview}/verification/preserved.jpg',
  ARRAY['${ids.owner}/reviews/${ids.preservedReview}/food/preserved.jpg'],
  'admin correction',true,true,'${ids.owner}',now());
INSERT INTO public.admin_storyboard_production_workers(id,owner_id,token_sha256,models,last_heartbeat)
VALUES('${ids.worker}','${ids.owner}',repeat('a',64),'[]'::jsonb,now());
INSERT INTO public.admin_storyboard_production_projects(id,owner_id,request_id,revision,title,request,document,status)
VALUES
 ('${ids.queuedProject}','${ids.owner}','${ids.queuedRequest}',0,'legacy queued',${quote(legacyRequest)}::jsonb,NULL,'waiting_worker'),
 ('${ids.claimedProject}','${ids.owner}','${ids.claimedRequest}',0,'legacy claimed',${quote(legacyRequest)}::jsonb,NULL,'generating');
INSERT INTO public.admin_storyboard_production_jobs(id,project_id,owner_id,request_id,requested_revision,base_revision,kind,status,stage)
VALUES('${ids.queuedJob}','${ids.queuedProject}','${ids.owner}','${ids.queuedJobRequest}',0,0,'generate','queued','queued');
INSERT INTO public.admin_storyboard_production_jobs(id,project_id,owner_id,request_id,requested_revision,base_revision,kind,status,stage,worker_id,lease_token,lease_expires_at,last_heartbeat)
VALUES('${ids.claimedJob}','${ids.claimedProject}','${ids.owner}','${ids.claimedJobRequest}',0,0,'generate','claimed','text','${ids.worker}','${ids.lease}',now()+interval '1 hour',now());`);
}

function preservedReviewState() {
  return json(`SELECT to_jsonb(r)::text FROM public.reviews r WHERE id='${ids.preservedReview}';`);
}

function legacyState() {
  return json(`SELECT jsonb_build_object(
    'projects',(SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'request',request,'document',document,'revision',revision) ORDER BY id)
      FROM public.admin_storyboard_production_projects WHERE id IN ('${ids.queuedProject}','${ids.claimedProject}')),
    'jobs',(SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'stage',stage,'errorCode',error_code,'workerId',worker_id,'leaseToken',lease_token,'leaseExpiresAt',lease_expires_at) ORDER BY id)
      FROM public.admin_storyboard_production_jobs WHERE id IN ('${ids.queuedJob}','${ids.claimedJob}')),
    'events',(SELECT count(*) FROM public.admin_storyboard_production_events WHERE job_id IN ('${ids.queuedJob}','${ids.claimedJob}'))
  )::text;`);
}

function rollbackState() {
  return sha256(JSON.stringify(canonical({
    schema: targetSchemaSha256(),
    roles: roleSignature(),
    allowlist: g014Signature(),
    catalogManifest: g014CatalogManifestSignature(),
    legacy: legacyState(),
    preservedReview: preservedReviewState(),
    storage: storageContractState(),
    migrationLedgerRows: Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')),
  })));
}

function faultedMigration(path, bytes, marker) {
  const fault = `DO $forced$ BEGIN RAISE EXCEPTION '${marker}'; END $forced$;`;
  const withTerminalCommit = bytes.replace(/\nCOMMIT;\s*$/i, `\n${fault}\nCOMMIT;`);
  if (withTerminalCommit !== bytes) return withTerminalCommit;
  if (/\b(?:BEGIN|START\s+TRANSACTION)\s*;/i.test(bytes)) {
    fail('FEATURE_SQL_COMMIT_MARKER_MISSING', path);
  }
  return `BEGIN;\n${bytes}\n${fault}\nCOMMIT;`;
}

async function applyStoryboardWithLateInvocations(storyboardBytes) {
  const gate = startPsqlSession('feature_storyboard_gate');
  const admin = startPsqlSession('feature_storyboard_late_admin');
  const heartbeat = startPsqlSession('feature_storyboard_late_heartbeat');
  const cutover = startPsqlSession('feature_storyboard_cutover');
  const sessions = [gate, admin, heartbeat, cutover];
  const request = JSON.stringify({
    workflow: 'storyboard-mlx-v1',
    requestId: ids.raceRequest,
    prompt: 'existing catalog late invocation fixture',
    sceneCount: 5,
    providers: {
      externalAI: true,
      text: { id: 'gemini-api', model: 'gemini-3.8-flash' },
      image: { id: 'gemini-api', model: 'gemini-3.1-flash-image' },
    },
  });
  const models = JSON.stringify([
    { id: 'gemini-3.8-flash', owned_by: 'gemini-api', capabilities: ['chat'], loaded: false, bytes_on_disk: 0, bytes_resident: 0 },
    { id: 'gemini-3.1-flash-image', owned_by: 'gemini-api', capabilities: ['image'], loaded: false, bytes_on_disk: 0, bytes_resident: 0 },
  ]);
  try {
    gate.child.stdin.write("BEGIN;\nLOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE;\nSELECT 'feature_gate_ready';\n");
    await waitUntil(() => gate.output().stdout.includes('feature_gate_ready'), 'FEATURE_STORYBOARD_GATE_NOT_READY');

    admin.child.stdin.end(`SET ROLE service_role;\nSELECT public.storyboard_production_admin(
      '${ids.owner}','create',NULL,NULL,${quote(request)}::jsonb);\n`);
    heartbeat.child.stdin.end(`SET ROLE service_role;\nSELECT public.storyboard_production_worker(
      '${ids.worker}','heartbeat','${ids.claimedJob}','${ids.lease}',${quote(JSON.stringify({ models: JSON.parse(models) }))}::jsonb);\n`);
    const initialWaits = await waitUntil(() => {
      const rows = json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
        'application',application_name,'waitType',wait_event_type,'waitEvent',wait_event
      ) ORDER BY application_name),'[]'::jsonb)::text
      FROM pg_stat_activity
      WHERE datname=current_database()
        AND application_name IN ('feature_storyboard_late_admin','feature_storyboard_late_heartbeat');`);
      return rows.length === 2 && rows.every(row => row.waitType === 'Lock') ? rows : null;
    }, 'FEATURE_STORYBOARD_INITIAL_WAIT_UNPROVEN');

    const staged = storyboardBytes.replace(/\nCOMMIT;\s*$/i, "\nSELECT 'feature_cutover_staged';");
    if (staged === storyboardBytes) fail('FEATURE_STORYBOARD_COMMIT_MARKER_MISSING');
    cutover.child.stdin.write(`${staged}\n`);
    await waitUntil(() => cutover.output().stdout.includes('feature_cutover_staged'), 'FEATURE_STORYBOARD_CUTOVER_NOT_STAGED');

    gate.child.stdin.end('ROLLBACK;\n\\q\n');
    const gateResult = await gate.completed;
    if (gateResult.status !== 0) fail('FEATURE_STORYBOARD_GATE_RELEASE_FAILED');
    const projectRelation = scalar("SELECT 'public.admin_storyboard_production_projects'::regclass::oid;");
    const tableWaits = await waitUntil(() => {
      const rows = json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
        'application',activity.application_name,'relation',lock.relation,'mode',lock.mode
      ) ORDER BY activity.application_name),'[]'::jsonb)::text
      FROM pg_stat_activity activity
      JOIN pg_locks lock ON lock.pid=activity.pid AND lock.locktype='relation' AND NOT lock.granted
      WHERE activity.datname=current_database()
        AND activity.application_name IN ('feature_storyboard_late_admin','feature_storyboard_late_heartbeat')
        AND lock.relation=${projectRelation}::oid;`);
      return rows.length === 2 ? rows : null;
    }, 'FEATURE_STORYBOARD_TABLE_WAIT_UNPROVEN');

    cutover.child.stdin.end('COMMIT;\n\\q\n');
    const cutoverResult = await cutover.completed;
    if (cutoverResult.status !== 0) {
      fail('FEATURE_STORYBOARD_CUTOVER_FAILED', cutoverResult.stderr.replace(/\s+/g, ' ').slice(0, 220));
    }
    const [adminResult, heartbeatResult] = await Promise.all([admin.completed, heartbeat.completed]);
    if (adminResult.status === 0 || !/archived_project_read_only/.test(adminResult.stderr)) {
      fail('FEATURE_STORYBOARD_LATE_ADMIN_NOT_REJECTED');
    }
    const heartbeatLines = heartbeatResult.stdout.split(/\r?\n/).filter(Boolean);
    let heartbeatPayload;
    try { heartbeatPayload = JSON.parse(heartbeatLines.at(-1) || 'null'); } catch {
      fail('FEATURE_STORYBOARD_LATE_HEARTBEAT_JSON_INVALID');
    }
    if (heartbeatResult.status !== 0 || heartbeatPayload?.ok !== true || heartbeatPayload?.leaseValid !== false) {
      fail('FEATURE_STORYBOARD_LATE_HEARTBEAT_NOT_REJECTED');
    }
    if (Number(scalar(`SELECT count(*) FROM public.admin_storyboard_production_projects
      WHERE request_id='${ids.raceRequest}';`)) !== 0
      || Number(scalar(`SELECT count(*) FROM public.admin_storyboard_production_jobs
        WHERE request_id='${ids.raceRequest}';`)) !== 0) {
      fail('FEATURE_STORYBOARD_LATE_WRITE_COMMITTED');
    }
    return Object.freeze({
      initialWaits,
      tableWaits,
      adminCreateRejected: true,
      heartbeatLeaseInvalidated: true,
      lateProjectRows: 0,
      lateJobRows: 0,
    });
  } finally {
    await Promise.allSettled(sessions.map(closePsqlSession));
  }
}

function featureRuntimeCapabilityState(stage) {
  const rpcInstalled = scalar(
    "SELECT (to_regprocedure('public.get_feature_runtime_capability(uuid)') IS NOT NULL)::text;",
  ) === 'true';
  if (!rpcInstalled) return Object.freeze({ stage, rpcInstalled: false, status: 'held' });
  const receipt = json(
    `SELECT public.get_feature_runtime_capability('${ids.owner}')::text;`,
    'service_role',
  );
  return Object.freeze({ stage, rpcInstalled: true, ...receipt });
}

function assertFeatureRuntimeCapability(state, ready) {
  if (state.status !== (ready ? 'ready' : 'held')) {
    fail('FEATURE_SQL_RUNTIME_CAPABILITY_STATUS_INVALID', state.stage);
  }
  if (!state.rpcInstalled) {
    if (ready) fail('FEATURE_SQL_RUNTIME_CAPABILITY_RPC_MISSING', state.stage);
    return;
  }
  if (state.schema_version !== 1
    || state.code !== (ready ? 'FEATURE_DATABASE_READY' : 'FEATURE_DATABASE_HELD')
    || state.capability_version !== 'review-media-feature-v1'
    || Object.keys(state).sort().join(',')
      !== 'capability_version,code,rpcInstalled,schema_version,stage,status') {
    fail('FEATURE_SQL_RUNTIME_CAPABILITY_RECEIPT_INVALID', state.stage);
  }
}

function verifyRuntimeCapabilityCatalogDrift() {
  const cases = [
    {
      kind: 'column',
      name: 'receipt_hash',
      drift: "ALTER TABLE public.reviews ALTER COLUMN receipt_hash SET DEFAULT 'runtime-drift'::text;",
      restore: 'ALTER TABLE public.reviews ALTER COLUMN receipt_hash DROP DEFAULT;',
    },
    {
      kind: 'column',
      name: 'receipt_data',
      drift: "ALTER TABLE public.reviews ALTER COLUMN receipt_data SET DEFAULT '{}'::jsonb;",
      restore: 'ALTER TABLE public.reviews ALTER COLUMN receipt_data DROP DEFAULT;',
    },
    {
      kind: 'column',
      name: 'is_duplicate',
      drift: 'ALTER TABLE public.reviews ALTER COLUMN is_duplicate SET DEFAULT true;',
      restore: 'ALTER TABLE public.reviews ALTER COLUMN is_duplicate SET DEFAULT false;',
    },
    {
      kind: 'column',
      name: 'ocr_processed_at',
      drift: "ALTER TABLE public.reviews ALTER COLUMN ocr_processed_at SET DEFAULT 'epoch'::timestamptz;",
      restore: 'ALTER TABLE public.reviews ALTER COLUMN ocr_processed_at DROP DEFAULT;',
    },
    {
      kind: 'index',
      name: 'idx_reviews_receipt_hash',
      drift: `DROP INDEX public.idx_reviews_receipt_hash;
CREATE INDEX idx_reviews_receipt_hash
  ON public.reviews USING btree (receipt_hash)
  WHERE receipt_hash IS NOT NULL;`,
      restore: `DROP INDEX public.idx_reviews_receipt_hash;
CREATE UNIQUE INDEX idx_reviews_receipt_hash
  ON public.reviews USING btree (receipt_hash)
  WHERE receipt_hash IS NOT NULL;`,
    },
    {
      kind: 'index',
      name: 'reviews_ocr_pending_idx',
      drift: `DROP INDEX public.reviews_ocr_pending_idx;
CREATE INDEX reviews_ocr_pending_idx
  ON public.reviews USING btree (receipt_hash)
  WHERE verification_photo IS NOT NULL;`,
      restore: `DROP INDEX public.reviews_ocr_pending_idx;
CREATE INDEX reviews_ocr_pending_idx
  ON public.reviews USING btree (ocr_processed_at)
  WHERE verification_photo IS NOT NULL;`,
    },
    {
      kind: 'index',
      name: 'reviews_duplicate_idx',
      drift: `DROP INDEX public.reviews_duplicate_idx;
CREATE INDEX reviews_duplicate_idx
  ON public.reviews USING hash (is_duplicate);`,
      restore: `DROP INDEX public.reviews_duplicate_idx;
CREATE INDEX reviews_duplicate_idx
  ON public.reviews USING btree (is_duplicate);`,
    },
  ];
  const receipts = [];
  const initial = featureRuntimeCapabilityState('catalog-drift-initial');
  assertFeatureRuntimeCapability(initial, true);
  for (const item of cases) {
    psql(item.drift);
    let held;
    try {
      held = featureRuntimeCapabilityState(`${item.kind}-${item.name}-held`);
    } finally {
      // Keep the disposable harness internally recoverable even when the
      // held-state assertion exposes a regression. Later cases and cleanup
      // must observe the admitted catalog, not the intentionally damaged one.
      psql(item.restore);
    }
    assertFeatureRuntimeCapability(held, false);
    const ready = featureRuntimeCapabilityState(`${item.kind}-${item.name}-restored`);
    assertFeatureRuntimeCapability(ready, true);
    receipts.push(Object.freeze({
      kind: item.kind,
      name: item.name,
      heldStatus: held.status,
      restoredStatus: ready.status,
    }));
  }
  return Object.freeze({
    initialStatus: initial.status,
    cases: Object.freeze(receipts),
  });
}

async function checkFeatureRollbacks(featureBytes) {
  const verified = {};
  let storyboardCutoverRace = null;
  const runtimeCapabilityStages = [featureRuntimeCapabilityState('base97')];
  assertFeatureRuntimeCapability(runtimeCapabilityStages[0], false);
  for (const [index, path] of FEATURE_PATHS.entries()) {
    const bytes = featureBytes.get(path);
    if (typeof bytes !== 'string' || bytes.length === 0) fail('FEATURE_SQL_SOURCE_EMPTY', path);
    const marker = `FEATURE_SQL_${index + 1}_FORCED_ROLLBACK`;
    const before = rollbackState();
    const fault = psql(faultedMigration(path, bytes, marker), { allowFailure: true });
    if (fault.status === 0 || !fault.stderr.includes(marker)) {
      fail('FEATURE_SQL_ROLLBACK_FAULT_MISSING', path);
    }
    if (rollbackState() !== before) fail('FEATURE_SQL_ROLLBACK_DRIFT', path);
    if (index === 0) storyboardCutoverRace = await applyStoryboardWithLateInvocations(bytes);
    else applyFile(path, bytes);
    insertLedger(path);
    const capability = featureRuntimeCapabilityState(`feature${98 + index}`);
    assertFeatureRuntimeCapability(capability, index === FEATURE_PATHS.length - 1);
    runtimeCapabilityStages.push(capability);
    verified[path] = true;
  }
  return Object.freeze({
    migrations: Object.freeze(verified),
    storyboardCutoverRace,
    runtimeCapabilityStages: Object.freeze(runtimeCapabilityStages),
  });
}

function verifyStoryboard() {
  const state = legacyState();
  if (state.projects?.length !== 2 || state.projects.some(row => row.status !== 'cancelled')) {
    fail('FEATURE_STORYBOARD_PROJECT_CUTOVER_INVALID');
  }
  if (state.jobs?.length !== 2 || state.jobs.some(row => row.status !== 'cancelled'
    || row.stage !== 'cancelled' || row.errorCode !== 'generation_cancelled'
    || row.workerId !== null || row.leaseToken !== null || row.leaseExpiresAt !== null)) {
    fail('FEATURE_STORYBOARD_JOB_CUTOVER_INVALID');
  }
  if (state.events !== 2) fail('FEATURE_STORYBOARD_EVENT_COUNT_INVALID');
  const archivedProjectWrite = psql(`UPDATE public.admin_storyboard_production_projects
    SET title='late old rpc' WHERE id='${ids.queuedProject}';`, { allowFailure: true });
  const archivedJobWrite = psql(`UPDATE public.admin_storyboard_production_jobs
    SET attempts=attempts+1 WHERE id='${ids.queuedJob}';`, { allowFailure: true });
  const archivedEventWrite = psql(`INSERT INTO public.admin_storyboard_production_events(
    project_id,owner_id,job_id,operation,revision,error_code)
    VALUES('${ids.queuedProject}','${ids.owner}','${ids.queuedJob}','cancelled',0,'generation_cancelled');`, { allowFailure: true });
  for (const attempt of [archivedProjectWrite, archivedJobWrite, archivedEventWrite]) {
    if (attempt.status === 0 || !/archived_project_read_only/.test(attempt.stderr)) {
      fail('FEATURE_STORYBOARD_ARCHIVE_WRITE_NOT_REJECTED');
    }
  }
  const archiveGuard = json(`SELECT jsonb_build_object(
    'triggerCount',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE t.tgname LIKE 'storyboard_archive_%_write_guard' AND t.tgenabled='O' AND NOT t.tgisinternal),
    'publicExecute',(SELECT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') FROM pg_proc p
      WHERE p.oid='public.storyboard_production_reject_archived_write()'::regprocedure),
    'anonExecute',has_function_privilege('anon','public.storyboard_production_reject_archived_write()','EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated','public.storyboard_production_reject_archived_write()','EXECUTE'),
    'serviceExecute',has_function_privilege('service_role','public.storyboard_production_reject_archived_write()','EXECUTE')
  )::text;`);
  if (archiveGuard.triggerCount !== 6 || archiveGuard.publicExecute || archiveGuard.anonExecute
    || archiveGuard.authenticatedExecute || archiveGuard.serviceExecute) {
    fail('FEATURE_STORYBOARD_ARCHIVE_GUARD_INVALID');
  }
  const sourceGates = Number(scalar(`SELECT
    (length(pg_get_functiondef('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure))
     - length(replace(pg_get_functiondef('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure),'storyboard-gemini-v1','')))
     / length('storyboard-gemini-v1');`));
  if (sourceGates < 4) fail('FEATURE_STORYBOARD_WORKER_GATE_INVALID', String(sourceGates));
  const constraints = json(`SELECT jsonb_build_object(
    'request',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_storyboard_production_projects_request_workflow_check'),
    'document',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_storyboard_production_projects_document_workflow_check'),
    'revision',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_storyboard_production_revisions_document_workflow_check')
  )::text;`);
  if (!constraints.request?.includes('storyboard-gemini-v1')
    || !constraints.request.includes('gemini-3.8-flash')
    || !constraints.request.includes('gemini-3.1-flash-image')
    || !constraints.request.includes('gemini-3-pro-image')
    || !constraints.document?.includes('request')
    || !constraints.revision?.includes('storyboard-gemini-v1')) {
    fail('FEATURE_STORYBOARD_CONTRACT_INVALID');
  }
  return Object.freeze({
    legacyProjectsCancelled: 2,
    legacyJobsCancelled: 2,
    cutoverEvents: 2,
    workerWorkflowGateOccurrences: sourceGates,
    archivedProjectWriteRejected: true,
    archivedJobWriteRejected: true,
    archivedEventWriteRejected: true,
    archiveGuard,
  });
}

async function verifyOcrStorageRaces({ resultId, resultRevision, imageHash }) {
  const createWinsVerificationPath = `${ids.owner}/reviews/${ids.createWinsReview}/verification/receipt.jpg`;
  const createWinsFoodPath = `${ids.owner}/reviews/${ids.createWinsReview}/food/meal.jpg`;
  const deleteWinsVerificationPath = `${ids.owner}/reviews/${ids.deleteWinsReview}/verification/receipt.jpg`;
  const deleteWinsFoodPath = `${ids.owner}/reviews/${ids.deleteWinsReview}/food/meal.jpg`;
  const createReviewSql = ({ reviewId, verificationPath, foodPath, verificationObject }) => `
    SET ROLE service_role;
    SELECT public.create_review_with_receipt_ocr(
      '${reviewId}','${ids.owner}','${ids.restaurant}','race title','race content',
      '2026-10-12T12:34:00Z',${quote(verificationPath)},ARRAY[${quote(foodPath)}],ARRAY['한식'],
      '${resultId}','${resultRevision}','${verificationObject}','v1','2026-10-13T00:00:00Z',
      '${imageHash}','{}'::jsonb
    );
  `;
  const blockingGraph = applications => json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'application',activity.application_name,
      'waitType',activity.wait_event_type,
      'waitEvent',activity.wait_event,
      'blockers',coalesce((
        SELECT jsonb_agg(blocker.application_name ORDER BY blocker.application_name)
        FROM unnest(pg_blocking_pids(activity.pid)) blocker_pid
        JOIN pg_stat_activity blocker ON blocker.pid=blocker_pid
      ),'[]'::jsonb)
    ) ORDER BY activity.application_name),'[]'::jsonb)::text
    FROM pg_stat_activity activity
    WHERE activity.datname=current_database()
      AND activity.application_name = ANY(ARRAY[${applications.map(quote).join(',')}]);`);

  const orphanDelete = psql(`BEGIN;
  SET LOCAL storage.allow_delete_query='true';
  WITH deleted AS (
    DELETE FROM storage.objects WHERE id='${ids.orphanVerificationObject}' RETURNING 1
  ) SELECT count(*) FROM deleted;
  COMMIT;`, {
    actor: 'supabase_admin', role: 'supabase_storage_admin', allowFailure: true,
  });
  if (orphanDelete.status !== 0 || orphanDelete.stdout.trim() !== '1') {
    fail(
      'FEATURE_OCR_UNREFERENCED_DELETE_OVERBLOCKED',
      `${orphanDelete.status}:${orphanDelete.stderr.replace(/\s+/g, ' ').slice(0, 220)}`,
    );
  }
  const orphanTombstone = json(`SELECT jsonb_build_object(
    'ownerId',owner_id,'reviewId',review_id,'purpose',purpose,'retired',retired,'complete',complete
  )::text FROM review_media_private.cleanup WHERE path=${quote(`${ids.owner}/reviews/${ids.staleReview}/verification/orphan.jpg`)};`);
  if (orphanTombstone.ownerId !== ids.owner
    || orphanTombstone.reviewId !== ids.staleReview
    || orphanTombstone.purpose !== 'verification'
    || orphanTombstone.retired !== true
    || orphanTombstone.complete !== false) {
    fail('FEATURE_OCR_UNREFERENCED_DELETE_TOMBSTONE_INVALID');
  }

  const createWinsCreate = startPsqlSession('feature_ocr_create_wins_create');
  const createWinsDelete = startPsqlSession('feature_ocr_create_wins_delete', 'supabase_admin');
  const createWinsSessions = [createWinsCreate, createWinsDelete];
  let createWinsGraph;
  try {
    createWinsCreate.child.stdin.write(`BEGIN;
      ${createReviewSql({
        reviewId: ids.createWinsReview,
        verificationPath: createWinsVerificationPath,
        foodPath: createWinsFoodPath,
        verificationObject: ids.createWinsVerificationObject,
      })}
      SELECT 'feature_ocr_create_wins_staged';
    `);
    await waitUntil(
      () => createWinsCreate.output().stdout.includes('feature_ocr_create_wins_staged'),
      'FEATURE_OCR_CREATE_WINS_NOT_STAGED',
    );
    createWinsDelete.child.stdin.end(`SET ROLE supabase_storage_admin;
      BEGIN;
      SET LOCAL storage.allow_delete_query='true';
      DELETE FROM storage.objects WHERE id='${ids.createWinsVerificationObject}';
      COMMIT;
    `);
    createWinsGraph = await waitUntil(() => {
      const rows = blockingGraph([
        'feature_ocr_create_wins_create',
        'feature_ocr_create_wins_delete',
      ]);
      const deleteRow = rows.find(row => row.application === 'feature_ocr_create_wins_delete');
      return deleteRow?.waitType === 'Lock'
        && deleteRow.blockers?.includes('feature_ocr_create_wins_create') ? rows : null;
    }, 'FEATURE_OCR_CREATE_WINS_DELETE_WAIT_UNPROVEN');
    createWinsCreate.child.stdin.end('COMMIT;\n\\q\n');
    const [createResult, deleteResult] = await Promise.all([
      createWinsCreate.completed,
      createWinsDelete.completed,
    ]);
    if (createResult.status !== 0
      || !createResult.stdout.split(/\r?\n/).filter(Boolean).includes(ids.createWinsReview)) {
      fail(
        'FEATURE_OCR_CREATE_WINS_REVIEW_NOT_COMMITTED',
        `${createResult.status}:${createResult.stdout.replace(/\s+/g, ' ').slice(0, 120)}:${createResult.stderr.replace(/\s+/g, ' ').slice(0, 220)}`,
      );
    }
    if (deleteResult.status === 0
      || !/REVIEW_VERIFICATION_OBJECT_REFERENCED/.test(deleteResult.stderr)) {
      fail('FEATURE_OCR_CREATE_WINS_DELETE_NOT_REJECTED');
    }
    const committed = json(`SELECT jsonb_build_object(
      'reviewCount',(SELECT count(*) FROM public.reviews WHERE id='${ids.createWinsReview}'),
      'objectCount',(SELECT count(*) FROM storage.objects WHERE id='${ids.createWinsVerificationObject}')
    )::text;`);
    if (committed.reviewCount !== 1 || committed.objectCount !== 1) {
      fail('FEATURE_OCR_CREATE_WINS_READBACK_INVALID');
    }
    if (Number(scalar(`SELECT count(*) FROM review_media_private.cleanup
      WHERE path=${quote(createWinsVerificationPath)};`)) !== 0) {
      fail('FEATURE_OCR_CREATE_WINS_TOMBSTONE_DRIFT');
    }
  } finally {
    await Promise.allSettled(createWinsSessions.map(closePsqlSession));
  }

  const deleteWinsDelete = startPsqlSession('feature_ocr_delete_wins_delete', 'supabase_admin');
  const deleteWinsCreate = startPsqlSession('feature_ocr_delete_wins_create');
  const deleteWinsSessions = [deleteWinsDelete, deleteWinsCreate];
  let deleteWinsGraph;
  try {
    deleteWinsDelete.child.stdin.write(`SET ROLE supabase_storage_admin;
      BEGIN;
      SET LOCAL storage.allow_delete_query='true';
      DELETE FROM storage.objects WHERE id='${ids.deleteWinsVerificationObject}';
      SELECT 'feature_ocr_delete_wins_staged';
    `);
    await waitUntil(
      () => deleteWinsDelete.output().stdout.includes('feature_ocr_delete_wins_staged'),
      'FEATURE_OCR_DELETE_WINS_NOT_STAGED',
    );
    deleteWinsCreate.child.stdin.end(createReviewSql({
      reviewId: ids.deleteWinsReview,
      verificationPath: deleteWinsVerificationPath,
      foodPath: deleteWinsFoodPath,
      verificationObject: ids.deleteWinsVerificationObject,
    }));
    deleteWinsGraph = await waitUntil(() => {
      const rows = blockingGraph(['feature_ocr_delete_wins_create']);
      return rows.length === 1
        && rows[0].waitType === 'Lock'
        && rows[0].blockers?.includes('feature_ocr_delete_wins_delete') ? rows : null;
    }, 'FEATURE_OCR_DELETE_WINS_CREATE_WAIT_UNPROVEN');
    deleteWinsDelete.child.stdin.end('COMMIT;\n\\q\n');
    const deleteResult = await deleteWinsDelete.completed;
    const createResult = await deleteWinsCreate.completed;
    if (deleteResult.status !== 0) fail('FEATURE_OCR_DELETE_WINS_NOT_COMMITTED');
    if (createResult.status === 0
      || !/receipt_verification_object_not_available/.test(createResult.stderr)) {
      fail('FEATURE_OCR_DELETE_WINS_CREATE_NOT_REJECTED');
    }
    const committed = json(`SELECT jsonb_build_object(
      'reviewCount',(SELECT count(*) FROM public.reviews WHERE id='${ids.deleteWinsReview}'),
      'objectCount',(SELECT count(*) FROM storage.objects WHERE id='${ids.deleteWinsVerificationObject}'),
      'tombstone',(SELECT jsonb_build_object(
        'ownerId',owner_id,'reviewId',review_id,'purpose',purpose,'retired',retired,'complete',complete)
        FROM review_media_private.cleanup WHERE path=${quote(deleteWinsVerificationPath)})
    )::text;`);
    if (committed.reviewCount !== 0
      || committed.objectCount !== 0
      || committed.tombstone?.ownerId !== ids.owner
      || committed.tombstone?.reviewId !== ids.deleteWinsReview
      || committed.tombstone?.purpose !== 'verification'
      || committed.tombstone?.retired !== true
      || committed.tombstone?.complete !== false) {
      fail('FEATURE_OCR_DELETE_WINS_READBACK_INVALID');
    }
  } finally {
    await Promise.allSettled(deleteWinsSessions.map(closePsqlSession));
  }

  return Object.freeze({
    unreferencedVerificationDeleteAllowed: true,
    createWinsDeleteRejected: true,
    deleteWinsCreateRejected: true,
    orphanTombstone,
    createWinsBlockingGraph: createWinsGraph,
    deleteWinsBlockingGraph: deleteWinsGraph,
  });
}

async function verifyOcrPublishResetLocks({
  reviewId,
  generation,
  resultId,
  resultRevision,
  receiptData,
  modelPolicySql,
  payload,
}) {
  const deadlocksBefore = Number(scalar(
    "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();",
  ));
  const blockingGraph = applications => json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'application',activity.application_name,
      'waitType',activity.wait_event_type,
      'waitEvent',activity.wait_event,
      'blockers',coalesce((
        SELECT jsonb_agg(blocker.application_name ORDER BY blocker.application_name)
        FROM unnest(pg_blocking_pids(activity.pid)) blocker_pid
        JOIN pg_stat_activity blocker ON blocker.pid=blocker_pid
      ),'[]'::jsonb)
    ) ORDER BY activity.application_name),'[]'::jsonb)::text
    FROM pg_stat_activity activity
    WHERE activity.datname=current_database()
      AND activity.application_name = ANY(ARRAY[${applications.map(quote).join(',')}]);`);

  const publishFirst = startPsqlSession('feature_ocr_publish_first');
  const resetSecond = startPsqlSession('feature_ocr_reset_second');
  let publishFirstGraph;
  try {
    publishFirst.child.stdin.write(`BEGIN;
SET ROLE service_role;
SELECT public.publish_review_receipt_ocr_result(
  '${ids.owner}','${reviewId}','${generation}','${resultId}','${resultRevision}',NULL,
  ${quote(JSON.stringify(receiptData))}::jsonb,false
)::text;
SELECT 'publish_locked';
`);
    await waitUntil(
      () => publishFirst.output().stdout.includes('publish_locked'),
      'FEATURE_OCR_PUBLISH_FIRST_LOCK_NOT_ACQUIRED',
    );
    resetSecond.child.stdin.end(`BEGIN;
SET ROLE service_role;
UPDATE public.reviews
SET ocr_processed_at=NULL,receipt_data=NULL,receipt_hash=NULL,is_duplicate=false
WHERE id='${reviewId}' AND user_id='${ids.owner}';
COMMIT;
\\q
`);
    publishFirstGraph = await waitUntil(() => {
      const rows = blockingGraph(['feature_ocr_publish_first', 'feature_ocr_reset_second']);
      const reset = rows.find(row => row.application === 'feature_ocr_reset_second');
      return reset?.waitType === 'Lock'
        && reset.blockers?.includes('feature_ocr_publish_first') ? rows : null;
    }, 'FEATURE_OCR_PUBLISH_FIRST_BLOCKING_UNPROVEN');
    publishFirst.child.stdin.end('COMMIT;\n\\q\n');
    const [publishResult, resetResult] = await Promise.all([
      publishFirst.completed,
      resetSecond.completed,
    ]);
    if (publishResult.status !== 0 || resetResult.status !== 0
      || /40P01|deadlock detected/i.test(`${publishResult.stderr}\n${resetResult.stderr}`)) {
      fail('FEATURE_OCR_PUBLISH_FIRST_DEADLOCK_OR_FAILURE');
    }
  } finally {
    await Promise.allSettled([closePsqlSession(publishFirst), closePsqlSession(resetSecond)]);
  }

  const afterPublishFirstReset = json(`SELECT public.get_review_receipt_ocr_generation(
    '${ids.owner}','${reviewId}'
  )::text;`, 'service_role');
  if (afterPublishFirstReset.status !== 'ready'
    || afterPublishFirstReset.generation === generation) {
    fail('FEATURE_OCR_PUBLISH_FIRST_RESET_GENERATION_INVALID');
  }

  const barrierImageHash = 'f'.repeat(64);
  const barrierContextHash = 'a'.repeat(64);
  const barrierClaim = json(`SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${barrierImageHash}','${barrierContextHash}','gemini',${modelPolicySql},
    '${afterPublishFirstReset.generation}','receipt-public-ocr-v1','receipt-image-v1',
    'receipt-normalization-v1','${ids.authenticatedBarrierOperation}',false
  )::text;`, 'service_role');
  if (barrierClaim.status !== 'claimed' || !barrierClaim.result_ref || !barrierClaim.claim_token) {
    fail('FEATURE_OCR_BARRIER_CLAIM_INVALID');
  }
  json(`SELECT public.mark_receipt_ocr_dispatched(
    '${barrierClaim.result_ref}','${barrierClaim.claim_token}'
  )::text;`, 'service_role');
  const barrierCompleted = json(`SELECT public.complete_receipt_ocr_result(
    '${barrierClaim.result_ref}','${barrierClaim.claim_token}',${quote(JSON.stringify(payload))}::jsonb
  )::text;`, 'service_role');
  if (barrierCompleted.status !== 'succeeded' || !barrierCompleted.result_revision) {
    fail('FEATURE_OCR_BARRIER_COMPLETE_INVALID');
  }

  const resetFirst = startPsqlSession('feature_ocr_reset_first');
  const publishSecond = startPsqlSession('feature_ocr_publish_second');
  let resetFirstGraph;
  try {
    resetFirst.child.stdin.write(`BEGIN;
SET ROLE service_role;
UPDATE public.reviews
SET ocr_processed_at=NULL,receipt_data=NULL,receipt_hash=NULL,is_duplicate=false
WHERE id='${reviewId}' AND user_id='${ids.owner}';
SELECT 'reset_locked';
`);
    await waitUntil(
      () => resetFirst.output().stdout.includes('reset_locked'),
      'FEATURE_OCR_RESET_FIRST_LOCK_NOT_ACQUIRED',
    );
    publishSecond.child.stdin.end(`BEGIN;
SET ROLE service_role;
SELECT public.publish_review_receipt_ocr_result(
  '${ids.owner}','${reviewId}','${afterPublishFirstReset.generation}',
  '${barrierClaim.result_ref}','${barrierCompleted.result_revision}',NULL,
  ${quote(JSON.stringify(receiptData))}::jsonb,false
);
COMMIT;
\\q
`);
    resetFirstGraph = await waitUntil(() => {
      const rows = blockingGraph(['feature_ocr_reset_first', 'feature_ocr_publish_second']);
      const publisher = rows.find(row => row.application === 'feature_ocr_publish_second');
      return publisher?.waitType === 'Lock'
        && publisher.blockers?.includes('feature_ocr_reset_first') ? rows : null;
    }, 'FEATURE_OCR_RESET_FIRST_BLOCKING_UNPROVEN');
    resetFirst.child.stdin.end('COMMIT;\n\\q\n');
    const [resetResult, publishResult] = await Promise.all([
      resetFirst.completed,
      publishSecond.completed,
    ]);
    if (resetResult.status !== 0
      || publishResult.status === 0
      || !/review_ocr_generation_stale/.test(publishResult.stderr)
      || /40P01|deadlock detected/i.test(`${resetResult.stderr}\n${publishResult.stderr}`)) {
      fail('FEATURE_OCR_RESET_FIRST_STALE_REJECTION_INVALID');
    }
  } finally {
    await Promise.allSettled([closePsqlSession(resetFirst), closePsqlSession(publishSecond)]);
  }

  const deadlocksAfter = Number(scalar(
    "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();",
  ));
  if (deadlocksAfter !== deadlocksBefore) fail('FEATURE_OCR_RESET_PUBLISH_DEADLOCK_RECORDED');
  return Object.freeze({
    deadlocksBefore,
    deadlocksAfter,
    publishFirstGraph,
    resetFirstGraph,
    publishFirstThenResetSucceeded: true,
    resetFirstStalePublishRejected: true,
  });
}

async function verifyOcr() {
  const imageHash = 'b'.repeat(64);
  const contextHash = 'c'.repeat(64);
  const defaultGeneration = '00000000-0000-0000-0000-000000000000';
  const modelPolicy = ['gemini-3.8-flash', 'gemini-3.7-flash'];
  const modelPolicySql = `${quote(JSON.stringify(modelPolicy))}::jsonb`;
  const verificationPath = `${ids.owner}/reviews/${ids.createdReview}/verification/receipt.jpg`;
  const foodPath = `${ids.owner}/reviews/${ids.createdReview}/food/meal.jpg`;
  const staleVerificationPath = `${ids.owner}/reviews/${ids.staleReview}/verification/receipt.jpg`;
  const staleFoodPath = `${ids.owner}/reviews/${ids.staleReview}/food/meal.jpg`;
  const createWinsVerificationPath = `${ids.owner}/reviews/${ids.createWinsReview}/verification/receipt.jpg`;
  const createWinsFoodPath = `${ids.owner}/reviews/${ids.createWinsReview}/food/meal.jpg`;
  const deleteWinsVerificationPath = `${ids.owner}/reviews/${ids.deleteWinsReview}/verification/receipt.jpg`;
  const deleteWinsFoodPath = `${ids.owner}/reviews/${ids.deleteWinsReview}/food/meal.jpg`;
  const orphanVerificationPath = `${ids.owner}/reviews/${ids.staleReview}/verification/orphan.jpg`;
  const authenticatedVerificationPath = `${ids.owner}/reviews/${ids.authenticatedReview}/verification/receipt.jpg`;
  const authenticatedFoodPath = `${ids.owner}/reviews/${ids.authenticatedReview}/food/meal.jpg`;
  const claim = json(`SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${imageHash}','${contextHash}','gemini',${modelPolicySql},'${defaultGeneration}',
    'receipt-public-ocr-v1','receipt-image-v1','receipt-normalization-v1','${ids.ocrOperation}',false
  )::text;`, 'service_role');
  if (claim.status !== 'claimed' || !claim.result_ref || !claim.claim_token) fail('FEATURE_OCR_CLAIM_INVALID');
  const resultId = claim.result_ref;
  const claimToken = claim.claim_token;
  const payload = {
    schema_version: 'receipt-public-ocr-v1', provider: 'gemini', model: 'gemini-3.7-flash',
    normalized: { store_name: 'Fixture Restaurant', date: '2026-10-12', time: '12:34', total_amount: 12345, items: [{ name: 'Fixture Meal', price: 12345 }], category: '한식', review_draft: 'fixture draft' },
    field_trust: [{ field: 'store_name', level: 'high', source: 'model_raw', reason: 'fixture evidence', needsReview: false }],
    confidence: 0.99, needs_review: [], normalization_version: 'receipt-normalization-v1',
  };
  const dispatched = json(`SELECT public.mark_receipt_ocr_dispatched('${resultId}','${claimToken}')::text;`, 'service_role');
  if (dispatched.status !== 'dispatched') fail('FEATURE_OCR_DISPATCH_INVALID');
  const completed = json(`SELECT public.complete_receipt_ocr_result('${resultId}','${claimToken}',${quote(JSON.stringify(payload))}::jsonb)::text;`, 'service_role');
  if (completed.status !== 'succeeded' || !completed.result_revision) fail('FEATURE_OCR_COMPLETE_INVALID');
  const firstResultRevision = completed.result_revision;
  const refreshedClaim = json(`SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${imageHash}','${contextHash}','gemini',${modelPolicySql},'${defaultGeneration}',
    'receipt-public-ocr-v1','receipt-image-v1','receipt-normalization-v1','${ids.ocrRefreshOperation}',true
  )::text;`, 'service_role');
  if (refreshedClaim.status !== 'claimed'
    || refreshedClaim.result_ref !== resultId
    || !refreshedClaim.claim_token) {
    fail('FEATURE_OCR_REFRESH_CLAIM_INVALID');
  }
  const refreshedPayload = {
    ...payload,
    normalized: { ...payload.normalized, review_draft: 'fixture draft refreshed' },
  };
  const refreshedDispatched = json(`SELECT public.mark_receipt_ocr_dispatched(
    '${resultId}','${refreshedClaim.claim_token}'
  )::text;`, 'service_role');
  if (refreshedDispatched.status !== 'dispatched') fail('FEATURE_OCR_REFRESH_DISPATCH_INVALID');
  const refreshedCompleted = json(`SELECT public.complete_receipt_ocr_result(
    '${resultId}','${refreshedClaim.claim_token}',${quote(JSON.stringify(refreshedPayload))}::jsonb
  )::text;`, 'service_role');
  if (refreshedCompleted.status !== 'succeeded'
    || refreshedCompleted.result_ref !== resultId
    || !refreshedCompleted.result_revision
    || refreshedCompleted.result_revision === firstResultRevision) {
    fail('FEATURE_OCR_REFRESH_REVISION_INVALID');
  }
  const resultRevision = refreshedCompleted.result_revision;
  const durableReadback = json(`SELECT public.read_receipt_ocr_result(
    '${ids.owner}','${imageHash}','${contextHash}','gemini',${modelPolicySql},'${defaultGeneration}',
    'receipt-public-ocr-v1','receipt-image-v1','receipt-normalization-v1'
  )::text;`, 'service_role');
  if (durableReadback.status !== 'succeeded'
    || durableReadback.result_ref !== resultId
    || durableReadback.result_revision !== resultRevision
    || durableReadback.result_payload?.model !== 'gemini-3.7-flash') {
    fail('FEATURE_OCR_OWNER_READBACK_INVALID');
  }
  const crossOwnerReadback = json(`SELECT public.read_receipt_ocr_result(
    '${ids.wrongUser}','${imageHash}','${contextHash}','gemini',${modelPolicySql},'${defaultGeneration}',
    'receipt-public-ocr-v1','receipt-image-v1','receipt-normalization-v1'
  )::text;`, 'service_role');
  if (JSON.stringify(crossOwnerReadback) !== JSON.stringify({ status: 'not_found' })) {
    fail('FEATURE_OCR_CROSS_OWNER_READBACK_NOT_HIDDEN');
  }

  psql(`INSERT INTO storage.buckets(id,name,public) VALUES
    ('review-verifications','review-verifications',false),('review-photos','review-photos',false)
    ON CONFLICT(id) DO NOTHING;
  INSERT INTO storage.objects(id,bucket_id,name,owner_id,version,updated_at,metadata)
  VALUES
    ('${ids.verificationObject}','review-verifications',${quote(verificationPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.foodObject}','review-photos',${quote(foodPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.createWinsVerificationObject}','review-verifications',${quote(createWinsVerificationPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.createWinsFoodObject}','review-photos',${quote(createWinsFoodPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.deleteWinsVerificationObject}','review-verifications',${quote(deleteWinsVerificationPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.deleteWinsFoodObject}','review-photos',${quote(deleteWinsFoodPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.orphanVerificationObject}','review-verifications',${quote(orphanVerificationPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.authenticatedVerificationObject}','review-verifications',${quote(authenticatedVerificationPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}'),
    ('${ids.authenticatedFoodObject}','review-photos',${quote(authenticatedFoodPath)},'${ids.owner}','v1','2026-10-13T00:00:00Z','{}');`);

  const authenticatedInsert = psql(`BEGIN;
SET LOCAL request.jwt.claim.sub='${ids.owner}';
INSERT INTO public.reviews(
  id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos,categories,
  receipt_hash,receipt_data,is_duplicate,ocr_processed_at
) VALUES (
  '${ids.authenticatedReview}','${ids.owner}','${ids.restaurant}',
  'authenticated title','authenticated review content','2026-10-12T10:00:00Z',
  ${quote(authenticatedVerificationPath)},ARRAY[${quote(authenticatedFoodPath)}],ARRAY['한식'],
  repeat('e',64),'{"schema_version":"receipt_summary_v1","status":"processed"}'::jsonb,false,now()
)
RETURNING id;
COMMIT;`, { actor: 'supabase_admin', role: 'authenticated', allowFailure: true });
  if (authenticatedInsert.status !== 0 || !authenticatedInsert.stdout.includes(ids.authenticatedReview)) {
    fail('FEATURE_OCR_AUTHENTICATED_REVIEW_INSERT_FAILED');
  }
  const generationBeforeReset = json(`SELECT public.get_review_receipt_ocr_generation(
    '${ids.owner}','${ids.authenticatedReview}'
  )::text;`, 'service_role');
  if (generationBeforeReset.status !== 'ready'
    || generationBeforeReset.review_id !== ids.authenticatedReview
    || typeof generationBeforeReset.generation !== 'string') {
    fail('FEATURE_OCR_INITIAL_GENERATION_INVALID');
  }

  const ownerMutation = psql(`BEGIN;
SET LOCAL request.jwt.claim.sub='${ids.owner}';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims=${quote(JSON.stringify({ sub: ids.owner, role: 'authenticated' }))};
SELECT public.mutate_review_with_media(
  '${ids.authenticatedOwnerEditOperation}','${ids.authenticatedReview}','edit',
  (SELECT updated_at FROM public.reviews WHERE id='${ids.authenticatedReview}'),
  'authenticated review content updated through owner RPC',ARRAY['한식'],
  ARRAY[${quote(authenticatedFoodPath)}]
);
COMMIT;`, { actor: 'supabase_admin', role: 'authenticated', allowFailure: true });
  if (ownerMutation.status !== 0
    || !ownerMutation.stdout.split(/\r?\n/).filter(Boolean).includes('REVIEW_COMMITTED')) {
    fail(
      'FEATURE_OCR_AUTHENTICATED_OWNER_MUTATION_FAILED',
      `${ownerMutation.status}:${ownerMutation.stdout.replace(/\s+/g, ' ').slice(0, 160)}:${ownerMutation.stderr.replace(/\s+/g, ' ').slice(0, 220)}`,
    );
  }
  const ownerMutationReadback = json(`SELECT pg_catalog.jsonb_build_object(
    'content',review.content,
    'generation',(SELECT generation FROM ocr_private.review_generations
      WHERE review_id=review.id AND user_id=review.user_id)
  )::text
  FROM public.reviews AS review
  WHERE review.id='${ids.authenticatedReview}' AND review.user_id='${ids.owner}';`);
  if (ownerMutationReadback.content !== 'authenticated review content updated through owner RPC'
    || ownerMutationReadback.generation !== generationBeforeReset.generation) {
    fail('FEATURE_OCR_OWNER_MUTATION_GENERATION_DRIFT');
  }

  const adminImageHash = 'd'.repeat(64);
  const adminContextHash = 'e'.repeat(64);
  const adminClaim = json(`SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${adminImageHash}','${adminContextHash}','gemini',${modelPolicySql},
    '${generationBeforeReset.generation}','receipt-public-ocr-v1','receipt-image-v1',
    'receipt-normalization-v1','${ids.authenticatedOcrOperation}',false
  )::text;`, 'service_role');
  if (adminClaim.status !== 'claimed' || !adminClaim.result_ref || !adminClaim.claim_token) {
    fail('FEATURE_OCR_ADMIN_GENERATION_CLAIM_INVALID');
  }
  json(`SELECT public.mark_receipt_ocr_dispatched(
    '${adminClaim.result_ref}','${adminClaim.claim_token}'
  )::text;`, 'service_role');
  const adminCompleted = json(`SELECT public.complete_receipt_ocr_result(
    '${adminClaim.result_ref}','${adminClaim.claim_token}',${quote(JSON.stringify(payload))}::jsonb
  )::text;`, 'service_role');
  if (adminCompleted.status !== 'succeeded' || !adminCompleted.result_revision) {
    fail('FEATURE_OCR_ADMIN_GENERATION_COMPLETE_INVALID');
  }

  const adminServiceReset = psql(`BEGIN;
UPDATE public.reviews
SET ocr_processed_at=NULL,receipt_data=NULL,receipt_hash=NULL,is_duplicate=false
WHERE id='${ids.authenticatedReview}' AND user_id='${ids.owner}'
RETURNING id;
COMMIT;`, { role: 'service_role', allowFailure: true });
  if (adminServiceReset.status !== 0 || !adminServiceReset.stdout.includes(ids.authenticatedReview)) {
    fail('FEATURE_OCR_ADMIN_SERVICE_RESET_FAILED');
  }
  const generationAfterReset = json(`SELECT public.get_review_receipt_ocr_generation(
    '${ids.owner}','${ids.authenticatedReview}'
  )::text;`, 'service_role');
  if (generationAfterReset.status !== 'ready'
    || generationAfterReset.generation === generationBeforeReset.generation) {
    fail('FEATURE_OCR_RESET_GENERATION_NOT_ROTATED');
  }
  const privateRead = psql(
    'SELECT count(*) FROM ocr_private.review_generations;',
    { actor: 'supabase_admin', role: 'authenticated', allowFailure: true },
  );
  if (privateRead.status === 0 || !/permission denied/i.test(privateRead.stderr)) {
    fail('FEATURE_OCR_PRIVATE_GENERATION_ACCESS_NOT_REJECTED');
  }

  const publishedReceipt = {
    schema_version: 'receipt_summary_v1',
    status: 'processed',
    source: 'admin_ocr',
    store_name: 'Fixture Restaurant',
  };
  const stalePublish = psql(`SELECT public.publish_review_receipt_ocr_result(
    '${ids.owner}','${ids.authenticatedReview}','${generationBeforeReset.generation}',
    '${adminClaim.result_ref}','${adminCompleted.result_revision}',NULL,
    ${quote(JSON.stringify(publishedReceipt))}::jsonb,false
  );`, { role: 'service_role', allowFailure: true });
  if (stalePublish.status === 0 || !/review_ocr_generation_stale/.test(stalePublish.stderr)) {
    fail('FEATURE_OCR_STALE_GENERATION_PUBLISH_NOT_REJECTED');
  }

  const refreshedAdminClaim = json(`SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${adminImageHash}','${adminContextHash}','gemini',${modelPolicySql},
    '${generationAfterReset.generation}','receipt-public-ocr-v1','receipt-image-v1',
    'receipt-normalization-v1','${ids.authenticatedRefreshOperation}',false
  )::text;`, 'service_role');
  if (refreshedAdminClaim.status !== 'claimed'
    || refreshedAdminClaim.result_ref === adminClaim.result_ref
    || !refreshedAdminClaim.claim_token) {
    fail('FEATURE_OCR_REFRESH_GENERATION_CLAIM_INVALID');
  }
  json(`SELECT public.mark_receipt_ocr_dispatched(
    '${refreshedAdminClaim.result_ref}','${refreshedAdminClaim.claim_token}'
  )::text;`, 'service_role');
  const refreshedAdminCompleted = json(`SELECT public.complete_receipt_ocr_result(
    '${refreshedAdminClaim.result_ref}','${refreshedAdminClaim.claim_token}',
    ${quote(JSON.stringify(payload))}::jsonb
  )::text;`, 'service_role');
  if (refreshedAdminCompleted.status !== 'succeeded' || !refreshedAdminCompleted.result_revision) {
    fail('FEATURE_OCR_REFRESH_GENERATION_COMPLETE_INVALID');
  }
  const published = json(`SELECT public.publish_review_receipt_ocr_result(
    '${ids.owner}','${ids.authenticatedReview}','${generationAfterReset.generation}',
    '${refreshedAdminClaim.result_ref}','${refreshedAdminCompleted.result_revision}',NULL,
    ${quote(JSON.stringify(publishedReceipt))}::jsonb,false
  )::text;`, 'service_role');
  const publishedAgain = json(`SELECT public.publish_review_receipt_ocr_result(
    '${ids.owner}','${ids.authenticatedReview}','${generationAfterReset.generation}',
    '${refreshedAdminClaim.result_ref}','${refreshedAdminCompleted.result_revision}',NULL,
    ${quote(JSON.stringify(publishedReceipt))}::jsonb,false
  )::text;`, 'service_role');
  if (published.status !== 'published'
    || published.review_id !== ids.authenticatedReview
    || published.generation !== generationAfterReset.generation
    || published.result_ref !== refreshedAdminClaim.result_ref
    || published.result_revision !== refreshedAdminCompleted.result_revision
    || JSON.stringify(publishedAgain) !== JSON.stringify(published)) {
    fail('FEATURE_OCR_GENERATION_PUBLISH_READBACK_INVALID');
  }
  const resetPublishLocks = await verifyOcrPublishResetLocks({
    reviewId: ids.authenticatedReview,
    generation: generationAfterReset.generation,
    resultId: refreshedAdminClaim.result_ref,
    resultRevision: refreshedAdminCompleted.result_revision,
    receiptData: publishedReceipt,
    modelPolicySql,
    payload,
  });

  const authenticatedUpdate = psql(`BEGIN;
SET LOCAL request.jwt.claim.sub='${ids.owner}';
WITH changed AS (
  UPDATE storage.objects SET metadata='{"overwrite":true}'::jsonb
  WHERE id='${ids.verificationObject}' RETURNING 1
)
SELECT count(*) FROM changed;
ROLLBACK;`, { actor: 'supabase_admin', role: 'authenticated' });
  if (authenticatedUpdate.stdout.trim() !== '0') fail('FEATURE_OCR_AUTHENTICATED_UPDATE_NOT_REJECTED');
  const storageAdminUpsert = psql(`INSERT INTO storage.objects(
      id,bucket_id,name,owner_id,version,updated_at,metadata)
    VALUES('${ids.verificationObject}','review-verifications',${quote(verificationPath)},'${ids.owner}',
      'v2','2026-10-13T00:01:00Z','{"overwrite":true}'::jsonb)
    ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,
      metadata=EXCLUDED.metadata;`, { actor: 'supabase_admin', role: 'supabase_storage_admin', allowFailure: true });
  if (storageAdminUpsert.status === 0
    || !/REVIEW_VERIFICATION_OBJECT_IMMUTABLE/.test(storageAdminUpsert.stderr)) {
    fail('FEATURE_OCR_STORAGE_ADMIN_UPSERT_NOT_REJECTED');
  }
  const foodUpdate = psql(`BEGIN;
UPDATE storage.objects SET metadata='{"food":true}'::jsonb WHERE id='${ids.foodObject}';
ROLLBACK;`, { actor: 'supabase_admin', role: 'supabase_storage_admin', allowFailure: true });
  if (foodUpdate.status !== 0) fail('FEATURE_OCR_FOOD_UPDATE_OVERBLOCKED');
  const verificationObject = json(`SELECT jsonb_build_object(
    'version',version,'updatedAt',updated_at,'metadata',metadata
  )::text FROM storage.objects WHERE id='${ids.verificationObject}';`);
  if (verificationObject.version !== 'v1'
    || verificationObject.updatedAt !== '2026-10-13T00:00:00+00:00'
    || Object.keys(verificationObject.metadata || {}).length !== 0) {
    fail('FEATURE_OCR_VERIFICATION_OBJECT_DRIFT');
  }
  const staleRevision = psql(`SELECT public.create_review_with_receipt_ocr(
    '${ids.staleReview}','${ids.owner}','${ids.restaurant}','stale','stale','2026-10-12T12:34:00Z',
    ${quote(staleVerificationPath)},ARRAY[${quote(staleFoodPath)}],ARRAY['한식'],'${resultId}','${firstResultRevision}',
    '${ids.verificationObject}','v1','2026-10-13T00:00:00Z','${imageHash}','{}');`, { role: 'service_role', allowFailure: true });
  if (staleRevision.status === 0 || !/receipt_ocr_result_stale/.test(staleRevision.stderr)) {
    fail('FEATURE_OCR_STALE_REVISION_NOT_REJECTED');
  }
  const created = scalar(`SELECT public.create_review_with_receipt_ocr(
    '${ids.createdReview}','${ids.owner}','${ids.restaurant}','OCR title','OCR content','2026-10-12T12:34:00Z',
    ${quote(verificationPath)},ARRAY[${quote(foodPath)}],ARRAY['한식'],'${resultId}','${resultRevision}','${ids.verificationObject}','v1',
    '2026-10-13T00:00:00Z','${imageHash}',jsonb_build_object('title','operator correction')
  );`, 'service_role');
  if (created !== ids.createdReview) fail('FEATURE_OCR_REVIEW_CREATE_INVALID');

  const newReview = json(`SELECT jsonb_build_object(
    'receiptData',receipt_data,'receiptHash',receipt_hash,'duplicate',is_duplicate,'processed',ocr_processed_at IS NOT NULL,
    'verification',verification_photo,'foods',food_photos
  )::text FROM public.reviews WHERE id='${ids.createdReview}';`);
  if (newReview.receiptData?.user_corrections?.title !== 'operator correction'
    || newReview.receiptData?.source !== 'public_ocr'
    || newReview.receiptData?.ocr_result_id !== resultId
    || newReview.receiptData?.ocr_result_revision !== resultRevision
    || newReview.verification !== verificationPath
    || newReview.foods?.[0] !== foodPath
    || newReview.duplicate !== false
    || newReview.processed !== true
    || !/^[0-9a-f]{64}$/.test(newReview.receiptHash || '')) {
    fail('FEATURE_OCR_REVIEW_READBACK_INVALID');
  }
  const storageRaces = await verifyOcrStorageRaces({ resultId, resultRevision, imageHash });

  const boundary = json(`SELECT jsonb_build_object(
    'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='ocr_private.receipt_results'::regclass),
    'forceRls',(SELECT relforcerowsecurity FROM pg_class WHERE oid='ocr_private.receipt_results'::regclass),
    'anonExecute',has_function_privilege('anon','public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)','EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated','public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)','EXECUTE'),
    'serviceExecute',has_function_privilege('service_role','public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)','EXECUTE'),
    'anonSchema',has_schema_privilege('anon','ocr_private','USAGE'),
    'authenticatedSchema',has_schema_privilege('authenticated','ocr_private','USAGE'),
    'serviceTable',has_table_privilege('service_role','ocr_private.receipt_results','SELECT')
  )::text;`);
  if (!boundary.rls || !boundary.forceRls || boundary.anonExecute || boundary.authenticatedExecute
    || !boundary.serviceExecute || boundary.anonSchema || boundary.authenticatedSchema || boundary.serviceTable) {
    fail('FEATURE_OCR_ROLE_BOUNDARY_INVALID');
  }
  const anonCall = psql(`SET ROLE anon; SELECT public.claim_receipt_ocr_result(
    '${ids.owner}','${imageHash}','${contextHash}','gemini',${modelPolicySql},'${defaultGeneration}',
    'v','v','v','${ids.ocrOperation}',false);`, { allowFailure: true });
  if (anonCall.status === 0 || !/permission denied/i.test(anonCall.stderr)) fail('FEATURE_OCR_ANON_EXECUTE_NOT_REJECTED');
  const invalidPath = psql(`SELECT * FROM public.get_owned_review_storage_objects(
    '${ids.owner}','${ids.createdReview}','verification',ARRAY['${ids.owner}/reviews/${ids.createdReview}/verification/nested/receipt.jpg']);`, { role: 'service_role', allowFailure: true });
  if (invalidPath.status === 0 || !/invalid_review_storage_lookup/.test(invalidPath.stderr)) fail('FEATURE_OCR_PATH_BOUNDARY_NOT_REJECTED');
  const wrongOwner = psql(`SELECT public.create_review_with_receipt_ocr(
    '${ids.wrongOwnerReview}','${ids.wrongUser}','${ids.restaurant}','x','x','2026-10-12T12:34:00Z',
    ${quote(verificationPath)},ARRAY[${quote(foodPath)}],ARRAY['한식'],'${resultId}','${resultRevision}','${ids.verificationObject}','v1',
    '2026-10-13T00:00:00Z','${imageHash}','{}');`, { role: 'service_role', allowFailure: true });
  if (wrongOwner.status === 0 || !/(invalid_review_receipt_input|receipt_ocr_result_not_available)/.test(wrongOwner.stderr)) {
    fail('FEATURE_OCR_OWNER_BOUNDARY_NOT_REJECTED');
  }
  return Object.freeze({
    durableClaimCompleted: true,
    fallbackModelPolicyReadbackVerified: true,
    crossOwnerReadbackHidden: true,
    authenticatedReviewInsertSucceeded: true,
    authenticatedOwnerRpcMutationSucceeded: true,
    ownerRpcMutationPreservedGeneration: true,
    adminServiceResetRotatedGeneration: true,
    privateGenerationAccessRejected: true,
    staleGenerationPublishRejected: true,
    currentGenerationPublishIdempotent: true,
    resetPublishLocks,
    canonicalMediaPathsBound: true,
    userCorrectionPreservedInSummary: true,
    staleResultRevisionRejected: true,
    forceRefreshRetainedResultRef: true,
    forceRefreshChangedResultRevision: true,
    anonymousExecutionRejected: true,
    crossOwnerReuseRejected: true,
    nestedMediaPathRejected: true,
    authenticatedVerificationUpdateRejected: true,
    storageAdminVerificationUpsertRejected: true,
    foodObjectUpdateStillAllowed: true,
    verificationObjectReadback: verificationObject,
    storageRaces,
    roleBoundary: boundary,
  });
}

let created = false;
let removed = false;
let containerId = null;
let proof;
try {
  const sourceHeadBefore = sourceHead();
  const successorManifestBytes = readFileSync(resolve(ROOT, SUCCESSOR_MANIFEST_PATH));
  let successorManifest;
  try { successorManifest = JSON.parse(successorManifestBytes.toString('utf8')); } catch {
    fail('FEATURE_SQL_SUCCESSOR_MANIFEST_INVALID');
  }
  if (!Array.isArray(successorManifest?.migrations)
    || successorManifest.migrations.length !== 11
    || successorManifest.migrations.some(migration => typeof migration?.path !== 'string'
      || typeof migration?.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(migration.sha256)
      || migration.path.startsWith('/')
      || migration.path.split('/').includes('..'))) {
    fail('FEATURE_SQL_SUCCESSOR_MANIFEST_SHAPE_INVALID');
  }
  const frozenSourcePaths = [
    HARNESS_PATH,
    SUCCESSOR_MANIFEST_PATH,
    ...PREDECESSOR_PATHS,
    ...successorManifest.migrations.map(({ path }) => path),
    ...FEATURE_PATHS,
  ];
  if (new Set(frozenSourcePaths).size !== frozenSourcePaths.length) {
    fail('FEATURE_SQL_FROZEN_SOURCE_PATH_DUPLICATE');
  }
  const frozenSourceBytes = new Map(frozenSourcePaths.map(path => [
    path,
    path === SUCCESSOR_MANIFEST_PATH
      ? successorManifestBytes
      : readFileSync(resolve(ROOT, path)),
  ]));
  for (const migration of successorManifest.migrations) {
    if (sha256(frozenSourceBytes.get(migration.path)) !== migration.sha256) {
      fail('FEATURE_SQL_SUCCESSOR_SOURCE_HASH_MISMATCH', migration.path);
    }
  }
  const frozenSourceEntries = frozenSourcePaths.map(path => Object.freeze({
    path,
    bytes: frozenSourceBytes.get(path).byteLength,
    sha256: sha256(frozenSourceBytes.get(path)),
  }));
  const frozenSourceSnapshotSha256 = sha256(JSON.stringify(canonical(frozenSourceEntries)));
  const beforeDump = sourceDump();
  const normalizedBeforeDump = deterministicDump(beforeDump);
  const sourceBeforeSha256 = sha256(normalizedBeforeDump);
  const create = docker([
    'run', '-d', '--rm', '--name', CONTAINER, '--label', `${OWNER_LABEL}=${OWNER_TOKEN}`,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE,
  ], { allowFailure: true });
  containerId = inspectOwnedContainer();
  if (!containerId) fail('FEATURE_SQL_CONTAINER_CREATION_UNCONFIRMED');
  created = true;
  if (create.status === 0 && create.stdout.trim() && create.stdout.trim() !== containerId) {
    fail('FEATURE_SQL_CONTAINER_ACK_MISMATCH');
  }
  waitForReady();
  psql('ALTER ROLE postgres SUPERUSER;\nDROP DATABASE postgres WITH (FORCE);\nCREATE DATABASE postgres OWNER postgres TEMPLATE template0;', { actor: 'supabase_admin', database: 'template1' });
  createRequiredRoles();
  psql(beforeDump);
  const sourceStorageState = storageContractState();
  psql(`UPDATE privacy_retention.g014_public_rpc_allowlist allowed
    SET identity_arguments=procedure.proargtypes::text
    FROM pg_proc procedure
    WHERE procedure.oid=to_regprocedure(allowed.source_signature)
      AND allowed.identity_arguments IS DISTINCT FROM procedure.proargtypes::text;`);
  psql('ALTER ROLE postgres NOSUPERUSER;', { actor: 'supabase_admin' });
  for (const path of PREDECESSOR_PATHS) applyFile(path, frozenSourceBytes.get(path));
  seedPredecessorLedger();

  for (const migration of successorManifest.migrations) {
    applyFile(migration.path, frozenSourceBytes.get(migration.path));
    insertLedger(migration.path, migration.sha256);
  }
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 97) {
    fail('FEATURE_SQL_SUCCESSOR_LEDGER_INVALID');
  }

  seedFeatureRows();
  const preservedReviewBefore = preservedReviewState();
  const rolesBeforeSnapshot = roleSnapshot();
  const rolesBefore = rolesBeforeSnapshot.sha256;
  const g014AllowlistSha256Before = g014Signature();
  const g014AllowlistRowsBefore = g014AllowlistRows();
  const g014CatalogManifestSha256Before = g014CatalogManifestSignature();
  const g014MatrixBefore = g014EffectiveMatrixDiff();
  const g014AssertionsBefore = g014AssertionResults();
  const storageBefore = storageContractState();
  const featureHashesBefore = FEATURE_PATHS.map(path => ({
    path,
    sha256: sha256(frozenSourceBytes.get(path)),
  }));
  const featureBytes = new Map(FEATURE_PATHS.map(path => [
    path,
    frozenSourceBytes.get(path).toString('utf8'),
  ]));
  const rollback = await checkFeatureRollbacks(featureBytes);
  const runtimeCapabilityCatalogDrift = verifyRuntimeCapabilityCatalogDrift();
  const storyboard = verifyStoryboard();
  const ocr = await verifyOcr();

  const preservedReviewAfter = preservedReviewState();
  if (JSON.stringify(canonical(preservedReviewAfter)) !== JSON.stringify(canonical(preservedReviewBefore))) {
    fail('FEATURE_SQL_PRESERVED_REVIEW_DRIFT');
  }
  const rolesAfterSnapshot = roleSnapshot();
  const rolesAfter = rolesAfterSnapshot.sha256;
  const g014AllowlistSha256After = g014Signature();
  const g014AllowlistRowsAfter = g014AllowlistRows();
  const g014CatalogManifestSha256After = g014CatalogManifestSignature();
  const g014MatrixAfter = g014EffectiveMatrixDiff();
  const g014AssertionsAfter = g014AssertionResults();
  const g014FeatureRpcCatalog = g014FeatureRpcCatalogState();
  const g014FeatureRpcCatalogIsVerified = g014FeatureRpcCatalogVerified(g014FeatureRpcCatalog);
  const storageAfter = storageContractState();
  const g014MatrixChanges = g014MatrixDelta(g014MatrixBefore, g014MatrixAfter);
  const allowlistKey = value => `${value.sourceSignature}\u0000${value.grantee}`;
  const allowlistBeforeKeys = new Set(g014AllowlistRowsBefore.map(allowlistKey));
  const allowlistAfterKeys = new Set(g014AllowlistRowsAfter.map(allowlistKey));
  const g014AllowlistChanges = {
    added: g014AllowlistRowsAfter.filter(value => !allowlistBeforeKeys.has(allowlistKey(value))),
    removed: g014AllowlistRowsBefore.filter(value => !allowlistAfterKeys.has(allowlistKey(value))),
  };
  const expectedAllowlistChanges = EXPECTED_FEATURE_RPC_ALLOWLIST
    .map(sourceSignature => ({ sourceSignature, grantee: 'service_role' }));
  const reviewVerificationBucket = storageAfter.buckets
    .find(bucket => bucket.id === 'review-verifications');
  const storageConfigurationVerified = reviewVerificationBucket?.public === false
    && reviewVerificationBucket.fileSizeLimit === 5 * 1024 * 1024
    && JSON.stringify(reviewVerificationBucket.allowedMimeTypes) === JSON.stringify([
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
    ])
    && storageAfter.reviewVerificationPolicyCount > 0
    && storageAfter.immutablePolicy?.command === 'UPDATE'
    && storageAfter.immutablePolicy?.permissive === 'RESTRICTIVE'
    && storageAfter.immutablePolicy?.roles?.length === 1
    && storageAfter.immutablePolicy.roles[0] === 'authenticated'
    && storageAfter.immutablePolicy.using === "(bucket_id <> 'review-verifications'::text)"
    && storageAfter.immutablePolicy.check === "(bucket_id <> 'review-verifications'::text)"
    && storageAfter.immutableTrigger?.enabled === 'O'
    && storageAfter.immutableTrigger?.type === 19
    && storageAfter.immutableTrigger?.function === 'review_media_private.reject_verification_object_update()'
    && storageAfter.immutableFunction?.owner === 'privacy_workflow_owner'
    && storageAfter.immutableFunction?.securityDefiner === false
    && JSON.stringify(storageAfter.immutableFunction?.config) === JSON.stringify(['search_path=""'])
    && storageAfter.immutableFunction?.returnType === 'trigger'
    && storageAfter.immutableFunctionExecuteExposureCount === 0
    && storageAfter.deleteTrigger?.enabled === 'O'
    && storageAfter.deleteTrigger?.type === 11
    && storageAfter.deleteTrigger?.function === 'review_media_private.guard_verification_object_delete()'
    && storageAfter.deleteFunction?.owner === 'privacy_workflow_owner'
    && storageAfter.deleteFunction?.securityDefiner === true
    && JSON.stringify(storageAfter.deleteFunction?.config) === JSON.stringify(['search_path=""'])
    && storageAfter.deleteFunction?.returnType === 'trigger'
    && storageAfter.deleteFunctionExecuteExposureCount === 0;
  const findings = [];
  if (g014MatrixBefore.length !== 0 || g014AssertionsBefore.some(result => !result.passed)) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_G014_BASELINE_INVALID',
      baselineMismatchCount: g014MatrixBefore.length,
      baselineAssertions: g014AssertionsBefore,
    }));
  }
  if (g014MatrixChanges.added.length !== 0 || g014MatrixChanges.removed.length !== 0) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_G014_EFFECTIVE_MATRIX_CHANGED',
      added: g014MatrixChanges.added,
      removed: g014MatrixChanges.removed,
    }));
  }
  if (JSON.stringify(canonical(g014AllowlistChanges.added))
      !== JSON.stringify(canonical(expectedAllowlistChanges))
    || g014AllowlistChanges.removed.length !== 0) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_G014_ALLOWLIST_DELTA_INVALID',
      expected: expectedAllowlistChanges,
      actual: g014AllowlistChanges,
    }));
  }
  if (g014AssertionsAfter.some(result => !result.passed)) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_G014_ASSERTION_FAILED',
      baseline: g014AssertionsBefore,
      final: g014AssertionsAfter,
    }));
  }
  if (!g014FeatureRpcCatalogIsVerified) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_G014_FEATURE_RPC_CATALOG_INVALID',
      catalog: g014FeatureRpcCatalog,
    }));
  }
  if (g014CatalogManifestSha256After !== g014CatalogManifestSha256Before) {
    findings.push(Object.freeze({ code: 'FEATURE_SQL_G014_CATALOG_MANIFEST_DRIFT' }));
  }
  if (!storageConfigurationVerified) {
    findings.push(Object.freeze({
      code: 'FEATURE_SQL_OCR_STORAGE_MUTATION_BOUNDARY_UNVERIFIED',
      authenticatedUpdatePolicyCount: storageAfter.authenticatedUpdatePolicyCount,
      immutablePolicy: storageAfter.immutablePolicy,
      immutableTrigger: storageAfter.immutableTrigger,
      immutableFunction: storageAfter.immutableFunction,
      immutableFunctionExecuteExposureCount: storageAfter.immutableFunctionExecuteExposureCount,
      deleteTrigger: storageAfter.deleteTrigger,
      deleteFunction: storageAfter.deleteFunction,
      deleteFunctionExecuteExposureCount: storageAfter.deleteFunctionExecuteExposureCount,
      reviewVerificationPolicies: storageAfter.reviewVerificationPolicies,
    }));
  }
  if (rolesAfter !== rolesBefore) fail('FEATURE_SQL_ROLE_CATALOG_DRIFT');
  if (Number(scalar('SELECT count(*) FROM supabase_migrations.schema_migrations;')) !== 101) {
    fail('FEATURE_SQL_TERMINAL_LEDGER_INVALID');
  }
  const featureHashesAfter = FEATURE_PATHS.map(path => ({
    path,
    sha256: sha256(readFileSync(resolve(ROOT, path))),
  }));
  if (JSON.stringify(featureHashesAfter) !== JSON.stringify(featureHashesBefore)) fail('FEATURE_SQL_SOURCE_CHANGED_DURING_REPLAY');
  for (const [index, path] of frozenSourcePaths.entries()) {
    if (!readFileSync(resolve(ROOT, path)).equals(frozenSourceBytes.get(path))) {
      fail('FEATURE_SQL_FROZEN_SOURCE_CHANGED_DURING_REPLAY', `${index}:${path}`);
    }
  }
  const sourceHeadAfter = sourceHead();
  if (sourceHeadAfter !== sourceHeadBefore) fail('FEATURE_SQL_SOURCE_HEAD_CHANGED_DURING_REPLAY');
  const normalizedAfterDump = deterministicDump(sourceDump());
  const sourceAfterSha256 = sha256(normalizedAfterDump);
  if (sourceAfterSha256 !== sourceBeforeSha256) fail('FEATURE_SQL_SOURCE_CLONE_DRIFT');

  proof = {
    schemaVersion: 1,
    kind: 'feature-migration-existing-catalog-replay',
    status: findings.length === 0 ? 'passed' : 'failed',
    environment: {
      engine: scalar('SHOW server_version;'),
      image: IMAGE,
      dockerContext: DOCKER_CONTEXT,
      sourceContainer: SOURCE_CONTAINER,
      sourceDatabase: 'ranking_clone',
      targetOwnershipLabel: OWNER_LABEL,
    },
    sources: {
      sourceHead: sourceHeadAfter,
      frozenSourceSnapshotSha256,
      frozenSourcePathCount: frozenSourceEntries.length,
      frozenSourceBytes: frozenSourceEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      harness: frozenSourceEntries.find(entry => entry.path === HARNESS_PATH),
      successorManifest: frozenSourceEntries.find(entry => entry.path === SUCCESSOR_MANIFEST_PATH),
      predecessorMigrations: PREDECESSOR_PATHS.map(path => frozenSourceEntries.find(entry => entry.path === path)),
      successorMigrations: successorManifest.migrations.map(({ path }) => frozenSourceEntries.find(entry => entry.path === path)),
      featureMigrations: FEATURE_PATHS.map(path => frozenSourceEntries.find(entry => entry.path === path)),
    },
    replay: {
      predecessorLedgerRows: 86,
      successorMigrationCount: successorManifest.migrations.length,
      featureMigrationCount: FEATURE_PATHS.length,
      terminalLedgerRows: 101,
      sourceCatalogSha256Before: sourceBeforeSha256,
      sourceCatalogSha256After: sourceAfterSha256,
      sourceCatalogBytesBefore: Buffer.byteLength(normalizedBeforeDump),
      sourceCatalogBytesAfter: Buffer.byteLength(normalizedAfterDump),
      sourceCatalogUnchanged: true,
      sourceMutation: false,
      hostedWrites: false,
      providerCalls: 0,
      storageNetworkWrites: 0,
    },
    semanticResults: {
      migrationRollbackExact: rollback.migrations,
      storyboardCutoverRace: rollback.storyboardCutoverRace,
      runtimeCapabilityStages: rollback.runtimeCapabilityStages,
      runtimeCapabilityCatalogDrift,
      storyboard,
      ocr,
      preexistingReviewAndAdminCorrectionExact: true,
      roleCatalogSha256Before: rolesBefore,
      roleCatalogSha256After: rolesAfter,
      roleCatalogBytesBefore: rolesBeforeSnapshot.bytes,
      roleCatalogBytesAfter: rolesAfterSnapshot.bytes,
      roleCatalogUnchanged: true,
      g014AllowlistSha256Before,
      g014AllowlistSha256After,
      g014AllowlistChanges,
      g014CatalogManifestSha256Before,
      g014CatalogManifestSha256After,
      g014CatalogManifestUnchanged: g014CatalogManifestSha256After === g014CatalogManifestSha256Before,
      g014EffectiveMatrix: {
        baselineMismatchCount: g014MatrixBefore.length,
        finalMismatchCount: g014MatrixAfter.length,
        changes: g014MatrixChanges,
      },
      g014Assertions: { baseline: g014AssertionsBefore, final: g014AssertionsAfter },
      g014FeatureRpcCatalog: {
        verified: g014FeatureRpcCatalogIsVerified,
        ...g014FeatureRpcCatalog,
      },
      storagePrerequisite: {
        sourceCatalog: sourceStorageState,
        baseline: storageBefore,
        final: storageAfter,
        catalogConfigurationVerified: storageConfigurationVerified,
      },
    },
    findings,
    limitations: [
      'Local exact-version clone only; this is not hosted application evidence.',
      'Fixtures are synthetic and contain no operating user data.',
      'No provider, Storage service, or network request was executed.',
      'The Storage metadata update/delete guards do not fence credentials that can overwrite or remove provider bytes directly; those credentials remain an operating authority boundary.',
      'The raw source catalog contains no review-verifications bucket row; replayed predecessors create the 5 MiB bucket contract, so hosted bucket metadata still requires separate readback.',
    ],
  };
} finally {
  if (created || inspectOwnedContainer()) {
    const observed = inspectOwnedContainer();
    if (observed && containerId && observed !== containerId) fail('FEATURE_SQL_CONTAINER_ID_DRIFT');
    if (observed) docker(['container', 'rm', '--force', observed]);
    if (inspectOwnedContainer()) fail('FEATURE_SQL_CONTAINER_REMOVAL_UNCONFIRMED');
    removed = true;
  }
}

if (!proof) fail('FEATURE_SQL_PROOF_MISSING');
proof.cleanup = { ownedContainerRemoved: removed, ownedContainerIdRecorded: Boolean(containerId) };
const proofBytes = `${JSON.stringify(canonical(proof))}\n`;
if (OUTPUT_NAME !== null) {
  const outputPath = resolve(HERE, OUTPUT_NAME);
  if (dirname(outputPath) !== HERE) fail('FEATURE_SQL_OUTPUT_PATH_INVALID');
  writeImmutable(outputPath, proofBytes);
  writeImmutable(`${outputPath}.sha256`, `${sha256(proofBytes)}  ${basename(outputPath)}\n`);
}
process.stdout.write(proofBytes);
if (proof.status !== 'passed') process.exitCode = 2;
