import 'server-only';

import type { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { parseReceiptOcrWorkflowPolicy } from '@/lib/ocr/workflow-policy';

export const RECEIPT_OCR_RECOVERY_CAPABILITY_VERSION = 'receipt-ocr-indeterminate-recovery-v1';
export const ADMIN_RECEIPT_OCR_PROMPT_VERSION = 'admin-receipt-summary-v1';
export const ADMIN_RECEIPT_OCR_PREPROCESS_VERSION = 'admin-canonical-jpeg-v2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

type SupabaseAdmin = ReturnType<typeof createSupabaseServiceRoleClient>;

export type ReceiptOcrRecoveryPreview = {
  schemaVersion: 1;
  status: 'eligible' | 'processing' | 'not_indeterminate' | 'recovery_in_progress' | 'conflict';
  reviewId: string;
  expectedGeneration: string | null;
  inputSnapshotHash: string | null;
  recoveryOperationId: string | null;
};

export type ReceiptOcrRecoveryApply =
  | {
      schemaVersion: 1;
      status: 'rotated';
      reviewId: string;
      operationId: string;
      previousGeneration: string;
      generation: string;
      inputSnapshotHash: string;
      idempotent: boolean;
      providerOutcomeCertain: false;
      modelPolicy: string[];
      thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    }
  | {
      schemaVersion: 1;
      status: 'processing' | 'not_indeterminate' | 'conflict' | 'stale_operation';
      reviewId: string;
      operationId: string;
    };

export class ReceiptOcrRecoveryCapabilityHeldError extends Error {
  readonly code = 'FEATURE_DATABASE_HELD';

  constructor() {
    super('FEATURE_DATABASE_HELD');
    this.name = 'ReceiptOcrRecoveryCapabilityHeldError';
  }
}

export class ReceiptOcrRecoveryPersistenceError extends Error {
  constructor() {
    super('OCR_RECOVERY_PERSISTENCE_FAILED');
    this.name = 'ReceiptOcrRecoveryPersistenceError';
  }
}

export type ReceiptOcrExecutionAuthorization = {
  schemaVersion: 1;
  status: 'allowed_normal' | 'allowed_recovery';
  reviewId: string;
  generation: string;
  recoveryOperationId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID.test(value));
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SHA256.test(value));
}

export function isReceiptOcrRecoveryOperationId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isReceiptOcrRecoverySnapshotHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

export async function assertReceiptOcrRecoveryCapabilityReady(client: SupabaseAdmin): Promise<void> {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc('get_receipt_ocr_indeterminate_recovery_capability', {});
  } catch {
    throw new ReceiptOcrRecoveryCapabilityHeldError();
  }
  const { data, error } = response;
  if (error || !isRecord(data)
    || !hasOnlyKeys(data, ['schema_version', 'status', 'capability_version'])
    || data.schema_version !== 1
    || data.status !== 'ready'
    || data.capability_version !== RECEIPT_OCR_RECOVERY_CAPABILITY_VERSION) {
    throw new ReceiptOcrRecoveryCapabilityHeldError();
  }
}

export async function previewReceiptOcrIndeterminateRecovery(
  client: SupabaseAdmin,
  reviewId: string,
): Promise<ReceiptOcrRecoveryPreview> {
  if (!UUID.test(reviewId)) throw new ReceiptOcrRecoveryPersistenceError();
  await assertReceiptOcrRecoveryCapabilityReady(client);
  const { data, error } = await client.rpc('preview_review_receipt_ocr_indeterminate_recovery', {
    p_review_id: reviewId,
  });
  if (error || !isRecord(data)
    || !hasOnlyKeys(data, [
      'schema_version', 'status', 'review_id', 'expected_generation',
      'input_snapshot_hash', 'recovery_operation_id',
    ])
    || data.schema_version !== 1
    || !['eligible', 'processing', 'not_indeterminate', 'recovery_in_progress', 'conflict'].includes(String(data.status))
    || data.review_id !== reviewId
    || !isNullableUuid(data.expected_generation)
    || !isNullableSha256(data.input_snapshot_hash)
    || !isNullableUuid(data.recovery_operation_id)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  if ((data.status === 'eligible' || data.status === 'recovery_in_progress')
    && (!data.expected_generation || !data.input_snapshot_hash)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  if (data.status === 'recovery_in_progress' && !data.recovery_operation_id) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  return {
    schemaVersion: 1,
    status: data.status as ReceiptOcrRecoveryPreview['status'],
    reviewId,
    expectedGeneration: data.expected_generation,
    inputSnapshotHash: data.input_snapshot_hash,
    recoveryOperationId: data.recovery_operation_id,
  };
}

export async function applyReceiptOcrIndeterminateRecovery(
  client: SupabaseAdmin,
  input: {
    actorUserId: string;
    reviewId: string;
    recoveryOperationId: string;
    expectedGeneration: string;
    inputSnapshotHash: string;
    modelPolicy: readonly string[];
    thinkingLevel: string;
    promptVersion: string;
    preprocessVersion: string;
    normalizationVersion: string;
  },
): Promise<ReceiptOcrRecoveryApply> {
  if (!UUID.test(input.actorUserId)
    || !UUID.test(input.reviewId)
    || !UUID.test(input.recoveryOperationId)
    || !UUID.test(input.expectedGeneration)
    || !SHA256.test(input.inputSnapshotHash)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  let policy;
  try {
    policy = parseReceiptOcrWorkflowPolicy(JSON.stringify(input.modelPolicy), input.thinkingLevel);
  } catch {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  if (input.promptVersion !== ADMIN_RECEIPT_OCR_PROMPT_VERSION
    || input.preprocessVersion !== ADMIN_RECEIPT_OCR_PREPROCESS_VERSION
    || !/^receipt-normalization-v[1-9]\d*$/.test(input.normalizationVersion)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  await assertReceiptOcrRecoveryCapabilityReady(client);
  const { data, error } = await client.rpc('recover_review_receipt_ocr_indeterminate', {
    p_actor_user_id: input.actorUserId,
    p_review_id: input.reviewId,
    p_recovery_operation_id: input.recoveryOperationId,
    p_expected_generation: input.expectedGeneration,
    p_input_snapshot_hash: input.inputSnapshotHash,
    p_model_policy: policy.modelPolicy,
    p_thinking_level: policy.inferenceConfig.thinkingLevel,
    p_prompt_version: input.promptVersion,
    p_preprocess_version: input.preprocessVersion,
    p_normalization_version: input.normalizationVersion,
  });
  if (error || !isRecord(data) || data.schema_version !== 1 || data.review_id !== input.reviewId
    || data.operation_id !== input.recoveryOperationId) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  if (data.status === 'rotated') {
    if (!hasOnlyKeys(data, [
      'schema_version', 'status', 'review_id', 'operation_id', 'previous_generation',
      'generation', 'input_snapshot_hash', 'idempotent', 'provider_outcome_certain',
      'model_policy', 'thinking_level',
    ])
      || !isReceiptOcrRecoveryOperationId(data.previous_generation)
      || !isReceiptOcrRecoveryOperationId(data.generation)
      || data.previous_generation !== input.expectedGeneration
      || data.generation === input.expectedGeneration
      || data.input_snapshot_hash !== input.inputSnapshotHash
      || typeof data.idempotent !== 'boolean'
      || data.provider_outcome_certain !== false) {
      throw new ReceiptOcrRecoveryPersistenceError();
    }
    let boundPolicy;
    try {
      boundPolicy = parseReceiptOcrWorkflowPolicy(
        JSON.stringify(data.model_policy),
        String(data.thinking_level),
      );
    } catch {
      throw new ReceiptOcrRecoveryPersistenceError();
    }
    const returnedPolicyMatchesRequest = boundPolicy.inferenceConfig.thinkingLevel
      === policy.inferenceConfig.thinkingLevel
      && boundPolicy.modelPolicy.length === policy.modelPolicy.length
      && boundPolicy.modelPolicy.every((model, index) => model === policy.modelPolicy[index]);
    if (!data.idempotent && !returnedPolicyMatchesRequest) {
      throw new ReceiptOcrRecoveryPersistenceError();
    }
    return {
      schemaVersion: 1,
      status: 'rotated',
      reviewId: input.reviewId,
      operationId: input.recoveryOperationId,
      previousGeneration: data.previous_generation,
      generation: data.generation,
      inputSnapshotHash: data.input_snapshot_hash,
      idempotent: data.idempotent,
      providerOutcomeCertain: false,
      modelPolicy: [...boundPolicy.modelPolicy],
      thinkingLevel: boundPolicy.inferenceConfig.thinkingLevel,
    };
  }
  if (!['processing', 'not_indeterminate', 'conflict', 'stale_operation'].includes(String(data.status))
    || !hasOnlyKeys(data, ['schema_version', 'status', 'review_id', 'operation_id'])) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  return {
    schemaVersion: 1,
    status: data.status as Exclude<ReceiptOcrRecoveryApply, { status: 'rotated' }>['status'],
    reviewId: input.reviewId,
    operationId: input.recoveryOperationId,
  };
}

export async function authorizeReceiptOcrExecution(
  client: SupabaseAdmin,
  input: {
    userId: string;
    reviewId: string;
    generation: string;
    recoveryOperationId: string | null;
    verificationPhotoHash: string;
    imageHash: string;
    inputContextHash: string;
    modelPolicy: readonly string[];
    thinkingLevel: string;
    promptVersion: string;
    preprocessVersion: string;
    normalizationVersion: string;
  },
): Promise<ReceiptOcrExecutionAuthorization> {
  if (![input.userId, input.reviewId, input.generation].every(value => UUID.test(value))
    || (input.recoveryOperationId !== null && !UUID.test(input.recoveryOperationId))
    || ![input.verificationPhotoHash, input.imageHash, input.inputContextHash].every(value => SHA256.test(value))
    || input.promptVersion !== ADMIN_RECEIPT_OCR_PROMPT_VERSION
    || input.preprocessVersion !== ADMIN_RECEIPT_OCR_PREPROCESS_VERSION
    || !/^receipt-normalization-v[1-9]\d*$/.test(input.normalizationVersion)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  let policy;
  try {
    policy = parseReceiptOcrWorkflowPolicy(JSON.stringify(input.modelPolicy), input.thinkingLevel);
  } catch {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  await assertReceiptOcrRecoveryCapabilityReady(client);
  const { data, error } = await client.rpc('authorize_review_receipt_ocr_execution', {
    p_user_id: input.userId,
    p_review_id: input.reviewId,
    p_generation: input.generation,
    p_recovery_operation_id: input.recoveryOperationId,
    p_verification_photo_hash: input.verificationPhotoHash,
    p_image_hash: input.imageHash,
    p_input_context_hash: input.inputContextHash,
    p_model_policy: policy.modelPolicy,
    p_thinking_level: policy.inferenceConfig.thinkingLevel,
    p_prompt_version: input.promptVersion,
    p_preprocess_version: input.preprocessVersion,
    p_normalization_version: input.normalizationVersion,
  });
  if (error || !isRecord(data)
    || !hasOnlyKeys(data, ['schema_version', 'status', 'review_id', 'generation', 'recovery_operation_id'])
    || data.schema_version !== 1
    || !['allowed_normal', 'allowed_recovery'].includes(String(data.status))
    || data.review_id !== input.reviewId
    || data.generation !== input.generation
    || !isNullableUuid(data.recovery_operation_id)
    || (data.status === 'allowed_normal' && data.recovery_operation_id !== null)
    || (data.status === 'allowed_recovery' && data.recovery_operation_id !== input.recoveryOperationId)) {
    throw new ReceiptOcrRecoveryPersistenceError();
  }
  return {
    schemaVersion: 1,
    status: data.status as ReceiptOcrExecutionAuthorization['status'],
    reviewId: input.reviewId,
    generation: input.generation,
    recoveryOperationId: data.recovery_operation_id,
  };
}
