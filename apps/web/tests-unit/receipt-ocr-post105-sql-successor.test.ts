import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertPost105LaunchReady,
  buildPost105StateQuery,
  compilePost105OperatingPlan,
  compilePost105RehearsalPlan,
  expectedPost105StageStates,
  loadPost105SuccessorManifest,
  validatePost105StageStates,
} from '@/scripts/receipt-ocr-post105-sql-successor.mjs';
import { statementSpans } from '@/scripts/supabase-migration-transaction.mjs';

const repositoryRoot = join(import.meta.dir, '../../..');

describe('receipt OCR post-105 SQL successor', () => {
  test('binds the immutable terminal-105 identity to one exact held 105-to-106 migration', () => {
    const record = loadPost105SuccessorManifest();

    expect(record.manifest.operatingTransition).toEqual({ before: 105, after: 106 });
    expect(record.manifest.predecessor).toMatchObject({
      ledgerCount: 105,
      terminalIdentityRoot: '3ef9d904fd9545027d39041483e5375e6d9c861f5f1a64a61c23b94df1146e4c',
    });
    expect(record.priorRows).toHaveLength(105);
    expect(record.material.originalVector).toHaveLength(record.manifest.migration.statementCount);
    expect(record.manifest.launchPolicy.state).toBe('held');
    expect(() => assertPost105LaunchReady(record)).toThrow('RECEIPT_OCR_POST105_LAUNCH_HELD');

    for (const legacyManifest of [
      '.github/review-media-evidence-prefixed-predecessor-successor.v1.json',
      '.github/review-media-evidence-prefixed-feature-successor.v1.json',
      '.github/review-media-sql-successor.v1.json',
      '.github/review-media-feature-sql-successor.v1.json',
    ]) {
      expect(readFileSync(join(repositoryRoot, legacyManifest), 'utf8'))
        .not.toContain(record.manifest.migration.version);
    }
  });

  test('builds exact prior and terminal fixtures and rejects a reused 105 terminal receipt', () => {
    const record = loadPost105SuccessorManifest();
    const stages = expectedPost105StageStates(record);

    expect(stages[0]).toMatchObject({
      bundle: { ledgerCount: 105, priorCount: 105, targetCount: 0, suffixRoot: null },
      state: { predecessorReady: true, targetReady: false, targetStageIndex: 0, terminalReady: false },
    });
    expect(stages[1]).toMatchObject({
      bundle: { ledgerCount: 106, priorCount: 105, targetCount: 1 },
      state: {
        predecessorReady: true,
        runtimeObjectCount: 6,
        targetReady: true,
        targetStageIndex: 1,
        terminalReady: true,
      },
    });
    expect(validatePost105StageStates(stages, record)).toMatchObject({ priorCount: 105 });

    const reused105 = structuredClone(stages);
    reused105[1].bundle.ledgerCount = 105;
    reused105[1].state.ledgerIdentityRoot = record.manifest.predecessor.terminalIdentityRoot;
    expect(() => validatePost105StageStates(reused105, record))
      .toThrow('RECEIPT_OCR_POST105_STAGE_INVALID');
  });

  test('compiles the exact migration source into one outer transaction with terminal readback', () => {
    const record = loadPost105SuccessorManifest();
    const compiled = compilePost105RehearsalPlan(record);
    const topLevel = statementSpans(compiled.sql);

    expect(compiled.transactionMode).toBe('single-outer-transaction');
    expect(compiled.plan.originalVector).toEqual(record.material.originalVector);
    expect(compiled.plan.execution).toContain('release_receipt_ocr_definitive_credential_rejection');
    expect(compiled.plan.execution).toContain('receipt_credential_release_catalog_contract');
    expect(compiled.sql).toContain(record.manifest.migration.statementVectorSha256);
    expect(compiled.sql).toContain(record.manifest.rehearsalFixture.targetIdentityRoot);
    expect(compiled.priorReadback.query).not.toContain(
      'AND ocr_private.get_receipt_ocr_credential_release_capability()\n',
    );
    expect(compiled.finalReadback.query).toContain(
      'AND ocr_private.get_receipt_ocr_credential_release_capability()\n',
    );
    expect(compiled.sql).toContain(`VALUES('${record.manifest.migration.version}'`);
    const ledgerInsertIndex = compiled.sql.indexOf(
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${record.manifest.migration.version}'`,
    );
    const sealIndex = compiled.sql.indexOf(
      'UPDATE ocr_private.receipt_credential_release_catalog_contract',
      ledgerInsertIndex,
    );
    const ledgerReadbackIndex = compiled.sql.indexOf('MIGRATION_LEDGER_READBACK_FAILED');
    expect(ledgerInsertIndex).toBeGreaterThan(-1);
    expect(sealIndex).toBeGreaterThan(ledgerInsertIndex);
    expect(ledgerReadbackIndex).toBeGreaterThan(sealIndex);
    expect(compiled.sql).toContain('RECEIPT_OCR_CATALOG_SEAL_LEDGER_MISMATCH');
    expect(compiled.sql).toContain('RECEIPT_OCR_CATALOG_SEAL_READBACK_FAILED');
    expect(compiled.sql).toContain('MIGRATION_PRIOR_STATE_MISMATCH');
    expect(compiled.sql).toContain('MIGRATION_TERMINAL_READBACK_FAILED');
    expect(topLevel.filter(({ token }) => /^SELECT\b/i.test(token))).toHaveLength(1);
    expect(topLevel.at(-1)?.token).toMatch(/^SELECT\b/i);
    expect(topLevel.some(({ token }) => /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(token)))
      .toBe(false);
  });

  test('binds the operating compiler seal to the operating 106 identity without source self-reference', () => {
    const record = loadPost105SuccessorManifest();
    const compiled = compilePost105OperatingPlan(record);
    const migration = readFileSync(join(repositoryRoot, record.manifest.migration.path), 'utf8');

    expect(compiled.sql).toContain(record.manifest.operatingIdentity.targetIdentityRoot);
    expect(compiled.sql).not.toContain(record.manifest.rehearsalFixture.targetIdentityRoot);
    expect(compiled.sql).toContain(`statement_count=${record.manifest.migration.statementCount}`);
    expect(migration).not.toContain(record.manifest.migration.sha256);
    expect(migration).not.toContain(record.manifest.migration.statementVectorSha256);
    expect(migration).not.toContain(record.manifest.operatingIdentity.targetIdentityRoot);
  });

  test('keeps the synthetic rehearsal 105 identity separate from operating admission', () => {
    const record = loadPost105SuccessorManifest();
    const rehearsal = expectedPost105StageStates(record, { mode: 'rehearsal' });

    expect(record.manifest.rehearsalFixture.terminalIdentityRoot)
      .not.toBe(record.manifest.predecessor.terminalIdentityRoot);
    expect(() => validatePost105StageStates(rehearsal, record, { mode: 'operating' }))
      .toThrow('RECEIPT_OCR_POST105_STAGE_INVALID');
    expect(buildPost105StateQuery(record, { mode: 'rehearsal', phase: 'prior' }))
      .toContain(record.manifest.rehearsalFixture.terminalIdentityRoot);
    expect(buildPost105StateQuery(record, { mode: 'operating', phase: 'prior' }))
      .toContain(record.manifest.predecessor.terminalIdentityRoot);
  });

  test('state query requires exact count, root, migration vector, and stage', () => {
    const record = loadPost105SuccessorManifest();
    const query = buildPost105StateQuery(record);

    expect(query).toContain('predecessor_scope.row_count=105');
    expect(query).toContain(record.manifest.predecessor.terminalIdentityRoot);
    expect(query).toContain(record.manifest.operatingIdentity.migrationIdentityRoot);
    expect(query).toContain('ledger_scope.row_count=106');
    expect(query).toContain(record.manifest.operatingIdentity.targetIdentityRoot);
    expect(query).toContain(`version='${record.manifest.migration.version}'`);
    expect(query).toContain('receipt_credential_release_catalog_contract');
    expect(query).toContain('ocr_private.get_receipt_ocr_credential_release_capability()');
    expect(query).toContain('PRIMARY KEY (result_id, claim_token)');
    expect(query).toContain('PRIMARY KEY (capability_version)');
    expect(query).toContain('receipt_credential_rejection_releases_owner_only');
    expect(query).toContain('receipt_credential_release_catalog_contract_owner_only');
    expect(query).toContain("procedure.provolatile<>required.volatility");
    expect(query).toContain("procedure.proconfig IS DISTINCT FROM ARRAY['search_path=\"\"']::text[]");
  });

  test('fails closed on migration source identity or target-root drift', () => {
    const record = loadPost105SuccessorManifest();
    const manifestPath = join(repositoryRoot, '.github/receipt-ocr-post105-sql-successor.v1.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const directory = mkdtempSync(join(tmpdir(), 'tzudong-post105-successor-'));
    try {
      const sourceDrift = structuredClone(manifest);
      sourceDrift.migration.sha256 = '0'.repeat(64);
      const sourceDriftPath = join(directory, 'source-drift.json');
      writeFileSync(sourceDriftPath, `${JSON.stringify(sourceDrift)}\n`);
      expect(() => loadPost105SuccessorManifest({ manifestPath: sourceDriftPath }))
        .toThrow('RECEIPT_OCR_POST105_SOURCE_DRIFT');

      const targetDrift = structuredClone(manifest);
      targetDrift.operatingIdentity.targetIdentityRoot = record.manifest.predecessor.terminalIdentityRoot;
      const targetDriftPath = join(directory, 'target-drift.json');
      writeFileSync(targetDriftPath, `${JSON.stringify(targetDrift)}\n`);
      expect(() => loadPost105SuccessorManifest({ manifestPath: targetDriftPath }))
        .toThrow('RECEIPT_OCR_POST105_IDENTITY_BINDING_INVALID');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
