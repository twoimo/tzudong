import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

mock.module('server-only', () => ({}));

import { retainConfirmedOcrRecoveryOperation } from '../lib/admin/ocr-recovery-confirmation';

const {
  ReceiptOcrRecoveryCapabilityHeldError,
  ReceiptOcrRecoveryPersistenceError,
  applyReceiptOcrIndeterminateRecovery,
  authorizeReceiptOcrExecution,
  previewReceiptOcrIndeterminateRecovery,
} = await import('../lib/ocr/admin-receipt-recovery');

const UUIDS = {
  actor: 'b1000000-0000-4000-8000-000000000001',
  review: 'b1000000-0000-4000-8000-000000000002',
  operation: 'b1000000-0000-4000-8000-000000000003',
  previousGeneration: 'b1000000-0000-4000-8000-000000000004',
  generation: 'b1000000-0000-4000-8000-000000000005',
};
const snapshot = 'a'.repeat(64);

function client(responses: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      const response = responses.shift();
      if (!response) throw new Error('unexpected rpc');
      return response;
    },
  };
}

const ready = {
  schema_version: 1,
  status: 'ready',
  capability_version: 'receipt-ocr-indeterminate-recovery-v1',
};

describe('explicit receipt OCR indeterminate recovery', () => {
  test('fails closed before preview/apply when 108 capability is absent', async () => {
    const missing = client([{ data: null, error: { code: 'rpc-missing' } }]);
    await expect(previewReceiptOcrIndeterminateRecovery(missing as never, UUIDS.review))
      .rejects.toBeInstanceOf(ReceiptOcrRecoveryCapabilityHeldError);
    expect(missing.calls.map((call) => call.name)).toEqual([
      'get_receipt_ocr_indeterminate_recovery_capability',
    ]);
  });

  test('requires an exact source-bound preview snapshot', async () => {
    const fixture = client([
      { data: ready, error: null },
      {
        data: {
          schema_version: 1,
          status: 'eligible',
          review_id: UUIDS.review,
          expected_generation: UUIDS.previousGeneration,
          input_snapshot_hash: snapshot,
          recovery_operation_id: null,
        },
        error: null,
      },
    ]);
    await expect(previewReceiptOcrIndeterminateRecovery(fixture as never, UUIDS.review))
      .resolves.toEqual({
        schemaVersion: 1,
        status: 'eligible',
        reviewId: UUIDS.review,
        expectedGeneration: UUIDS.previousGeneration,
        inputSnapshotHash: snapshot,
        recoveryOperationId: null,
      });
  });

  test('accepts the same persisted operation readback without inventing another generation', async () => {
    const first = {
      schema_version: 1,
      status: 'rotated',
      review_id: UUIDS.review,
      operation_id: UUIDS.operation,
      previous_generation: UUIDS.previousGeneration,
      generation: UUIDS.generation,
      input_snapshot_hash: snapshot,
      idempotent: false,
      provider_outcome_certain: false,
      model_policy: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      thinking_level: 'HIGH',
    };
    const replay = {
      ...first,
      idempotent: true,
      model_policy: ['gemini-3.6-flash'],
      thinking_level: 'LOW',
    };
    const fixture = client([
      { data: ready, error: null }, { data: first, error: null },
      { data: ready, error: null }, { data: replay, error: null },
    ]);
    const input = {
      actorUserId: UUIDS.actor,
      reviewId: UUIDS.review,
      recoveryOperationId: UUIDS.operation,
      expectedGeneration: UUIDS.previousGeneration,
      inputSnapshotHash: snapshot,
      modelPolicy: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      thinkingLevel: 'HIGH',
      promptVersion: 'admin-receipt-summary-v1',
      preprocessVersion: 'admin-canonical-jpeg-v2',
      normalizationVersion: 'receipt-normalization-v1',
    };
    const applied = await applyReceiptOcrIndeterminateRecovery(fixture as never, input);
    const readback = await applyReceiptOcrIndeterminateRecovery(fixture as never, input);
    expect(applied).toMatchObject({ status: 'rotated', generation: UUIDS.generation, idempotent: false });
    expect(readback).toMatchObject({
      status: 'rotated',
      generation: UUIDS.generation,
      idempotent: true,
      modelPolicy: ['gemini-3.6-flash'],
      thinkingLevel: 'LOW',
    });
    expect(fixture.calls.filter((call) => call.name === 'recover_review_receipt_ocr_indeterminate'))
      .toHaveLength(2);
  });

  test('rejects a first rotation whose persisted execution policy differs from the request', async () => {
    const fixture = client([
      { data: ready, error: null },
      {
        data: {
          schema_version: 1,
          status: 'rotated',
          review_id: UUIDS.review,
          operation_id: UUIDS.operation,
          previous_generation: UUIDS.previousGeneration,
          generation: UUIDS.generation,
          input_snapshot_hash: snapshot,
          idempotent: false,
          provider_outcome_certain: false,
          model_policy: ['gemini-3.6-flash'],
          thinking_level: 'LOW',
        },
        error: null,
      },
    ]);
    await expect(applyReceiptOcrIndeterminateRecovery(fixture as never, {
      actorUserId: UUIDS.actor,
      reviewId: UUIDS.review,
      recoveryOperationId: UUIDS.operation,
      expectedGeneration: UUIDS.previousGeneration,
      inputSnapshotHash: snapshot,
      modelPolicy: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      thinkingLevel: 'HIGH',
      promptVersion: 'admin-receipt-summary-v1',
      preprocessVersion: 'admin-canonical-jpeg-v2',
      normalizationVersion: 'receipt-normalization-v1',
    })).rejects.toBeInstanceOf(ReceiptOcrRecoveryPersistenceError);
  });

  test('keeps processing and stale conflicts non-rotating at the route boundary', async () => {
    for (const status of ['processing', 'stale_operation'] as const) {
      const fixture = client([
        { data: ready, error: null },
        {
          data: {
            schema_version: 1,
            status,
            review_id: UUIDS.review,
            operation_id: UUIDS.operation,
          },
          error: null,
        },
      ]);
      await expect(applyReceiptOcrIndeterminateRecovery(fixture as never, {
        actorUserId: UUIDS.actor,
        reviewId: UUIDS.review,
        recoveryOperationId: UUIDS.operation,
        expectedGeneration: UUIDS.previousGeneration,
        inputSnapshotHash: snapshot,
        modelPolicy: ['gemini-3.8-flash', 'gemini-3.6-flash'],
        thinkingLevel: 'HIGH',
        promptVersion: 'admin-receipt-summary-v1',
        preprocessVersion: 'admin-canonical-jpeg-v2',
        normalizationVersion: 'receipt-normalization-v1',
      })).resolves.toMatchObject({ status });
    }
  });

  test('requires confirmation again after a cancelled first recovery click', () => {
    const retained = new Map();
    const operation = {
      operationId: UUIDS.operation,
      expectedGeneration: UUIDS.previousGeneration,
      inputSnapshotHash: snapshot,
    };
    let confirmations = 0;
    expect(retainConfirmedOcrRecoveryOperation(
      retained, UUIDS.review, operation, true, () => { confirmations += 1; return false; },
    )).toBe(false);
    expect(retained.has(UUIDS.review)).toBe(false);
    expect(retainConfirmedOcrRecoveryOperation(
      retained, UUIDS.review, operation, true, () => { confirmations += 1; return true; },
    )).toBe(true);
    expect(confirmations).toBe(2);
    expect(retained.get(UUIDS.review)).toEqual(operation);
  });

  test('authorizes the exact recovery generation and immutable execution binding', async () => {
    const fixture = client([
      { data: ready, error: null },
      {
        data: {
          schema_version: 1,
          status: 'allowed_recovery',
          review_id: UUIDS.review,
          generation: UUIDS.generation,
          recovery_operation_id: UUIDS.operation,
        },
        error: null,
      },
    ]);
    await expect(authorizeReceiptOcrExecution(fixture as never, {
      userId: UUIDS.actor,
      reviewId: UUIDS.review,
      generation: UUIDS.generation,
      recoveryOperationId: UUIDS.operation,
      verificationPhotoHash: 'b'.repeat(64),
      imageHash: 'c'.repeat(64),
      inputContextHash: 'd'.repeat(64),
      modelPolicy: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      thinkingLevel: 'HIGH',
      promptVersion: 'admin-receipt-summary-v1',
      preprocessVersion: 'admin-canonical-jpeg-v2',
      normalizationVersion: 'receipt-normalization-v1',
    })).resolves.toMatchObject({
      status: 'allowed_recovery',
      generation: UUIDS.generation,
      recoveryOperationId: UUIDS.operation,
    });
    expect(fixture.calls.map(call => call.name)).toEqual([
      'get_receipt_ocr_indeterminate_recovery_capability',
      'authorize_review_receipt_ocr_execution',
    ]);
  });

  test('binds the route and UI to preview, preflight, persisted operation reuse, and fixed conflicts', () => {
    const root = join(import.meta.dir, '..');
    const route = readFileSync(join(root, 'app/api/admin/ocr-receipts/rerun/route.ts'), 'utf8');
    const ui = readFileSync(join(root, 'components/admin/SubmissionListView.tsx'), 'utf8');
    const migration = readFileSync(join(
      root,
      '../../backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql',
    ), 'utf8');

    expect(route.indexOf('workflowPreflightResponse')).toBeLessThan(
      route.indexOf('applyReceiptOcrIndeterminateRecovery(supabase'),
    );
    expect(route).toContain("body.action === RECOVERY_ACTION && !resetAlreadyPending");
    expect(route).toContain("else if (!resetAlreadyPending)");
    expect(route).toContain("dispatchSkipped: true");
    expect(route).toContain("code: 'OCR_WORKFLOW_DISPATCH_INDETERMINATE'");
    expect(ui).toContain('ocrRecoveryOperationsRef');
    expect(ui).toContain('preview_provider_indeterminate');
    expect(ui).toContain('recover_provider_indeterminate');
    expect(ui).toContain('OCR_RECOVERY_COST_NOTICE');
    expect(ui).toContain('OCR 결과를 확인하고 있습니다.');
    expect(ui).toContain("? '결과 확인 중'");
    expect(ui).not.toContain('초 후 완료 예정');
    expect(ui).not.toContain('ocrCountdown');
    expect(migration).toContain('PRIMARY KEY');
    expect(migration).toContain('UNIQUE (review_id, expected_generation)');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("status', 'processing'");
    expect(migration).toContain("status', 'stale_operation'");
    expect(migration).toContain("'provider_outcome_certain', false");
  });
});
