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
import {
  atomicMigrationSql,
  migrationEnvelope,
  reconciliationOutcome,
  reconciliationSql,
  statementSpans,
} from '../../../scripts/supabase-migration-transaction.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => {
  if (value.startsWith('--')) rows.push([value.slice(2), all[index + 1]]);
  return rows;
}, []));
const output = resolve(args.output ?? '');
const container = args.container ?? '';
const sourceDatabase = args['source-database'] ?? '';
const nonce = args.nonce ?? '';
const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const docker = '/opt/homebrew/bin/docker';
const context = 'colima-tzudong-catalog-20261007';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

const FIVE = [
  ['admin_record_guarded_actions', 'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql', 'b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95', 39, '5038d14ce704d494889562f04d33cacae7bd7a117bf4cd2341752bd3b40f12af'],
  ['admin_evaluation_raw_warning_groups', 'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql', '66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a', 10, '082fec2c22c8588e262bbe6cd936cb30f6b100c3f5b2ffec489ff144bbdfc5f8'],
  ['admin_evaluation_raw_warning_invoker_contract', 'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql', 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020', 4, 'f211b61f0959413d40783cd62b4221e9ec30d92792ad86b61ca186f504c6c0e1'],
  ['restaurant_review_manual_preview_eligibility', 'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql', '8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3', 4, 'ab55e1704f6b54134d7153603d55f948b19ab2c8ac9dfdf31d7ea1ef82d43958'],
  ['admin_record_private_verification_cleanup', 'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql', '03c8ebabaaf7255e1c5ab5dedf59a95782b78dbc960668870ea80fc8780ab3af', 13, '147414379f4eebdc1274257419629107a80be59ec3203a064f29c82472760003'],
];
const FORWARD = {
  id: 'admin_user_management_rpc_forward',
  path: 'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql',
  sha256: 'b96126240399e580ed6b7198edbd3d0af44b26ec5cab66073c037b331ec8eb26',
  statementCount: 2,
  vectorSha256: '949cbb0862da3e62c190cdeafd23051198178440584b9ebf3f96cec1f062d9c6',
};
const TARGET_SIGNATURES = [
  'public.read_admin_user_management_metadata(uuid[])',
  'public.read_admin_user_audit_events(integer)',
  'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)',
];
const TARGET_BODY_HASHES = [
  'c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656',
  'b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e',
  '2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6',
];
const fiveVersions = FIVE.map(([, path]) => /\/(\d{14})_/.exec(path)[1]);
const forwardVersion = /\/(\d{14})_/.exec(FORWARD.path)[1];
const fiveDatabase = `tzudong_admin_user_five_${nonce}`;
const mismatchDatabase = `tzudong_admin_user_mismatch_${nonce}`;
const driftDatabase = `tzudong_admin_user_drift_${nonce}`;
const successDatabase = `tzudong_admin_user_ok_${nonce}`;
const result = {
  kind: 'five-plus-admin-user-rpc-forward-final-full-schema-replay',
  status: 'unconfirmed',
  operatingWrites: false,
  hostedWrites: false,
  userRowsCopied: 0,
  hostedLedgerRowsCopied: 0,
  fixturePrefix: 'local-synthetic-only',
  databases: { source: sourceDatabase, postFive: fiveDatabase, terminalMismatch: mismatchDatabase, preimageDrift: driftDatabase, success: successDatabase },
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
  timeout = 120000,
} = {}) {
  const command = ['--context', context, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only'];
  if (standardConformingStringsOff) command.push('-e', 'PGOPTIONS=-c standard_conforming_strings=off');
  command.push(container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose');
  if (singleTransaction) command.push('--single-transaction', '--file=-');
  command.push('-h', '127.0.0.1', '-U', user, '-d', database);
  const child = spawnSync(docker, command, { input: sql, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const sqlState = child.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? null;
  const fixedCode = child.stderr?.match(/\bMIGRATION_[A-Z0-9_]{2,96}\b/)?.[0] ?? null;
  const messageCode = child.stderr?.match(/\badmin_user_forward_[a-z0-9_]{2,96}\b/)?.[0] ?? null;
  if (expectFailure) {
    if (!child.error && child.status !== 0) return {
      sqlState,
      fixedCode,
      messageCode,
      timeout: false,
      detail: (child.stderr ?? '').split('\n').filter(line => /ERROR:|CONTEXT:/.test(line)).slice(0, 6),
    };
    fail('EXPECTED_DATABASE_FAILURE_MISSING');
  }
  if (child.error || child.status !== 0) {
    const error = new Error('LOCAL_DATABASE_STEP_FAILED');
    error.code = child.error?.code === 'ETIMEDOUT' ? 'LOCAL_DATABASE_STEP_TIMEOUT' : 'LOCAL_DATABASE_STEP_FAILED';
    error.sqlState = sqlState;
    error.fixedCode = fixedCode;
    error.messageCode = messageCode;
    error.detail = (child.stderr ?? '').slice(0, 1000);
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
  const command = ['--context', context, 'exec', '-e', 'PGPASSWORD=fixture-only', container,
    'pg_dump', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database,
    dataOnly ? '--data-only' : '--schema-only', '--no-comments', '--no-publications', '--no-subscriptions',
    '--restrict-key=TZUDONGADMINUSER20261009'];
  if (dataOnly) command.push('--inserts', '--rows-per-insert=1');
  const child = spawnSync(docker, command, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error || child.status !== 0) fail(dataOnly ? 'DATA_HASH_FAILED' : 'SCHEMA_HASH_FAILED');
  return sha256(child.stdout);
}

function roleState(database) {
  return queryJson(database, `SELECT jsonb_build_object(
    'roles',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY oid),'[]'::jsonb)::text,'UTF8')),'hex'),
    'members',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_auth_members m)
  ) FROM pg_roles r;`);
}

function exactState(database) {
  return { schemaSha256: dumpHash(database), dataSha256: dumpHash(database, true), roles: roleState(database) };
}

function stageReadback(stage) {
  const checks = [
    `to_regprocedure('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)') IS NOT NULL
      AND has_function_privilege('service_role','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')`,
    `to_regprocedure('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)') IS NOT NULL
      AND NOT has_function_privilege('authenticated','public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)','EXECUTE')`,
    `EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)' AND grantee='service_role')`,
    `encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='pipeline_control.restaurant_review_manual_preview(uuid,text)'::regprocedure),'UTF8')),'hex')='2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1'
      AND encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'::regprocedure),'UTF8')),'hex')='b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1'`,
    `to_regprocedure('pipeline_control.admin_record_storage_snapshot(text,text)') IS NOT NULL
      AND to_regprocedure('pipeline_control.admin_record_review_media(jsonb)') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admin_record_media_cleanup_bucket_check' AND pg_get_constraintdef(oid) LIKE '%review-verifications%')`,
  ];
  return { query: `SELECT json_build_object('stage',CASE WHEN ${checks[stage - 1]} THEN ${stage} ELSE 0 END)::text AS state`, expected: { stage } };
}

const fiveMaterials = FIVE.map(([, path, expectedSha, expectedCount, expectedVectorSha]) => {
  const bytes = readFileSync(resolve(repo, path));
  if (sha256(bytes) !== expectedSha) fail('FIVE_SOURCE_HASH_DRIFT');
  const originalVector = readOriginalStatementVector({ path, sha256: expectedSha }, bytes);
  if (originalVector.length !== expectedCount || sha256(JSON.stringify(originalVector)) !== expectedVectorSha) fail('FIVE_SOURCE_VECTOR_DRIFT');
  return { path, bytes, originalVector };
});
const fiveTargetsSql = fiveVersions.map(literal).join(',');

function prefixRootSql(excludedVersions = fiveVersions) {
  return `WITH prefix AS (SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text material FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${excludedVersions.map(literal).join(',')}])) SELECT encode(sha256(convert_to(material,'UTF8')),'hex') FROM prefix;`;
}

function fiveStateQuery(priorCount, prefixRoot, suffixRoot, migrations) {
  const exactRows = migrations.map((migration, index) => {
    const name = /\d{14}_([a-z0-9_]+)\.sql$/.exec(migration.path)[1];
    const statements = JSON.stringify(fiveMaterials[index].originalVector).replaceAll("'", "''");
    return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${fiveVersions[index]}' AND name='${name}' AND statements=ARRAY(SELECT jsonb_array_elements_text('${statements}'::jsonb)))`;
  }).join(' AND ');
  return `SELECT * FROM (WITH prefix AS (SELECT count(*)::int prior_count,coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text material FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${fiveTargetsSql}])), target AS (SELECT count(*)::int target_count FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${fiveTargetsSql}])) SELECT json_build_object('bundle',json_build_object('ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),'priorCount',prefix.prior_count,'prefixRoot',encode(sha256(convert_to(prefix.material,'UTF8')),'hex'),'targetCount',target.target_count,'suffixRoot',CASE WHEN target.target_count=5 AND ${exactRows} THEN '${suffixRoot}' ELSE NULL END))::text AS state FROM prefix,target) bundle_state`;
}

function compileFive(priorCount, prefixRoot) {
  const migrations = FIVE.map(([id, path, sourceSha], index) => ({
    id,
    path,
    sha256: sourceSha,
    statementVectorSha256: sha256(JSON.stringify(fiveMaterials[index].originalVector)),
    expectedPriorState: index === 0 ? undefined : stageReadback(index),
    terminalReadback: stageReadback(index + 1),
  }));
  const suffixRoot = fiveMigrationBundleSuffixRoot(migrations);
  const query = fiveStateQuery(priorCount, prefixRoot, suffixRoot, migrations);
  const priorReadback = { query, expected: { bundle: { ledgerCount: priorCount, priorCount, prefixRoot, targetCount: 0, suffixRoot: null } } };
  const finalReadback = { query, expected: { bundle: { ledgerCount: priorCount + 5, priorCount, prefixRoot, targetCount: 5, suffixRoot } } };
  migrations[0].expectedPriorState = priorReadback;
  return compileFiveMigrationBundle({ schemaVersion: 1, id: 'verified_admin_five_setup', migrations, priorCount, prefixRoot, suffixRoot, priorReadback, finalReadback }, fiveMaterials);
}

function seedPrefix(database) {
  runSql(database, `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES
    ('20261001000001','local_synthetic_prefix_one',ARRAY['SELECT 1']),
    ('20261001000002','local_synthetic_prefix_two',ARRAY['SELECT 2']),
    ('20261001000003','local_synthetic_prefix_three',ARRAY['SELECT 3']);`);
  return { count: Number(runSql(database, 'SELECT count(*) FROM supabase_migrations.schema_migrations;')), root: runSql(database, prefixRootSql()) };
}

function priorContract() {
  const query = `SELECT json_build_object('prior',json_build_object(
    'ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),
    'fiveLedgerRows',(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${fiveTargetsSql}])),
    'forwardLedgerRows',(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version='${forwardVersion}'),
    'targetFunctions',(SELECT count(*)::int FROM pg_proc WHERE oid=ANY(ARRAY[${TARGET_SIGNATURES.map(value => `to_regprocedure(${literal(value)})`).join(',')}])),
    'targetAllowlistRows',(SELECT count(*)::int FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(ARRAY[${TARGET_SIGNATURES.map(literal).join(',')}]))
  ))::text AS state`;
  return { query, expected: { prior: { ledgerCount: 8, fiveLedgerRows: 5, forwardLedgerRows: 0, targetFunctions: 0, targetAllowlistRows: 0 } } };
}

function targetContract(forceMismatch = false) {
  const bodyValues = TARGET_SIGNATURES.map((signature, index) => `(${literal(signature)},${literal(TARGET_BODY_HASHES[index])})`).join(',');
  const query = `SELECT json_build_object('targets',json_build_object(
    'functionCount',(SELECT count(*)::int FROM pg_proc WHERE oid=ANY(ARRAY[${TARGET_SIGNATURES.map(value => `to_regprocedure(${literal(value)})`).join(',')}])),
    'bodyContract',${forceMismatch ? 'false' : `(SELECT count(*)=3 FROM (VALUES ${bodyValues}) expected(signature,body_sha) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha)`},
    'ownerConfigContract',(SELECT count(*)=3 FROM pg_proc WHERE oid=ANY(ARRAY[${TARGET_SIGNATURES.map(value => `to_regprocedure(${literal(value)})`).join(',')}]) AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]),
    'aclContract',(SELECT count(*)=3 FROM pg_proc p WHERE p.oid=ANY(ARRAY[${TARGET_SIGNATURES.map(value => `to_regprocedure(${literal(value)})`).join(',')}]) AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=2 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)),
    'allowlistContract',(SELECT count(*)=3 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature) WHERE a.source_signature=ANY(ARRAY[${TARGET_SIGNATURES.map(literal).join(',')}]) AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
  ))::text AS state`;
  return { query, expected: { targets: { functionCount: 3, bodyContract: true, ownerConfigContract: true, aclContract: true, allowlistContract: true } } };
}

function targetMetadata(database) {
  return queryJson(database, `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object(
      'signature',signature,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],
      'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,
      'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY signature)
      FROM unnest(ARRAY[${TARGET_SIGNATURES.map(literal).join(',')}]) signature JOIN pg_proc p ON p.oid=to_regprocedure(signature)),
    'allowlist',(SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature) FROM privacy_retention.g014_public_rpc_allowlist a WHERE source_signature=ANY(ARRAY[${TARGET_SIGNATURES.map(literal).join(',')}])),
    'ledger',jsonb_build_object(
      'count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
      'fiveRows',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${fiveTargetsSql}])),
      'forwardRows',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${forwardVersion}'))
  );`);
}

function postFiveBindings(database) {
  const signatures = [
    'pipeline_control.admin_record_review_media(jsonb)',
    'pipeline_control.admin_record_snapshot(text,uuid[])',
    'pipeline_control.admin_record_storage_snapshot(text,text)',
    'pipeline_control.lock_restaurant_review_catalog_revision()',
    'pipeline_control.restaurant_review_manual_preview(uuid,text)',
    'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
    'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
    'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)',
  ];
  return queryJson(database, `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY signature) FROM unnest(ARRAY[${signatures.map(literal).join(',')}]) signature JOIN pg_proc p ON p.oid=to_regprocedure(signature)),
    'assertions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' AND p.proname=ANY(ARRAY['assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract']) AND p.pronargs=0),
    'manifest',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m),'[]'::jsonb)::text,'UTF8')),'hex')
  );`);
}

if (!/^tzudong-five-forward-final-[a-f0-9]{24}$/.test(container)
    || !/^[a-f0-9]{24}$/.test(nonce)
    || !/^tzudong_fresh_pg17_[a-f0-9]{12}$/.test(sourceDatabase)
    || !output) fail('OWNED_REPLAY_ARGUMENT_INVALID');

const forwardBytes = readFileSync(resolve(repo, FORWARD.path));
if (sha256(forwardBytes) !== FORWARD.sha256) fail('FORWARD_SOURCE_HASH_DRIFT');
const forwardVector = readOriginalStatementVector(FORWARD, forwardBytes);
if (forwardVector.length !== FORWARD.statementCount || sha256(JSON.stringify(forwardVector)) !== FORWARD.vectorSha256) {
  fail('FORWARD_SOURCE_VECTOR_DRIFT');
}
const fixturePath = 'apps/web/performance/continuity-recovery-20261009/five-plus-admin-user-rpc-forward-final-20261009/rpc-contract-fixture.sql';
const fixtureBytes = readFileSync(resolve(repo, fixturePath));
const created = new Set();

try {
  const inspect = JSON.parse(spawnSync(docker, ['--context', context, 'inspect', container], { encoding: 'utf8', timeout: 10000 }).stdout)[0];
  if (inspect.Name !== `/${container}` || inspect.Config.Labels?.['tzudong.five-forward-final'] !== nonce
      || inspect.HostConfig.NetworkMode !== 'none' || Object.keys(inspect.HostConfig.PortBindings ?? {}).length) {
    fail('OWNED_CONTAINER_ADMISSION_FAILED');
  }
  result.sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  result.serverVersion = runSql('postgres', "SELECT current_setting('server_version');", { user: 'supabase_admin' });
  result.serverVersionNum = Number(runSql('postgres', "SELECT current_setting('server_version_num');", { user: 'supabase_admin' }));
  if (result.serverVersion !== '17.6' || result.serverVersionNum !== 170006) fail('PG_VERSION_DRIFT');
  result.sourceBindings = {
    five: FIVE.map(([id, path, sourceSha], index) => ({
      id, path, sha256: sourceSha, bytes: fiveMaterials[index].bytes.length,
      statementCount: fiveMaterials[index].originalVector.length,
      statementVectorSha256: sha256(JSON.stringify(fiveMaterials[index].originalVector)),
    })),
    forward: { ...FORWARD, bytes: forwardBytes.length, statementHashes: forwardVector.map(value => sha256(value)) },
    fixture: { path: fixturePath, bytes: fixtureBytes.length, sha256: sha256(fixtureBytes) },
  };

  runSql('postgres', `CREATE DATABASE ${fiveDatabase} TEMPLATE ${sourceDatabase} OWNER postgres;`, { user: 'supabase_admin' });
  created.add(fiveDatabase);
  const prefix = seedPrefix(fiveDatabase);
  if (prefix.count !== 3 || !/^[a-f0-9]{64}$/.test(prefix.root)) fail('SYNTHETIC_PREFIX_DRIFT');
  const compiledFive = compileFive(prefix.count, prefix.root);
  const fiveObserved = queryJson(fiveDatabase, compiledFive.sql, { singleTransaction: true, standardConformingStringsOff: true, timeout: 240000 });
  if (JSON.stringify(fiveObserved) !== JSON.stringify(compiledFive.finalReadback.expected)) fail('FIVE_FINAL_READBACK_MISMATCH');
  const fiveReconciled = queryJson(fiveDatabase, bundleReconciliationSql(compiledFive), { singleTransaction: true });
  if (bundleReconciliationOutcome(fiveReconciled, compiledFive) !== 'committed') fail('FIVE_RECONCILIATION_FAILED');
  const postFive = postFiveBindings(fiveDatabase);
  result.postFive = {
    setupStatus: 'passed',
    bundleId: compiledFive.id,
    priorCount: compiledFive.priorCount,
    prefixRoot: compiledFive.prefixRoot,
    suffixRoot: compiledFive.suffixRoot,
    topLevelStatementCount: statementSpans(compiledFive.sql).length,
    exactSourceVectors: true,
    ledgerCount: Number(runSql(fiveDatabase, 'SELECT count(*) FROM supabase_migrations.schema_migrations;')),
    bindings: postFive,
  };
  if (result.postFive.ledgerCount !== 8) fail('FIVE_LEDGER_COUNT_DRIFT');

  runSql('postgres', `CREATE DATABASE ${mismatchDatabase} TEMPLATE ${fiveDatabase} OWNER postgres; CREATE DATABASE ${driftDatabase} TEMPLATE ${fiveDatabase} OWNER postgres; CREATE DATABASE ${successDatabase} TEMPLATE ${fiveDatabase} OWNER postgres;`, { user: 'supabase_admin' });
  created.add(mismatchDatabase);
  created.add(driftDatabase);
  created.add(successDatabase);

  const prior = priorContract();
  const mismatchMigration = { ...FORWARD, expectedPriorState: prior, terminalReadback: targetContract(true) };
  const mismatchPlan = migrationEnvelope(forwardBytes, mismatchMigration, forwardVector);
  const mismatchBefore = exactState(mismatchDatabase);
  const mismatchFailure = runSql(mismatchDatabase, atomicMigrationSql(mismatchPlan, mismatchMigration), { singleTransaction: true, standardConformingStringsOff: true, expectFailure: true, timeout: 240000 });
  const mismatchAfter = exactState(mismatchDatabase);
  const mismatchObserved = queryJson(mismatchDatabase, reconciliationSql(mismatchPlan, mismatchMigration), { singleTransaction: true });
  result.terminalMismatchObserved = {
    failure: mismatchFailure,
    exactStateEqual: JSON.stringify(mismatchBefore) === JSON.stringify(mismatchAfter),
    reconciliation: reconciliationOutcome(mismatchObserved, mismatchMigration),
    observed: mismatchObserved,
  };
  if (mismatchFailure.sqlState !== 'P0001' || mismatchFailure.fixedCode !== 'MIGRATION_TERMINAL_READBACK_FAILED'
      || JSON.stringify(mismatchBefore) !== JSON.stringify(mismatchAfter)
      || reconciliationOutcome(mismatchObserved, mismatchMigration) !== 'not_applied') {
    fail('FORWARD_TERMINAL_MISMATCH_ROLLBACK_FAILED');
  }
  result.terminalMismatch = {
    sqlState: mismatchFailure.sqlState,
    fixedCode: mismatchFailure.fixedCode,
    rollbackExact: true,
    schemaSha256: mismatchBefore.schemaSha256,
    dataSha256: mismatchBefore.dataSha256,
    rolesAndMembershipPreserved: true,
    reconciliation: 'not_applied',
  };

  const driftBefore = exactState(driftDatabase);
  const driftFailure = runSql(driftDatabase,
    `REVOKE EXECUTE ON FUNCTION public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text) FROM service_role;\n${forwardBytes.toString('utf8')}`,
    { singleTransaction: true, expectFailure: true, timeout: 240000 });
  const driftAfter = exactState(driftDatabase);
  if (driftFailure.messageCode !== 'admin_user_forward_post_five_function_drift'
      || driftFailure.sqlState !== 'P0001'
      || JSON.stringify(driftBefore) !== JSON.stringify(driftAfter)) {
    fail('FORWARD_PREIMAGE_DRIFT_ROLLBACK_FAILED');
  }
  result.preimageDrift = {
    predicate: 'post-five admin_record_action service_role EXECUTE ACL',
    sqlState: driftFailure.sqlState,
    fixedCode: driftFailure.messageCode,
    rollbackExact: true,
    targetsInstalled: false,
  };

  const migration = { ...FORWARD, expectedPriorState: prior, terminalReadback: targetContract(false) };
  const plan = migrationEnvelope(forwardBytes, migration, forwardVector);
  const successBefore = exactState(successDatabase);
  const forwardObserved = queryJson(successDatabase, atomicMigrationSql(plan, migration), { singleTransaction: true, standardConformingStringsOff: true, timeout: 240000 });
  if (JSON.stringify(forwardObserved) !== JSON.stringify(migration.terminalReadback.expected)) fail('FORWARD_FINAL_READBACK_MISMATCH');
  const forwardReconciled = queryJson(successDatabase, reconciliationSql(plan, migration), { singleTransaction: true });
  if (reconciliationOutcome(forwardReconciled, migration) !== 'committed') fail('FORWARD_RECONCILIATION_FAILED');

  runSql(successDatabase, 'BEGIN READ ONLY; SELECT privacy_retention.assert_g014_workflow_owner_contract(); SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); SELECT privacy_retention.assert_g014_catalog_contract(); ROLLBACK;', { user: 'supabase_admin' });
  const metadata = targetMetadata(successDatabase);
  const postFiveAfter = postFiveBindings(successDatabase);
  if (metadata.functions.length !== 3 || metadata.allowlist.length !== 3
      || metadata.ledger.count !== 9 || metadata.ledger.fiveRows !== 5 || metadata.ledger.forwardRows !== 1
      || JSON.stringify(postFiveAfter) !== JSON.stringify(postFive)) fail('FORWARD_METADATA_PRESERVATION_FAILED');

  const ledgerExact = queryJson(successDatabase, `SELECT jsonb_build_object(
    'exact',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${forwardVersion}' AND name='admin_user_management_rpc_forward' AND statements=ARRAY(SELECT jsonb_array_elements_text(${literal(JSON.stringify(forwardVector))}::jsonb))),
    'prefixCount',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version<>ALL(ARRAY[${[...fiveVersions, forwardVersion].map(literal).join(',')}])),
    'prefixRoot',(${prefixRootSql([...fiveVersions, forwardVersion]).replace(/;$/, '')})
  );`);
  if (!ledgerExact.exact || ledgerExact.prefixCount !== 3 || ledgerExact.prefixRoot !== prefix.root) fail('FORWARD_LEDGER_PRESERVATION_FAILED');

  const fixtureBefore = exactState(successDatabase);
  const fixtureProof = queryJson(successDatabase, fixtureBytes.toString('utf8'), { user: 'postgres', timeout: 240000 });
  const fixtureAfter = exactState(successDatabase);
  if (JSON.stringify(fixtureBefore) !== JSON.stringify(fixtureAfter)
      || fixtureProof.metadata.rowCount !== 3 || fixtureProof.metadata.ordered !== true
      || fixtureProof.metadata.missingProfileNull !== true || fixtureProof.metadata.adminProjection !== true
      || fixtureProof.metadata.bound200 !== 200
      || fixtureProof.audit.storedCount !== 52 || fixtureProof.audit.returnedCount !== 50
      || fixtureProof.audit.ordered !== true || fixtureProof.audit.minimizedProjection !== true
      || fixtureProof.invalidMetadataDenied !== 3 || fixtureProof.invalidAuditLimitsDenied !== 2
      || fixtureProof.invalidAppendDenied !== 3 || fixtureProof.positiveAppendCount !== 52
      || fixtureProof.transactionRollbackPending !== true) fail('RPC_CONTRACT_FIXTURE_FAILED');

  result.success = {
    exactTerminalReadback: true,
    reconciliation: 'committed',
    ledger: metadata.ledger,
    exactOriginalVectorStored: true,
    prefixPreserved: true,
    prefixCount: ledgerExact.prefixCount,
    prefixRoot: ledgerExact.prefixRoot,
    postFiveBindingsPreserved: true,
    rolesAndMembershipPreserved: JSON.stringify(successBefore.roles) === JSON.stringify(fixtureAfter.roles),
    g014AssertionsPassed: 4,
    targetMetadata: metadata,
  };
  result.rpcContract = {
    ...fixtureProof,
    rollbackExact: true,
    syntheticOnly: true,
    personalRowsCopied: 0,
  };
  result.status = 'passed';
} catch (error) {
  result.failure = {
    code: /^[A-Z0-9_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'ADMIN_USER_FORWARD_REPLAY_UNCONFIRMED',
    sqlState: /^[A-Z0-9]{5}$/.test(error.sqlState ?? '') ? error.sqlState : null,
    fixedCode: error.fixedCode ?? error.messageCode ?? null,
    detail: typeof error.detail === 'string' ? error.detail : null,
  };
} finally {
  result.databaseCleanup = {};
  for (const database of [...created].reverse()) {
    try {
      runSql('postgres', `DROP DATABASE IF EXISTS ${database};`, { user: 'supabase_admin' });
      result.databaseCleanup[database] = true;
    } catch {
      result.databaseCleanup[database] = false;
    }
  }
  result.completedAt = new Date().toISOString();
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, failure: result.failure ?? null, databaseCleanup: result.databaseCleanup }));
}

if (result.status !== 'passed' || [...created].some(database => !result.databaseCleanup[database])) process.exitCode = 1;
