import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from '../../../scripts/apply-supabase-migration.mjs';
import {
  bundleReconciliationOutcome,
  bundleReconciliationSql,
  compileMigrationBundle,
  migrationBundleSuffixRoot,
} from '../../../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../../../scripts/supabase-migration-transaction.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => {
  if (value.startsWith('--')) rows.push([value.slice(2), all[index + 1]]);
  return rows;
}, []));
const out = resolve(args.output ?? '');
const container = args.container ?? '';
const sourceDatabase = args['source-database'] ?? '';
const nonce = args.nonce ?? '';
const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const docker = '/opt/homebrew/bin/docker';
const context = 'colima-tzudong-catalog-20261007';
const TARGETS = [
  ['admin_record_guarded_actions', 'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql', 'b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95'],
  ['admin_evaluation_raw_warning_groups', 'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql', '66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a'],
  ['admin_evaluation_raw_warning_invoker_contract', 'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql', 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020'],
  ['restaurant_review_manual_preview_eligibility', 'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql', '8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3'],
];
const versions = TARGETS.map(([, path]) => /\/(\d{14})_/.exec(path)[1]);
const failDatabase = `tzudong_actual4_fail_${nonce}`;
const successDatabase = `tzudong_actual4_ok_${nonce}`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const expectedContainerPattern = /^tzudong-actual-bundle-[a-f0-9]{24}$/;
const result = {
  kind: 'actual-four-source-full-schema-bundle-replay',
  status: 'unconfirmed',
  operatingWrites: false,
  hostedWrites: false,
  userRowsCopied: 0,
  hostedLedgerRowsCopied: 0,
  fixturePrefix: 'local-synthetic-only',
  databases: { source: sourceDatabase, terminalMismatch: failDatabase, success: successDatabase },
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runSql(database, sql, { user = 'postgres', singleTransaction = false, expectFailure = false, timeout = 90000 } = {}) {
  const command = ['--context', context, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only', container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  if (singleTransaction) command.push('--single-transaction');
  command.push('-h', '127.0.0.1', '-U', user, '-d', database);
  const child = spawnSync(docker, command, { input: sql, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const sqlState = child.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? null;
  const fixedCode = child.stderr?.match(/\b(?:MIGRATION|RECORD_ACTION|REVIEW|G014|FIXTURE)_[A-Z0-9_]{2,96}\b/)?.[0] ?? null;
  if (expectFailure) {
    if (!child.error && child.status !== 0) return { sqlState, fixedCode, timeout: false };
    fail('EXPECTED_DATABASE_FAILURE_MISSING');
  }
  if (child.error || child.status !== 0) {
    const error = new Error('LOCAL_DATABASE_STEP_FAILED');
    error.code = child.error?.code === 'ETIMEDOUT' ? 'LOCAL_DATABASE_STEP_TIMEOUT' : 'LOCAL_DATABASE_STEP_FAILED';
    error.sqlState = sqlState;
    error.fixedCode = fixedCode;
    throw error;
  }
  return child.stdout.trim();
}

function queryJson(database, sql, options) {
  const rows = runSql(database, sql, options).split('\n').filter(line => line.startsWith('{'));
  if (!rows.length) fail('JSON_READBACK_MISSING');
  return JSON.parse(rows.at(-1));
}

function schemaHash(database) {
  const child = spawnSync(docker, ['--context', context, 'exec', '-e', 'PGPASSWORD=fixture-only', container,
    'pg_dump', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database, '--schema-only', '--no-comments',
    '--no-publications', '--no-subscriptions', '--restrict-key=TZUDONGACTUALBUNDLE20261009'],
  { encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
  if (child.error || child.status !== 0) fail('SCHEMA_HASH_FAILED');
  return sha256(child.stdout);
}

function roleState(database) {
  return queryJson(database, `SELECT jsonb_build_object(
    'roles',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY oid),'[]'::jsonb)::text,'UTF8')),'hex'),
    'members',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_auth_members m)
  ) FROM pg_roles r;`);
}

const targetsSql = versions.map(literal).join(',');
function prefixRootSql() {
  return `WITH prefix AS (SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text material FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${targetsSql}])) SELECT encode(sha256(convert_to(material,'UTF8')),'hex') FROM prefix;`;
}

function stageReadback(stage) {
  const checks = [
    `to_regprocedure('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)') IS NOT NULL
      AND to_regclass('pipeline_control.admin_record_operations') IS NOT NULL
      AND has_function_privilege('service_role','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')`,
    `to_regprocedure('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)') IS NOT NULL
      AND has_function_privilege('service_role','public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)','EXECUTE')`,
    `EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)' AND grantee='service_role')
      AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'pg_temp_%' AND p.proname IN ('admin_record_registration','admin_raw_warning_registration'))=0`,
    `encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='pipeline_control.restaurant_review_manual_preview(uuid,text)'::regprocedure),'UTF8')),'hex')='2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1'
      AND encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'::regprocedure),'UTF8')),'hex')='b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1'
      AND EXISTS(SELECT 1 FROM pg_proc WHERE oid='pipeline_control.lock_restaurant_review_catalog_revision()'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""','lock_timeout=2s']::text[])
      AND NOT has_function_privilege('authenticated','pipeline_control.lock_restaurant_review_catalog_revision()','EXECUTE')`,
  ];
  return { query: `SELECT json_build_object('stage',CASE WHEN ${checks[stage - 1]} THEN ${stage} ELSE 0 END)::text AS state`, expected: { stage } };
}

function stateQuery(priorCount, prefixRoot, suffixRoot, migrations, forceMismatch) {
  const exactRows = migrations.map((migration, index) => {
    const name = /\d{14}_([a-z0-9_]+)\.sql$/.exec(migration.path)[1];
    const statements = JSON.stringify(materials[index].originalVector).replaceAll("'", "''");
    return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${versions[index]}' AND name='${name}' AND statements=ARRAY(SELECT jsonb_array_elements_text('${statements}'::jsonb)))`;
  }).join(' AND ');
  return `SELECT * FROM (WITH prefix AS (SELECT count(*)::int prior_count,coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text material FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${targetsSql}])), target AS (SELECT count(*)::int target_count FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${targetsSql}])) SELECT json_build_object('bundle',json_build_object('ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),'priorCount',prefix.prior_count,'prefixRoot',encode(sha256(convert_to(prefix.material,'UTF8')),'hex'),'targetCount',target.target_count,'suffixRoot',CASE WHEN target.target_count=4 AND ${exactRows} THEN '${forceMismatch ? '0'.repeat(64) : suffixRoot}' ELSE NULL END))::text AS state FROM prefix,target) bundle_state`;
}

function compileActual(priorCount, prefixRoot, forceMismatch = false) {
  const migrations = TARGETS.map(([id, path, sourceSha], index) => ({
    id,
    path,
    sha256: sourceSha,
    statementVectorSha256: sha256(JSON.stringify(materials[index].originalVector)),
    expectedPriorState: index === 0 ? undefined : stageReadback(index),
    terminalReadback: stageReadback(index + 1),
  }));
  const suffixRoot = migrationBundleSuffixRoot(migrations);
  const query = stateQuery(priorCount, prefixRoot, suffixRoot, migrations, forceMismatch);
  const priorReadback = { query, expected: { bundle: { ledgerCount: priorCount, priorCount, prefixRoot, targetCount: 0, suffixRoot: null } } };
  const finalReadback = { query, expected: { bundle: { ledgerCount: priorCount + 4, priorCount, prefixRoot, targetCount: 4, suffixRoot } } };
  migrations[0].expectedPriorState = priorReadback;
  return compileMigrationBundle({ schemaVersion: 1, id: 'actual_admin_four_migration_bundle', migrations, priorCount, prefixRoot, suffixRoot, priorReadback, finalReadback }, materials);
}

function seedPrefix(database) {
  runSql(database, `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES
    ('20261001000001','local_synthetic_prefix_one',ARRAY['SELECT 1']),
    ('20261001000002','local_synthetic_prefix_two',ARRAY['SELECT 2']),
    ('20261001000003','local_synthetic_prefix_three',ARRAY['SELECT 3']);`);
  return { count: Number(runSql(database, 'SELECT count(*) FROM supabase_migrations.schema_migrations;')), root: runSql(database, prefixRootSql()) };
}

function databaseState(database) {
  return queryJson(database, `SELECT jsonb_build_object(
    'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
    'targetCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${targetsSql}])),
    'prefixRoot',(${prefixRootSql().replace(/;$/, '')}),
    'manifestHash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key),'[]'::jsonb)::text,'UTF8')),'hex') FROM privacy_retention.g014_catalog_contract_manifest m),
    'legacyHash',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.oid)::text,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=ANY(ARRAY['public.approve_submission_item(uuid,uuid,jsonb)'::regprocedure,'public.approve_edit_submission_item(uuid,uuid,jsonb)'::regprocedure,'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)'::regprocedure]))
  );`);
}

function metadata(database) {
  const signatures = [
    'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
    'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
    'pipeline_control.restaurant_review_manual_preview(uuid,text)',
    'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)',
    'pipeline_control.lock_restaurant_review_catalog_revision()',
  ];
  return queryJson(database, `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'securityDefiner',p.prosecdef,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY s) FROM unnest(ARRAY[${signatures.map(literal).join(',')}]) s JOIN pg_proc p ON p.oid=to_regprocedure(s)),
    'assertions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' AND p.proname=ANY(ARRAY['assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract']) AND p.pronargs=0),
    'targetAllowlistRows',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(ARRAY['public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'])),
    'registrationHelpers',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'pg_temp_%' AND p.proname IN('admin_record_registration','admin_raw_warning_registration'))
  );`);
}

if (!expectedContainerPattern.test(container) || !/^[a-f0-9]{24}$/.test(nonce)
    || !/^tzudong_fresh_pg17_[a-f0-9]{12}$/.test(sourceDatabase) || !out) fail('OWNED_REPLAY_ARGUMENT_INVALID');

const materials = TARGETS.map(([, path, expectedSha]) => {
  const bytes = readFileSync(resolve(repo, path));
  if (sha256(bytes) !== expectedSha) fail('ACTUAL_SOURCE_HASH_DRIFT');
  return { path, bytes, originalVector: readOriginalStatementVector({ path, sha256: expectedSha }, bytes) };
});

let failCreated = false;
let successCreated = false;
try {
  const inspect = JSON.parse(spawnSync(docker, ['--context', context, 'inspect', container], { encoding: 'utf8', timeout: 10000 }).stdout)[0];
  if (inspect.Name !== `/${container}` || inspect.Config.Labels?.['tzudong.actual-bundle'] !== nonce
      || inspect.HostConfig.NetworkMode !== 'none' || Object.keys(inspect.HostConfig.PortBindings ?? {}).length) fail('OWNED_CONTAINER_ADMISSION_FAILED');
  result.sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  result.serverVersion = runSql('postgres', "SELECT current_setting('server_version');", { user: 'supabase_admin' });
  if (!/^17\.6(?:\D|$)/.test(result.serverVersion)) fail('PG_VERSION_DRIFT');
  result.sourceBindings = TARGETS.map(([id, path, sha], index) => ({ id, path, sha256: sha, bytes: materials[index].bytes.length, statementCount: materials[index].originalVector.length, statementVectorSha256: sha256(JSON.stringify(materials[index].originalVector)) }));
  result.helperBindings = Object.fromEntries(['apps/web/scripts/supabase-migration-bundle.mjs','apps/web/scripts/supabase-migration-transaction.mjs','apps/web/scripts/apply-supabase-migration.mjs','backend/supabase/scripts/g037_supabase_statement_vector.mjs'].map(path => [path, sha256(readFileSync(resolve(repo, path)))]));

  runSql('postgres', `CREATE DATABASE ${failDatabase} TEMPLATE ${sourceDatabase} OWNER postgres; CREATE DATABASE ${successDatabase} TEMPLATE ${sourceDatabase} OWNER postgres;`, { user: 'supabase_admin' });
  failCreated = true;
  successCreated = true;
  const failPrefix = seedPrefix(failDatabase);
  const successPrefix = seedPrefix(successDatabase);
  if (JSON.stringify(failPrefix) !== JSON.stringify(successPrefix) || failPrefix.count !== 3 || !/^[a-f0-9]{64}$/.test(failPrefix.root)) fail('SYNTHETIC_PREFIX_DRIFT');
  result.syntheticPrefix = { count: failPrefix.count, sha256: failPrefix.root, copiedFromHosted: false };

  const mismatchBefore = { schemaSha256: schemaHash(failDatabase), state: databaseState(failDatabase), roles: roleState(failDatabase) };
  const mismatch = compileActual(failPrefix.count, failPrefix.root, true);
  const mismatchFailure = runSql(failDatabase, mismatch.sql, { singleTransaction: true, expectFailure: true });
  const mismatchAfter = { schemaSha256: schemaHash(failDatabase), state: databaseState(failDatabase), roles: roleState(failDatabase) };
  const mismatchObserved = queryJson(failDatabase, bundleReconciliationSql(mismatch), { singleTransaction: true });
  if (mismatchFailure.fixedCode !== 'MIGRATION_TERMINAL_READBACK_FAILED'
      || mismatchFailure.sqlState !== 'P0001'
      || JSON.stringify(mismatchBefore) !== JSON.stringify(mismatchAfter)
      || bundleReconciliationOutcome(mismatchObserved, mismatch) !== 'not_applied') fail('TERMINAL_MISMATCH_ROLLBACK_FAILED');
  result.terminalMismatch = { fixedCode: mismatchFailure.fixedCode, sqlState: mismatchFailure.sqlState, rollbackExact: true, schemaSha256: mismatchBefore.schemaSha256, reconciliation: 'not_applied', targetLedgerRows: 0 };

  const successBefore = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase), roles: roleState(successDatabase) };
  const compiled = compileActual(successPrefix.count, successPrefix.root, false);
  const observed = queryJson(successDatabase, compiled.sql, { singleTransaction: true, timeout: 180000 });
  if (JSON.stringify(observed) !== JSON.stringify(compiled.finalReadback.expected)) fail('FINAL_BUNDLE_READBACK_MISMATCH');
  const reconciled = queryJson(successDatabase, bundleReconciliationSql(compiled), { singleTransaction: true });
  if (bundleReconciliationOutcome(reconciled, compiled) !== 'committed') fail('FINAL_BUNDLE_RECONCILIATION_FAILED');

  const assertions = `BEGIN READ ONLY; SELECT privacy_retention.assert_g014_workflow_owner_contract(); SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); SELECT privacy_retention.assert_g014_catalog_contract(); ROLLBACK;`;
  runSql(successDatabase, assertions, { user: 'supabase_admin' });
  const metadataReadback = metadata(successDatabase);
  if (metadataReadback.assertions.length !== 4 || metadataReadback.targetAllowlistRows !== 2 || metadataReadback.registrationHelpers !== 0) fail('METADATA_READBACK_FAILED');

  const phaseFixture = readFileSync(resolve(repo, 'apps/web/performance/record-review-fixes-20261009/final-three-six-flow-fixture.sql'), 'utf8').replace('tzudong_phase_full_3455d753', successDatabase).replace('tzudong-record-fixes-20261009-final', container);
  const phaseBefore = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase) };
  const phaseProof = queryJson(successDatabase, phaseFixture, { user: 'supabase_admin', timeout: 180000 });
  const phaseAfter = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase) };
  if (phaseProof.caseCount !== 6 || JSON.stringify(phaseBefore) !== JSON.stringify(phaseAfter)) fail('PHASE_FIXTURE_ROLLBACK_FAILED');

  const manualFixture = readFileSync(resolve(repo, 'apps/web/performance/record-review-fixes-20261009/manual-preview-fixture-final.sql'), 'utf8');
  const manualBefore = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase) };
  runSql(successDatabase, manualFixture, { user: 'supabase_admin', timeout: 180000 });
  const manualAfter = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase) };
  if (JSON.stringify(manualBefore) !== JSON.stringify(manualAfter)) fail('MANUAL_PREVIEW_FIXTURE_ROLLBACK_FAILED');

  const successAfter = { schemaSha256: schemaHash(successDatabase), state: databaseState(successDatabase), roles: roleState(successDatabase) };
  if (successAfter.state.ledgerCount !== 7 || successAfter.state.targetCount !== 4
      || successAfter.state.prefixRoot !== successPrefix.root
      || successAfter.state.manifestHash !== successBefore.state.manifestHash
      || successAfter.state.legacyHash !== successBefore.state.legacyHash
      || JSON.stringify(successAfter.roles) !== JSON.stringify(successBefore.roles)) fail('SUCCESS_PRESERVATION_FAILED');

  result.bundle = { id: compiled.id, transactionMode: compiled.transactionMode, priorCount: compiled.priorCount, prefixRoot: compiled.prefixRoot, suffixRoot: compiled.suffixRoot, topLevelStatementCount: statementSpans(compiled.sql).length, outputSelectCount: statementSpans(compiled.sql).filter(span => /^SELECT\b/i.test(span.token)).length };
  result.success = { exactFinalReadback: true, reconciliation: 'committed', ledgerCount: successAfter.state.ledgerCount, targetLedgerRows: successAfter.state.targetCount, prefixPreserved: true, existingManifestPreserved: true, legacyFunctionMetadataPreserved: true, rolesAndMembershipPreserved: true, g014AssertionsPassed: 4, metadata: metadataReadback };
  result.phaseAssertions = { adminRecordCases: phaseProof.cases, adminRecordCaseCount: phaseProof.caseCount, adminRecordRollbackExact: true, manualPreviewCases: ['applied_fingerprint_excluded','today_finished_approval_prior_day_run_counted','same_policy_daily_deferred_reincluded','stale_policy_excluded','stop_counts_empty_version_preserved'], manualPreviewRollbackExact: true, syntheticOnly: true };
  result.status = 'passed';
} catch (error) {
  result.failure = { code: /^[A-Z0-9_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'ACTUAL_BUNDLE_REPLAY_UNCONFIRMED', sqlState: /^[A-Z0-9]{5}$/.test(error.sqlState ?? '') ? error.sqlState : null, fixedCode: /^[A-Z0-9_]+$/.test(error.fixedCode ?? '') ? error.fixedCode : null };
} finally {
  if (failCreated) {
    try { runSql('postgres', `DROP DATABASE IF EXISTS ${failDatabase};`, { user: 'supabase_admin' }); result.terminalMismatchDatabaseDropped = true; } catch { result.terminalMismatchDatabaseDropped = false; }
  }
  if (successCreated) {
    try { runSql('postgres', `DROP DATABASE IF EXISTS ${successDatabase};`, { user: 'supabase_admin' }); result.successDatabaseDropped = true; } catch { result.successDatabaseDropped = false; }
  }
  result.completedAt = new Date().toISOString();
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, failure: result.failure ?? null, databaseCleanup: { terminalMismatch: result.terminalMismatchDatabaseDropped, success: result.successDatabaseDropped } }));
}

if (result.status !== 'passed' || !result.terminalMismatchDatabaseDropped || !result.successDatabaseDropped) process.exitCode = 1;
