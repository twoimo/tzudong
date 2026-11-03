import { expect, test } from 'bun:test';
import { canRenewRecoveryPreview, RecoveryJobSchema, RecoveryRequestSchema, RecoveryStatusSchema } from '../lib/admin/evaluation-recovery';

const id = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const draft = { schemaVersion: 1, jobId, restaurantId: id, policyVersion: 2, rowSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64),
  videoId: 'ABCDEFGHIJK', resultSha256: 'c'.repeat(64), state: 'draft', reason: 'evidence_ready', receipt: null,
  requestOperationId: jobId, applyOperationId: operationId, retireOperationId: null, proposal: null };
const receipt = { operationId, action: 'restaurant.evidence_recovery.apply', state: 'preview', targetIds: [id], jobId,
  auditId: null, previewHash: 'd'.repeat(64), expiresAt: '2026-11-04T00:00:00Z',
  readback: [{ id, kind: 'restaurant', status: 'hold', fingerprint: 'a'.repeat(64) }], mediaCleanupPending: false,
  policyVersion: 2, rowSha256: draft.rowSha256, inputSha256: draft.inputSha256, videoId: draft.videoId };
const job = () => RecoveryStatusSchema.parse({ schemaVersion: 1, restaurantId: id, jobs: [draft] }).jobs[0];

// Strip status-only fields without relying on schema defaults.
const reconciledRead = () => {
  const { requestOperationId: _request, applyOperationId: _apply, retireOperationId: _retire, proposal: _proposal, ...value } = draft;
  void _request; void _apply; void _retire; void _proposal;
  return RecoveryJobSchema.parse({ ...value, receipt });
};
const now = Date.parse('2026-11-04T00:01:00Z');

test('expired apply is renewable only after confirmed unapplied same-result read', () => {
  expect(canRenewRecoveryPreview(job(), undefined, 'apply', now)).toBe(false);
  expect(canRenewRecoveryPreview(job(), reconciledRead(), 'apply', now)).toBe(true);
  expect(canRenewRecoveryPreview(job(), reconciledRead(), 'apply', now - 120_000)).toBe(false);
  expect(canRenewRecoveryPreview(job(), { ...reconciledRead(), receipt: null }, 'apply', now)).toBe(false);
});

test('applied, uncertain, stale result/source and different operation never release identity', () => {
  for (const prior of [
    { ...reconciledRead(), state: 'applied' as const }, { ...reconciledRead(), state: 'uncertain' as const },
    { ...reconciledRead(), resultSha256: 'e'.repeat(64) }, { ...reconciledRead(), rowSha256: 'e'.repeat(64) },
    { ...reconciledRead(), inputSha256: 'e'.repeat(64) }, { ...reconciledRead(), policyVersion: 3 },
    { ...reconciledRead(), receipt: { ...reconciledRead().receipt!, state: 'applied' as const, auditId: operationId } },
    { ...reconciledRead(), receipt: { ...reconciledRead().receipt!, operationId: jobId } },
  ]) expect(canRenewRecoveryPreview(job(), prior, 'apply', now)).toBe(false);
  expect(canRenewRecoveryPreview({ ...job(), state: 'applied' }, reconciledRead(), 'apply', now)).toBe(false);
});

test('retirement has its own exact confirmation and current-policy-bound receipt', () => {
  const input = { phase: 'retire', operationId, jobId, restaurantId: id, policyVersion: 2, rowSha256: draft.rowSha256,
    inputSha256: draft.inputSha256, previewHash: 'd'.repeat(64) };
  expect(RecoveryRequestSchema.safeParse({ ...input, confirmation: 'APPLY EVIDENCE RECOVERY' }).success).toBe(false);
  expect(RecoveryRequestSchema.safeParse({ ...input, confirmation: 'RETIRE STALE EVIDENCE RECOVERY' }).success).toBe(true);
  expect(RecoveryRequestSchema.safeParse({ ...input, phase: 'preview_retire', confirmation: 'RETIRE STALE EVIDENCE RECOVERY' }).success).toBe(false);
  const prior = reconciledRead();
  expect(RecoveryJobSchema.safeParse({ ...prior, receipt: { ...receipt, action: 'restaurant.evidence_recovery.retire' } }).success).toBe(false);
  const retiredRead = RecoveryJobSchema.parse({ ...prior, receipt: { ...receipt, action: 'restaurant.evidence_recovery.retire', retirementPolicyVersion: 3 } });
  expect(canRenewRecoveryPreview({ ...job(), applyOperationId: null, retireOperationId: operationId }, retiredRead, 'retire', now)).toBe(true);
  expect(canRenewRecoveryPreview(job(), retiredRead, 'apply', now)).toBe(false);
});
