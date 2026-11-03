import { z } from 'zod';

export const EVALUATION_RECOVERY_ENDPOINT = '/api/admin/evaluations/recovery';
export const RECOVERY_CONFIRMATIONS = { request: 'REQUEST EVIDENCE RECOVERY', apply: 'APPLY EVIDENCE RECOVERY' } as const;
const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9][0-9]{0,18}$/)]);
const date = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const video = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

const binding = { restaurantId: uuid, policyVersion: version, rowSha256: sha, inputSha256: sha };
export const RecoveryContextSchema = z.strictObject({ schemaVersion: z.literal(1), ...binding, videoId: video, originName: z.string().min(1).max(160), sourceUpdatedAt: date });
export type RecoveryContext = z.infer<typeof RecoveryContextSchema>;

export const RecoveryProposalSchema = z.strictObject({
  evaluation_results: z.record(z.string().max(64), z.unknown()), geocoding_success: z.boolean(),
  categories: z.array(z.string().min(1).max(160)).min(1).max(15),
  geocoding_false_stage: z.number().int().nonnegative().nullable().optional(),
  lat: z.number().finite().min(-90).max(90).nullable().optional(), lng: z.number().finite().min(-180).max(180).nullable().optional(),
  road_address: z.string().max(4000).nullable().optional(), jibun_address: z.string().max(4000).nullable().optional(),
  english_address: z.string().max(4000).nullable().optional(), naver_name: z.string().max(4000).nullable().optional(),
  google_name: z.string().max(4000).nullable().optional(),
  address_elements: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable().optional(),
});
export type RecoveryProposal = z.infer<typeof RecoveryProposalSchema>;

const actions = z.enum(['restaurant.evidence_recovery.request', 'restaurant.evidence_recovery.apply']);
export const RecoveryReceiptSchema = z.strictObject({
  operationId: uuid, action: actions, state: z.enum(['preview', 'applied']), targetIds: z.array(uuid).length(1),
  jobId: uuid, auditId: uuid.nullable(), previewHash: sha, expiresAt: date,
  readback: z.array(z.strictObject({ id: uuid, kind: z.literal('restaurant'), status: z.string().max(64), fingerprint: sha })).length(1),
  mediaCleanupPending: z.literal(false), policyVersion: version, rowSha256: sha, inputSha256: sha, videoId: video,
});
export const RecoveryJobSchema = z.strictObject({
  schemaVersion: z.literal(1), jobId: uuid, state: z.enum(['preview', 'queued', 'running', 'draft', 'applied', 'failed', 'uncertain']),
  reason: z.string().regex(/^[a-z_]{1,64}$/), ...binding, videoId: video, resultSha256: sha.nullable(),
  receipt: RecoveryReceiptSchema.nullable(),
});
export type RecoveryJob = z.infer<typeof RecoveryJobSchema>;
export const RecoveryStatusSchema = z.strictObject({
  schemaVersion: z.literal(1), restaurantId: uuid,
  jobs: z.array(RecoveryJobSchema.extend({
    requestOperationId: uuid, applyOperationId: uuid.nullable(), proposal: RecoveryProposalSchema.nullable(),
  })).max(5),
});
export type RecoveryStatus = z.infer<typeof RecoveryStatusSchema>;

export const RecoveryRequestSchema = z.strictObject({
  phase: z.enum(['preview_request', 'request', 'read', 'preview_apply', 'apply']),
  operationId: uuid, jobId: uuid, restaurantId: uuid,
  policyVersion: version.optional(), rowSha256: sha.optional(), inputSha256: sha.optional(),
  previewHash: sha.optional(), confirmation: z.string().max(64).optional(),
}).superRefine((value, ctx) => {
  if (value.phase === 'read') {
    if (value.previewHash !== undefined || value.confirmation !== undefined) ctx.addIssue({ code: 'custom', message: 'read_only' });
    return;
  }
  if (value.policyVersion === undefined || !value.rowSha256 || !value.inputSha256) ctx.addIssue({ code: 'custom', message: 'binding_required' });
  if (value.phase === 'preview_request' || value.phase === 'preview_apply') {
    if (value.previewHash !== undefined || value.confirmation !== undefined) ctx.addIssue({ code: 'custom', message: 'preview_only' });
  } else if (!value.previewHash || value.confirmation !== RECOVERY_CONFIRMATIONS[value.phase]) {
    ctx.addIssue({ code: 'custom', message: 'confirmation_required' });
  }
});
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;

export const RECOVERY_ERROR_CODES = [
  'EVIDENCE_RECOVERY_FORBIDDEN', 'EVIDENCE_RECOVERY_POLICY_CHANGED', 'EVIDENCE_RECOVERY_NOT_FOUND',
  'EVIDENCE_RECOVERY_PROTECTED', 'EVIDENCE_RECOVERY_SOURCE_REQUIRED', 'EVIDENCE_RECOVERY_STALE',
  'EVIDENCE_RECOVERY_WORK_OUTSTANDING', 'EVIDENCE_RECOVERY_INVALID_PAYLOAD', 'EVIDENCE_RECOVERY_CONFIRMATION_REQUIRED',
  'EVIDENCE_RECOVERY_IDEMPOTENCY_CONFLICT', 'EVIDENCE_RECOVERY_PREVIEW_MISMATCH', 'EVIDENCE_RECOVERY_PREVIEW_EXPIRED',
  'EVIDENCE_RECOVERY_PREVIEW_REQUIRED', 'EVIDENCE_RECOVERY_JOB_EXISTS', 'EVIDENCE_RECOVERY_DRAFT_REQUIRED',
  'EVIDENCE_RECOVERY_RESULT_CHANGED', 'EVIDENCE_RECOVERY_RESULT_INVALID', 'EVIDENCE_RECOVERY_STATE_CONFLICT',
  'EVIDENCE_RECOVERY_LEASE_EXPIRED', 'EVIDENCE_RECOVERY_READBACK_FAILED', 'EVIDENCE_RECOVERY_UNAVAILABLE',
  'EVIDENCE_RECOVERY_NOT_ADMITTED', 'EVIDENCE_RECOVERY_PRIVACY_UNSAFE',
] as const;
export type RecoveryErrorCode = typeof RECOVERY_ERROR_CODES[number];
export const RecoveryViewSchema = RecoveryStatusSchema.extend({ context: RecoveryContextSchema.nullable(), contextError: z.enum(RECOVERY_ERROR_CODES).nullable() });
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;

export function parseRecoveryJob(value: unknown, expected: { jobId: string; restaurantId: string; operationId?: string }): RecoveryJob {
  const job = RecoveryJobSchema.parse(value);
  if (job.jobId !== expected.jobId || job.restaurantId !== expected.restaurantId) throw new Error('EVIDENCE_RECOVERY_RESPONSE_MISMATCH');
  if (expected.operationId && (!job.receipt || job.receipt.operationId !== expected.operationId
    || job.receipt.jobId !== job.jobId || job.receipt.targetIds[0] !== job.restaurantId)) throw new Error('EVIDENCE_RECOVERY_RESPONSE_MISMATCH');
  if (job.receipt && (job.receipt.rowSha256 !== job.rowSha256 || job.receipt.inputSha256 !== job.inputSha256
    || String(job.receipt.policyVersion) !== String(job.policyVersion) || job.receipt.videoId !== job.videoId)) throw new Error('EVIDENCE_RECOVERY_RESPONSE_MISMATCH');
  return job;
}
