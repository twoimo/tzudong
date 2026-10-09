import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readOriginalStatementVector } from '../scripts/apply-supabase-migration.mjs';
import {
  bundleReconciliationOutcome,
  bundleReconciliationSql,
  compileMigrationBundle,
  executeMigrationBundle,
  migrationBundleSuffixRoot,
} from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const PREFIX_ROOT = 'a'.repeat(64);
const ACTUAL_MIGRATIONS = [
  ['admin_record_guarded_actions', 'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql', 'b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95'],
  ['admin_evaluation_raw_warning_groups', 'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql', '66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a'],
  ['admin_evaluation_raw_warning_invoker_contract', 'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql', 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020'],
  ['restaurant_review_manual_preview_eligibility', 'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql', '8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3'],
] as const;

// Compilation-only: runtime ledger-root behavior is proved separately by the
// owned PG17 test, whose query derives the prefix and exact four target rows.
function compilationOnlyReadStateQuery(priorCount: number, prefixRoot: string, suffixRoot: string) {
  const versions = ACTUAL_MIGRATIONS.map(([, path]) => path.match(/(\d{14})_/)?.[1]);
  const values = versions.map(version => `('${version}')`).join(',');
  return `SELECT json_build_object('bundle', json_build_object('ledgerCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),'priorCount',${priorCount},'prefixRoot','${prefixRoot}','targetCount',(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version IN (VALUES ${values})),'suffixRoot',CASE WHEN (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (VALUES ${values}))=4 THEN '${suffixRoot}' ELSE NULL END))::text AS state`;
}

function actualFixture(priorCount = 7) {
  const materials = ACTUAL_MIGRATIONS.map(([, path, expectedSha]) => {
    const bytes = readFileSync(new URL(`../../../${path}`, import.meta.url));
    expect(sha256(bytes)).toBe(expectedSha);
    const provisional = { path, sha256: expectedSha };
    return { path, bytes, originalVector: readOriginalStatementVector(provisional, bytes) };
  });
  const migrations = ACTUAL_MIGRATIONS.map(([id, path, sourceSha], index) => ({
    id,
    path,
    sha256: sourceSha,
    statementVectorSha256: sha256(JSON.stringify(materials[index].originalVector)),
    expectedPriorState: index === 0 ? undefined : {
      query: `SELECT '{"stage":${index}}'::text AS state`,
      expected: { stage: index },
    },
    terminalReadback: {
      query: `SELECT '{"stage":${index + 1}}'::text AS state`,
      expected: { stage: index + 1 },
    },
  }));
  const suffixRoot = migrationBundleSuffixRoot(migrations);
  const query = compilationOnlyReadStateQuery(priorCount, PREFIX_ROOT, suffixRoot);
  const priorReadback = {
    query,
    expected: {
      bundle: {
        ledgerCount: priorCount,
        prefixRoot: PREFIX_ROOT,
        priorCount,
        suffixRoot: null,
        targetCount: 0,
      },
    },
  };
  const finalReadback = {
    query,
    expected: {
      bundle: {
        ledgerCount: priorCount + 4,
        prefixRoot: PREFIX_ROOT,
        priorCount,
        suffixRoot,
        targetCount: 4,
      },
    },
  };
  migrations[0].expectedPriorState = priorReadback;
  return {
    bundle: {
      schemaVersion: 1,
      id: 'admin_four_migration_successor',
      priorCount,
      prefixRoot: PREFIX_ROOT,
      suffixRoot,
      migrations,
      priorReadback,
      finalReadback,
    },
    materials,
  };
}

test('actual four source files compile in exact identity/hash/vector order with one output SELECT', () => {
  const fixture = actualFixture(13);
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  const spans = statementSpans(compiled.sql);
  expect(compiled.transactionMode).toBe('single-outer-transaction');
  expect(compiled.priorCount).toBe(13);
  expect(compiled.plans.map(plan => plan.version)).toEqual([
    '20261004190259',
    '20261004192657',
    '20261004194715',
    '20261009022915',
  ]);
  expect(spans.filter(span => /^SELECT\b/i.test(span.token))).toHaveLength(1);
  expect(spans.at(-1)?.token).toStartWith('SELECT json_build_object');
  expect(spans.some(span => /^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(span.token))).toBe(false);
  expect(compiled.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(4);
  const finalGuard = compiled.sql.lastIndexOf('MIGRATION_TERMINAL_READBACK_FAILED');
  const finalLedgerInsert = compiled.sql.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations');
  const finalOutput = compiled.sql.lastIndexOf('SELECT json_build_object');
  expect(finalGuard).toBeGreaterThan(finalLedgerInsert);
  expect(finalGuard).toBeLessThan(finalOutput);
});

test('order, source identity, source hash, vector and suffix drift reject before an executor exists', () => {
  const make = () => actualFixture();
  {
    const fixture = make();
    [fixture.bundle.migrations[0], fixture.bundle.migrations[1]] = [fixture.bundle.migrations[1], fixture.bundle.migrations[0]];
    [fixture.materials[0], fixture.materials[1]] = [fixture.materials[1], fixture.materials[0]];
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('ORDER_OR_IDENTITY_INVALID');
  }
  {
    const fixture = make();
    fixture.bundle.migrations[0].path = fixture.bundle.migrations[0].path.replace('20261004190259', '20261004190258');
    fixture.bundle.suffixRoot = migrationBundleSuffixRoot(fixture.bundle.migrations);
    fixture.bundle.finalReadback.expected.bundle.suffixRoot = fixture.bundle.suffixRoot;
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('MIGRATION_BUNDLE_MATERIAL_INVALID');
  }
  {
    const fixture = make();
    fixture.materials[0].bytes = Buffer.concat([fixture.materials[0].bytes, Buffer.from(' ')]);
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('MIGRATION_FILE_DIGEST_MISMATCH');
  }
  {
    const fixture = make();
    fixture.materials[0].originalVector = [...fixture.materials[0].originalVector, 'SELECT 1'];
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('MIGRATION_VECTOR_MISMATCH');
  }
  {
    const fixture = make();
    fixture.bundle.migrations[0].statementVectorSha256 = 'c'.repeat(64);
    fixture.bundle.suffixRoot = migrationBundleSuffixRoot(fixture.bundle.migrations);
    fixture.bundle.finalReadback.expected.bundle.suffixRoot = fixture.bundle.suffixRoot;
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('MIGRATION_BUNDLE_VECTOR_DIGEST_MISMATCH');
  }
  {
    const fixture = make();
    fixture.bundle.suffixRoot = 'b'.repeat(64);
    fixture.bundle.finalReadback.expected.bundle.suffixRoot = fixture.bundle.suffixRoot;
    expect(() => compileMigrationBundle(fixture.bundle, fixture.materials)).toThrow('MIGRATION_BUNDLE_SUFFIX_ROOT_MISMATCH');
  }
});

test('fresh prior N and prefix/suffix roots are mandatory and partial target ledger is rejected by the first transaction guard', () => {
  const fixture = actualFixture(23);
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  expect(compiled.sql).toContain('"ledgerCount":23');
  expect(compiled.sql).toContain('"targetCount":0');
  expect(compiled.sql).toContain(PREFIX_ROOT);
  expect(compiled.sql).toContain(fixture.bundle.suffixRoot);
  expect(compiled.sql).toContain('MIGRATION_PRIOR_STATE_MISMATCH');

  const broken = actualFixture(23);
  broken.bundle.priorReadback.expected.bundle.targetCount = 1;
  broken.bundle.migrations[0].expectedPriorState = broken.bundle.priorReadback;
  expect(() => compileMigrationBundle(broken.bundle, broken.materials)).toThrow('READBACK_BINDING_MISMATCH');
});

test('reconciliation classifies only exact prior/final objects; all intermediate stages conflict', () => {
  const fixture = actualFixture();
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  expect(bundleReconciliationOutcome(compiled.priorReadback.expected, compiled)).toBe('not_applied');
  expect(bundleReconciliationOutcome(compiled.finalReadback.expected, compiled)).toBe('committed');
  for (const targetCount of [1, 2, 3]) {
    const intermediate = structuredClone(compiled.priorReadback.expected);
    intermediate.bundle.ledgerCount += targetCount;
    intermediate.bundle.targetCount = targetCount;
    expect(bundleReconciliationOutcome(intermediate, compiled)).toBe('partial_conflict');
  }
  expect(bundleReconciliationOutcome('not-json', compiled)).toBe('partial_conflict');
  const sql = bundleReconciliationSql(compiled);
  expect(sql).toContain('SET TRANSACTION READ ONLY');
  expect(statementSpans(sql).filter(span => /^SELECT\b/i.test(span.token))).toHaveLength(1);
  expect(sql).not.toContain('INSERT INTO');
});

test('ambiguous transport performs one read-only reconciliation without claiming or resending a commit', () => {
  const fixture = actualFixture();
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  const calls: Array<{databaseUrl: string, sql: string, singleTransaction: boolean}> = [];
  const result = () => executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: (databaseUrl, sql, singleTransaction) => {
    calls.push({ databaseUrl, sql, singleTransaction });
    if (calls.length === 1) throw new Error('lost acknowledgement');
    return JSON.stringify(compiled.finalReadback.expected);
  } });
  expect(result).toThrow('MIGRATION_BUNDLE_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ databaseUrl: 'fixture-db', singleTransaction: true });
  expect(calls[1]).toMatchObject({ databaseUrl: 'fixture-db', singleTransaction: true });
  expect(calls[1].sql).not.toContain('INSERT INTO');
});

test('exit-zero malformed or mismatched readback is confirmed once by exact final state', () => {
  const { bundle, materials } = actualFixture();
  const compiled = compileMigrationBundle(bundle, materials);
  for (const output of ['', '{}', `${JSON.stringify(compiled.finalReadback.expected)}\nnoise`]) {
    let calls = 0;
    const result = executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: () => {
      calls += 1;
      return calls === 1 ? output : JSON.stringify(compiled.finalReadback.expected);
    } });
    expect(calls).toBe(2);
    expect(result).toEqual(compiled.finalReadback.expected);
  }
});

test('not-applied preserves failure while partial and unknown are fixed fail-closed outcomes', () => {
  const fixture = actualFixture();
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  const run = (reconcileOutput: string | Error) => {
    let calls = 0;
    return () => executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: () => {
      calls += 1;
      if (calls === 1) throw new Error('apply failed');
      if (reconcileOutput instanceof Error) throw reconcileOutput;
      return reconcileOutput;
    } });
  };
  expect(run(JSON.stringify(compiled.priorReadback.expected))).toThrow('MIGRATION_PSQL_FAILED');
  const partial = structuredClone(compiled.priorReadback.expected);
  partial.bundle.targetCount = 2;
  expect(run(JSON.stringify(partial))).toThrow('MIGRATION_BUNDLE_RECONCILIATION_CONFLICT');
  expect(run(new Error('readback lost'))).toThrow('MIGRATION_BUNDLE_RECONCILIATION_UNKNOWN');
});

test('transport and malformed-output diagnostics never escape through errors or causes', () => {
  const { bundle, materials } = actualFixture();
  const compiled = compileMigrationBundle(bundle, materials);
  const marker = 'private-diagnostic-marker';
  const failures: Array<unknown> = [
    new Error(marker, { cause: new Error(marker) }),
    Object.assign(new Error(marker), { code: 'MIGRATION_PSQL_FAILED_P0001_PRIVATE_DIAGNOSTIC_MARKER' }),
    Object.assign(new Error(marker), { code: marker }),
    { get code() { throw new Error(marker); } },
  ];
  for (const failure of failures) {
    let calls = 0;
    try {
      executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: () => {
        calls += 1;
        if (calls === 1) throw failure;
        return JSON.stringify(compiled.priorReadback.expected);
      } });
      throw new Error('expected failure');
    } catch (error) {
      expect(calls).toBe(2);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(marker);
      expect((error as Error).stack).not.toContain(marker);
      expect((error as Error).cause).toBeUndefined();
      expect(['MIGRATION_PSQL_FAILED', 'MIGRATION_PSQL_FAILED_P0001']).toContain((error as Error).message);
    }
  }
  let calls = 0;
  try {
    executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: () => {
      calls += 1;
      return calls === 1 ? marker : JSON.stringify(compiled.priorReadback.expected);
    } });
    throw new Error('expected failure');
  } catch (error) {
    expect(calls).toBe(2);
    expect((error as Error).message).toBe('MIGRATION_BUNDLE_READBACK_INVALID');
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).stack).not.toContain(marker);
  }
});

test('successful output must be exactly one JSON object matching the final bundle readback', () => {
  const fixture = actualFixture();
  const compiled = compileMigrationBundle(fixture.bundle, fixture.materials);
  for (const bad of ['', '{}', `${JSON.stringify(compiled.finalReadback.expected)}\nnoise`]) {
    let calls = 0;
    const result = () => executeMigrationBundle('fixture-db', compiled, { runPsqlImpl: () => {
      calls += 1;
      return calls === 1 ? bad : JSON.stringify(compiled.priorReadback.expected);
    } });
    expect(result).toThrow();
    expect(calls).toBe(2);
  }
});
