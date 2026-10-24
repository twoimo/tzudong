import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import {
  classifyRecovery108ChainReconciliation,
  compileRecovery108ChainPlan,
  loadRecovery108ChainSource,
  validateTransactionBody,
} from '../scripts/receipt-ocr-recovery108-chain-plan.mjs';
import { ledgerIdentityRoot } from '../scripts/review-media-evidence-prefixed-sql-successors.mjs';
import {
  elevenMigrationBundleSuffixRoot,
  fiveMigrationBundleSuffixRoot,
} from '../scripts/supabase-migration-bundle.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const emptyRoot = sha256('');

// Operating-shaped, source-bound synthetic states: useful for compiler checks only.
// They are not observed DB states or an admission receipt.
function syntheticLegacy(record: any) {
  const predecessor = record.manifest.phase === 'predecessor';
  const size = predecessor ? 11 : 5;
  const migrations = record.targetRecord.manifest.migrations;
  const prefixRoot = predecessor ? '1'.repeat(64) : '8'.repeat(64);
  const roleRoot = sha256('feature-role-root');
  return Array.from({ length: size + 1 }, (_, index) => ({
    bundle: {
      ledgerCount: (predecessor ? 89 : 100) + index,
      prefixRoot,
      priorCount: predecessor ? 89 : 100,
      suffixRoot: index === size ? (predecessor
        ? elevenMigrationBundleSuffixRoot(migrations) : fiveMigrationBundleSuffixRoot(migrations)) : null,
      targetCount: index,
    },
    state: predecessor ? {
      activeReviewItems: 0,
      currentUser: 'postgres', databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? record.targetRecord.manifest.terminalContract.finishPreimageSha256
        : index === 11 ? record.targetRecord.manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : sha256(`finish-${index}`),
      g014Root: index < 3 ? '2'.repeat(64) : '3'.repeat(64),
      ledgerRoot: index === 0 ? prefixRoot : sha256(`predecessor-ledger-${index}`),
      ownerAuthorityReady: true, reviewItems: 0, reviewPolicyEnabled: false, reviewRuns: 0,
      schemaRoot: sha256(`predecessor-schema-${index}`), serverMajor: 17,
      sessionUser: 'postgres', storageRoot: sha256(`predecessor-storage-${index}`),
      terminalContractReady: index === 11,
    } : {
      activeReviewItems: 0, baseReviewReady: true,
      catalogRoot: sha256(`feature-catalog-${index}`), currentUser: 'postgres',
      databaseName: 'postgres', featureRuntimeReady: index >= 5, g014Ready: index >= 3,
      g014Root: index < 3 ? sha256('feature-g014-before') : sha256('feature-g014-after'),
      immutableReady: index >= 4,
      ledgerRoot: index === 0 ? prefixRoot : sha256(`feature-ledger-${index}`),
      ocrReady: index >= 2, predecessorReady: true, reviewPolicyEnabled: false, reviewRuns: 0,
      roleRoot, runtimePredicateReady: index >= 5, serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: index < 4 ? sha256('feature-storage-before') : sha256('feature-storage-after'),
      storyboardReady: index >= 1,
      storyboardRoot: index === 0 ? sha256('feature-storyboard-before') : sha256('feature-storyboard-after'),
    },
  }));
}

function syntheticOperatingStages(record: any) {
  const predecessor = record.manifest.phase === 'predecessor';
  const legacy = syntheticLegacy(record);
  const targetRoots = record.manifest.operatingIdentity.targetStageRoots;
  const predecessorFullRoot = ledgerIdentityRoot(record.predecessorRows);
  return legacy.map((legacyStage: any, index: number) => ({
    bundle: {
      ledgerCount: record.manifest.operatingTransition.before + index,
      prefixRoot: record.manifest.operatingIdentity.prefixIdentityRoot,
      priorCount: record.manifest.operatingTransition.before,
      suffixRoot: legacyStage.bundle.suffixRoot,
      targetCount: index,
    },
    state: {
      baseIdentityRoot: record.manifest.baseMapping.baseIdentityRoot,
      baseRowCount: 86, evidenceCount: 3,
      evidenceIdentityRoot: record.manifest.operatingIdentity.evidenceIdentityRoot,
      evidenceReady: true, featureCount: predecessor ? 0 : index,
      featureIdentityRoot: predecessor ? emptyRoot : targetRoots[index],
      featureReady: !predecessor && index === 5,
      historicalAppliedVariantReady: true,
      ledgerIdentityRoot: record.manifest.operatingIdentity.ledgerStageRoots[index],
      legacyBundle: legacyStage.bundle, legacyState: legacyStage.state,
      operatingBaseReady: true,
      predecessorCount: predecessor ? index : 11,
      predecessorIdentityRoot: predecessor ? targetRoots[index] : predecessorFullRoot,
      predecessorReady: predecessor ? index === 11 : true,
      targetIdentityRoot: targetRoots[index], targetStageIndex: index,
    },
  }));
}

function syntheticInput() {
  const source = loadRecovery108ChainSource();
  const admission = (record: any) => ({
    kind: 'evidence-prefixed-successor-local-admission',
    phase: record.manifest.phase,
    baseMappingSha256: record.manifest.baseMapping.sha256,
    manifestSha256: record.manifestSha256,
    stageStates: syntheticOperatingStages(record),
  });
  return {
    predecessorAdmission: admission(source.predecessor),
    featureAdmission: admission(source.feature),
    now: '2026-10-20T00:00:00.000Z',
    expiresAt: '2026-10-20T00:10:00.000Z',
  };
}

const controls = (sql: string) => statementSpans(sql)
  .map(({ token }) => /^(?:BEGIN|COMMIT|ROLLBACK)\b/i.exec(token.trim())?.[0]?.toUpperCase())
  .filter(Boolean);

describe('held OCR full-chain source-only compiler', () => {
  test('binds the exact five source records and 19 unique ordered migrations', () => {
    const source = loadRecovery108ChainSource();
    expect(source.migrations).toHaveLength(19);
    expect(Object.keys(source.manifestSha256s)).toHaveLength(5);
    expect(source.sourceRoot).toMatch(/^[0-9a-f]{64}$/);
    const self = source.compilerSources.find((entry: { path: string }) =>
      entry.path === 'apps/web/scripts/receipt-ocr-recovery108-chain-plan.mjs');
    expect(self?.sha256).toBe(sha256(readFileSync(new URL('../scripts/receipt-ocr-recovery108-chain-plan.mjs', import.meta.url)).toString()));
    expect(source.compilerSources.map((entry: { path: string }) => entry.path))
      .toContain('apps/web/scripts/supabase-migration-transaction.mjs');
    expect(new Set(source.migrations.map((migration: any) => migration.path)).size).toBe(19);
    expect(source.predecessor.manifest.operatingTransition).toEqual({ before: 89, after: 100 });
    expect(source.feature.manifest.operatingTransition).toEqual({ before: 100, after: 105 });
    expect(source.recovery.manifest.operatingTransition).toEqual({ before: 107, after: 108 });
  }, 30000);

  test('uses the same source-bound body for one outer commit or full rollback', () => {
    const plan = compileRecovery108ChainPlan(syntheticInput());
    expect(plan.kind).toBe('receipt-ocr-89-to-108-source-only-chain-plan');
    expect(plan.migrationCount).toBe(19);
    expect(plan.sourceRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.applySql).toBe(`BEGIN;\n${plan.bodySql}COMMIT;\n`);
    expect(plan.rehearsalSql).toBe(`BEGIN;\n${plan.bodySql}ROLLBACK;\n`);
    expect(controls(plan.bodySql)).toEqual([]);
    expect(controls(plan.applySql)).toEqual(['BEGIN', 'COMMIT']);
    expect(controls(plan.rehearsalSql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(validateTransactionBody(plan.bodySql, 19).inserts).toHaveLength(19);
    expect(plan.bodySql.match(/SET LOCAL idle_in_transaction_session_timeout='30s'/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(plan.bodySql.match(/pg_advisory_xact_lock\(731175428226031[1248]::bigint\)/g)).toHaveLength(4);
    expect(plan.bodySql).toContain('pg_advisory_xact_lock(7311754282260313::bigint)');
    expect(plan.bodySql.match(/set_config\('transaction_timeout'/g)?.length).toBeGreaterThanOrEqual(25);
    expect(plan.bodySql).toMatch(/END;\s+\$ocr_chain_window_[0-9a-f]{18}\$;/);
    expect(plan.bodySql).toContain('RECEIPT_OCR_RECOVERY108_SEAL_FAILED');
    expect(plan.bodySql).toContain('RECEIPT_OCR_ACL_V2_SEAL_FAILED');
    const sealOffsets = [
      'RECEIPT_OCR_CATALOG_SEAL_LEDGER_MISMATCH',
      'RECEIPT_OCR_ACL_V2_SEAL_LEDGER_MISMATCH',
      'RECEIPT_OCR_RECOVERY108_SEAL_LEDGER_MISMATCH',
    ].map(marker => plan.bodySql.indexOf(marker));
    expect(sealOffsets.every(offset => offset >= 0)).toBe(true);
    expect(sealOffsets).toEqual([...sealOffsets].sort((a, b) => a - b));
    expect(plan.bodySql.match(/MIGRATION_TERMINAL_READBACK_FAILED/g)?.length)
      .toBeGreaterThanOrEqual(19);
    const spans = statementSpans(plan.bodySql);
    const sourceDefinitionsWithLock = spans
      .map((span, index) => ({ token: span.token, next: spans[index + 1]?.token ?? '' }))
      .filter(span => /^\s*(?:--[^\n]*\n\s*)*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(span.token)
        && span.token.includes('pg_advisory_xact_lock'));
    expect(sourceDefinitionsWithLock.length).toBeGreaterThan(0);
    expect(sourceDefinitionsWithLock.every(span => !span.next.includes('$ocr_chain_window_'))).toBe(true);
    let switchedRole = false;
    for (const span of spans) {
      const token = span.token.trim();
      if (/^SET\s+LOCAL\s+ROLE\s+privacy_workflow_owner\b/i.test(token)) switchedRole = true;
      if (/^RESET\s+ROLE\b/i.test(token)) switchedRole = false;
      if (switchedRole) expect(/^DO\s+\$ocr_chain_window_/i.test(token)).toBe(false);
    }
    expect(switchedRole).toBe(false);
  }, 30000);

  test('rejects unknown input, stale window, malformed operating stages, and transaction control', () => {
    const unknown = { ...syntheticInput(), extra: true };
    expect(() => compileRecovery108ChainPlan(unknown)).toThrow('RECEIPT_OCR_CHAIN_INPUT_INVALID');
    const expired = { ...syntheticInput(), expiresAt: '2026-10-20T00:16:00.000Z' };
    expect(() => compileRecovery108ChainPlan(expired)).toThrow('RECEIPT_OCR_CHAIN_EXPIRY_INVALID');
    const drifted = syntheticInput();
    drifted.featureAdmission.stageStates[0].state.ledgerIdentityRoot = '0'.repeat(64);
    expect(() => compileRecovery108ChainPlan(drifted)).toThrow('EVIDENCE_PREFIXED_STAGE_INVALID');
    expect(() => validateTransactionBody('BEGIN; INSERT INTO supabase_migrations.schema_migrations VALUES (1);', 1))
      .toThrow('RECEIPT_OCR_CHAIN_TRANSACTION_CONTROL_DENIED');
    expect(() => validateTransactionBody('/* nested /* comment */ */ ROLLBACK; INSERT INTO supabase_migrations.schema_migrations VALUES (1);', 1))
      .toThrow('RECEIPT_OCR_CHAIN_TRANSACTION_CONTROL_DENIED');
    expect(() => validateTransactionBody('INSERT INTO supabase_migrations.schema_migrations VALUES (1);', 2))
      .toThrow('RECEIPT_OCR_CHAIN_LEDGER_INSERT_INVALID');
  }, 30000);

  test('denies comment-separated top-level transaction controls', () => {
    for (const control of ['PREPARE/*gap*/TRANSACTION', 'START/*gap*/TRANSACTION',
      'SET/*gap*/TRANSACTION']) {
      expect(() => validateTransactionBody(`${control}; INSERT INTO supabase_migrations.schema_migrations VALUES (1);`, 1))
        .toThrow('RECEIPT_OCR_CHAIN_TRANSACTION_CONTROL_DENIED');
    }
  });

  test('reconciliation branches only after identity and existence, without a missing-RPC CASE query', () => {
    const plan = compileRecovery108ChainPlan(syntheticInput()).reconciliation;
    expect(plan.availabilityQuery).not.toContain('FROM supabase_migrations.schema_migrations');
    expect(plan.availabilityQuery).not.toContain('review_media_private.commits');
    expect(plan.availabilityQuery).not.toContain('review_media_private.cleanup');
    expect(plan.availabilityQuery).toContain("to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()')");
    expect(plan.availabilityQuery).toContain("to_regprocedure('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()')");
    expect(plan.availabilityQuery).toContain("to_regprocedure('ocr_private.receipt_credential_release_acl_admitted_v2()')");
    expect(plan.availabilityQuery).toContain("to_regprocedure('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()')");
    expect(plan.availabilityQuery).toContain("to_regprocedure('ocr_private.receipt_ocr_recovery_acl_admitted_v1()')");
    expect(plan.availabilityQuery).toContain("to_regclass('public.reviews')");
    expect(plan.availabilityQuery).toContain("to_regclass('ocr_private.receipt_results')");
    expect(plan.availabilityQuery).toContain("to_regclass('privacy_retention.g014_public_rpc_allowlist')");
    expect(plan.identityQuery).toContain('FROM supabase_migrations.schema_migrations');
    expect(plan.identityQuery).not.toContain('ocr_private.');
    const observed = (count: number, root: string, state: unknown = null) => ({
      availability: { ledgerExists: true, initialObjectsReady: true, terminalObjectsReady: true },
      identity: { ledgerCount: count, ledgerIdentityRoot: root }, state,
    });
    expect(classifyRecovery108ChainReconciliation(plan, observed(89, plan.initialRoot)))
      .toBe('needs_settled_initial_state');
    expect(classifyRecovery108ChainReconciliation(plan,
      observed(89, plan.initialRoot, plan.initialExpected))).toBe('initial_match_unsettled');
    expect(classifyRecovery108ChainReconciliation(plan, observed(108, plan.terminalRoot)))
      .toBe('needs_settled_terminal_state');
    expect(classifyRecovery108ChainReconciliation(plan,
      observed(108, plan.terminalRoot, plan.terminalExpected))).toBe('terminal_match_unsettled');
    expect(plan.settlement.lockKeys).toHaveLength(5);
    expect(plan.settlement.openSql).toContain('ISOLATION LEVEL READ COMMITTED');
    expect(plan.settlement.lockSql.match(/pg_try_advisory_xact_lock\(/g)).toHaveLength(5);
    expect(plan.settlement.lockSql).toContain('LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE NOWAIT');
    expect(plan.settlement.closeSql).toBe('ROLLBACK;\n');
    expect(() => classifyRecovery108ChainReconciliation(plan,
      { ...observed(89, plan.initialRoot, plan.initialExpected), settled: true }))
      .toThrow('RECEIPT_OCR_CHAIN_INPUT_INVALID');
    for (const count of [100, 105, 106, 107]) {
      expect(classifyRecovery108ChainReconciliation(plan, observed(count, plan.initialRoot)))
        .toBe('partial_conflict');
    }
    expect(classifyRecovery108ChainReconciliation(plan, observed(108, plan.initialRoot)))
      .toBe('partial_conflict');
    expect(classifyRecovery108ChainReconciliation(plan,
      { ...observed(89, plan.initialRoot), availability: { ledgerExists: true, initialObjectsReady: false, terminalObjectsReady: false } }))
      .toBe('partial_conflict');
    expect(classifyRecovery108ChainReconciliation(plan,
      { ...observed(108, plan.terminalRoot), availability: { ledgerExists: true, initialObjectsReady: true, terminalObjectsReady: false } }))
      .toBe('partial_conflict');
    expect(classifyRecovery108ChainReconciliation(plan,
      { ...observed(108, plan.terminalRoot), identity: null })).toBe('unknown');
  }, 30000);
});
