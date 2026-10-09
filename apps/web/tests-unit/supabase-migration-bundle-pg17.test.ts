import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  bundleReconciliationOutcome,
  bundleReconciliationSql,
  compileMigrationBundle,
  migrationBundleSuffixRoot,
} from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const databaseUrl = process.env.TZUDONG_BUNDLE_PG17_URL;
const psql = process.env.TZUDONG_BUNDLE_PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';
const integrationTest = databaseUrl ? test : test.skip;
const fixtureId = process.env.TZUDONG_BUNDLE_FIXTURE_ID;
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const TARGET_VERSIONS = ['20261009130101', '20261009130102', '20261009130103', '20261009130104'];

function runSql(sql: string, { singleTransaction = false, expectFailure = false } = {}) {
  const args = [databaseUrl!, '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1'];
  if (singleTransaction) args.push('--single-transaction');
  const result = spawnSync(psql, args, { input: sql, encoding: 'utf8' });
  if (expectFailure) {
    expect(result.status).not.toBe(0);
  } else if (result.status !== 0) {
    throw new Error('PG17_FIXTURE_FAILED');
  }
  return result.stdout.trim();
}

function assertOwnedFixture() {
  if (!fixtureId || !/^[a-f0-9]{24}$/.test(fixtureId)) throw new Error('PG17_FIXTURE_IDENTITY_REQUIRED');
  let target: URL;
  try { target = new URL(databaseUrl!); } catch { throw new Error('PG17_FIXTURE_TARGET_INVALID'); }
  const name = `tzudong_bundle_fixture_${fixtureId}`;
  const socket = target.searchParams.get('host');
  const localSocket = !target.hostname && socket
    && /^\/(?:private\/)?tmp\/tzudong-bundle-[a-f0-9]{24}\/socket$/.test(socket);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || target.pathname !== `/${name}` || target.hash
    || (target.hostname && socket)
    || (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && !localSocket)
    || [...target.searchParams.keys()].some(key => !['host', 'port'].includes(key))
    || target.searchParams.getAll('host').length > 1 || target.searchParams.getAll('port').length > 1) {
    throw new Error('PG17_FIXTURE_TARGET_INVALID');
  }
  const owned = runSql(`BEGIN TRANSACTION READ ONLY;
    SELECT current_database()='${name}' AND EXISTS(
      SELECT 1 FROM public.tzudong_bundle_fixture_ownership
      WHERE fixture_id='${fixtureId}' AND owner_tag='codex-pipeline-continuity-20261009'
    ); COMMIT;`);
  if (owned !== 't') throw new Error('PG17_FIXTURE_OWNERSHIP_REQUIRED');
}

function prefixRootSql() {
  return `WITH prefix AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text AS material
    FROM supabase_migrations.schema_migrations
    WHERE version <> ALL(ARRAY[${TARGET_VERSIONS.map(version => `'${version}'`).join(',')}])
  ) SELECT encode(sha256(convert_to(material,'UTF8')),'hex') FROM prefix;`;
}

function fixtureSources(failureStage: number | null) {
  const operations = [
    'CREATE TABLE public.bundle_fixture(id integer PRIMARY KEY, stage integer NOT NULL); INSERT INTO public.bundle_fixture VALUES(1,1)',
    'ALTER TABLE public.bundle_fixture ADD COLUMN note text; UPDATE public.bundle_fixture SET stage=2,note=\'two\' WHERE id=1',
    'UPDATE public.bundle_fixture SET stage=3,note=\'three\' WHERE id=1',
    'CREATE VIEW public.bundle_fixture_view AS SELECT id,stage,note FROM public.bundle_fixture',
  ];
  return operations.map((operation, index) => {
    const body = failureStage === index + 1
      ? `DO $fixture_failure$ BEGIN RAISE EXCEPTION 'FIXTURE_STAGE_${index + 1}_FAILURE'; END $fixture_failure$`
      : operation;
    return `BEGIN; ${body}; SELECT ${index + 1} AS bundle_assertion_stage; COMMIT;`;
  });
}

function stageReadback(stage: number) {
  const expressions = [
    "to_regclass('public.bundle_fixture') IS NOT NULL",
    "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bundle_fixture' AND column_name='note')",
    "(SELECT stage=3 AND note='three' FROM public.bundle_fixture WHERE id=1)",
    "to_regclass('public.bundle_fixture_view') IS NOT NULL",
  ];
  return {
    query: `SELECT json_build_object('stage',CASE WHEN ${expressions[stage - 1]} THEN ${stage} ELSE 0 END)::text AS state`,
    expected: { stage },
  };
}

function bundleStateQuery(
  priorCount: number,
  prefixRoot: string,
  suffixRoot: string,
  migrations: Array<any>,
  forceFinalMismatch: boolean,
) {
  const targets = TARGET_VERSIONS.map(version => `'${version}'`).join(',');
  const exactRows = migrations.map((migration, index) => {
    const name = migration.path.match(/^backend\/supabase\/migrations\/\d{14}_([a-z0-9_]+)\.sql$/)![1];
    const statements = JSON.stringify(statementSpans(fixtureSources(null)[index]).map(span => span.token)).replaceAll("'", "''");
    return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${TARGET_VERSIONS[index]}' AND name='${name}' AND statements=ARRAY(SELECT jsonb_array_elements_text('${statements}'::jsonb)))`;
  }).join(' AND ');
  const material = `coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)::text`;
  return `SELECT * FROM (WITH prefix AS (
    SELECT count(*)::int AS prior_count,${material} AS material
    FROM supabase_migrations.schema_migrations WHERE version <> ALL(ARRAY[${targets}])
  ), target AS (
    SELECT count(*)::int AS target_count FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${targets}])
  ) SELECT json_build_object('bundle',json_build_object(
    'ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),
    'priorCount',prefix.prior_count,
    'prefixRoot',encode(sha256(convert_to(prefix.material,'UTF8')),'hex'),
    'targetCount',target.target_count,
    'suffixRoot',CASE WHEN target.target_count=4 AND ${exactRows} THEN '${forceFinalMismatch ? '0'.repeat(64) : suffixRoot}' ELSE NULL END
  ))::text AS state FROM prefix,target) AS bundle_state`;
}

function compileFixture(
  priorCount: number,
  prefixRoot: string,
  failureStage: number | null,
  forceFinalMismatch = false,
) {
  const sources = fixtureSources(failureStage);
  const materials = sources.map((source, index) => ({
    path: `backend/supabase/migrations/${TARGET_VERSIONS[index]}_bundle_fixture_stage_${index + 1}.sql`,
    bytes: Buffer.from(source),
    originalVector: statementSpans(source).map(span => span.token),
  }));
  const migrations = materials.map((material, index) => ({
    id: `bundle_fixture_stage_${index + 1}`,
    path: material.path,
    sha256: sha256(material.bytes),
    statementVectorSha256: sha256(JSON.stringify(material.originalVector)),
    expectedPriorState: index === 0 ? undefined : stageReadback(index),
    terminalReadback: stageReadback(index + 1),
  }));
  const suffixRoot = migrationBundleSuffixRoot(migrations);
  const query = bundleStateQuery(priorCount, prefixRoot, suffixRoot, migrations, forceFinalMismatch);
  const priorReadback = {
    query,
    expected: { bundle: { ledgerCount: priorCount, prefixRoot, priorCount, suffixRoot: null, targetCount: 0 } },
  };
  const finalReadback = {
    query,
    expected: { bundle: { ledgerCount: priorCount + 4, prefixRoot, priorCount, suffixRoot, targetCount: 4 } },
  };
  migrations[0].expectedPriorState = priorReadback;
  return compileMigrationBundle({
    schemaVersion: 1,
    id: `pg17_bundle_fixture_${failureStage ?? 'success'}`,
    priorCount,
    prefixRoot,
    suffixRoot,
    migrations,
    priorReadback,
    finalReadback,
  }, materials);
}

function resetTargets() {
  runSql(`DROP VIEW IF EXISTS public.bundle_fixture_view; DROP TABLE IF EXISTS public.bundle_fixture; DELETE FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY[${TARGET_VERSIONS.map(version => `'${version}'`).join(',')}]);`);
}

integrationTest('owned PG17 proves partial prior/global mismatch/stage failures roll back, then exact success commits four', () => {
  assertOwnedFixture();
  expect(runSql('SHOW server_version_num;')).toStartWith('17');
  runSql(`DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[] NOT NULL, name text NOT NULL);
    INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES
      ('20261001000001',ARRAY['seed one'],'seed_one'),
      ('20261001000002',ARRAY['seed two'],'seed_two'),
      ('20261001000003',ARRAY['seed three'],'seed_three');`);
  const priorCount = Number(runSql('SELECT count(*) FROM supabase_migrations.schema_migrations;'));
  const prefixRoot = runSql(prefixRootSql());
  expect(priorCount).toBe(3);
  expect(prefixRoot).toMatch(/^[0-9a-f]{64}$/);

  resetTargets();
  const partialCompiled = compileFixture(priorCount, prefixRoot, null);
  runSql(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
    VALUES('${TARGET_VERSIONS[0]}',ARRAY['partial-ledger-row'],'bundle_fixture_stage_1');`);
  runSql(partialCompiled.sql, { singleTransaction: true, expectFailure: true });
  expect(runSql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '202610091301%';")).toBe('1');
  expect(runSql("SELECT count(*) FROM pg_class WHERE relname IN ('bundle_fixture','bundle_fixture_view');")).toBe('0');
  const partialObserved = JSON.parse(runSql(bundleReconciliationSql(partialCompiled)));
  expect(bundleReconciliationOutcome(partialObserved, partialCompiled)).toBe('partial_conflict');

  resetTargets();
  const globalMismatchCompiled = compileFixture(priorCount, prefixRoot, null, true);
  runSql(globalMismatchCompiled.sql, { singleTransaction: true, expectFailure: true });
  expect(runSql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '202610091301%';")).toBe('0');
  expect(runSql("SELECT count(*) FROM pg_class WHERE relname IN ('bundle_fixture','bundle_fixture_view');")).toBe('0');
  const globalMismatchObserved = JSON.parse(runSql(bundleReconciliationSql(globalMismatchCompiled)));
  expect(bundleReconciliationOutcome(globalMismatchObserved, globalMismatchCompiled)).toBe('not_applied');

  for (const failureStage of [1, 2, 3, 4]) {
    resetTargets();
    const compiled = compileFixture(priorCount, prefixRoot, failureStage);
    runSql(compiled.sql, { singleTransaction: true, expectFailure: true });
    expect(runSql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '202610091301%';")).toBe('0');
    expect(runSql("SELECT count(*) FROM pg_class WHERE relname IN ('bundle_fixture','bundle_fixture_view');")).toBe('0');
    const observed = JSON.parse(runSql(bundleReconciliationSql(compiled)));
    expect(bundleReconciliationOutcome(observed, compiled)).toBe('not_applied');
  }

  resetTargets();
  const compiled = compileFixture(priorCount, prefixRoot, null);
  const observed = JSON.parse(runSql(compiled.sql, { singleTransaction: true }));
  expect(observed).toEqual(compiled.finalReadback.expected);
  expect(runSql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '202610091301%';")).toBe('4');
  expect(runSql('SELECT stage||\':\'||note FROM public.bundle_fixture WHERE id=1;')).toBe('3:three');
  expect(bundleReconciliationOutcome(JSON.parse(runSql(bundleReconciliationSql(compiled))), compiled)).toBe('committed');
  resetTargets();
});
