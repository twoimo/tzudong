import { expect, test } from 'bun:test';

import { createSuccessorPsqlRunner } from '../scripts/admin-record-sql-successor.mjs';
import { runPsql } from '../scripts/apply-supabase-migration.mjs';

const databaseUrl = process.env.TZUDONG_SUCCESSOR_RUNNER_PG17_URL || '';
const psql = process.env.TZUDONG_SUCCESSOR_RUNNER_PSQL || '';
const integrationTest = databaseUrl && psql ? test : test.skip;

type Runner = (databaseUrl: string, sql: string, singleTransaction: boolean) => string;

function readState(run: Runner, schema: string, payloadTable: string, ledgerKey: string) {
  const output = run(databaseUrl, `
SELECT json_build_object(
  'payloadExists', to_regclass('${schema}.${payloadTable}') IS NOT NULL,
  'ledgerCount', (SELECT count(*)::int FROM ${schema}.ledger WHERE key='${ledgerKey}')
)::text;
`, false);
  return JSON.parse(output.trim());
}

function proveTransactionBoundary(run: Runner, schema: string) {
  run(databaseUrl, `
DROP SCHEMA IF EXISTS ${schema} CASCADE;
CREATE SCHEMA ${schema};
CREATE TABLE ${schema}.ledger(key text PRIMARY KEY);
CREATE TABLE ${schema}.lock_anchor(id integer PRIMARY KEY);
INSERT INTO ${schema}.lock_anchor(id) VALUES (1);
`, true);

  try {
    expect(() => run(databaseUrl, `
SET LOCAL application_name='tzudong-runner-failure';
DO $verify_local$ BEGIN
  IF current_setting('application_name') <> 'tzudong-runner-failure' THEN
    RAISE EXCEPTION 'RUNNER_SET_LOCAL_MISSING' USING ERRCODE='P0001';
  END IF;
END $verify_local$;
LOCK TABLE ${schema}.lock_anchor IN ACCESS EXCLUSIVE MODE;
CREATE TABLE ${schema}.failed_payload(id integer PRIMARY KEY);
INSERT INTO ${schema}.ledger(key) VALUES ('failed');
DO $terminal$ BEGIN
  RAISE EXCEPTION 'RUNNER_TERMINAL_FAILURE' USING ERRCODE='P0001';
END $terminal$;
`, true)).toThrow();
    expect(readState(run, schema, 'failed_payload', 'failed')).toEqual({
      payloadExists: false,
      ledgerCount: 0,
    });

    run(databaseUrl, `
SET LOCAL application_name='tzudong-runner-success';
DO $verify_local$ BEGIN
  IF current_setting('application_name') <> 'tzudong-runner-success' THEN
    RAISE EXCEPTION 'RUNNER_SET_LOCAL_MISSING' USING ERRCODE='P0001';
  END IF;
END $verify_local$;
LOCK TABLE ${schema}.lock_anchor IN ACCESS EXCLUSIVE MODE;
CREATE TABLE ${schema}.committed_payload(id integer PRIMARY KEY);
INSERT INTO ${schema}.ledger(key) VALUES ('committed');
`, true);
    expect(readState(run, schema, 'committed_payload', 'committed')).toEqual({
      payloadExists: true,
      ledgerCount: 1,
    });
  } finally {
    run(databaseUrl, `DROP SCHEMA IF EXISTS ${schema} CASCADE;`, true);
  }
}

integrationTest('actual legacy and successor runners commit and roll back as one PostgreSQL 17.6 transaction', () => {
  const environment = { ...process.env };
  const legacy: Runner = (url, sql, singleTransaction) => runPsql(url, sql, singleTransaction, {
    environment,
    psql,
  });
  const successor = createSuccessorPsqlRunner(databaseUrl, { environment, psql });

  const version = legacy(databaseUrl, `
SELECT current_setting('server_version_num');
SELECT current_setting('server_version');
`, false).trim().split(/\r?\n/);
  expect(version).toEqual(['170006', '17.6']);

  proveTransactionBoundary(legacy, 'tzudong_runner_legacy_0176');
  proveTransactionBoundary(successor, 'tzudong_runner_successor_0176');
});
