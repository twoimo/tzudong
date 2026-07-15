import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PRIVACY_RETENTION_ENDPOINT,
  canonicalUtcCutoff,
  deriveIdempotencyKey,
  parseScheduleConfig,
  runPrivacyRetentionSchedule,
} from '../scripts/run-privacy-retention-schedule.mjs';
import {
  applyRetentionRun,
  type PrivacyRetentionRpcClient,
} from '../lib/privacy/retention-runner';

const ROOT = resolve(import.meta.dir, '..');

describe('privacy retention production schedule', () => {
  test('uses a canonical UTC cutoff and deterministic bound retry key', () => {
    expect(canonicalUtcCutoff(new Date('2026-07-12T19:45:00.000Z'))).toBe('2026-07-12T00:00:00.000Z');
    const input = {
      operationId: '00000000-0000-4000-8000-000000000001',
      previewHash: 'a'.repeat(64),
      adapterVersion: 'b'.repeat(64),
      sourceMappingVersion: 'c'.repeat(64),
      classCode: 'privacy_identity_audit',
      cutoff: '2026-07-12T00:00:00.000Z',
    };
    expect(deriveIdempotencyKey(input)).toBe(deriveIdempotencyKey(input));
    expect(deriveIdempotencyKey(input)).toMatch(/^retention:[0-9a-f]{64}$/);
    expect(() => deriveIdempotencyKey({
      ...input,
      adapterVersion: 'retention-adapter-2026.07.13',
    })).toThrow('privacy_retention_schedule_idempotency_invalid');
    expect(() => deriveIdempotencyKey({
      ...input,
      sourceMappingVersion: input.sourceMappingVersion.toUpperCase(),
    })).toThrow('privacy_retention_schedule_idempotency_invalid');
  });
  test('forwards only exact preview hash bindings through apply and final readback', async () => {
    const adapterVersion = 'b'.repeat(64);
    const sourceMappingVersion = 'c'.repeat(64);
    const operationId = '00000000-0000-4000-8000-000000000001';
    const previewHash = 'a'.repeat(64);
    const cutoff = '2026-07-12T00:00:00.000Z';
    const requests: Array<Record<string, unknown>> = [];
    const fetchImplementation = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push(body);
      const payload = body.action === 'preview'
        ? {
            ok: true,
            preview: {
              operationId,
              previewHash,
              adapterVersion,
              sourceMappingVersion,
              expiresAt: '2026-07-12T00:15:00.000Z',
              summary: { cutoff, eligible: 1, held: 0, scanned: 1 },
              requiredConfirmation: '보존·분리 적용',
            },
          }
        : {
            ok: true,
            receipt: {
              operationId,
              status: 'applied',
              adapterVersion,
              sourceMappingVersion,
              readback: {
                passed: true,
                checks: {
                  expectedCountMatched: true,
                  databaseSourceAbsent: true,
                  storageProviderAbsent: true,
                  noActiveHoldMutated: true,
                },
              },
              auditId: '00000000-0000-4000-8000-000000000002',
              errorCode: null,
            },
          };
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(runPrivacyRetentionSchedule({
      env: {
        NODE_ENV: 'production',
        PRIVACY_RETENTION_SCHEDULED_RUN: 'true',
        PRIVACY_RETENTION_ENDPOINT,
        PRIVACY_RETENTION_INTERNAL_CAPABILITY: 'x'.repeat(32),
        PRIVACY_RETENTION_CLASS_CODES: 'privacy_identity_audit',
      },
      fetchImplementation,
      now: new Date('2026-07-12T19:45:00.000Z'),
      log: () => undefined,
    })).resolves.toEqual({
      cutoff,
      results: [{
        classCode: 'privacy_identity_audit',
        status: 'applied',
        cutoff,
        eligible: 1,
        held: 0,
        scanned: 1,
      }],
    });
    expect(requests[1]).toMatchObject({
      action: 'apply',
      operationId,
      previewHash,
      adapterVersion,
      sourceMappingVersion,
    });
    expect(Object.keys(requests[1] ?? {}).sort()).toEqual([
      'action',
      'adapterVersion',
      'batchSize',
      'confirmationText',
      'idempotencyKey',
      'operationId',
      'previewHash',
      'sourceMappingVersion',
    ]);
  });
  test('preserves a SQL applied-null receipt through runner, route serialization, and scheduler parsing', async () => {
    const operationId = '00000000-0000-4000-8000-000000000011';
    const auditId = '00000000-0000-4000-8000-000000000012';
    const previewHash = 'a'.repeat(64);
    const adapterVersion = 'b'.repeat(64);
    const sourceMappingVersion = 'c'.repeat(64);
    const cutoff = '2026-07-12T00:00:00.000Z';
    const checks = {
      expectedCountMatched: true,
      databaseSourceAbsent: true,
      storageProviderAbsent: true,
      noActiveHoldMutated: true,
    };
    const preview = {
      operationId,
      previewHash,
      adapterVersion,
      sourceMappingVersion,
      expiresAt: '2026-07-12T00:15:00.000Z',
      summary: { cutoff, eligible: 1, held: 0, scanned: 1 },
      requiredConfirmation: '보존·분리 적용',
    };
    const sqlApplyReceipt = {
      operationId,
      status: 'partial',
      adapterVersion,
      sourceMappingVersion,
      readback: {
        passed: false,
        checks: {
          expectedCountMatched: false,
          databaseSourceAbsent: true,
          storageProviderAbsent: false,
          noActiveHoldMutated: true,
        },
      },
      auditId,
      errorCode: null,
    };
    const sqlFinalReceipt = {
      operationId,
      status: 'applied',
      adapterVersion,
      sourceMappingVersion,
      readback: { passed: true, checks },
      auditId,
      errorCode: null,
    };
    const serializedRouteResponses: string[] = [];
    const fetchImplementation = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.action === 'preview') {
        return new Response(JSON.stringify({ ok: true, preview }), {
          headers: { 'content-type': 'application/json' },
        });
      }

      const rpc: PrivacyRetentionRpcClient = {
        rpc: async (name) => {
          switch (name) {
            case 'confirm_privacy_retention_run':
              return {
                data: { operationId, status: 'confirmed', adapterVersion, sourceMappingVersion },
                error: null,
              };
            case 'apply_privacy_retention_run':
              return { data: sqlApplyReceipt, error: null };
            case 'finalize_privacy_retention_run':
              return { data: sqlFinalReceipt, error: null };
            default:
              throw new Error(`unexpected RPC ${name}`);
          }
        },
      };
      const receipt = await applyRetentionRun(rpc, {
        operationId: String(body.operationId),
        previewHash: String(body.previewHash),
        confirmationText: String(body.confirmationText),
        idempotencyKey: String(body.idempotencyKey),
        adapterVersion: String(body.adapterVersion),
        sourceMappingVersion: String(body.sourceMappingVersion),
        batchSize: Number(body.batchSize),
      });
      const routeBody = JSON.stringify({ ok: true, receipt });
      serializedRouteResponses.push(routeBody);
      return new Response(routeBody, {
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(runPrivacyRetentionSchedule({
      env: {
        NODE_ENV: 'production',
        PRIVACY_RETENTION_SCHEDULED_RUN: 'true',
        PRIVACY_RETENTION_ENDPOINT,
        PRIVACY_RETENTION_INTERNAL_CAPABILITY: 'x'.repeat(32),
        PRIVACY_RETENTION_CLASS_CODES: 'privacy_identity_audit',
      },
      fetchImplementation,
      now: new Date('2026-07-12T19:45:00.000Z'),
      log: () => undefined,
    })).resolves.toEqual({
      cutoff,
      results: [{
        classCode: 'privacy_identity_audit',
        status: 'applied',
        cutoff,
        eligible: 1,
        held: 0,
        scanned: 1,
      }],
    });
    expect(JSON.parse(serializedRouteResponses[0] ?? '{}')).toEqual({
      ok: true,
      receipt: sqlFinalReceipt,
    });
  });

  test('rejects missing, extra, and inconsistent final receipt fields', async () => {
    const operationId = '00000000-0000-4000-8000-000000000021';
    const previewHash = 'a'.repeat(64);
    const adapterVersion = 'b'.repeat(64);
    const sourceMappingVersion = 'c'.repeat(64);
    const cutoff = '2026-07-12T00:00:00.000Z';
    const preview = {
      operationId,
      previewHash,
      adapterVersion,
      sourceMappingVersion,
      expiresAt: '2026-07-12T00:15:00.000Z',
      summary: { cutoff, eligible: 1, held: 0, scanned: 1 },
      requiredConfirmation: '보존·분리 적용',
    };
    const passedChecks = {
      expectedCountMatched: true,
      databaseSourceAbsent: true,
      storageProviderAbsent: true,
      noActiveHoldMutated: true,
    };
    const failedChecks = {
      expectedCountMatched: false,
      databaseSourceAbsent: true,
      storageProviderAbsent: true,
      noActiveHoldMutated: true,
    };
    const validReceipt = {
      operationId,
      status: 'applied',
      adapterVersion,
      sourceMappingVersion,
      readback: { passed: true, checks: passedChecks },
      auditId: '00000000-0000-4000-8000-000000000022',
      errorCode: null,
    };
    const { errorCode: _errorCode, ...missingErrorCode } = validReceipt;
    const runWithReceipt = (receipt: unknown) => runPrivacyRetentionSchedule({
      env: {
        NODE_ENV: 'production',
        PRIVACY_RETENTION_SCHEDULED_RUN: 'true',
        PRIVACY_RETENTION_ENDPOINT,
        PRIVACY_RETENTION_INTERNAL_CAPABILITY: 'x'.repeat(32),
        PRIVACY_RETENTION_CLASS_CODES: 'privacy_identity_audit',
      },
      fetchImplementation: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify(
          body.action === 'preview'
            ? { ok: true, preview }
            : { ok: true, receipt },
        ), { headers: { 'content-type': 'application/json' } });
      },
      now: new Date('2026-07-12T19:45:00.000Z'),
      log: () => undefined,
    });

    for (const { receipt, code } of [
      {
        receipt: { ...validReceipt, errorCode: 'privacy_retention_readback_incomplete' },
        code: 'privacy_retention_schedule_receipt_invalid',
      },
      {
        receipt: { ...validReceipt, readback: { passed: false, checks: failedChecks } },
        code: 'privacy_retention_schedule_receipt_invalid',
      },
      {
        receipt: missingErrorCode,
        code: 'privacy_retention_schedule_receipt_invalid',
      },
      {
        receipt: { ...validReceipt, extra: true },
        code: 'privacy_retention_schedule_receipt_invalid',
      },
      {
        receipt: {
          ...validReceipt,
          status: 'partial',
          readback: { passed: true, checks: passedChecks },
          errorCode: 'privacy_retention_readback_incomplete',
        },
        code: 'privacy_retention_schedule_readback_failed',
      },
      {
        receipt: {
          ...validReceipt,
          status: 'failed',
          readback: { passed: false, checks: failedChecks },
          errorCode: null,
        },
        code: 'privacy_retention_schedule_readback_failed',
      },
    ]) {
      await expect(runWithReceipt(receipt)).rejects.toMatchObject({ code });
    }
  });

  test('fails closed outside the exact production endpoint and capability contract', () => {
    const valid = {
      NODE_ENV: 'production',
      PRIVACY_RETENTION_SCHEDULED_RUN: 'true',
      PRIVACY_RETENTION_ENDPOINT,
      PRIVACY_RETENTION_INTERNAL_CAPABILITY: 'x'.repeat(32),
      PRIVACY_RETENTION_CLASS_CODES: 'privacy_identity_audit,privacy_incident_audit',
    };
    expect(parseScheduleConfig(valid)).toEqual({
      endpoint: PRIVACY_RETENTION_ENDPOINT,
      capability: 'x'.repeat(32),
      classCodes: ['privacy_identity_audit', 'privacy_incident_audit'],
    });
    expect(() => parseScheduleConfig({ ...valid, NODE_ENV: 'test' })).toThrow('privacy_retention_schedule_not_production');
    expect(() => parseScheduleConfig({ ...valid, PRIVACY_RETENTION_ENDPOINT: 'https://example.com/' })).toThrow('privacy_retention_schedule_not_production');
    expect(() => parseScheduleConfig({ ...valid, PRIVACY_RETENTION_INTERNAL_CAPABILITY: 'short' })).toThrow('privacy_retention_schedule_capability_invalid');
  });

  test('keeps scheduled orchestration storage-blind and its internal endpoint binding-strict', () => {
    const workflow = readFileSync(resolve(ROOT, '../../.github/workflows/privacy-retention.yml'), 'utf8');
    const script = readFileSync(resolve(ROOT, 'scripts/run-privacy-retention-schedule.mjs'), 'utf8');
    const runner = readFileSync(resolve(ROOT, 'lib/privacy/retention-runner.ts'), 'utf8');
    const route = readFileSync(resolve(ROOT, 'app/api/internal/privacy-retention/route.ts'), 'utf8');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('push:');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('SUPABASE_SERVICE_ROLE');
    expect(script).toContain("redirect: 'error'");
    expect(script).toContain("credentials: 'omit'");
    expect(script).toContain("referrerPolicy: 'no-referrer'");
    expect(script).toContain("confirmationText: CONFIRMATION_TEXT");
    expect(script).toContain('adapterVersion: preview.adapterVersion');
    expect(script).toContain('sourceMappingVersion: preview.sourceMappingVersion');
    expect(script).toContain('parseReceipt(await postRetention');
    expect(script).toContain("receipt.readback.passed !== true");
    expect(script).not.toContain('supabase.storage');
    expect(script).not.toContain('objectName');
    expect(script).not.toContain('bucketName');
    expect(runner).toContain('const HASH_PATTERN = /^[0-9a-f]{64}$/;');
    expect(runner).not.toContain('VERSION_PATTERN');
    expect(route).toContain("'adapterVersion', 'sourceMappingVersion'");
    expect(route).toContain('adapterVersion: body.adapterVersion');
    expect(route).toContain('sourceMappingVersion: body.sourceMappingVersion');
  });
});
