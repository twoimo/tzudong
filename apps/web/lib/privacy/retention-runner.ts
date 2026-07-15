export const PRIVACY_RETENTION_CONFIRMATION_TEXT = '보존·분리 적용' as const;
export const MAX_PRIVACY_RETENTION_BATCH_SIZE = 100 as const;
export const MAX_PRIVACY_RETENTION_RUNTIME_MS = 10_000 as const;

export type PrivacyRetentionPreview = Readonly<{
  operationId: string;
  previewHash: string;
  adapterVersion: string;
  sourceMappingVersion: string;
  expiresAt: string;
  summary: Readonly<{
    cutoff: string;
    eligible: number;
    held: number;
    scanned: number;
  }>;
  requiredConfirmation: typeof PRIVACY_RETENTION_CONFIRMATION_TEXT;
}>;

export type PrivacyRetentionReceipt = Readonly<{
  operationId: string;
  status: 'applied' | 'partial' | 'failed';
  adapterVersion: string;
  sourceMappingVersion: string;
  readback: Readonly<{
    passed: boolean;
    checks: Readonly<Record<string, boolean>>;
  }>;
  auditId: string;
  errorCode: string | null;
}>;

export type PrivacyRetentionPreviewInput = Readonly<{
  classCode: string;
  asOf: string;
  batchSize: number;
}>;

export type PrivacyRetentionApplyInput = Readonly<{
  operationId: string;
  previewHash: string;
  confirmationText: string;
  idempotencyKey: string;
  adapterVersion: string;
  sourceMappingVersion: string;
  batchSize: number;
}>;

type RpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type PrivacyRetentionRpcClient = Readonly<{
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<RpcResponse>;
}>;
export type PrivacyRetentionProviderProof = Readonly<{
  providerReceiptRef: string;
  providerReceiptHash: string;
  providerAbsenceHash: string;
}>;

export type PrivacyRetentionProvider = Readonly<{
  verifierRef: string;
  deleteExactVersion: (input: Readonly<{
    bucketName: string;
    objectName: string;
    objectVersionHash: string;
    providerEffectToken: string;
    leaseExpiresAt: string;
  }>) => Promise<void>;
  verifyAbsent: (input: Readonly<{
    objectLocatorHash: string;
    objectVersionHash: string;
    providerEffectToken: string;
  }>) => Promise<PrivacyRetentionProviderProof | null>;
}>;

export type PrivacyRetentionRunnerDependencies = Readonly<{
  provider?: PrivacyRetentionProvider;
}>;

type JsonRecord = Record<string, unknown>;
type DurableBinding = Readonly<{
  operationId: string;
  adapterVersion: string;
  sourceMappingVersion: string;
}>;

export type PrivacyRetentionConfirmation = Readonly<{
  operationId: string;
  status: 'confirmed' | 'applied' | 'partial' | 'failed' | 'held';
  adapterVersion: string;
  sourceMappingVersion: string;
}>;

const CLASS_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROVIDER_REF_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PROVIDER_RECEIPT_REF_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/;
const RETENTION_RECEIPT_ERROR_CODES = [
  'privacy_retention_readback_incomplete',
] as const;
const REQUIRED_READBACK_CHECKS = [
  'expectedCountMatched',
  'databaseSourceAbsent',
  'storageProviderAbsent',
  'noActiveHoldMutated',
] as const;

export class PrivacyRetentionRunnerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PrivacyRetentionRunnerError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: JsonRecord, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const integerAtLeastZero = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const boundedBatchSize = (value: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PRIVACY_RETENTION_BATCH_SIZE) {
    throw new PrivacyRetentionRunnerError('privacy_retention_batch_invalid');
  }
  return value;
};

const canonicalTimestamp = (value: string, code: string): string => {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) {
    throw new PrivacyRetentionRunnerError(code);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PrivacyRetentionRunnerError(code);
  }

  return date.toISOString();
};

const canonicalAsOf = (value: string): string => {
  const timestamp = canonicalTimestamp(value, 'privacy_retention_cutoff_invalid');
  if (new Date(timestamp).getTime() > Date.now()) {
    throw new PrivacyRetentionRunnerError('privacy_retention_cutoff_invalid');
  }
  return timestamp;
};

const safeErrorCode = (_error: unknown): string => 'privacy_retention_operation_failed';

const callRpc = async (
  client: PrivacyRetentionRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  let response: RpcResponse;
  try {
    response = await client.rpc(functionName, args);
  } catch {
    throw new PrivacyRetentionRunnerError('privacy_retention_operation_failed');
  }

  if (!isRecord(response) || response.error) {
    throw new PrivacyRetentionRunnerError(isRecord(response) ? safeErrorCode(response.error) : 'privacy_retention_operation_failed');
  }
  return response.data;
};

const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PrivacyRetentionRunnerError(code);
  }
  return value;
};

const requiredUuid = (value: unknown, code: string): string => {
  const candidate = requiredString(value, code);
  if (!UUID_PATTERN.test(candidate)) throw new PrivacyRetentionRunnerError(code);
  return candidate;
};

const requiredHash = (value: unknown, code: string): string => {
  const candidate = requiredString(value, code);
  if (!HASH_PATTERN.test(candidate)) throw new PrivacyRetentionRunnerError(code);
  return candidate;
};


const parseBinding = (value: JsonRecord, code: string, expected?: DurableBinding): DurableBinding => {
  const binding = {
    operationId: requiredUuid(value.operationId, code),
    adapterVersion: requiredHash(value.adapterVersion, code),
    sourceMappingVersion: requiredHash(value.sourceMappingVersion, code),
  };
  if (
    expected
    && (
      binding.operationId !== expected.operationId
      || binding.adapterVersion !== expected.adapterVersion
      || binding.sourceMappingVersion !== expected.sourceMappingVersion
    )
  ) {
    throw new PrivacyRetentionRunnerError(code);
  }
  return binding;
};
type PrivacyRetentionReceiptPhase = 'apply' | 'final';

const isFixedReceiptErrorCode = (value: unknown): value is string =>
  typeof value === 'string'
  && (RETENTION_RECEIPT_ERROR_CODES as readonly string[]).includes(value);


const parsePreview = (value: unknown): PrivacyRetentionPreview => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'operationId',
      'previewHash',
      'expiresAt',
      'adapterVersion',
      'sourceMappingVersion',
      'summary',
      'requiredConfirmation',
    ])
    || !isRecord(value.summary)
    || !hasExactKeys(value.summary, ['cutoff', 'eligible', 'held', 'scanned'])
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_preview_invalid');
  }

  const binding = parseBinding(value, 'privacy_retention_preview_invalid');
  const eligible = integerAtLeastZero(value.summary.eligible);
  const held = integerAtLeastZero(value.summary.held);
  const scanned = integerAtLeastZero(value.summary.scanned);
  const requiredConfirmation = requiredString(value.requiredConfirmation, 'privacy_retention_preview_invalid');
  const expiresAt = canonicalTimestamp(requiredString(value.expiresAt, 'privacy_retention_preview_invalid'), 'privacy_retention_preview_invalid');
  const cutoff = canonicalAsOf(requiredString(value.summary.cutoff, 'privacy_retention_preview_invalid'));

  if (
    eligible === null
    || held === null
    || scanned === null
    || scanned !== eligible + held
    || requiredConfirmation !== PRIVACY_RETENTION_CONFIRMATION_TEXT
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_preview_invalid');
  }

  return {
    operationId: binding.operationId,
    previewHash: requiredHash(value.previewHash, 'privacy_retention_preview_invalid'),
    adapterVersion: binding.adapterVersion,
    sourceMappingVersion: binding.sourceMappingVersion,
    expiresAt,
    summary: { cutoff, eligible, held, scanned },
    requiredConfirmation: PRIVACY_RETENTION_CONFIRMATION_TEXT,
  };
};

const parseConfirmation = (
  value: unknown,
  expectedBinding: DurableBinding,
): PrivacyRetentionConfirmation => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['operationId', 'status', 'adapterVersion', 'sourceMappingVersion'])
    || !['confirmed', 'applied', 'partial', 'failed', 'held'].includes(value.status as string)
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_confirmation_invalid');
  }

  const binding = parseBinding(value, 'privacy_retention_confirmation_invalid', expectedBinding);
  return {
    operationId: binding.operationId,
    status: value.status as PrivacyRetentionConfirmation['status'],
    adapterVersion: binding.adapterVersion,
    sourceMappingVersion: binding.sourceMappingVersion,
  };
};

const parseReceipt = (
  value: unknown,
  binding: DurableBinding,
  phase: PrivacyRetentionReceiptPhase,
): PrivacyRetentionReceipt => {
  if (
    !isRecord(value)
    || !isRecord(value.readback)
    || !hasExactKeys(value, [
      'operationId',
      'status',
      'readback',
      'auditId',
      'adapterVersion',
      'sourceMappingVersion',
      'errorCode',
    ])
    || !hasExactKeys(value.readback, ['passed', 'checks'])
    || !['applied', 'partial', 'failed'].includes(value.status as string)
    || typeof value.readback.passed !== 'boolean'
    || !isRecord(value.readback.checks)
    || !hasExactKeys(value.readback.checks, REQUIRED_READBACK_CHECKS)
    || (value.errorCode !== null && !isFixedReceiptErrorCode(value.errorCode))
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_receipt_invalid');
  }

  const receiptBinding = parseBinding(value, 'privacy_retention_receipt_invalid', binding);
  const checks: Record<string, boolean> = {};
  for (const key of REQUIRED_READBACK_CHECKS) {
    const check = value.readback.checks[key];
    if (typeof check !== 'boolean') {
      throw new PrivacyRetentionRunnerError('privacy_retention_receipt_invalid');
    }
    checks[key] = check;
  }

  const status = value.status as PrivacyRetentionReceipt['status'];
  const errorCode: string | null = value.errorCode === null
    ? null
    : isFixedReceiptErrorCode(value.errorCode) ? value.errorCode : null;
  const allChecksPassed = Object.values(checks).every((check) => check);
  if (
    (status === 'applied' && (!value.readback.passed || !allChecksPassed || errorCode !== null))
    || (status !== 'applied' && (value.readback.passed || allChecksPassed))
    || (status === 'partial' && (
      phase === 'apply'
        ? errorCode !== null
        : errorCode !== 'privacy_retention_readback_incomplete'
    ))
    || (status === 'failed' && errorCode !== 'privacy_retention_readback_incomplete')
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_receipt_invalid');
  }

  return {
    operationId: receiptBinding.operationId,
    status,
    adapterVersion: receiptBinding.adapterVersion,
    sourceMappingVersion: receiptBinding.sourceMappingVersion,
    readback: { passed: value.readback.passed, checks },
    auditId: requiredUuid(value.auditId, 'privacy_retention_receipt_invalid'),
    errorCode,
  };
};

type ProviderClaim = Readonly<{
  workItemId: string;
  claimToken: string;
  claimHash: string;
  objectLocatorHash: string;
  objectVersionHash: string;
}>;

type ProviderVerificationWork = ProviderClaim & Readonly<{
  providerEffectToken: string;
  verifierRef: string;
}>;

type ProviderDeleteWork = ProviderVerificationWork & Readonly<{
  bucketName: string;
  objectName: string;
  leaseExpiresAt: string;
}>;

const parseProviderClaim = (value: unknown, binding: DurableBinding, code: string): ProviderClaim => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'workItemId',
      'claimToken',
      'objectLocatorHash',
      'objectVersionHash',
      'claimHash',
      'adapterVersion',
      'sourceMappingVersion',
    ])
  ) {
    throw new PrivacyRetentionRunnerError(code);
  }
  parseBinding({
    operationId: binding.operationId,
    adapterVersion: value.adapterVersion,
    sourceMappingVersion: value.sourceMappingVersion,
  }, code, binding);
  return {
    workItemId: requiredUuid(value.workItemId, code),
    claimToken: requiredUuid(value.claimToken, code),
    claimHash: requiredHash(value.claimHash, code),
    objectLocatorHash: requiredHash(value.objectLocatorHash, code),
    objectVersionHash: requiredHash(value.objectVersionHash, code),
  };
};

const parseProviderClaims = (value: unknown, binding: DurableBinding): ProviderClaim[] => {
  if (!Array.isArray(value) || value.length > 1) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_claim_invalid');
  }
  return value.map((claim) => parseProviderClaim(claim, binding, 'privacy_retention_provider_claim_invalid'));
};

const parseProviderVerificationWork = (
  value: unknown,
  binding: DurableBinding,
  code: string,
): ProviderVerificationWork => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'workItemId',
      'claimToken',
      'claimHash',
      'objectLocatorHash',
      'objectVersionHash',
      'adapterVersion',
      'sourceMappingVersion',
      'providerEffectToken',
      'providerVerifierRef',
      'workMode',
    ])
    || value.workMode !== 'verify_absence_only'
  ) {
    throw new PrivacyRetentionRunnerError(code);
  }
  parseBinding({
    operationId: binding.operationId,
    adapterVersion: value.adapterVersion,
    sourceMappingVersion: value.sourceMappingVersion,
  }, code, binding);
  return {
    workItemId: requiredUuid(value.workItemId, code),
    claimToken: requiredUuid(value.claimToken, code),
    claimHash: requiredHash(value.claimHash, code),
    objectLocatorHash: requiredHash(value.objectLocatorHash, code),
    objectVersionHash: requiredHash(value.objectVersionHash, code),
    providerEffectToken: requiredUuid(value.providerEffectToken, code),
    verifierRef: (() => {
      const verifierRef = requiredString(value.providerVerifierRef, code);
      if (!PROVIDER_REF_PATTERN.test(verifierRef)) throw new PrivacyRetentionRunnerError(code);
      return verifierRef;
    })(),
  };
};

const parseProviderReconciliationWork = (
  value: unknown,
  binding: DurableBinding,
): ProviderVerificationWork[] => {
  if (!Array.isArray(value) || value.length > 1) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_reconciliation_invalid');
  }
  return value.map((work) => parseProviderVerificationWork(
    work,
    binding,
    'privacy_retention_provider_reconciliation_invalid',
  ));
};

const parseProviderDeleteWork = (
  value: unknown,
  expected: ProviderClaim,
  binding: DurableBinding,
  verifierRef: string,
): ProviderDeleteWork => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'workItemId',
      'claimToken',
      'claimHash',
      'objectLocatorHash',
      'objectVersionHash',
      'adapterVersion',
      'sourceMappingVersion',
      'providerEffectToken',
      'providerVerifierRef',
      'leaseExpiresAt',
      'bucketName',
      'objectName',
    ])
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_effect_invalid');
  }
  const work = parseProviderVerificationWork({
    workItemId: value.workItemId,
    claimToken: value.claimToken,
    claimHash: value.claimHash,
    objectLocatorHash: value.objectLocatorHash,
    objectVersionHash: value.objectVersionHash,
    adapterVersion: value.adapterVersion,
    sourceMappingVersion: value.sourceMappingVersion,
    providerEffectToken: value.providerEffectToken,
    providerVerifierRef: value.providerVerifierRef,
    workMode: 'verify_absence_only',
  }, binding, 'privacy_retention_provider_effect_invalid');
  const bucketName = requiredString(value.bucketName, 'privacy_retention_provider_effect_invalid');
  const objectName = requiredString(value.objectName, 'privacy_retention_provider_effect_invalid');
  if (
    work.workItemId !== expected.workItemId
    || work.claimToken !== expected.claimToken
    || work.claimHash !== expected.claimHash
    || work.objectLocatorHash !== expected.objectLocatorHash
    || work.objectVersionHash !== expected.objectVersionHash
    || work.verifierRef !== verifierRef
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$/.test(bucketName)
    || !/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,1023}$/.test(objectName)
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_effect_invalid');
  }
  const leaseExpiresAt = canonicalTimestamp(
    requiredString(value.leaseExpiresAt, 'privacy_retention_provider_effect_invalid'),
    'privacy_retention_provider_effect_invalid',
  );
  if (new Date(leaseExpiresAt).getTime() <= Date.now()) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_effect_invalid');
  }
  return { ...work, bucketName, objectName, leaseExpiresAt };
};

const parseProviderProof = (value: PrivacyRetentionProviderProof | null): PrivacyRetentionProviderProof | null => {
  if (value === null) return null;
  if (
    !PROVIDER_RECEIPT_REF_PATTERN.test(value.providerReceiptRef)
    || !HASH_PATTERN.test(value.providerReceiptHash)
    || !HASH_PATTERN.test(value.providerAbsenceHash)
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_proof_invalid');
  }
  return value;
};

const recordProviderProof = async (
  client: PrivacyRetentionRpcClient,
  input: PrivacyRetentionApplyInput,
  binding: DurableBinding,
  work: ProviderVerificationWork,
  proof: PrivacyRetentionProviderProof,
): Promise<void> => {
  const value = await callRpc(client, 'record_privacy_retention_storage_provider_receipts', {
    p_run_id: input.operationId,
    p_preview_hash: input.previewHash,
    p_idempotency_key: input.idempotencyKey,
    p_receipts: [{
      workItemId: work.workItemId,
      claimToken: work.claimToken,
      objectLocatorHash: work.objectLocatorHash,
      objectVersionHash: work.objectVersionHash,
      claimHash: work.claimHash,
      providerEffectToken: work.providerEffectToken,
      providerReceiptRef: proof.providerReceiptRef,
      providerReceiptHash: proof.providerReceiptHash,
      providerAbsenceHash: proof.providerAbsenceHash,
      verifierRef: work.verifierRef,
    }],
  });
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['operationId', 'acceptedCount', 'adapterVersion', 'sourceMappingVersion'])
    || parseBinding(value, 'privacy_retention_provider_receipt_invalid', binding).operationId !== binding.operationId
    || value.acceptedCount !== 1
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_receipt_invalid');
  }
};

const runProviderLifecycle = async (
  client: PrivacyRetentionRpcClient,
  input: PrivacyRetentionApplyInput,
  binding: DurableBinding,
  provider: PrivacyRetentionProvider,
): Promise<void> => {
  if (!PROVIDER_REF_PATTERN.test(provider.verifierRef)) {
    throw new PrivacyRetentionRunnerError('privacy_retention_provider_invalid');
  }

  const reconciliationArgs = {
    p_run_id: input.operationId,
    p_preview_hash: input.previewHash,
    p_idempotency_key: input.idempotencyKey,
    p_provider_verifier_ref: provider.verifierRef,
    p_limit: 1,
  };
  const verifyAndRecord = async (work: ProviderVerificationWork): Promise<boolean> => {
    let proof: PrivacyRetentionProviderProof | null;
    try {
      proof = parseProviderProof(await provider.verifyAbsent({
        objectLocatorHash: work.objectLocatorHash,
        objectVersionHash: work.objectVersionHash,
        providerEffectToken: work.providerEffectToken,
      }));
    } catch {
      return false;
    }
    if (!proof) return false;
    await recordProviderProof(client, input, binding, work, proof);
    return true;
  };

  for (let index = 0; index < boundedBatchSize(input.batchSize); index += 1) {
    const reconciliation = parseProviderReconciliationWork(
      await callRpc(client, 'get_privacy_retention_provider_reconciliation_work', reconciliationArgs),
      binding,
    );
    if (reconciliation.length === 1) {
      if (!(await verifyAndRecord(reconciliation[0]))) return;
      continue;
    }

    const claims = parseProviderClaims(await callRpc(client, 'claim_privacy_retention_storage_items', {
      p_run_id: input.operationId,
      p_preview_hash: input.previewHash,
      p_idempotency_key: input.idempotencyKey,
      p_limit: 1,
    }), binding);
    if (claims.length === 0) return;

    let work: ProviderDeleteWork;
    try {
      work = parseProviderDeleteWork(
        await callRpc(client, 'resolve_privacy_retention_provider_effect', {
          p_run_id: input.operationId,
          p_preview_hash: input.previewHash,
          p_idempotency_key: input.idempotencyKey,
          p_work_item_id: claims[0].workItemId,
          p_claim_token: claims[0].claimToken,
          p_claim_hash: claims[0].claimHash,
          p_object_locator_hash: claims[0].objectLocatorHash,
          p_object_version_hash: claims[0].objectVersionHash,
          p_adapter_version: binding.adapterVersion,
          p_source_mapping_version: binding.sourceMappingVersion,
          p_provider_verifier_ref: provider.verifierRef,
        }),
        claims[0],
        binding,
        provider.verifierRef,
      );
    } catch {
      return;
    }

    try {
      await provider.deleteExactVersion({
        bucketName: work.bucketName,
        objectName: work.objectName,
        objectVersionHash: work.objectVersionHash,
        providerEffectToken: work.providerEffectToken,
        leaseExpiresAt: work.leaseExpiresAt,
      });
    } catch {
      return;
    }
    if (!(await verifyAndRecord(work))) return;
  }
};
const finalReceipt = async (
  client: PrivacyRetentionRpcClient,
  input: PrivacyRetentionApplyInput,
  binding: DurableBinding,
): Promise<PrivacyRetentionReceipt> => parseReceipt(await callRpc(client, 'finalize_privacy_retention_run', {
  p_run_id: input.operationId,
  p_preview_hash: input.previewHash,
  p_idempotency_key: input.idempotencyKey,
}), binding, 'final');

export const previewRetentionRun = async (
  client: PrivacyRetentionRpcClient,
  input: PrivacyRetentionPreviewInput,
): Promise<PrivacyRetentionPreview> => {
  if (!CLASS_CODE_PATTERN.test(input.classCode)) {
    throw new PrivacyRetentionRunnerError('privacy_retention_class_invalid');
  }

  return parsePreview(await callRpc(client, 'preview_privacy_retention_run', {
    p_class_code: input.classCode,
    p_as_of: canonicalAsOf(input.asOf),
    p_batch_size: boundedBatchSize(input.batchSize),
    p_max_duration_ms: MAX_PRIVACY_RETENTION_RUNTIME_MS,
  }));
};

/**
 * The runner is server-only when a provider dependency is supplied. It returns
 * only the final durable receipt; raw locators exist only in the short provider
 * call between the atomic effect consume and the independent verifier.
 */
export const applyRetentionRun = async (
  client: PrivacyRetentionRpcClient,
  input: PrivacyRetentionApplyInput,
  dependencies: PrivacyRetentionRunnerDependencies = {},
): Promise<PrivacyRetentionReceipt> => {
  if (
    !UUID_PATTERN.test(input.operationId)
    || !HASH_PATTERN.test(input.previewHash)
    || input.confirmationText !== PRIVACY_RETENTION_CONFIRMATION_TEXT
    || !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new PrivacyRetentionRunnerError('privacy_retention_confirmation_invalid');
  }
  const expectedBinding: DurableBinding = {
    operationId: input.operationId,
    adapterVersion: requiredHash(input.adapterVersion, 'privacy_retention_confirmation_invalid'),
    sourceMappingVersion: requiredHash(input.sourceMappingVersion, 'privacy_retention_confirmation_invalid'),
  };
  boundedBatchSize(input.batchSize);

  const confirmation = parseConfirmation(await callRpc(client, 'confirm_privacy_retention_run', {
    p_run_id: input.operationId,
    p_preview_hash: input.previewHash,
    p_confirmation_text: input.confirmationText,
    p_idempotency_key: input.idempotencyKey,
  }), expectedBinding);

  if (confirmation.status === 'confirmed' || confirmation.status === 'partial' || confirmation.status === 'held') {
    parseReceipt(await callRpc(client, 'apply_privacy_retention_run', {
      p_run_id: input.operationId,
      p_preview_hash: input.previewHash,
      p_idempotency_key: input.idempotencyKey,
      p_max_duration_ms: MAX_PRIVACY_RETENTION_RUNTIME_MS,
    }), expectedBinding, 'apply');
  }
  if (dependencies.provider && confirmation.status !== 'failed') {
    await runProviderLifecycle(client, input, expectedBinding, dependencies.provider);
  }

  return finalReceipt(client, input, expectedBinding);
};
