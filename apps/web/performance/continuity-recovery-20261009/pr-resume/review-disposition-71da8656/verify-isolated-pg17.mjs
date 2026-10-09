import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMigrationWithTerminalReadback } from '../../../../scripts/apply-supabase-migration.mjs';
import { migrationEnvelope, reconciliationSql } from '../../../../scripts/supabase-migration-transaction.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../../..', import.meta.url)));

const postgresMajor = value => {
  const match = /(?:PostgreSQL\)?\s+)?(\d+)(?:\.\d+)?/.exec(String(value));
  return match ? Number(match[1]) : null;
};

const engineContract = ({ pgConfigVersion, initdbVersion, pgCtlVersion, psqlVersion, serverVersionNum = null }) => {
  const preStartupMajors = {
    pgConfig: postgresMajor(pgConfigVersion),
    initdb: postgresMajor(initdbVersion),
    pgCtl: postgresMajor(pgCtlVersion),
    psql: postgresMajor(psqlVersion),
  };
  const preStartupPassed = Object.values(preStartupMajors).every(major => major === 17);
  const parsedVersionNum = /^\d+$/.test(String(serverVersionNum ?? '')) ? Number(serverVersionNum) : null;
  const postStartupMajor = parsedVersionNum === null ? null : Math.trunc(parsedVersionNum / 10000);
  const postStartupChecked = postStartupMajor !== null;
  const postStartupPassed = postStartupChecked ? postStartupMajor === 17 : null;
  return {
    expectedMajor: 17,
    preStartupMajors,
    preStartupPassed,
    postStartupMajor,
    postStartupChecked,
    postStartupPassed,
    code: !preStartupPassed ? 'POSTGRES_MAJOR_UNSUPPORTED'
      : postStartupChecked && !postStartupPassed ? 'POSTGRES_SERVER_MAJOR_UNSUPPORTED' : null,
  };
};

const fixtureIndex = process.argv.indexOf('--engine-contract-fixture');
if (fixtureIndex !== -1) {
  let fixtureResult;
  try {
    const fixture = JSON.parse(readFileSync(process.argv[fixtureIndex + 1], 'utf8'));
    const verification = engineContract(fixture);
    const fixtureCode = verification.postStartupChecked ? verification.code : 'ENGINE_FIXTURE_INVALID';
    fixtureResult = {
      status: fixtureCode === null ? 'passed' : 'rejected',
      engine: fixtureCode === null ? 'postgresql-17' : null,
      engineVerification: verification,
      failure: fixtureCode === null ? null : { code: fixtureCode },
      fixtureOnly: true,
      operatingDatabaseWrites: false,
    };
  } catch {
    fixtureResult = {
      status: 'rejected',
      engine: null,
      failure: { code: 'ENGINE_FIXTURE_INVALID' },
      fixtureOnly: true,
      operatingDatabaseWrites: false,
    };
  }
  console.log(JSON.stringify(fixtureResult));
  process.exit(fixtureResult.status === 'passed' ? 0 : 1);
}

const temporaryRoot = mkdtempSync('/tmp/tzudong-pr3150-pg17-');
const dataDirectory = resolve(temporaryRoot, 'data');
const socketDirectory = resolve(temporaryRoot, 'socket');
const fixtureDirectory = resolve(temporaryRoot, 'fixtures');
const port = '55439';
mkdirSync(socketDirectory);
mkdirSync(fixtureDirectory);

const result = {
  status: 'unconfirmed',
  engine: null,
  expectedEngine: 'postgresql-17',
  network: 'unix-socket-only',
  operatingDatabaseWrites: false,
  cases: [],
  cleanup: { stopped: false, removed: false },
};

const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function command(executable, args, options = {}) {
  const run = spawnSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (run.error || run.status !== 0) {
    const error = new Error('COMMAND_FAILED');
    error.code = 'COMMAND_FAILED';
    throw error;
  }
  return run.stdout || '';
}

let initdb = null;
let pgCtl = null;
let psql = null;
let serverStarted = false;

function runPsql(query, { role = 'postgres', singleTransaction = false } = {}) {
  const args = [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--quiet',
    '--tuples-only',
    '--no-align',
  ];
  if (singleTransaction) args.push('--single-transaction');
  args.push('-h', socketDirectory, '-p', port, '-U', role, '-d', 'postgres');
  const run = spawnSync(psql, args, {
    encoding: 'utf8',
    input: `\\set VERBOSITY verbose\n${query}`,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (run.error) {
    const error = new Error('MIGRATION_PSQL_EXECUTION_FAILED');
    error.code = error.message;
    throw error;
  }
  if (run.status !== 0) {
    const stderr = run.stderr || '';
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/m.exec(stderr)?.[1];
    const error = new Error(sqlstate ? `MIGRATION_PSQL_FAILED_${sqlstate}` : 'MIGRATION_PSQL_FAILED');
    error.code = error.message;
    error.fixedSqlCode = /ERROR:\s+(?:[0-9A-Z]{5}:\s*)?(MIGRATION_[A-Z0-9_]{1,96})\b/m.exec(stderr)?.[1];
    throw error;
  }
  return run.stdout || '';
}

let ordinal = 0;
function migration(name, source, expectedPriorState, terminalReadback) {
  ordinal += 1;
  const version = `20261009${String(200000 + ordinal).padStart(6, '0')}`;
  const fixturePath = resolve(fixtureDirectory, `${version}_${name}.sql`);
  writeFileSync(fixturePath, source, { mode: 0o600 });
  const record = {
    id: name,
    path: `backend/supabase/migrations/${version}_${name}.sql`,
    sha256: hash(source),
    expectedPriorState,
    terminalReadback,
  };
  const vector = () => {
    const parsed = command(process.execPath, [
      resolve(repositoryRoot, 'backend/supabase/scripts/g037_supabase_statement_vector.mjs'),
      '--source', fixturePath,
      '--version', version,
      '--sha256', record.sha256,
      '--size', String(Buffer.byteLength(source)),
    ]);
    return JSON.parse(parsed).statements;
  };
  return { record, source, vector, version };
}

function apply(fixture, runPsqlImpl = (_url, query, singleTransaction) => runPsql(query, { singleTransaction })) {
  return applyMigrationWithTerminalReadback('isolated', fixture.record, fixture.source, {
    readVectorImpl: fixture.vector,
    runPsqlImpl,
  });
}

function expect(condition, code) {
  if (!condition) throw new Error(code);
}

try {
  const pgConfigVersion = command('pg_config', ['--version']).trim();
  const pgBindir = command('pg_config', ['--bindir']).trim();
  initdb = resolve(pgBindir, 'initdb');
  pgCtl = resolve(pgBindir, 'pg_ctl');
  psql = resolve(pgBindir, 'psql');
  const preStartup = engineContract({
    pgConfigVersion,
    initdbVersion: command(initdb, ['--version']).trim(),
    pgCtlVersion: command(pgCtl, ['--version']).trim(),
    psqlVersion: command(psql, ['--version']).trim(),
  });
  result.engineVerification = preStartup;
  expect(preStartup.preStartupPassed, preStartup.code);
  command(initdb, ['-D', dataDirectory, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8']);
  command(pgCtl, ['-D', dataDirectory, '-l', resolve(temporaryRoot, 'postgres.log'), '-o', `-F -k ${socketDirectory} -p ${port} -h ''`, '-w', 'start']);
  serverStarted = true;
  result.serverVersion = runPsql("SELECT current_setting('server_version');").trim();
  result.serverVersionNum = runPsql("SELECT current_setting('server_version_num');").trim();
  result.engineVerification = engineContract({
    pgConfigVersion,
    initdbVersion: command(initdb, ['--version']).trim(),
    pgCtlVersion: command(pgCtl, ['--version']).trim(),
    psqlVersion: command(psql, ['--version']).trim(),
    serverVersionNum: result.serverVersionNum,
  });
  expect(result.engineVerification.postStartupPassed, result.engineVerification.code);
  result.engine = 'postgresql-17';
  runPsql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');

  const newTable = 'review_preimage_terminal';
  const preimage = migration(
    'preimage_terminal',
    `BEGIN;\nCREATE TABLE public.${newTable}(id integer);\nCOMMIT;\n`,
    {
      query: `SELECT json_build_object('absent',to_regclass('public.${newTable}') IS NULL)::text;`,
      expected: { absent: true },
    },
    {
      query: `SELECT json_build_object('ready',(SELECT count(*) FROM public.${newTable})=0)::text;`,
      expected: { ready: true },
    },
  );
  const applied = apply(preimage);
  expect(applied.ready === true, 'PREIMAGE_APPLY_FAILED');
  result.cases.push({ name: 'terminal_query_not_run_on_preimage', status: 'passed' });

  const existingTable = 'review_existing_terminal';
  runPsql(`CREATE TABLE public.${existingTable}(id integer);`);
  const existing = migration(
    'existing_terminal',
    'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    {
      query: 'SELECT json_build_object(\'old_rows\',count(*))::text FROM public.review_missing_preimage;',
      expected: { old_rows: 0 },
    },
    {
      query: `SELECT json_build_object('ready',to_regclass('public.${existingTable}') IS NOT NULL)::text;`,
      expected: { ready: true },
    },
  );
  const existingPlan = migrationEnvelope(Buffer.from(existing.source), existing.record, existing.vector());
  runPsql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(existingPlan.version)},${quote(existingPlan.name)},ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(existingPlan.originalVector))}::jsonb)));`);
  const existingReconciliation = JSON.parse(runPsql(reconciliationSql(existingPlan, existing.record), { singleTransaction: true }).trim());
  let existingCode = null;
  let existingFirstCode = null;
  let existingFirstFixedSqlCode = null;
  try {
    apply(existing, (_url, query, singleTransaction) => {
      try { return runPsql(query, { singleTransaction }); }
      catch (error) {
        existingFirstCode ??= error.code ?? error.message;
        existingFirstFixedSqlCode ??= error.fixedSqlCode ?? null;
        throw error;
      }
    });
  } catch (error) { existingCode = error.code ?? error.message; }
  result.existingStateDiagnostic = {
    code: existingCode,
    firstCode: existingFirstCode,
    firstFixedSqlCode: existingFirstFixedSqlCode,
    reconciliation: existingReconciliation,
  };
  expect(existingCode === 'MIGRATION_ALREADY_APPLIED', 'EXISTING_STATE_BRANCH_FAILED');
  result.cases.push({ name: 'prior_query_not_run_on_existing_ledger', status: 'passed', code: existingCode });

  const missingTerminal = migration(
    'missing_terminal',
    'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    {
      query: "SELECT json_build_object('absent',true)::text;",
      expected: { absent: true },
    },
    {
      query: "SELECT json_build_object('ready',count(*)=0)::text FROM public.review_missing_terminal;",
      expected: { ready: true },
    },
  );
  const missingPlan = migrationEnvelope(Buffer.from(missingTerminal.source), missingTerminal.record, missingTerminal.vector());
  const preimageReconciliation = JSON.parse(runPsql(reconciliationSql(missingPlan, missingTerminal.record), { singleTransaction: true }).trim());
  expect(preimageReconciliation.ledger_exists === false
    && preimageReconciliation.prior.absent === true
    && preimageReconciliation.terminal === null, 'PREIMAGE_RECONCILIATION_BRANCH_FAILED');
  result.cases.push({ name: 'reconciliation_skips_missing_terminal_table', status: 'passed' });

  runPsql("CREATE ROLE review_limited LOGIN; GRANT USAGE,CREATE ON SCHEMA public TO review_limited; GRANT USAGE ON SCHEMA supabase_migrations TO review_limited; GRANT SELECT,INSERT ON supabase_migrations.schema_migrations TO review_limited;");
  const limitedTable = 'review_limited_table';
  const limited = migration(
    'limited_privilege',
    `BEGIN;\nCREATE TABLE public.${limitedTable}(id integer);\nCOMMIT;\n`,
    {
      query: `SELECT json_build_object('absent',to_regclass('public.${limitedTable}') IS NULL)::text;`,
      expected: { absent: true },
    },
    {
      query: `SELECT json_build_object('ready',to_regclass('public.${limitedTable}') IS NOT NULL)::text;`,
      expected: { ready: true },
    },
  );
  let limitedCode = null;
  try {
    apply(limited, (_url, query, singleTransaction) => runPsql(query, { role: 'review_limited', singleTransaction }));
  } catch (error) { limitedCode = error.code ?? error.message; }
  const limitedState = JSON.parse(runPsql(`SELECT json_build_object('table',to_regclass('public.${limitedTable}') IS NOT NULL,'ledger',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(limited.version)}))::text;`).trim());
  expect(limitedCode === 'MIGRATION_LEDGER_UNAVAILABLE' && limitedState.table === false && limitedState.ledger === false, 'LIMITED_PRIVILEGE_GUARD_FAILED');
  result.cases.push({ name: 'select_insert_cannot_reach_exclusive_lock', status: 'passed', code: limitedCode });

  const ackTable = 'review_ambiguous_ack';
  const ack = migration(
    'ambiguous_ack',
    `BEGIN;\nCREATE TABLE public.${ackTable}(id integer);\nCOMMIT;\n`,
    {
      query: `SELECT json_build_object('absent',to_regclass('public.${ackTable}') IS NULL)::text;`,
      expected: { absent: true },
    },
    {
      query: `SELECT json_build_object('ready',to_regclass('public.${ackTable}') IS NOT NULL)::text;`,
      expected: { ready: true },
    },
  );
  let ackCalls = 0;
  let ackCode = null;
  let replayedWrite = false;
  try {
    apply(ack, (_url, query, singleTransaction) => {
      ackCalls += 1;
      if (ackCalls > 1 && query.includes('INSERT INTO supabase_migrations.schema_migrations')) replayedWrite = true;
      const output = runPsql(query, { singleTransaction });
      if (ackCalls === 1) {
        const error = new Error('MIGRATION_PSQL_EXECUTION_FAILED');
        error.code = error.message;
        throw error;
      }
      return output;
    });
  } catch (error) { ackCode = error.code ?? error.message; }
  const ackState = JSON.parse(runPsql(`SELECT json_build_object('table',to_regclass('public.${ackTable}') IS NOT NULL,'ledger',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(ack.version)}))::text;`).trim());
  expect(ackCalls === 2 && ackCode === 'MIGRATION_OUTCOME_UNCONFIRMED' && replayedWrite === false && ackState.table === true && ackState.ledger === true, 'AMBIGUOUS_ACK_FAILED');
  result.cases.push({ name: 'ambiguous_ack_no_resend_fail_closed', status: 'passed', calls: ackCalls, code: ackCode });

  const stdoutTable = 'review_exit0_stdout';
  const stdoutFixture = migration(
    'exit0_stdout',
    `BEGIN;\nCREATE TABLE public.${stdoutTable}(id integer);\nCOMMIT;\n`,
    {
      query: `SELECT json_build_object('absent',to_regclass('public.${stdoutTable}') IS NULL)::text;`,
      expected: { absent: true },
    },
    {
      query: `SELECT json_build_object('ready',to_regclass('public.${stdoutTable}') IS NOT NULL)::text;`,
      expected: { ready: true },
    },
  );
  let stdoutCalls = 0;
  const stdoutValue = apply(stdoutFixture, (_url, query, singleTransaction) => {
    stdoutCalls += 1;
    const output = runPsql(query, { singleTransaction });
    return stdoutCalls === 1 ? '' : output;
  });
  expect(stdoutCalls === 2 && stdoutValue.ready === true, 'EXIT0_RECONCILIATION_FAILED');
  result.cases.push({ name: 'exit0_invalid_stdout_reconciles', status: 'passed', calls: stdoutCalls });

  result.status = 'passed';
} catch (error) {
  result.failure = { code: error.code ?? error.message };
} finally {
  if (!serverStarted) result.cleanup.stopped = true;
  else try {
    command(pgCtl, ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop']);
    result.cleanup.stopped = true;
  } catch { result.cleanup.stopped = false; }
  rmSync(temporaryRoot, { recursive: true, force: true });
  result.cleanup.removed = true;
}

console.log(JSON.stringify(result));
if (result.status !== 'passed' || !result.cleanup.stopped || !result.cleanup.removed) process.exitCode = 1;
