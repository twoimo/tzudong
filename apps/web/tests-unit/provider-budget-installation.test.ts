import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import {
  readOriginalStatementVector, resolveReviewedMigration, validateReleaseMigrationManifest,
} from '../scripts/apply-supabase-migration.mjs';
import {
  atomicMigrationSql, migrationEnvelope, reconciliationOutcome, reconciliationSql,
} from '../scripts/supabase-migration-transaction.mjs';

// No DB/provider transport or production admission is substituted here. These
// tests use the real frozen parser/compiler; actual PG17.6 evidence is separate.
const root = resolve(import.meta.dir, '../../..');
const read = (path: string) => readFileSync(join(root, path));
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const rawManifest = read('.github/provider-budget-installation.draft.v1.json');
const manifest = JSON.parse(rawManifest.toString());
const migration = manifest.migration;
const bytes = read(migration.candidatePath);
const source = bytes.toString();
const temporary = mkdtempSync(join(tmpdir(), 'provider-budget-vector-'));
const parserPath = join(temporary, '20261024130000_provider_budget_install.sql');
writeFileSync(parserPath, bytes, { flag: 'wx', mode: 0o600 });
const vector = readOriginalStatementVector({ path: parserPath, sha256: migration.sha256 }, bytes);
const plan = migrationEnvelope(bytes, migration, vector);
const compiled = manifest.executionContract.serializerSql + atomicMigrationSql(plan, migration);
const prior = migration.expectedPriorState.expected;
const terminal = migration.terminalReadback.expected;
afterAll(() => rmSync(temporary, { recursive: true }));

test('fixed draft and every component retain exact canonical bytes without authorizing the old caller', () => {
  expect(rawManifest.toString()).toBe(JSON.stringify(manifest, null, 2) + '\n');
  expect(sha(rawManifest)).toBe('7fa566baf28aeefb6368eafedfd8dc5a6ca65fe42d842a30bf39d50fdcff90d6');
  expect(manifest.executionEnabled).toBe(false);
  expect(manifest.status).toBe('DRAFT_UNAPPLIED');
  for (const component of manifest.components) {
    const observed = read(component.path);
    expect(sha(observed)).toBe(component.sha256);
    expect(observed.length).toBe(component.bytes);
  }
  expect(() => validateReleaseMigrationManifest(manifest)).toThrow('MIGRATION_MANIFEST_INVALID');
  const admitted = validateReleaseMigrationManifest(JSON.parse(read('.github/supabase-migration-release-manifest.v1.json').toString()));
  expect(() => resolveReviewedMigration('provider_budget_install', admitted)).toThrow('MIGRATION_ID_NOT_ALLOWLISTED');
});

test('official vector binds exact copied bytes to the new ledger identity; the 8-digit candidate is not a parser alias', () => {
  expect(bytes.length).toBe(26003);
  expect(sha(bytes)).toBe('3503957bb65c602d559b789e59cfda343cfdcd0b75ccfe94a3b1fae678492092');
  expect(vector).toHaveLength(24);
  expect(sha(JSON.stringify(vector))).toBe('7b9501d8d9ef4e5c45fedf75fb0d7bad91e4c9382648672ac4827edec5819031');
  expect(plan.version).toBe('20261024130000');
  expect(plan.name).toBe('provider_budget_install');
  expect(plan.execution).toBe(source);
  expect(() => readOriginalStatementVector({ path: migration.candidatePath, sha256: migration.sha256 }, bytes))
    .toThrow('MIGRATION_VECTOR_INVALID');
  expect(() => migrationEnvelope(Buffer.concat([bytes, Buffer.from('\n')]), migration, vector))
    .toThrow('MIGRATION_FILE_DIGEST_MISMATCH');
  expect(() => migrationEnvelope(bytes, migration, [...vector, 'SELECT 1']))
    .toThrow('MIGRATION_VECTOR_MISMATCH');
});

test('the original budget component is byte exact, and G014 runs before and after lease-free metadata checks', () => {
  const component = read('backend/supabase/candidates/20261024_provider_budget_private_bridge.sql');
  const start = source.indexOf('-- BEGIN PINNED BUDGET COMPONENT');
  const bodyStart = source.indexOf('\n', start) + 1;
  const end = source.indexOf('-- END PINNED BUDGET COMPONENT');
  expect(Buffer.from(source.slice(bodyStart, end)).equals(component)).toBe(true);
  expect(source.indexOf("PERFORM pg_temp.provider_budget_install_g014_check('pre')")).toBeLessThan(start);
  const revoke = 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;';
  expect(source.indexOf(revoke)).toBeLessThan(source.indexOf("PERFORM pg_temp.provider_budget_install_g014_check('pre')"));
  expect(source.indexOf(revoke, end)).toBeLessThan(source.indexOf("PERFORM pg_temp.provider_budget_install_g014_check('post')"));
  expect(source.indexOf('provider_budget_install_metadata_drift', end)).toBeLessThan(source.indexOf("PERFORM pg_temp.provider_budget_install_g014_check('post')"));
  expect(vector[0]).toContain("'server_version_num')::integer<>170006");
  expect(vector[0]).not.toContain('GRANT ');
  expect(vector[1].indexOf('provider_budget_install_outer_transaction_required')).toBeLessThan(vector[1].indexOf('GRANT '));
  for (const [name, hash] of prior.thumbnail.assertions) {
    expect(source).toContain(`'privacy_retention.${name}()','${hash}'`);
  }
});

test('same-transaction serializer precedes compiler ledger lock, source and original vector insertion', () => {
  const contract = manifest.executionContract;
  expect(contract.serializerKey).toBe('tzudong:review-media-sql-successor:workflow:v1');
  expect(sha(contract.serializerSql)).toBe(contract.serializerSqlSha256);
  const serializer = compiled.indexOf('pg_try_advisory_xact_lock');
  const ledgerLock = compiled.indexOf('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE');
  const priorGuard = compiled.indexOf("RAISE EXCEPTION 'MIGRATION_PRIOR_STATE_MISMATCH'");
  const body = compiled.indexOf(source);
  const ledgerInsert = compiled.indexOf('INSERT INTO supabase_migrations.schema_migrations');
  const terminalGuard = compiled.indexOf("RAISE EXCEPTION 'MIGRATION_TERMINAL_READBACK_FAILED'");
  expect(serializer).toBeGreaterThan(-1);
  expect(serializer).toBeLessThan(ledgerLock);
  expect(ledgerLock).toBeLessThan(priorGuard);
  expect(priorGuard).toBeLessThan(body);
  expect(body).toBeLessThan(ledgerInsert);
  expect(ledgerInsert).toBeLessThan(terminalGuard);
  expect(compiled).toContain("VALUES('20261024130000','provider_budget_install',ARRAY(SELECT jsonb_array_elements_text(");
});

test('compiler rejects transaction escape and mutating or multi-statement readbacks', () => {
  const escape = Buffer.from(source + '\nCOMMIT;\n');
  expect(() => migrationEnvelope(escape, { ...migration, sha256: sha(escape) }, [...vector, 'COMMIT']))
    .toThrow('MIGRATION_TRANSACTION_CONTROL_DENIED');
  for (const query of [
    'DELETE FROM supabase_migrations.schema_migrations RETURNING version;',
    'SELECT 1; SELECT 2;',
    "SELECT (WITH changed AS (DELETE FROM provider_budget_private.admin_provider_budget_policies RETURNING provider) SELECT count(*) FROM changed);",
  ]) {
    expect(() => atomicMigrationSql(plan, { ...migration, terminalReadback: { query, expected: terminal } }))
      .toThrow('MIGRATION_READBACK_CONTRACT_INSUFFICIENT');
  }
});

test('readback keeps exact 90-row prefix and frozen thumbnail terminal across the new single-row append', () => {
  const thumbnail = JSON.parse(read('.github/thumbnail-production-installation.draft.v1.json').toString()).migration;
  expect(prior.ledgerCount).toBe(90);
  expect(terminal.ledgerCount).toBe(91);
  expect(prior.ledgerTargetPresent).toBe(false);
  expect(terminal.ledgerTargetPresent).toBe(true);
  for (const state of [prior, terminal]) {
    expect(state.serverVersionNum).toBe(170006);
    expect(state.ledgerPrefixCount).toBe(90);
    expect(state.ledgerPrefixLatest).toBe('20261024071000');
    expect(state.ledgerPrefixDigest).toBe('b466a2ac7ade777f3948c9716a3c04cc4c1197b523d0de18f21c437b1fe0e45e');
    expect(state.thumbnail).toEqual(thumbnail.terminalReadback.expected);
  }
  const projected = thumbnail.terminalReadback.query.trim().replace(/;$/, '')
    .replaceAll('supabase_migrations.schema_migrations', 'budget_install_thumbnail_ledger');
  expect(migration.expectedPriorState.query).toContain(projected);
  expect(migration.terminalReadback.query).toBe(migration.expectedPriorState.query);
  expect(migration.terminalReadback.query).toContain("WHERE version<>'20261024130000'");
  expect(terminal.tables).toEqual(prior.tables);
  expect(terminal.rlsPolicies).toEqual(prior.rlsPolicies);
  expect(terminal.policies.filter((p: { provider: string }) => p.provider !== 'naver_directions')).toEqual(prior.policies);
  expect(terminal.policies[0]).toEqual({ provider: 'naver_directions', actor_per_minute: 20, global_per_minute: 200, global_per_day: 10000 });
});

test('fresh reconciliation requires target vector AND full terminal; prefix drift, extra rows and ACL/limit drift conflict', () => {
  const committed = { ledger_exists: true, ledger_equal: true, prior: null, terminal };
  expect(reconciliationOutcome(committed, migration)).toBe('committed');
  expect(reconciliationOutcome({ ...committed, ledger_equal: false }, migration)).toBe('partial_conflict');
  const variants = [
    { ...terminal, ledgerCount: 92 },
    { ...terminal, ledgerPrefixDigest: '0'.repeat(64) },
    { ...terminal, schema: ['postgres', '{postgres=UC/postgres,service_role=U/postgres}'] },
    { ...terminal, policies: terminal.policies.map((p: object) => ({ ...p, global_per_day: 99999 })) },
    { ...terminal, thumbnail: { ...terminal.thumbnail, registryCount: 141 } },
    { ...terminal, temporaryObjectsAbsent: false },
  ];
  for (const changed of variants) {
    expect(reconciliationOutcome({ ...committed, terminal: changed }, migration)).toBe('partial_conflict');
  }
  expect(reconciliationOutcome({ ledger_exists: false, ledger_equal: false, prior, terminal: null }, migration)).toBe('not_applied');
  expect(reconciliationOutcome({ ledger_exists: false, ledger_equal: false, prior: { ...prior, ledgerCount: 91 }, terminal: null }, migration))
    .toBe('partial_conflict');
  // 'not_applied' is the frozen compiler's snapshot label, not backend finality
  // or resend permission. No new operating caller or retry path is added here.
  const sql = reconciliationSql(plan, migration);
  expect(sql.startsWith('SET TRANSACTION READ ONLY;')).toBe(true);
  expect(sql).toContain('\\if :ledger_exists');
  expect(sql).not.toContain('INSERT INTO supabase_migrations.schema_migrations');
});
