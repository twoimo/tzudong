import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertRecovery108LaunchReady,
  compileRecovery108OperatingPlan,
  loadRecovery108HeldManifest,
} from '../scripts/receipt-ocr-recovery108-sql-successor.mjs';

describe('held receipt OCR recovery 107 to 108 successor', () => {
  test('binds exact migration, fixture, compiler, and statement vector source', () => {
    const record = loadRecovery108HeldManifest();
    expect(record.manifest.launchPolicy).toEqual({
      state: 'held',
      code: 'RECEIPT_OCR_RECOVERY108_LAUNCH_HELD',
      reason: 'source-ready-held-no-operating-executor-or-hosted-authorization',
    });
    expect(record.manifest.predecessor.state).toBe('source_ready');
    expect(record.manifest.predecessor.ledgerCount).toBe(107);
    expect(record.material.originalVector).toHaveLength(record.manifest.migration.statementCount);
    expect(record.material.bytes.byteLength).toBeGreaterThan(0);
    expect(record.fixtureBytes.byteLength).toBeGreaterThan(0);
    expect(record.aclInitialDefaultFixtureBytes.byteLength).toBeGreaterThan(0);
    expect(record.aclAdmissionFixtureBytes.byteLength).toBeGreaterThan(0);
  });

  test('compiles only the bound 108 transaction and keeps operating launch held', () => {
    const record = loadRecovery108HeldManifest();
    const plan = compileRecovery108OperatingPlan(record);
    expect(plan.transactionMode).toBe('single-explicit-108-transaction-after-verified-107');
    expect(plan.priorReadback).toEqual(plan.predecessorPlan.finalReadback);
    expect(plan.sql).toContain('RECEIPT_OCR_RECOVERY108_SEAL_LEDGER_MISMATCH');
    expect(plan.finalReadback.expected.credentialReleaseV2Rebound).toBe(true);
    const ledgerInsert = plan.sql.indexOf('INSERT INTO supabase_migrations.schema_migrations');
    const predecessorReadiness = plan.sql.indexOf('RECEIPT_OCR_RECOVERY108_PREDECESSOR_NOT_READY');
    const predecessorRebind = plan.sql.indexOf(
      'UPDATE ocr_private.receipt_credential_release_catalog_contract',
      ledgerInsert,
    );
    const recoverySealLedgerCheck = plan.sql.indexOf(
      'RECEIPT_OCR_RECOVERY108_SEAL_LEDGER_MISMATCH',
      ledgerInsert,
    );
    const predecessorRebindReadback = plan.sql.indexOf(
      'RECEIPT_OCR_RECOVERY108_PREDECESSOR_REBIND_READBACK_FAILED',
      predecessorRebind,
    );
    const recoverySeal = plan.sql.indexOf(
      'UPDATE ocr_private.receipt_ocr_recovery_catalog_contract',
      predecessorRebind,
    );
    expect(predecessorReadiness).toBeGreaterThanOrEqual(0);
    expect(predecessorReadiness).toBeLessThan(ledgerInsert);
    expect(recoverySealLedgerCheck).toBeGreaterThan(ledgerInsert);
    expect(predecessorRebind).toBeGreaterThan(ledgerInsert);
    expect(predecessorRebindReadback).toBeGreaterThan(predecessorRebind);
    expect(recoverySeal).toBeGreaterThan(predecessorRebindReadback);
    expect(plan.sql.slice(recoverySealLedgerCheck, recoverySeal)).not.toContain(
      'RECEIPT_OCR_RECOVERY108_PREDECESSOR_NOT_READY',
    );
    expect(plan.sql).toContain('AND ledger_count=107');
    expect(plan.sql).toContain('ledger_count=108');
    expect(() => assertRecovery108LaunchReady(record))
      .toThrow('RECEIPT_OCR_RECOVERY108_LAUNCH_HELD');
  });

  test('pins the discriminating processing, ack-loss, stale-snapshot and late-publish counterexamples', () => {
    const root = join(import.meta.dir, '../../..');
    const migration = readFileSync(join(
      root,
      'backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql',
    ), 'utf8');
    const fixture = readFileSync(join(
      root,
      'backend/supabase/tests/receipt_ocr_indeterminate_recovery.sql',
    ), 'utf8');
    const initialDefaultFixture = readFileSync(join(
      root,
      'backend/supabase/tests/receipt_ocr_indeterminate_recovery_acl_initial_default.sql',
    ), 'utf8');
    const aclAdmissionFixture = readFileSync(join(
      root,
      'backend/supabase/tests/receipt_ocr_indeterminate_recovery_acl_admission.sql',
    ), 'utf8');

    expect(migration).toContain('receipt_ocr_indeterminate_recoveries');
    expect(migration).toContain("current_generation IS DISTINCT FROM p_expected_generation");
    expect(migration).toContain("snapshot_hash IS DISTINCT FROM p_input_snapshot_hash");
    expect(migration).toContain("result_row.status = 'processing'");
    expect(migration).toContain("result_row.status = 'indeterminate'");
    expect(migration).toContain('review row, generation row, then');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_PROCESSING_ROTATIONS=0');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_ACK_LOSS_EXTRA_ROTATIONS=0');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_LATE_PUBLISH=stale_rejected');
    expect(fixture).toContain('ack_loss_retry');
    expect(fixture).toContain('wrong_snapshot');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_OLD_CLAIM=denied');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_DELETED_REVIEW_CLAIM=denied');
    expect(migration).toContain('receipt_ocr_recovery_acl_admitted_v1');
    expect(migration).toContain('claim_receipt_ocr_recovery_result');
    expect(migration).toContain('receipt_ocr_recovery_photo_update_guard');
    expect(migration).toContain('receipt_ocr_recovery_execution_leases');
    expect(migration).toContain('receipt_ocr_recovery_catalog_snapshot_v1');
    expect(migration).toContain('pg_catalog.pg_get_functiondef(procedure.oid)');
    expect(migration).toContain('pg_catalog.pg_get_constraintdef(constraint_row.oid, false)');
    expect(migration).toContain("trigger_row.tgenabled <> 'O'");
    expect(migration).toContain('trigger_contract jsonb NOT NULL');
    expect(migration).toContain('catalog_contract.ledger_count = 108');
    expect(migration).toContain('RECEIPT OCR 108 OPERATING ADMISSION');
    expect(fixture).toContain('RECEIPT_OCR_RECOVERY108_ACTIVE_DELETE=blocked_until_claim_release');
    expect(initialDefaultFixture).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner',
    );
    expect(initialDefaultFixture).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres');
    expect(aclAdmissionFixture).toContain('RECEIPT_OCR_RECOVERY108_FORBIDDEN_ACL_READY');
    expect(aclAdmissionFixture).toContain('TO privacy_workflow_owner WITH GRANT OPTION');
    expect(aclAdmissionFixture).toContain(
      'ALTER FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update()',
    );
    expect(aclAdmissionFixture).toContain('RECEIPT_OCR_RECOVERY108_AUTHORIZE_BODY_DRIFT_READY');
    expect(aclAdmissionFixture).toContain('RECEIPT_OCR_RECOVERY108_CLAIM_BODY_DRIFT_READY');
    expect(aclAdmissionFixture).toContain('RECEIPT_OCR_RECOVERY108_GUARD_BODY_DRIFT_READY');
    expect(aclAdmissionFixture).toContain('DISABLE TRIGGER receipt_ocr_recovery_photo_update_guard');
    expect(aclAdmissionFixture).toContain('DISABLE TRIGGER receipt_ocr_recovery_execution_lease_release');
    expect(aclAdmissionFixture).toContain('RECEIPT_OCR_RECOVERY108_LEASE_FK_REMOVED_READY');
    expect(aclAdmissionFixture).toContain('ON DELETE CASCADE');
  });
});
