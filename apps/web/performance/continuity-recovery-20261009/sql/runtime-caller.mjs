import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { applyMigrationWithTerminalReadback } from '../../../scripts/apply-supabase-migration.mjs';
import { migrationEnvelope, reconciliationSql, statementSpans } from '../../../scripts/supabase-migration-transaction.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evidenceDir, '../../../../..');
const docker = '/opt/homebrew/bin/docker';
const dockerContext = 'colima-tzudong-catalog-20261007';
const resources = Object.freeze({
  pg15: {
    container: 'tzudong-atomic-impl-pg15-20261009',
    imageDigest: 'sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b',
    expectedVersion: '15.8',
  },
  pg17: {
    container: 'tzudong-atomic-impl-pg17-20261009',
    imageDigest: 'sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab',
    expectedVersion: '17.6',
  },
});

const engine = process.argv[2];
const resource = resources[engine];
if (!resource) throw new Error('ENGINE_REQUIRED');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const suffix = `${process.pid}_${Date.now()}`;
const database = `continuity_sql_${engine}_${suffix}`;
const roles = [`continuity_select_${suffix}`, `continuity_insert_${suffix}`];
const fixturesDir = resolve(evidenceDir, 'fixtures');
const engineFixturesDir = resolve(fixturesDir, engine);
mkdirSync(engineFixturesDir, { recursive: true });

const result = {
  status: 'unconfirmed',
  engine,
  actualCaller: 'applyMigrationWithTerminalReadback',
  operatingWrites: false,
  dockerContext,
  container: resource.container,
  expectedImageDigest: resource.imageDigest,
  database,
  cases: [],
  cleanup: { databaseDropped: false, rolesDropped: false },
};

function dockerCall(args, options = {}) {
  return spawnSync(docker, ['--context', dockerContext, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
    ...options,
  });
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('IDENTIFIER_INVALID');
  return `"${value}"`;
}

function sql(text, { targetDatabase = database, singleTransaction = false, role = null } = {}) {
  const user = role ?? 'postgres';
  const password = role ? 'continuity-fixture-only' : 'fixture-only';
  const args = [
    'exec', '-i', '-e', `PGPASSWORD=${password}`, resource.container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', '127.0.0.1', '-U', user, '-d', targetDatabase,
  ];
  if (singleTransaction) args.push('--single-transaction');
  const run = dockerCall(args, { input: text });
  if (run.error || run.status !== 0) {
    const sqlstate = /ERROR:\s+([A-Z0-9]{5})/.exec(run.stderr || '')?.[1];
    const error = new Error(sqlstate ? `MIGRATION_PSQL_FAILED_${sqlstate}` : 'MIGRATION_PSQL_FAILED');
    error.code = error.message;
    error.fixedSqlCode = /ERROR:\s+(?:[A-Z0-9]{5}:\s*)?(MIGRATION_[A-Z0-9_]+)\b/.exec(run.stderr || '')?.[1];
    throw error;
  }
  return run.stdout || '';
}

let ordinal = 0;
function fixture(name, { terminalExpected = true, sourceSuffix = '' } = {}) {
  ordinal += 1;
  const version = `20261009${String(160000 + ordinal).padStart(6, '0')}`;
  const table = `continuity_${engine}_${name}_${ordinal}`;
  const source = `-- isolated continuity fixture\nBEGIN;\nCREATE TABLE public.${table}(id int);\n${sourceSuffix}COMMIT;\n`;
  const fixturePath = resolve(engineFixturesDir, `${version}_${name}.sql`);
  writeFileSync(fixturePath, source, { mode: 0o644 });
  const migration = {
    id: name,
    path: `backend/supabase/migrations/${version}_${name}.sql`,
    sha256: sha256(source),
    expectedPriorState: {
      query: `SELECT json_build_object('absent',to_regclass('public.${table}') IS NULL)::text;`,
      expected: { absent: true },
    },
    terminalReadback: {
      query: `SELECT json_build_object('ready',to_regclass('public.${table}') IS NOT NULL)::text;`,
      expected: { ready: terminalExpected },
    },
  };
  const readVectorImpl = () => {
    const run = spawnSync(process.execPath, [
      resolve(repositoryRoot, 'backend/supabase/scripts/g037_supabase_statement_vector.mjs'),
      '--source', fixturePath,
      '--version', version,
      '--sha256', migration.sha256,
      '--size', String(Buffer.byteLength(source)),
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw new Error('VECTOR_INVALID');
    return JSON.parse(run.stdout).statements;
  };
  return { migration, source, table, version, readVectorImpl };
}

function transport({ role = null, lostAck = false, corruptStdout = null } = {}) {
  const state = { calls: 0, firstCode: null, firstFixedSqlCode: null };
  return {
    state,
    runPsqlImpl: (_databaseUrl, query, singleTransaction) => {
      state.calls += 1;
      let output;
      try {
        output = sql(query, { singleTransaction, role });
      } catch (error) {
        state.firstCode ??= error.code ?? error.message;
        state.firstFixedSqlCode ??= error.fixedSqlCode ?? null;
        throw error;
      }
      if (state.calls === 1 && lostAck) {
        const error = new Error('MIGRATION_PSQL_EXECUTION_FAILED');
        error.code = error.message;
        throw error;
      }
      if (state.calls === 1 && corruptStdout !== null) return corruptStdout;
      return output;
    },
  };
}

function apply(fixtureRecord, transportOptions = {}) {
  const runner = transport(transportOptions);
  let value = null;
  let code = null;
  try {
    value = applyMigrationWithTerminalReadback('fixture', fixtureRecord.migration, fixtureRecord.source, {
      readVectorImpl: fixtureRecord.readVectorImpl,
      runPsqlImpl: runner.runPsqlImpl,
    });
  } catch (error) {
    code = error.code ?? error.message;
  }
  return { value, code, ...runner.state };
}

function observe(fixtureRecord) {
  return JSON.parse(sql(`SELECT json_build_object('table',to_regclass('public.${fixtureRecord.table}') IS NOT NULL,'ledger',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${fixtureRecord.version}'))::text;`).trim());
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function record(name, fixtureRecord, execution, expected) {
  const state = observe(fixtureRecord);
  assert(state.table === expected.table && state.ledger === expected.ledger, `${name.toUpperCase()}_STATE_INVALID`);
  result.cases.push({ name, ...execution, state });
}

try {
  const inspect = JSON.parse(dockerCall(['inspect', resource.container]).stdout)[0];
  assert(inspect.HostConfig.NetworkMode === 'none', 'RESOURCE_NETWORK_NOT_NONE');
  assert(Object.keys(inspect.HostConfig.PortBindings || {}).length === 0, 'RESOURCE_PORTS_PUBLISHED');
  assert(inspect.Image === resource.imageDigest, 'RESOURCE_IMAGE_DRIFT');
  result.containerId = inspect.Id;
  result.networkMode = inspect.HostConfig.NetworkMode;
  result.publishedPorts = 0;

  sql(`CREATE DATABASE ${quoteIdentifier(database)} OWNER postgres;`, { targetDatabase: 'postgres' });
  sql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
  result.serverVersion = sql("SELECT current_setting('server_version');").trim();
  assert(result.serverVersion === resource.expectedVersion, 'SERVER_VERSION_DRIFT');

  const strict3 = fixture('strict3_success');
  const strict3Run = apply(strict3);
  result.firstCaseDiagnostic = { execution: strict3Run, state: observe(strict3) };
  assert(strict3Run.code === null && JSON.stringify(strict3Run.value) === '{"ready":true}', 'STRICT3_CALLER_FAILED');
  record('strict_3_column_success', strict3, strict3Run, { table: true, ledger: true });

  const mismatch = fixture('terminal_mismatch', { terminalExpected: false });
  const mismatchRun = apply(mismatch);
  assert(mismatchRun.code === 'MIGRATION_TERMINAL_READBACK_FAILED', 'TERMINAL_MISMATCH_CODE');
  record('terminal_mismatch', mismatch, mismatchRun, { table: false, ledger: false });

  const lostAck = fixture('lost_ack');
  const lostAckRun = apply(lostAck, { lostAck: true });
  assert(lostAckRun.code === null && lostAckRun.calls === 2, 'LOST_ACK_RECONCILIATION_FAILED');
  record('lost_ack', lostAck, lostAckRun, { table: true, ledger: true });

  for (const [label, bad] of [
    ['empty', ''],
    ['truncated', '{"ready":'],
    ['contaminated', 'untrusted extra stdout'],
    ['mismatched', '{"ready":false}'],
  ]) {
    const corrupted = fixture(`exit0_${label}`);
    const corruptedRun = apply(corrupted, { corruptStdout: bad });
    assert(corruptedRun.code === null && corruptedRun.calls === 2, `EXIT0_${label.toUpperCase()}_RECONCILIATION_FAILED`);
    record(`exit0_stdout_${label}`, corrupted, corruptedRun, { table: true, ledger: true });
  }

  const conflict = fixture('ledger_conflict');
  sql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${conflict.version}','conflict',ARRAY['different source']);`);
  const conflictRun = apply(conflict);
  assert(conflictRun.code === 'MIGRATION_RECONCILIATION_CONFLICT', 'LEDGER_CONFLICT_CODE');
  record('ledger_conflict', conflict, conflictRun, { table: false, ledger: true });

  sql(`CREATE ROLE ${quoteIdentifier(roles[0])} LOGIN PASSWORD 'continuity-fixture-only'; CREATE ROLE ${quoteIdentifier(roles[1])} LOGIN PASSWORD 'continuity-fixture-only';
GRANT USAGE,CREATE ON SCHEMA public TO ${quoteIdentifier(roles[0])},${quoteIdentifier(roles[1])};
GRANT USAGE ON SCHEMA supabase_migrations TO ${quoteIdentifier(roles[0])},${quoteIdentifier(roles[1])};
GRANT SELECT ON supabase_migrations.schema_migrations TO ${quoteIdentifier(roles[0])};
GRANT INSERT ON supabase_migrations.schema_migrations TO ${quoteIdentifier(roles[1])};`);

  for (const [label, role] of [['select_only', roles[0]], ['insert_only', roles[1]]]) {
    const denied = fixture(`privilege_${label}`);
    const deniedRun = apply(denied, { role });
    result.privilegeDiagnostics ??= [];
    result.privilegeDiagnostics.push({ label, execution: deniedRun, state: observe(denied) });
    assert(deniedRun.firstFixedSqlCode === 'MIGRATION_LEDGER_UNAVAILABLE', `PRIVILEGE_${label.toUpperCase()}_ADMISSION_CODE`);
    record(`privilege_${label}_denied_before_ddl`, denied, deniedRun, { table: false, ledger: false });
  }

  sql('ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN created_by text, ADD COLUMN idempotency_key text, ADD COLUMN rollback text[];');
  const strict6 = fixture('strict6_success');
  const strict6Run = apply(strict6);
  assert(strict6Run.code === null, 'STRICT6_CALLER_FAILED');
  record('strict_6_column_success', strict6, strict6Run, { table: true, ledger: true });

  sql('ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN unknown_profile integer;');
  const unknown7 = fixture('unknown7_profile');
  const unknown7Run = apply(unknown7);
  assert(unknown7Run.firstFixedSqlCode === 'MIGRATION_LEDGER_CONTRACT_INSUFFICIENT', 'UNKNOWN_PROFILE_CODE');
  record('unknown_7_column_profile_denied', unknown7, unknown7Run, { table: false, ledger: false });
  sql('ALTER TABLE supabase_migrations.schema_migrations DROP COLUMN unknown_profile;');

  sql("ALTER TABLE supabase_migrations.schema_migrations ALTER COLUMN created_by SET DEFAULT 'unexpected';");
  const malformed6 = fixture('malformed6_profile');
  const malformed6Run = apply(malformed6);
  assert(malformed6Run.firstFixedSqlCode === 'MIGRATION_LEDGER_CONTRACT_INSUFFICIENT', 'MALFORMED6_PROFILE_CODE');
  record('malformed_6_column_profile_denied', malformed6, malformed6Run, { table: false, ledger: false });

  const readbackFixture = strict3;
  const plan = migrationEnvelope(Buffer.from(readbackFixture.source), readbackFixture.migration, readbackFixture.readVectorImpl());
  const reconciliation = JSON.parse(sql(reconciliationSql(plan, readbackFixture.migration), { singleTransaction: true }).trim());
  assert(reconciliation.ledger_exists === true && reconciliation.ledger_equal === true, 'RECONCILIATION_READBACK_INVALID');
  result.reconciliation = reconciliation;
  result.status = 'passed';
} catch (error) {
  result.failure = { code: error.code ?? error.message };
} finally {
  try {
    sql(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)};`, { targetDatabase: 'postgres' });
    result.cleanup.databaseDropped = true;
  } catch (error) {
    result.cleanup.databaseDropError = error.code ?? error.message;
  }
  try {
    sql(`DROP ROLE IF EXISTS ${roles.map(quoteIdentifier).join(',')};`, { targetDatabase: 'postgres' });
    result.cleanup.rolesDropped = true;
  } catch (error) {
    result.cleanup.roleDropError = error.code ?? error.message;
  }
  result.sourceHashes = {
    apply: sha256(readFileSync(resolve(repositoryRoot, 'apps/web/scripts/apply-supabase-migration.mjs'))),
    transaction: sha256(readFileSync(resolve(repositoryRoot, 'apps/web/scripts/supabase-migration-transaction.mjs'))),
    transactionTests: sha256(readFileSync(resolve(repositoryRoot, 'apps/web/tests-unit/supabase-migration-transaction.test.ts'))),
  };
  writeFileSync(resolve(evidenceDir, `${engine}-runtime.json`), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify(result));
  if (result.status !== 'passed' || !result.cleanup.databaseDropped || !result.cleanup.rolesDropped) process.exitCode = 1;
}
