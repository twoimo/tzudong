import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOriginalStatementVector } from '../../../scripts/apply-supabase-migration.mjs';
import {
  bundleReconciliationOutcome,
  bundleReconciliationSql,
  compileFiveMigrationBundle,
  fiveMigrationBundleSuffixRoot,
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
  ['admin_record_guarded_actions', 'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql', 'b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95', 39, '5038d14ce704d494889562f04d33cacae7bd7a117bf4cd2341752bd3b40f12af'],
  ['admin_evaluation_raw_warning_groups', 'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql', '66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a', 10, '082fec2c22c8588e262bbe6cd936cb30f6b100c3f5b2ffec489ff144bbdfc5f8'],
  ['admin_evaluation_raw_warning_invoker_contract', 'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql', 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020', 4, 'f211b61f0959413d40783cd62b4221e9ec30d92792ad86b61ca186f504c6c0e1'],
  ['restaurant_review_manual_preview_eligibility', 'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql', '8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3', 4, 'ab55e1704f6b54134d7153603d55f948b19ab2c8ac9dfdf31d7ea1ef82d43958'],
  ['admin_record_private_verification_cleanup', 'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql', 'f58a41a339663e9c6aa79fc233573e0ad15d6f253f0afae62e30b67e8180a065', 13, 'efd37cbc628681232e53d3b404a90cb52fe57e659b67214826fb475f90a79143'],
];
const versions = TARGETS.map(([, path]) => /\/(\d{14})_/.exec(path)[1]);
const stageFailDatabase = `tzudong_actual5_stage_${nonce}`;
const finalFailDatabase = `tzudong_actual5_final_${nonce}`;
const successDatabase = `tzudong_actual5_ok_${nonce}`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const expectedContainerPattern = /^tzudong-actual-five-[a-f0-9]{24}$/;
const result = {
  kind: 'actual-five-source-full-schema-bundle-replay',
  status: 'unconfirmed',
  operatingWrites: false,
  hostedWrites: false,
  userRowsCopied: 0,
  hostedLedgerRowsCopied: 0,
  fixturePrefix: 'local-synthetic-only',
  databases: {
    source: sourceDatabase,
    stageFiveMismatch: stageFailDatabase,
    finalMismatch: finalFailDatabase,
    success: successDatabase,
  },
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runSql(database, sql, {
  user = 'postgres',
  singleTransaction = false,
  standardConformingStringsOff = false,
  expectFailure = false,
  timeout = 90000,
} = {}) {
  const command = ['--context', context, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only'];
  if (standardConformingStringsOff) command.push('-e', 'PGOPTIONS=-c standard_conforming_strings=off');
  command.push(container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose');
  if (singleTransaction) command.push('--single-transaction');
  command.push('-h', '127.0.0.1', '-U', user, '-d', database);
  const child = spawnSync(docker, command, { input: sql, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const sqlState = child.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? null;
  const fixedCode = child.stderr?.match(/\b(?:MIGRATION|RECORD_ACTION|REVIEW|G014|FIXTURE|ADMIN_PRIVATE)_[A-Z0-9_]{2,96}\b/)?.[0] ?? null;
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

function dumpHash(database, dataOnly = false) {
  const args = ['--context', context, 'exec', '-e', 'PGPASSWORD=fixture-only', container,
    'pg_dump', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database,
    dataOnly ? '--data-only' : '--schema-only', '--no-comments', '--no-publications', '--no-subscriptions',
    '--restrict-key=TZUDONGACTUALFIVE20261009'];
  if (dataOnly) args.push('--inserts', '--rows-per-insert=1');
  const child = spawnSync(docker, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error || child.status !== 0) fail(dataOnly ? 'DATA_HASH_FAILED' : 'SCHEMA_HASH_FAILED');
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

function stageReadback(stage, forceMismatch = false) {
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
    `to_regprocedure('pipeline_control.admin_record_storage_snapshot(text,text)') IS NOT NULL
      AND to_regprocedure('pipeline_control.admin_record_review_media(jsonb)') IS NOT NULL
      AND has_function_privilege('service_role','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')
      AND NOT has_function_privilege('anon','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')
      AND position('review-media:' in (SELECT prosrc FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure))>0
      AND position('admin_record_storage_snapshot(job.bucket,job.object_name)' in (SELECT prosrc FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure))>0
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admin_record_media_cleanup_bucket_check' AND pg_get_constraintdef(oid) LIKE '%review-photos%' AND pg_get_constraintdef(oid) LIKE '%review-verifications%')`,
  ];
  const expression = forceMismatch ? 'false' : checks[stage - 1];
  return { query: `SELECT json_build_object('stage',CASE WHEN ${expression} THEN ${stage} ELSE 0 END)::text AS state`, expected: { stage } };
}

function stateQuery(priorCount, prefixRoot, suffixRoot, migrations, forceFinalMismatch) {
  const exactRows = migrations.map((migration, index) => {
    const name = /\d{14}_([a-z0-9_]+)\.sql$/.exec(migration.path)[1];
    const statements = JSON.stringify(materials[index].originalVector).replaceAll("'", "''");
    return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${versions[index]}' AND name='${name}' AND statements=ARRAY(SELECT jsonb_array_elements_text('${statements}'::jsonb)))`;
  }).join(' AND ');
  return `SELECT * FROM (WITH prefix AS (SELECT count(*)::int prior_count,coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text material FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${targetsSql}])), target AS (SELECT count(*)::int target_count FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${targetsSql}])) SELECT json_build_object('bundle',json_build_object('ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),'priorCount',prefix.prior_count,'prefixRoot',encode(sha256(convert_to(prefix.material,'UTF8')),'hex'),'targetCount',target.target_count,'suffixRoot',CASE WHEN target.target_count=5 AND ${exactRows} THEN '${forceFinalMismatch ? '0'.repeat(64) : suffixRoot}' ELSE NULL END))::text AS state FROM prefix,target) bundle_state`;
}

function compileActual(priorCount, prefixRoot, { stageFiveMismatch = false, finalMismatch = false } = {}) {
  const migrations = TARGETS.map(([id, path, sourceSha], index) => ({
    id,
    path,
    sha256: sourceSha,
    statementVectorSha256: sha256(JSON.stringify(materials[index].originalVector)),
    expectedPriorState: index === 0 ? undefined : stageReadback(index),
    terminalReadback: stageReadback(index + 1, stageFiveMismatch && index === 4),
  }));
  const suffixRoot = fiveMigrationBundleSuffixRoot(migrations);
  const query = stateQuery(priorCount, prefixRoot, suffixRoot, migrations, finalMismatch);
  const priorReadback = { query, expected: { bundle: { ledgerCount: priorCount, priorCount, prefixRoot, targetCount: 0, suffixRoot: null } } };
  const finalReadback = { query, expected: { bundle: { ledgerCount: priorCount + 5, priorCount, prefixRoot, targetCount: 5, suffixRoot } } };
  migrations[0].expectedPriorState = priorReadback;
  return compileFiveMigrationBundle({ schemaVersion: 1, id: 'actual_admin_five_migration_bundle', migrations, priorCount, prefixRoot, suffixRoot, priorReadback, finalReadback }, materials);
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

function exactState(database) {
  return {
    schemaSha256: dumpHash(database),
    dataSha256: dumpHash(database, true),
    state: databaseState(database),
    roles: roleState(database),
  };
}

function metadata(database) {
  const signatures = [
    'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
    'pipeline_control.admin_record_snapshot(text,uuid[])',
    'pipeline_control.admin_record_storage_snapshot(text,text)',
    'pipeline_control.admin_record_review_media(jsonb)',
    'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
    'pipeline_control.restaurant_review_manual_preview(uuid,text)',
    'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)',
    'pipeline_control.lock_restaurant_review_catalog_revision()',
  ];
  return queryJson(database, `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'securityDefiner',p.prosecdef,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY s) FROM unnest(ARRAY[${signatures.map(literal).join(',')}]) s JOIN pg_proc p ON p.oid=to_regprocedure(s)),
    'assertions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' AND p.proname=ANY(ARRAY['assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract']) AND p.pronargs=0),
    'targetAllowlistRows',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(ARRAY['public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'])),
    'registrationHelpers',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'pg_temp_%' AND p.proname IN('admin_record_registration','admin_raw_warning_registration')),
    'privateHelperAcl',jsonb_build_object(
      'serviceRole',has_function_privilege('service_role','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE'),
      'anon',has_function_privilege('anon','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE'),
      'authenticated',has_function_privilege('authenticated','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')),
    'cleanupConstraint',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_record_media_cleanup_bucket_check')
  );`);
}

function assertRollback(before, after, failure, compiled, observed, code) {
  if (failure.fixedCode !== 'MIGRATION_TERMINAL_READBACK_FAILED'
      || failure.sqlState !== 'P0001'
      || JSON.stringify(before) !== JSON.stringify(after)
      || bundleReconciliationOutcome(observed, compiled) !== 'not_applied') fail(code);
}

if (!expectedContainerPattern.test(container) || !/^[a-f0-9]{24}$/.test(nonce)
    || !/^tzudong_fresh_pg17_[a-f0-9]{12}$/.test(sourceDatabase) || !out) fail('OWNED_REPLAY_ARGUMENT_INVALID');

const materials = TARGETS.map(([, path, expectedSha, expectedCount, expectedVectorSha]) => {
  const bytes = readFileSync(resolve(repo, path));
  if (sha256(bytes) !== expectedSha) fail('ACTUAL_SOURCE_HASH_DRIFT');
  const originalVector = readOriginalStatementVector({ path, sha256: expectedSha }, bytes);
  if (originalVector.length !== expectedCount || sha256(JSON.stringify(originalVector)) !== expectedVectorSha) fail('ACTUAL_SOURCE_VECTOR_DRIFT');
  return { path, bytes, originalVector };
});

const created = new Set();
try {
  const inspect = JSON.parse(spawnSync(docker, ['--context', context, 'inspect', container], { encoding: 'utf8', timeout: 10000 }).stdout)[0];
  if (inspect.Name !== `/${container}` || inspect.Config.Labels?.['tzudong.actual-five'] !== nonce
      || inspect.HostConfig.NetworkMode !== 'none' || Object.keys(inspect.HostConfig.PortBindings ?? {}).length) fail('OWNED_CONTAINER_ADMISSION_FAILED');
  result.sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  result.serverVersion = runSql('postgres', "SELECT current_setting('server_version');", { user: 'supabase_admin' });
  result.serverVersionNum = Number(runSql('postgres', "SELECT current_setting('server_version_num');", { user: 'supabase_admin' }));
  if (result.serverVersion !== '17.6' || result.serverVersionNum !== 170006) fail('PG_VERSION_DRIFT');
  result.sourceBindings = TARGETS.map(([id, path, sourceSha], index) => ({
    id,
    path,
    sha256: sourceSha,
    bytes: materials[index].bytes.length,
    statementCount: materials[index].originalVector.length,
    statementVectorSha256: sha256(JSON.stringify(materials[index].originalVector)),
  }));
  result.helperBindings = Object.fromEntries([
    'apps/web/scripts/supabase-migration-bundle.mjs',
    'apps/web/scripts/supabase-migration-transaction.mjs',
    'apps/web/scripts/apply-supabase-migration.mjs',
    'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
  ].map(path => [path, sha256(readFileSync(resolve(repo, path)))]));

  runSql('postgres', `CREATE DATABASE ${stageFailDatabase} TEMPLATE ${sourceDatabase} OWNER postgres; CREATE DATABASE ${finalFailDatabase} TEMPLATE ${sourceDatabase} OWNER postgres; CREATE DATABASE ${successDatabase} TEMPLATE ${sourceDatabase} OWNER postgres;`, { user: 'supabase_admin' });
  created.add(stageFailDatabase);
  created.add(finalFailDatabase);
  created.add(successDatabase);
  const stagePrefix = seedPrefix(stageFailDatabase);
  const finalPrefix = seedPrefix(finalFailDatabase);
  const successPrefix = seedPrefix(successDatabase);
  if (JSON.stringify(stagePrefix) !== JSON.stringify(finalPrefix)
      || JSON.stringify(stagePrefix) !== JSON.stringify(successPrefix)
      || stagePrefix.count !== 3 || !/^[a-f0-9]{64}$/.test(stagePrefix.root)) fail('SYNTHETIC_PREFIX_DRIFT');
  result.syntheticPrefix = { count: stagePrefix.count, sha256: stagePrefix.root, copiedFromHosted: false };
  result.standardConformingStrings = {
    callerDefault: runSql(stageFailDatabase, 'SHOW standard_conforming_strings;', { standardConformingStringsOff: true }),
    compiledTransactionForcesOn: true,
    reconciliationTransactionForcesOn: true,
  };
  if (result.standardConformingStrings.callerDefault !== 'off') fail('CALLER_STRING_SEMANTICS_SETUP_FAILED');

  const stageBefore = exactState(stageFailDatabase);
  const stageMismatch = compileActual(stagePrefix.count, stagePrefix.root, { stageFiveMismatch: true });
  const stageFailure = runSql(stageFailDatabase, stageMismatch.sql, { singleTransaction: true, standardConformingStringsOff: true, expectFailure: true, timeout: 240000 });
  const stageAfter = exactState(stageFailDatabase);
  const stageObserved = queryJson(stageFailDatabase, bundleReconciliationSql(stageMismatch), { singleTransaction: true, standardConformingStringsOff: true });
  assertRollback(stageBefore, stageAfter, stageFailure, stageMismatch, stageObserved, 'STAGE_FIVE_MISMATCH_ROLLBACK_FAILED');
  result.stageFiveMismatch = {
    fixedCode: stageFailure.fixedCode,
    sqlState: stageFailure.sqlState,
    rollbackExact: true,
    schemaSha256: stageBefore.schemaSha256,
    dataSha256: stageBefore.dataSha256,
    rolesAndMembershipPreserved: true,
    reconciliation: 'not_applied',
    targetLedgerRows: 0,
  };

  const finalBefore = exactState(finalFailDatabase);
  const finalMismatch = compileActual(finalPrefix.count, finalPrefix.root, { finalMismatch: true });
  const finalFailure = runSql(finalFailDatabase, finalMismatch.sql, { singleTransaction: true, standardConformingStringsOff: true, expectFailure: true, timeout: 240000 });
  const finalAfter = exactState(finalFailDatabase);
  const finalObserved = queryJson(finalFailDatabase, bundleReconciliationSql(finalMismatch), { singleTransaction: true, standardConformingStringsOff: true });
  assertRollback(finalBefore, finalAfter, finalFailure, finalMismatch, finalObserved, 'FINAL_MISMATCH_ROLLBACK_FAILED');
  result.finalMismatch = {
    fixedCode: finalFailure.fixedCode,
    sqlState: finalFailure.sqlState,
    rollbackExact: true,
    schemaSha256: finalBefore.schemaSha256,
    dataSha256: finalBefore.dataSha256,
    rolesAndMembershipPreserved: true,
    reconciliation: 'not_applied',
    targetLedgerRows: 0,
  };

  const successBefore = exactState(successDatabase);
  const compiled = compileActual(successPrefix.count, successPrefix.root);
  const observed = queryJson(successDatabase, compiled.sql, { singleTransaction: true, standardConformingStringsOff: true, timeout: 240000 });
  if (JSON.stringify(observed) !== JSON.stringify(compiled.finalReadback.expected)) fail('FINAL_BUNDLE_READBACK_MISMATCH');
  const reconciled = queryJson(successDatabase, bundleReconciliationSql(compiled), { singleTransaction: true, standardConformingStringsOff: true });
  if (bundleReconciliationOutcome(reconciled, compiled) !== 'committed') fail('FINAL_BUNDLE_RECONCILIATION_FAILED');

  const assertions = `BEGIN READ ONLY; SELECT privacy_retention.assert_g014_workflow_owner_contract(); SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); SELECT privacy_retention.assert_g014_catalog_contract(); ROLLBACK;`;
  runSql(successDatabase, assertions, { user: 'supabase_admin' });
  const metadataReadback = metadata(successDatabase);
  if (metadataReadback.assertions.length !== 4 || metadataReadback.targetAllowlistRows !== 2
      || metadataReadback.registrationHelpers !== 0
      || metadataReadback.privateHelperAcl.serviceRole !== true
      || metadataReadback.privateHelperAcl.anon !== false
      || metadataReadback.privateHelperAcl.authenticated !== false
      || !metadataReadback.cleanupConstraint.includes('review-photos')
      || !metadataReadback.cleanupConstraint.includes('review-verifications')) fail('METADATA_READBACK_FAILED');

  const phaseFixture = readFileSync(resolve(repo, 'apps/web/performance/record-review-fixes-20261009/final-three-six-flow-fixture.sql'), 'utf8')
    .replace('tzudong_phase_full_3455d753', successDatabase)
    .replace('tzudong-record-fixes-20261009-final', container);
  const phaseBefore = exactState(successDatabase);
  const phaseProof = queryJson(successDatabase, phaseFixture, { user: 'supabase_admin', timeout: 180000 });
  const phaseAfter = exactState(successDatabase);
  if (phaseProof.caseCount !== 6 || JSON.stringify(phaseBefore) !== JSON.stringify(phaseAfter)) fail('PHASE_FIXTURE_ROLLBACK_FAILED');

  const manualFixture = readFileSync(resolve(repo, 'apps/web/performance/record-review-fixes-20261009/manual-preview-fixture-final.sql'), 'utf8');
  const manualBefore = exactState(successDatabase);
  runSql(successDatabase, manualFixture, { user: 'supabase_admin', timeout: 180000 });
  const manualAfter = exactState(successDatabase);
  if (JSON.stringify(manualBefore) !== JSON.stringify(manualAfter)) fail('MANUAL_PREVIEW_FIXTURE_ROLLBACK_FAILED');

  const privateFixture = readFileSync(resolve(repo, 'apps/web/performance/continuity-recovery-20261009/actual-five-stage-replay-20261009/private-verification-fixture.sql'), 'utf8')
    .replaceAll('__DATABASE__', successDatabase);
  const privateBefore = exactState(successDatabase);
  const privateProof = queryJson(successDatabase, privateFixture, { user: 'supabase_admin', timeout: 180000 });
  const privateAfter = exactState(successDatabase);
  if (privateProof.caseCount !== 4 || privateProof.exactVerificationJobCount !== 2
      || JSON.stringify(privateBefore) !== JSON.stringify(privateAfter)) fail('PRIVATE_VERIFICATION_FIXTURE_ROLLBACK_FAILED');

  const successAfter = exactState(successDatabase);
  if (successAfter.state.ledgerCount !== 8 || successAfter.state.targetCount !== 5
      || successAfter.state.prefixRoot !== successPrefix.root
      || successAfter.state.manifestHash !== successBefore.state.manifestHash
      || successAfter.state.legacyHash !== successBefore.state.legacyHash
      || JSON.stringify(successAfter.roles) !== JSON.stringify(successBefore.roles)) fail('SUCCESS_PRESERVATION_FAILED');

  result.bundle = {
    id: compiled.id,
    transactionMode: compiled.transactionMode,
    priorCount: compiled.priorCount,
    prefixRoot: compiled.prefixRoot,
    suffixRoot: compiled.suffixRoot,
    topLevelStatementCount: statementSpans(compiled.sql).length,
    outputSelectCount: statementSpans(compiled.sql).filter(span => /^SELECT\b/i.test(span.token)).length,
    sourceRoot: sha256(Buffer.concat(materials.map(material => material.bytes))),
  };
  result.success = {
    exactFinalReadback: true,
    reconciliation: 'committed',
    ledgerCount: successAfter.state.ledgerCount,
    targetLedgerRows: successAfter.state.targetCount,
    originalVectorsPreserved: true,
    prefixPreserved: true,
    existingManifestPreserved: true,
    legacyFunctionMetadataPreserved: true,
    rolesAndMembershipPreserved: true,
    g014AssertionsPassed: 4,
    metadata: metadataReadback,
  };
  result.phaseAssertions = {
    adminRecordCases: phaseProof.cases,
    adminRecordCaseCount: phaseProof.caseCount,
    adminRecordRollbackExact: true,
    manualPreviewCases: ['applied_fingerprint_excluded','today_finished_approval_prior_day_run_counted','same_policy_daily_deferred_reincluded','stale_policy_excluded','stop_counts_empty_version_preserved'],
    manualPreviewCaseCount: 5,
    manualPreviewRollbackExact: true,
    privateVerificationCases: privateProof.cases,
    privateVerificationCaseCount: privateProof.caseCount,
    privateVerificationExactJobCount: privateProof.exactVerificationJobCount,
    privateVerificationRollbackExact: true,
    syntheticOnly: true,
    providerCalls: 0,
    storageApiCalls: 0,
  };
  result.status = 'passed';
} catch (error) {
  result.failure = {
    code: /^[A-Z0-9_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'ACTUAL_FIVE_BUNDLE_REPLAY_UNCONFIRMED',
    sqlState: /^[A-Z0-9]{5}$/.test(error.sqlState ?? '') ? error.sqlState : null,
    fixedCode: /^[A-Z0-9_]+$/.test(error.fixedCode ?? '') ? error.fixedCode : null,
  };
} finally {
  result.databaseCleanup = {};
  for (const database of created) {
    try {
      runSql('postgres', `DROP DATABASE IF EXISTS ${database};`, { user: 'supabase_admin' });
      result.databaseCleanup[database] = true;
    } catch {
      result.databaseCleanup[database] = false;
    }
  }
  result.completedAt = new Date().toISOString();
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, failure: result.failure ?? null, databaseCleanup: result.databaseCleanup }));
}

if (result.status !== 'passed' || [...created].some(database => !result.databaseCleanup[database])) process.exitCode = 1;
