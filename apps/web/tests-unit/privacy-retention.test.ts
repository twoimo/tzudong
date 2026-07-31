import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_PRIVACY_RETENTION_BATCH_SIZE,
  PRIVACY_RETENTION_CONFIRMATION_TEXT,
  PrivacyRetentionRunnerError,
  applyRetentionRun,
  previewRetentionRun,
  type PrivacyRetentionProvider,
  type PrivacyRetentionRpcClient,
} from '../lib/privacy/retention-runner';

const webRoot = join(import.meta.dir, '..');
const fixedRunId = '11111111-1111-4111-8111-111111111111';
const fixedAuditId = '33333333-3333-4333-8333-333333333333';
const fixedHash = 'a'.repeat(64);
const fixedAdapterVersion = 'b'.repeat(64);
const fixedSourceMappingVersion = 'c'.repeat(64);
const fixedOtherBindingHash = 'd'.repeat(64);
const fixedWorkItemId = '44444444-4444-4444-8444-444444444444';
const fixedClaimToken = '55555555-5555-4555-8555-555555555555';
const fixedProviderEffectToken = '66666666-6666-4666-8666-666666666666';
const fixedProviderRef = 'fixture.provider.v1';
const fixedBucketName = 'fixture-bucket';
const fixedObjectName = 'opaque-fixture-object';
const providerClaim = {
  workItemId: fixedWorkItemId,
  claimToken: fixedClaimToken,
  claimHash: fixedHash,
  objectLocatorHash: fixedHash,
  objectVersionHash: fixedOtherBindingHash,
  adapterVersion: fixedAdapterVersion,
  sourceMappingVersion: fixedSourceMappingVersion,
};
const providerResolution = {
  ...providerClaim,
  providerEffectToken: fixedProviderEffectToken,
  providerVerifierRef: fixedProviderRef,
  leaseExpiresAt: '2099-07-12T00:15:00.000Z',
  bucketName: fixedBucketName,
  objectName: fixedObjectName,
};
const providerReconciliationWork = {
  ...providerClaim,
  providerEffectToken: fixedProviderEffectToken,
  providerVerifierRef: fixedProviderRef,
  workMode: 'verify_absence_only',
};
const providerProof = {
  providerReceiptRef: 'fixture.receipt.0001',
  providerReceiptHash: 'e'.repeat(64),
  providerAbsenceHash: 'f'.repeat(64),
};
const providerReceiptResult = {
  operationId: fixedRunId,
  acceptedCount: 1,
  adapterVersion: fixedAdapterVersion,
  sourceMappingVersion: fixedSourceMappingVersion,
};

const source = (path: string) => readFileSync(join(webRoot, path), 'utf8');
const response = (data: unknown) => Promise.resolve({ data, error: null });

const binding = {
  adapterVersion: fixedAdapterVersion,
  sourceMappingVersion: fixedSourceMappingVersion,
};

const confirmation = {
  operationId: fixedRunId,
  status: 'confirmed',
  ...binding,
};

const applyProgress = {
  operationId: fixedRunId,
  status: 'partial',
  readback: {
    passed: false,
    checks: {
      expectedCountMatched: false,
      databaseSourceAbsent: true,
      storageProviderAbsent: false,
      noActiveHoldMutated: true,
    },
  },
  auditId: fixedAuditId,
  ...binding,
  errorCode: null,
};
const providerPendingReceipt = {
  ...applyProgress,
  readback: {
    passed: false,
    checks: {
      expectedCountMatched: true,
      databaseSourceAbsent: true,
      storageProviderAbsent: false,
      noActiveHoldMutated: true,
    },
  },
  errorCode: 'privacy_retention_readback_incomplete',
};

const passedReceipt = {
  operationId: fixedRunId,
  status: 'applied',
  readback: {
    passed: true,
    checks: {
      expectedCountMatched: true,
      databaseSourceAbsent: true,
      storageProviderAbsent: true,
      noActiveHoldMutated: true,
    },
  },
  auditId: fixedAuditId,
  ...binding,
  errorCode: null,
};

const preview = {
  operationId: fixedRunId,
  previewHash: fixedHash,
  expiresAt: '2099-07-12T00:15:00.000Z',
  ...binding,
  summary: {
    cutoff: '2026-07-12T00:00:00.000Z',
    eligible: 2,
    held: 1,
    scanned: 3,
  },
  requiredConfirmation: PRIVACY_RETENTION_CONFIRMATION_TEXT,
};

const applyInput = {
  operationId: fixedRunId,
  previewHash: fixedHash,
  confirmationText: PRIVACY_RETENTION_CONFIRMATION_TEXT,
  idempotencyKey: 'retention-test-0001',
  adapterVersion: fixedAdapterVersion,
  sourceMappingVersion: fixedSourceMappingVersion,
  batchSize: 10,
};

const durableClient = (overrides: Partial<Record<string, unknown>> = {}): PrivacyRetentionRpcClient => ({
  rpc: async (name) => {
    const payloads: Record<string, unknown> = {
      confirm_privacy_retention_run: confirmation,
      apply_privacy_retention_run: applyProgress,
      finalize_privacy_retention_run: passedReceipt,
      ...overrides,
    };
    if (!Object.prototype.hasOwnProperty.call(payloads, name)) throw new Error(`unexpected RPC ${name}`);
    return response(payloads[name]);
  },
});

describe('privacy retention runner', () => {
  test('requires a bounded, nonfuture cutoff before making an RPC', async () => {
    const calls: string[] = [];
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        calls.push(name);
        return response(null);
      },
    };

    await expect(previewRetentionRun(client, {
      classCode: 'no',
      asOf: '2026-07-12T00:00:00.000Z',
      batchSize: 1,
    })).rejects.toMatchObject({ code: 'privacy_retention_class_invalid' });
    await expect(previewRetentionRun(client, {
      classCode: 'approved_access_logs',
      asOf: '2026-07-12T00:00:00.000Z',
      batchSize: MAX_PRIVACY_RETENTION_BATCH_SIZE + 1,
    })).rejects.toMatchObject({ code: 'privacy_retention_batch_invalid' });
    await expect(previewRetentionRun(client, {
      classCode: 'approved_access_logs',
      asOf: '2099-07-12T00:00:00.000Z',
      batchSize: 1,
    })).rejects.toMatchObject({ code: 'privacy_retention_cutoff_invalid' });
    expect(calls).toEqual([]);
  });

  test('accepts a successful preview only with exact durable adapter and source bindings', async () => {
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name, args) => {
        expect(name).toBe('preview_privacy_retention_run');
        expect(args).toEqual({
          p_class_code: 'approved_access_logs',
          p_as_of: '2026-07-12T00:00:00.000Z',
          p_batch_size: 3,
          p_max_duration_ms: 10_000,
        });
        return response(preview);
      },
    };

    await expect(previewRetentionRun(client, {
      classCode: 'approved_access_logs',
      asOf: '2026-07-12T00:00:00.000Z',
      batchSize: 3,
    })).resolves.toEqual({
      operationId: fixedRunId,
      previewHash: fixedHash,
      adapterVersion: fixedAdapterVersion,
      sourceMappingVersion: fixedSourceMappingVersion,
      expiresAt: '2099-07-12T00:15:00.000Z',
      summary: { cutoff: '2026-07-12T00:00:00.000Z', eligible: 2, held: 1, scanned: 3 },
      requiredConfirmation: PRIVACY_RETENTION_CONFIRMATION_TEXT,
    });
  });

  test('fails closed when the preview omits an approved adapter binding', async () => {
    const { adapterVersion: _adapterVersion, ...withoutAdapter } = preview;
    await expect(previewRetentionRun({ rpc: async () => response(withoutAdapter) }, {
      classCode: 'approved_access_logs',
      asOf: '2026-07-12T00:00:00.000Z',
      batchSize: 1,
    })).rejects.toMatchObject({ code: 'privacy_retention_preview_invalid' });
  });
  test('rejects label-shaped, uppercase, and extra preview bindings', async () => {
    for (const invalidPreview of [
      { ...preview, adapterVersion: 'retention-adapter-2026.07.13' },
      { ...preview, sourceMappingVersion: fixedSourceMappingVersion.toUpperCase() },
      { ...preview, extra: true },
    ]) {
      await expect(previewRetentionRun({ rpc: async () => response(invalidPreview) }, {
        classCode: 'approved_access_logs',
        asOf: '2026-07-12T00:00:00.000Z',
        batchSize: 1,
      })).rejects.toMatchObject({ code: 'privacy_retention_preview_invalid' });
    }
  });
  test('rejects noncanonical apply bindings before RPC execution', async () => {
    const calls: string[] = [];
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        calls.push(name);
        return response(confirmation);
      },
    };

    await expect(applyRetentionRun(client, {
      ...applyInput,
      adapterVersion: 'retention-adapter-2026.07.13',
    })).rejects.toMatchObject({ code: 'privacy_retention_confirmation_invalid' });
    await expect(applyRetentionRun(client, {
      ...applyInput,
      sourceMappingVersion: fixedSourceMappingVersion.toUpperCase(),
    })).rejects.toMatchObject({ code: 'privacy_retention_confirmation_invalid' });
    expect(calls).toEqual([]);
  });

  test('returns a final authoritative receipt rather than treating apply as proof', async () => {
    const calls: Array<Readonly<{ name: string; args: Record<string, unknown> }>> = [];
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'finalize_privacy_retention_run': return response(passedReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };

    await expect(applyRetentionRun(client, applyInput)).resolves.toEqual({
      operationId: fixedRunId,
      status: 'applied',
      adapterVersion: fixedAdapterVersion,
      sourceMappingVersion: fixedSourceMappingVersion,
      readback: passedReceipt.readback,
      auditId: fixedAuditId,
      errorCode: null,
    });
    expect(calls.map(({ name }) => name)).toEqual([
      'confirm_privacy_retention_run',
      'apply_privacy_retention_run',
      'finalize_privacy_retention_run',
    ]);
    expect(calls[0]?.args).toEqual({
      p_run_id: fixedRunId,
      p_preview_hash: fixedHash,
      p_confirmation_text: PRIVACY_RETENTION_CONFIRMATION_TEXT,
      p_idempotency_key: 'retention-test-0001',
    });
    expect(calls[1]?.args).toEqual({
      p_run_id: fixedRunId,
      p_preview_hash: fixedHash,
      p_idempotency_key: 'retention-test-0001',
      p_max_duration_ms: 10_000,
    });
    expect(calls[2]?.args).toEqual({
      p_run_id: fixedRunId,
      p_preview_hash: fixedHash,
      p_idempotency_key: 'retention-test-0001',
    });
  });

  test('rejects malformed, mismatched, or request-side asserted final receipts', async () => {
    const malformed = {
      ...passedReceipt,
      readback: { passed: true, checks: {} },
    };
    await expect(applyRetentionRun(durableClient({ finalize_privacy_retention_run: malformed }), applyInput))
      .rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });
    const { errorCode: _errorCode, ...missingErrorCode } = passedReceipt;
    await expect(applyRetentionRun(durableClient({ finalize_privacy_retention_run: missingErrorCode }), applyInput))
      .rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });

    const mismatchedBinding = {
      ...passedReceipt,
      adapterVersion: fixedOtherBindingHash,
    };
    await expect(applyRetentionRun(durableClient({ finalize_privacy_retention_run: mismatchedBinding }), applyInput))
      .rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });

    const selfAttested = {
      ...passedReceipt,
      readback: { passed: false, checks: { providerSubmitted: true } },
    };
    await expect(applyRetentionRun(durableClient({ finalize_privacy_retention_run: selfAttested }), applyInput))
      .rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });
  });
  test('requires canonical status, readback, and error-code combinations for final receipts', async () => {
    const allChecksPassed = {
      expectedCountMatched: true,
      databaseSourceAbsent: true,
      storageProviderAbsent: true,
      noActiveHoldMutated: true,
    };
    for (const invalidFinalReceipt of [
      { ...passedReceipt, errorCode: 'privacy_retention_readback_incomplete' },
      { ...applyProgress, errorCode: null },
      {
        ...applyProgress,
        readback: { passed: true, checks: allChecksPassed },
        errorCode: 'privacy_retention_readback_incomplete',
      },
      { ...applyProgress, status: 'failed', errorCode: null },
      { ...applyProgress, errorCode: 'privacy_retention_source_busy' },
    ]) {
      await expect(applyRetentionRun(durableClient({
        finalize_privacy_retention_run: invalidFinalReceipt,
      }), applyInput)).rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });
    }
  });
  test('rejects mismatched applied and partial receipt bindings before finalization', async () => {
    await expect(applyRetentionRun(durableClient({
      apply_privacy_retention_run: {
        ...applyProgress,
        adapterVersion: fixedOtherBindingHash,
      },
    }), applyInput)).rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });

    await expect(applyRetentionRun(durableClient({
      apply_privacy_retention_run: {
        ...applyProgress,
        sourceMappingVersion: fixedOtherBindingHash,
      },
    }), applyInput)).rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });
  });

  test('rejects stale replay bindings before apply', async () => {
    const calls: string[] = [];
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        calls.push(name);
        return response({
          ...confirmation,
          status: 'applied',
          sourceMappingVersion: fixedOtherBindingHash,
        });
      },
    };

    await expect(applyRetentionRun(client, applyInput)).rejects.toMatchObject({
      code: 'privacy_retention_confirmation_invalid',
    });
    expect(calls).toEqual(['confirm_privacy_retention_run']);
  });
  test('reads a stale idempotent replay from the final durable receipt without reapplying it', async () => {
    const calls: string[] = [];
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        calls.push(name);
        if (name === 'confirm_privacy_retention_run') {
          return response({ ...confirmation, status: 'applied' });
        }
        if (name === 'finalize_privacy_retention_run') return response(passedReceipt);
        throw new Error(`unexpected RPC ${name}`);
      },
    };

    await expect(applyRetentionRun(client, applyInput)).resolves.toMatchObject({
      status: 'applied',
      readback: { passed: true },
    });
    expect(calls).toEqual(['confirm_privacy_retention_run', 'finalize_privacy_retention_run']);
  });

  test('returns partial final outcomes as retryable receipts without provider paths or claims', async () => {
    const partialReceipt = {
      ...passedReceipt,
      status: 'partial',
      readback: {
        passed: false,
        checks: {
          expectedCountMatched: false,
          databaseSourceAbsent: true,
          storageProviderAbsent: false,
          noActiveHoldMutated: true,
        },
      },
      errorCode: 'privacy_retention_readback_incomplete',
    };
    const receipt = await applyRetentionRun(durableClient({
      apply_privacy_retention_run: applyProgress,
      finalize_privacy_retention_run: partialReceipt,
    }), applyInput);

    expect(receipt).toEqual({
      operationId: fixedRunId,
      status: 'partial',
      adapterVersion: fixedAdapterVersion,
      sourceMappingVersion: fixedSourceMappingVersion,
      readback: partialReceipt.readback,
      auditId: fixedAuditId,
      errorCode: 'privacy_retention_readback_incomplete',
    });
    expect(JSON.stringify(receipt)).not.toContain('object');
    expect(JSON.stringify(receipt)).not.toContain('bucket');
    expect(JSON.stringify(receipt)).toContain(fixedAdapterVersion);
    expect(JSON.stringify(receipt)).toContain(fixedSourceMappingVersion);
  });
  test('runs database-only work without constructing a provider and returns its durable receipt', async () => {
    const calls: string[] = [];
    let providerFactoryCalls = 0;
    let providerMethodCalls = 0;
    const receipt = await applyRetentionRun({
      rpc: async (name) => {
        calls.push(name);
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'finalize_privacy_retention_run': return response(passedReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    }, applyInput, {
      providerFactory: () => {
        providerFactoryCalls += 1;
        return {
          verifierRef: fixedProviderRef,
          deleteExactVersion: async () => { providerMethodCalls += 1; },
          verifyAbsent: async () => {
            providerMethodCalls += 1;
            return providerProof;
          },
        };
      },
    });

    expect(calls).toEqual([
      'confirm_privacy_retention_run',
      'apply_privacy_retention_run',
      'finalize_privacy_retention_run',
    ]);
    expect(providerFactoryCalls).toBe(0);
    expect(providerMethodCalls).toBe(0);
    expect(receipt).toEqual({
      operationId: fixedRunId,
      status: 'applied',
      adapterVersion: fixedAdapterVersion,
      sourceMappingVersion: fixedSourceMappingVersion,
      readback: passedReceipt.readback,
      auditId: fixedAuditId,
      errorCode: null,
    });
  });

  test('fails closed without provider configuration when durable readback requires external evidence', async () => {
    const calls: string[] = [];
    let providerFactoryCalls = 0;
    await expect(applyRetentionRun({
      rpc: async (name) => {
        calls.push(name);
        if (name === 'confirm_privacy_retention_run') return response(confirmation);
        if (name === 'apply_privacy_retention_run') return response(applyProgress);
        if (name === 'finalize_privacy_retention_run') return response(providerPendingReceipt);
        throw new Error(`unexpected RPC ${name}`);
      },
    }, applyInput, {
      providerFactory: () => {
        providerFactoryCalls += 1;
        return null;
      },
    })).rejects.toMatchObject({ code: 'privacy_retention_provider_unavailable' });

    expect(calls).toEqual([
      'confirm_privacy_retention_run',
      'apply_privacy_retention_run',
      'finalize_privacy_retention_run',
    ]);
    expect(providerFactoryCalls).toBe(1);
  });
  test('rejects an invalid provider before any provider egress', async () => {
    let deletes = 0;
    let verifications = 0;
    const provider: PrivacyRetentionProvider = {
      verifierRef: 'invalid',
      deleteExactVersion: async () => { deletes += 1; },
      verifyAbsent: async () => {
        verifications += 1;
        return providerProof;
      },
    };
    await expect(applyRetentionRun({
      rpc: async (name) => {
        if (name === 'confirm_privacy_retention_run') return response(confirmation);
        if (name === 'apply_privacy_retention_run') return response(applyProgress);
        if (name === 'finalize_privacy_retention_run') return response(providerPendingReceipt);
        throw new Error(`unexpected RPC ${name}`);
      },
    }, applyInput, { provider })).rejects.toMatchObject({ code: 'privacy_retention_provider_invalid' });

    expect(deletes).toBe(0);
    expect(verifications).toBe(0);
  });

  test('rejects malformed external work before any provider egress', async () => {
    let deletes = 0;
    let verifications = 0;
    const provider: PrivacyRetentionProvider = {
      verifierRef: fixedProviderRef,
      deleteExactVersion: async () => { deletes += 1; },
      verifyAbsent: async () => {
        verifications += 1;
        return providerProof;
      },
    };
    await expect(applyRetentionRun({
      rpc: async (name) => {
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'finalize_privacy_retention_run': return response(providerPendingReceipt);
          case 'get_privacy_retention_provider_reconciliation_work': return response([{ malformed: true }]);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    }, { ...applyInput, batchSize: 1 }, { provider })).rejects.toMatchObject({
      code: 'privacy_retention_provider_reconciliation_invalid',
    });

    expect(deletes).toBe(0);
    expect(verifications).toBe(0);
  });

  test('does not leak provider diagnostics or accept PII-shaped receipt extensions', async () => {
    const rpcErrorClient: PrivacyRetentionRpcClient = {
      rpc: async () => ({
        data: null,
        error: { message: 'raw-ocr: secret@example.com 900101-1234567' },
      }),
    };
    const error = await previewRetentionRun(rpcErrorClient, {
      classCode: 'approved_access_logs',
      asOf: '2026-07-12T00:00:00.000Z',
      batchSize: 1,
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(PrivacyRetentionRunnerError);
    expect((error as PrivacyRetentionRunnerError).code).toBe('privacy_retention_operation_failed');
    expect(String(error)).not.toContain('secret@example.com');
    expect(String(error)).not.toContain('900101-1234567');

    await expect(applyRetentionRun(durableClient({
      finalize_privacy_retention_run: { ...passedReceipt, objectName: 'subjects/secret@example.com' },
    }), applyInput)).rejects.toMatchObject({ code: 'privacy_retention_receipt_invalid' });
  });
  test('consumes one bound locator, deletes its exact version, verifies absence, and records only proof', async () => {
    const calls: string[] = [];
    const deletes: unknown[] = [];
    const verifications: unknown[] = [];
    const submittedReceipts: unknown[] = [];
    let finalizations = 0;
    const provider: PrivacyRetentionProvider = {
      verifierRef: fixedProviderRef,
      deleteExactVersion: async (input) => { deletes.push(input); },
      verifyAbsent: async (input) => {
        verifications.push(input);
        return providerProof;
      },
    };
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name, args) => {
        calls.push(name);
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'get_privacy_retention_provider_reconciliation_work': return response([]);
          case 'claim_privacy_retention_storage_items': return response([providerClaim]);
          case 'resolve_privacy_retention_provider_effect': return response(providerResolution);
          case 'record_privacy_retention_storage_provider_receipts':
            submittedReceipts.push(args.p_receipts);
            return response(providerReceiptResult);
          case 'finalize_privacy_retention_run':
            finalizations += 1;
            return response(finalizations === 1 ? providerPendingReceipt : passedReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };

    const receipt = await applyRetentionRun(client, { ...applyInput, batchSize: 1 }, { provider });

    expect(calls).toEqual([
      'confirm_privacy_retention_run',
      'apply_privacy_retention_run',
      'finalize_privacy_retention_run',
      'get_privacy_retention_provider_reconciliation_work',
      'claim_privacy_retention_storage_items',
      'resolve_privacy_retention_provider_effect',
      'record_privacy_retention_storage_provider_receipts',
      'finalize_privacy_retention_run',
    ]);
    expect(deletes).toEqual([{
      bucketName: fixedBucketName,
      objectName: fixedObjectName,
      objectVersionHash: fixedOtherBindingHash,
      providerEffectToken: fixedProviderEffectToken,
      leaseExpiresAt: '2099-07-12T00:15:00.000Z',
    }]);
    expect(verifications).toEqual([{
      objectLocatorHash: fixedHash,
      objectVersionHash: fixedOtherBindingHash,
      providerEffectToken: fixedProviderEffectToken,
    }]);
    expect(submittedReceipts).toEqual([[
      {
        workItemId: fixedWorkItemId,
        claimToken: fixedClaimToken,
        objectLocatorHash: fixedHash,
        objectVersionHash: fixedOtherBindingHash,
        claimHash: fixedHash,
        providerEffectToken: fixedProviderEffectToken,
        ...providerProof,
        verifierRef: fixedProviderRef,
      },
    ]]);
    expect(JSON.stringify(receipt)).not.toContain(fixedBucketName);
    expect(JSON.stringify(receipt)).not.toContain(fixedObjectName);
  });

  test('a hold that wins before effect consume prevents provider deletion', async () => {
    const deletes: unknown[] = [];
    const partialReceipt = {
      ...applyProgress,
      errorCode: 'privacy_retention_readback_incomplete',
    };
    const provider: PrivacyRetentionProvider = {
      verifierRef: fixedProviderRef,
      deleteExactVersion: async (input) => { deletes.push(input); },
      verifyAbsent: async () => providerProof,
    };
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'get_privacy_retention_provider_reconciliation_work': return response([]);
          case 'claim_privacy_retention_storage_items': return response([providerClaim]);
          case 'resolve_privacy_retention_provider_effect': return response(null);
          case 'finalize_privacy_retention_run': return response(partialReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };

    await expect(applyRetentionRun(client, { ...applyInput, batchSize: 1 }, { provider }))
      .resolves.toMatchObject({
        status: 'partial',
        readback: { checks: { noActiveHoldMutated: true } },
      });
    expect(deletes).toEqual([]);
  });

  test('an effect-boundary hold is recorded truthfully after the one provider effect completes', async () => {
    const deletes: unknown[] = [];
    let holdAttempted = false;
    const heldReceipt = {
      ...passedReceipt,
      status: 'partial',
      readback: {
        passed: false,
        checks: {
          expectedCountMatched: true,
          databaseSourceAbsent: true,
          storageProviderAbsent: true,
          noActiveHoldMutated: false,
        },
      },
      errorCode: 'privacy_retention_readback_incomplete',
    };
    let finalizations = 0;
    const provider: PrivacyRetentionProvider = {
      verifierRef: fixedProviderRef,
      deleteExactVersion: async (input) => {
        deletes.push(input);
        holdAttempted = true;
      },
      verifyAbsent: async () => providerProof,
    };
    const client: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'get_privacy_retention_provider_reconciliation_work': return response([]);
          case 'claim_privacy_retention_storage_items': return response([providerClaim]);
          case 'resolve_privacy_retention_provider_effect': return response(providerResolution);
          case 'record_privacy_retention_storage_provider_receipts': return response(providerReceiptResult);
          case 'finalize_privacy_retention_run':
            finalizations += 1;
            return response(finalizations === 1 ? providerPendingReceipt : heldReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };

    const receipt = await applyRetentionRun(client, { ...applyInput, batchSize: 1 }, { provider });

    expect(holdAttempted).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(receipt.readback.checks.noActiveHoldMutated).toBe(false);
  });

  test('reconciles a crash after provider delete with verifier-only work and never deletes twice', async () => {
    const deletes: unknown[] = [];
    const partialReceipt = {
      ...applyProgress,
      errorCode: 'privacy_retention_readback_incomplete',
    };
    const provider: PrivacyRetentionProvider = {
      verifierRef: fixedProviderRef,
      deleteExactVersion: async (input) => {
        deletes.push(input);
        throw new Error('simulated worker crash after provider effect');
      },
      verifyAbsent: async () => providerProof,
    };
    let firstFinalizations = 0;
    const firstClient: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        switch (name) {
          case 'confirm_privacy_retention_run': return response(confirmation);
          case 'apply_privacy_retention_run': return response(applyProgress);
          case 'get_privacy_retention_provider_reconciliation_work': return response([]);
          case 'claim_privacy_retention_storage_items': return response([providerClaim]);
          case 'resolve_privacy_retention_provider_effect': return response(providerResolution);
          case 'finalize_privacy_retention_run':
            firstFinalizations += 1;
            return response(firstFinalizations === 1 ? providerPendingReceipt : partialReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };
    await applyRetentionRun(firstClient, { ...applyInput, batchSize: 1 }, { provider });
    expect(deletes).toHaveLength(1);

    const secondCalls: string[] = [];
    let secondFinalizations = 0;
    const secondClient: PrivacyRetentionRpcClient = {
      rpc: async (name) => {
        secondCalls.push(name);
        switch (name) {
          case 'confirm_privacy_retention_run': return response({ ...confirmation, status: 'applied' });
          case 'get_privacy_retention_provider_reconciliation_work':
            return response([providerReconciliationWork]);
          case 'record_privacy_retention_storage_provider_receipts': return response(providerReceiptResult);
          case 'finalize_privacy_retention_run':
            secondFinalizations += 1;
            return response(secondFinalizations === 1 ? providerPendingReceipt : passedReceipt);
          default: throw new Error(`unexpected RPC ${name}`);
        }
      },
    };

    await expect(applyRetentionRun(secondClient, { ...applyInput, batchSize: 1 }, { provider }))
      .resolves.toMatchObject({ status: 'applied' });
    expect(secondCalls).toEqual([
      'confirm_privacy_retention_run',
      'finalize_privacy_retention_run',
      'get_privacy_retention_provider_reconciliation_work',
      'record_privacy_retention_storage_provider_receipts',
      'finalize_privacy_retention_run',
    ]);
    expect(deletes).toHaveLength(1);
  });
});

describe('privacy retention internal route contract', () => {
  test('keeps the server-only same-origin boundary, no-store responses, and fixed diagnostics', () => {
    const route = source('app/api/internal/privacy-retention/route.ts');
    const runner = source('lib/privacy/retention-runner.ts');

    expect(route).toContain("import { createHash, timingSafeEqual } from 'node:crypto'");
    expect(route).toContain('PRIVACY_RETENTION_INTERNAL_CAPABILITY');
    expect(route).toContain("CAPABILITY_HEADER = 'x-privacy-retention-capability'");
    expect(route).toContain('timingSafeEqual(digest(candidate), digest(expected))');
    expect(route).toContain("request.headers.get('authorization')");
    expect(route).toContain("request.headers.get('cookie')");
    expect(route).toContain("request.headers.get('origin')");
    expect(route).toContain('privacy_retention_browser_auth_rejected');
    expect(route).toContain('MAX_PRIVACY_RETENTION_BATCH_SIZE');
    expect(route).toContain('MAX_PRIVACY_RETENTION_RUNTIME_MS');
    expect(route).toContain('Cache-Control');
    expect(route).not.toContain('console.');
    expect(route).not.toContain('getUser(');
    expect(route).not.toContain('supabase.storage');
    expect(runner).not.toContain('PrivacyRetentionStorage');
    expect(runner).not.toContain('ack_privacy_retention_storage_items');
    expect(route).toContain("code === 'privacy_retention_provider_unavailable' || code === 'privacy_retention_operation_failed'");
    expect(route).toContain("code === 'privacy_retention_timeout'");
    expect(route).toContain("code === 'privacy_retention_confirmation_invalid'");
    expect(route).toContain(': 500;');
    expect(route).toContain('PRIVACY_RETENTION_PROVIDER_DELETE_URL');
    expect(route).toContain('PRIVACY_RETENTION_PROVIDER_VERIFIER_URL');
    expect(route).toContain('PRIVACY_RETENTION_PROVIDER_DELETE_CAPABILITY');
    expect(route).toContain('PRIVACY_RETENTION_PROVIDER_VERIFIER_CAPABILITY');
    expect(route).toContain('PRIVACY_RETENTION_PROVIDER_VERIFIER_REF');
    expect(route).toContain('MAX_PROVIDER_RESPONSE_BYTES = 1024');
    expect(route).toContain('readBoundedProviderResponse');
    expect(route).toContain('}, { providerFactory: privateProvider })');
    expect(runner).toContain('claim_privacy_retention_storage_items');
    expect(runner).toContain('resolve_privacy_retention_provider_effect');
    expect(runner).toContain('get_privacy_retention_provider_reconciliation_work');
    expect(runner).toContain('record_privacy_retention_storage_provider_receipts');
    expect(runner).toContain('bucketName');
    expect(runner).toContain('objectName');
    expect(route).toContain("const APPLY_REQUEST_KEYS = ['action', 'operationId', 'previewHash', 'confirmationText', 'idempotencyKey', 'adapterVersion', 'sourceMappingVersion'] as const;");
    expect(route).toContain('adapterVersion: body.adapterVersion');
    expect(route).toContain('sourceMappingVersion: body.sourceMappingVersion');
    expect(runner).toContain('const HASH_PATTERN = /^[0-9a-f]{64}$/;');
    expect(runner).toContain('adapterVersion: binding.adapterVersion');
    expect(runner).toContain('sourceMappingVersion: binding.sourceMappingVersion');
    expect(route).toContain('return json({ ok: true, receipt });');
    expect(runner).toContain('errorCode,');
  });

  test('bounds capability-authorized retention JSON by declared and chunked UTF-8 bytes', async () => {
    const route = source('app/api/internal/privacy-retention/route.ts');
    const postHandler = route.slice(route.indexOf('export async function POST('));
    const browserRejectionIndex = postHandler.indexOf('if (isBrowserOrSessionRequest(request))');
    const capabilityRejectionIndex = postHandler.indexOf('if (!hasValidRetentionCapability(');
    const bodyReadIndex = postHandler.indexOf('const body = await readRequest(request);');

    expect(browserRejectionIndex).toBeGreaterThanOrEqual(0);
    expect(capabilityRejectionIndex).toBeGreaterThan(browserRejectionIndex);
    expect(bodyReadIndex).toBeGreaterThan(capabilityRejectionIndex);
    expect(route).toContain('const MAX_REQUEST_BYTES = 16 * 1024;');
    expect(route).toContain("request.headers.get('content-length')");
    expect(route).toContain("text = await request.text();");
    expect(route).toContain("Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES");
    expect(route).toContain("parsed.status === 413 ? 'privacy_retention_request_too_large' : 'privacy_retention_request_invalid'");
    expect(route).toContain("code === 'privacy_retention_request_too_large'");
    expect(route).toContain('hasExactKeys(');
    expect(route).not.toContain('request.json()');

    const oversizedChunkedBody = JSON.stringify({ action: 'preview', padding: '가'.repeat(6_000) });
    const chunkedRequest = new Request('https://example.test/api/internal/privacy-retention', {
      method: 'POST',
      body: oversizedChunkedBody,
    });

    expect(chunkedRequest.headers.get('content-length')).toBeNull();
    expect(Buffer.byteLength(await chunkedRequest.text(), 'utf8')).toBeGreaterThan(16 * 1024);
  });
});
describe('privacy retention no-op and audit retention source contract', () => {
  test('closes fully scanned empty schedules with a canonical replayable receipt and separately approved audit class', () => {
    const migration = source('../../backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql');
    const sqlTest = source('../../backend/supabase/tests/g014_retention_adapters_receipts.sql');
    const finalizerStart = migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.finalize_privacy_retention_run(');
    const finalizer = migration.slice(finalizerStart, migration.indexOf('$function$;', finalizerStart));

    expect(migration).toContain("('privacy_retention_run_audit', 'disabled')");
    expect(migration).toContain("'privacy_retention_run_audit'");
    expect(migration).toContain("public.privacy_resolve_audit_retention_until(\n    'privacy_retention_run_audit',");
    expect(finalizer).not.toContain('v_readback := v_expected > 0');
    expect(finalizer).toContain('v_run.scanned_count = 0');
    expect(finalizer).toContain('v_empty_scan_complete');
    expect(finalizer).toContain("item.status IN ('pending', 'failed', 'claimed')");
    expect(finalizer).toContain('v_run.planned_count = 0');
    expect(finalizer).toContain('v_run.held_count = 0');
    expect(finalizer).toContain("WHEN v_readback THEN 'completed'");

    expect(sqlTest).toContain('$retention_run_audit_class_required$');
    expect(sqlTest).toContain('privacy_audit_retention_policy_required');
    expect(sqlTest).toContain('$retention_run_audit_class_contract$');
    expect(sqlTest).toContain('$empty_healthy_retention_runs$');
    expect(sqlTest).toContain('healthy empty retention replay was not idempotent');
    expect(sqlTest).toContain('completed empty retention run blocked a future class schedule');
    expect(sqlTest).toContain("retention_period = interval '90 days'");
  });
});
