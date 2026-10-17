import crypto from 'node:crypto';
import type { GeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini';
import type { ReceiptOcrEnvelope } from '@/lib/ocr/receipt-normalization';
import type { OcrRoutingProvider } from '@/lib/ocr/runtime-config';
import type { SelectedRestaurantContext } from '@/lib/ocr/restaurant-matching';
import type { ReceiptOcrData } from '@/lib/ocr/types';

export const DURABLE_RECEIPT_OCR_SCHEMA_VERSION = 'receipt-public-ocr-v1';
export const RECEIPT_OCR_DEFAULT_GENERATION = '00000000-0000-0000-0000-000000000000';
export const RECEIPT_OCR_INPUT_CONTEXT_VERSION = 'receipt-ocr-input-context-v2';

type DurableReceiptOcrNormalized = Pick<
  ReceiptOcrData,
  'store_name' | 'date' | 'time' | 'total_amount' | 'category' | 'review_draft' | 'items' | 'confidence'
>;

export type DurableReceiptOcrPayload = {
  schema_version: typeof DURABLE_RECEIPT_OCR_SCHEMA_VERSION;
  provider: OcrRoutingProvider;
  model: string;
  normalized: DurableReceiptOcrNormalized;
  failure_code?: 'not_receipt' | 'unreadable' | 'low_quality' | 'ocr_failed';
  field_trust: Array<Pick<ReceiptOcrEnvelope['field_trust'][number], 'field' | 'level' | 'source' | 'reason' | 'needsReview'>>;
  confidence: number;
  needs_review: string[];
  normalization_version: string;
};

export type DurableReceiptOcrBinding = {
  userId: string;
  imageHash: string;
  inputContextHash: string;
  provider: OcrRoutingProvider;
  modelPolicy: string[];
  generation: string;
  promptVersion: string;
  preprocessVersion: string;
  normalizationVersion: string;
};

export type DurableReceiptOcrClaim =
  | { status: 'claimed'; resultRef: string; claimToken: string }
  | { status: 'cached'; resultRef: string; resultRevision: string; payload: DurableReceiptOcrPayload }
  | { status: 'processing' | 'indeterminate'; resultRef: string };

export type DurableReceiptOcrRead =
  | { status: 'not_found' }
  | { status: 'processing' | 'indeterminate'; resultRef: string }
  | { status: 'succeeded'; resultRef: string; resultRevision: string; payload: DurableReceiptOcrPayload };

export interface DurableReceiptOcrStore {
  claim(input: DurableReceiptOcrBinding & { operationId: string; forceRefresh: boolean }): Promise<DurableReceiptOcrClaim>;
  markDispatched(input: {
    binding: DurableReceiptOcrBinding;
    resultRef: string;
    claimToken: string;
  }): Promise<void>;
  complete(input: {
    binding: DurableReceiptOcrBinding;
    resultRef: string;
    claimToken: string;
    payload: DurableReceiptOcrPayload;
  }): Promise<string>;
  markIndeterminate(input: {
    binding: DurableReceiptOcrBinding;
    resultRef: string;
    claimToken: string;
  }): Promise<void>;
  release(input: {
    binding: DurableReceiptOcrBinding;
    resultRef: string;
    claimToken: string;
  }): Promise<void>;
  read(input: DurableReceiptOcrBinding): Promise<DurableReceiptOcrRead>;
}

export async function pollDurableReceiptOcrResult(input: {
  store: Pick<DurableReceiptOcrStore, 'read'>;
  binding: DurableReceiptOcrBinding;
  attempts?: number;
  wait?: () => Promise<void>;
}): Promise<DurableReceiptOcrRead> {
  const attempts = input.attempts ?? 4;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8) {
    throw new DurableReceiptOcrPersistenceError();
  }
  let result: DurableReceiptOcrRead = { status: 'not_found' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = await input.store.read(input.binding);
    if (result.status === 'succeeded' || result.status === 'indeterminate') return result;
    if (attempt + 1 < attempts) await input.wait?.();
  }
  return result;
}

type RpcResult = { data: unknown; error: unknown };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export class DurableReceiptOcrPendingError extends Error {
  constructor(public readonly state: 'processing' | 'indeterminate') {
    super(state === 'processing' ? 'OCR_RESULT_PROCESSING' : 'OCR_RESULT_INDETERMINATE');
    this.name = 'DurableReceiptOcrPendingError';
  }
}

export class DurableReceiptOcrPersistenceError extends Error {
  constructor() {
    super('OCR_RESULT_PERSISTENCE_FAILED');
    this.name = 'DurableReceiptOcrPersistenceError';
  }
}

export async function getReviewReceiptOcrGeneration(
  client: RpcClient,
  userId: string,
  reviewId: string,
): Promise<string> {
  if (!isUuid(userId) || !isUuid(reviewId)) throw new DurableReceiptOcrPersistenceError();
  const { data, error } = await client.rpc('get_review_receipt_ocr_generation', {
    p_user_id: userId,
    p_review_id: reviewId,
  });
  if (error || !isRecord(data) || data.status !== 'ready'
    || data.review_id !== reviewId || !isUuid(data.generation)
    || Object.keys(data).some((key) => !['status', 'review_id', 'generation'].includes(key))) {
    throw new DurableReceiptOcrPersistenceError();
  }
  return data.generation;
}

export async function publishReviewReceiptOcrResult(
  client: RpcClient,
  input: {
    userId: string;
    reviewId: string;
    generation: string;
    resultRef: string;
    resultRevision: string;
    receiptHash: string | null;
    receiptData: unknown;
    isDuplicate: boolean;
  },
): Promise<Record<string, unknown>> {
  if (![input.userId, input.reviewId, input.generation, input.resultRef, input.resultRevision].every(isUuid)
    || (input.receiptHash !== null && !/^[0-9a-f]{64}$/.test(input.receiptHash))) {
    throw new DurableReceiptOcrPersistenceError();
  }
  const { data, error } = await client.rpc('publish_review_receipt_ocr_result', {
    p_user_id: input.userId,
    p_review_id: input.reviewId,
    p_generation: input.generation,
    p_result_id: input.resultRef,
    p_result_revision: input.resultRevision,
    p_receipt_hash: input.receiptHash,
    p_receipt_data: input.receiptData,
    p_is_duplicate: input.isDuplicate,
  });
  if (error || !isRecord(data) || data.status !== 'published'
    || data.review_id !== input.reviewId || data.generation !== input.generation
    || data.result_ref !== input.resultRef || data.result_revision !== input.resultRevision) {
    throw new DurableReceiptOcrPersistenceError();
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hasDurableOcrReviewResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isRecord(value.receipt_data)
    || (typeof value.ocr_processed_at === 'string' && Number.isFinite(Date.parse(value.ocr_processed_at)))
    || (typeof value.receipt_hash === 'string' && value.receipt_hash.length > 0)
    || value.is_duplicate === true;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const TOP_LEVEL_KEYS = new Set([
  'schema_version',
  'provider',
  'model',
  'normalized',
  'failure_code',
  'field_trust',
  'confidence',
  'needs_review',
  'normalization_version',
]);
const NORMALIZED_KEYS = new Set([
  'store_name',
  'date',
  'time',
  'total_amount',
  'category',
  'review_draft',
  'items',
  'confidence',
]);
const TRUST_KEYS = new Set(['field', 'level', 'source', 'reason', 'needsReview']);
const ITEM_KEYS = new Set(['name', 'price']);
const TRUST_FIELDS = new Set([
  'store_name', 'restaurant_id', 'date', 'time', 'total_amount', 'items', 'category', 'review_draft',
]);
const TRUST_SOURCES = new Set([
  'model_raw', 'model_candidate', 'selected_restaurant', 'db_exact', 'db_fuzzy', 'rule_validation', 'user_required',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isOptionalBoundedString(value: unknown, maxLength: number, pattern?: RegExp): boolean {
  return value === undefined
    || (typeof value === 'string'
      && value.length > 0
      && value.length <= maxLength
      && value.trim() === value
      && (!pattern || pattern.test(value)));
}

function isBoundedAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
}

function isOptionalBoundedAmount(value: unknown): boolean {
  return value === undefined || isBoundedAmount(value);
}

function isNormalizedReceipt(value: unknown): value is DurableReceiptOcrNormalized {
  if (!isRecord(value)
    || !hasOnlyKeys(value, NORMALIZED_KEYS)
    || !isOptionalBoundedString(value.store_name, 160)
    || !isOptionalBoundedString(value.date, 10, DATE_PATTERN)
    || !isOptionalBoundedString(value.time, 5, TIME_PATTERN)
    || !isOptionalBoundedAmount(value.total_amount)
    || !isOptionalBoundedString(value.category, 32)
    || !isOptionalBoundedString(value.review_draft, 4_000)
    || (value.confidence !== undefined
      && (typeof value.confidence !== 'number'
        || !Number.isFinite(value.confidence)
        || value.confidence < 0
        || value.confidence > 1))) {
    return false;
  }
  if (value.items === undefined) return true;
  return Array.isArray(value.items)
    && value.items.length <= 50
    && value.items.every((item) => isRecord(item)
      && hasOnlyKeys(item, ITEM_KEYS)
      && typeof item.name === 'string'
      && item.name.length > 0
      && item.name.length <= 160
      && item.name.trim() === item.name
      && Object.hasOwn(item, 'price')
      && (item.price === null || isBoundedAmount(item.price)));
}

function isDurablePayload(value: unknown): value is DurableReceiptOcrPayload {
  if (!isRecord(value)
    || !hasOnlyKeys(value, TOP_LEVEL_KEYS)
    || value.schema_version !== DURABLE_RECEIPT_OCR_SCHEMA_VERSION
    || value.provider !== 'gemini'
    || typeof value.model !== 'string'
    || !value.model.trim()
    || value.model.length > 160
    || value.model.trim() !== value.model
    || !isNormalizedReceipt(value.normalized)
    || !Array.isArray(value.field_trust)
    || value.field_trust.length > 16
    || typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || !Array.isArray(value.needs_review)
    || value.needs_review.length > 8
    || !value.needs_review.every((field) => typeof field === 'string' && TRUST_FIELDS.has(field))
    || new Set(value.needs_review).size !== value.needs_review.length
    || typeof value.normalization_version !== 'string'
    || value.normalization_version.length < 1
    || value.normalization_version.length > 160
    || value.normalization_version.trim() !== value.normalization_version) {
    return false;
  }
  if (value.failure_code !== undefined
    && !['not_receipt', 'unreadable', 'low_quality', 'ocr_failed'].includes(String(value.failure_code))) return false;
  return value.field_trust.every((entry) => isRecord(entry)
    && hasOnlyKeys(entry, TRUST_KEYS)
    && typeof entry.field === 'string'
    && TRUST_FIELDS.has(entry.field)
    && ['high', 'medium', 'low'].includes(String(entry.level))
    && typeof entry.source === 'string'
    && TRUST_SOURCES.has(entry.source)
    && typeof entry.reason === 'string'
    && entry.reason.length > 0
    && entry.reason.length <= 240
    && typeof entry.needsReview === 'boolean');
}

function parseResultState(value: unknown): DurableReceiptOcrClaim | DurableReceiptOcrRead {
  if (isRecord(value) && value.status === 'not_found' && Object.keys(value).length === 1) {
    return { status: 'not_found' };
  }
  if (!isRecord(value) || !isUuid(value.result_ref) || typeof value.status !== 'string') {
    throw new DurableReceiptOcrPersistenceError();
  }
  if (value.status === 'claimed' && isUuid(value.claim_token)) {
    return { status: 'claimed', resultRef: value.result_ref, claimToken: value.claim_token };
  }
  if ((value.status === 'cached' || value.status === 'succeeded')
    && isUuid(value.result_revision) && isDurablePayload(value.result_payload)) {
    return {
      status: value.status,
      resultRef: value.result_ref,
      resultRevision: value.result_revision,
      payload: value.result_payload,
    };
  }
  if (value.status === 'processing' || value.status === 'indeterminate') {
    return { status: value.status, resultRef: value.result_ref };
  }
  throw new DurableReceiptOcrPersistenceError();
}

function parseClaim(value: unknown): DurableReceiptOcrClaim {
  const parsed = parseResultState(value);
  if (parsed.status === 'not_found' || parsed.status === 'succeeded') throw new DurableReceiptOcrPersistenceError();
  return parsed;
}

function parseRead(value: unknown): DurableReceiptOcrRead {
  const parsed = parseResultState(value);
  if (parsed.status === 'claimed' || parsed.status === 'cached') throw new DurableReceiptOcrPersistenceError();
  return parsed;
}

function policyAllowsModel(policy: readonly string[], model: string): boolean {
  return policy.length >= 1
    && policy.length <= 8
    && new Set(policy).size === policy.length
    && policy.every((entry) => entry.length >= 1 && entry.length <= 160 && entry.trim() === entry)
    && policy.includes(model);
}

function bindingArgs(binding: DurableReceiptOcrBinding) {
  return {
    p_user_id: binding.userId,
    p_image_hash: binding.imageHash,
    p_input_context_hash: binding.inputContextHash,
    p_provider: binding.provider,
    p_model_policy: binding.modelPolicy,
    p_generation: binding.generation,
    p_prompt_version: binding.promptVersion,
    p_preprocess_version: binding.preprocessVersion,
    p_normalization_version: binding.normalizationVersion,
  };
}

export function createSupabaseDurableReceiptOcrStore(client: RpcClient): DurableReceiptOcrStore {
  return {
    async claim(input) {
      const { data, error } = await client.rpc('claim_receipt_ocr_result', {
        ...bindingArgs(input),
        p_operation_id: input.operationId,
        p_force_refresh: input.forceRefresh,
      });
      if (error) throw new DurableReceiptOcrPersistenceError();
      const claim = parseClaim(data);
      if (claim.status === 'cached'
        && (claim.payload.provider !== input.provider
          || !policyAllowsModel(input.modelPolicy, claim.payload.model)
          || claim.payload.normalization_version !== input.normalizationVersion)) {
        throw new DurableReceiptOcrPersistenceError();
      }
      return claim;
    },
    async complete(input) {
      const { data, error } = await client.rpc('complete_receipt_ocr_result', {
        p_result_id: input.resultRef,
        p_claim_token: input.claimToken,
        p_result_payload: input.payload,
      });
      if (error || !isRecord(data) || data.status !== 'succeeded'
        || data.result_ref !== input.resultRef || !isUuid(data.result_revision)) {
        throw new DurableReceiptOcrPersistenceError();
      }
      return data.result_revision;
    },
    async markDispatched(input) {
      const { data, error } = await client.rpc('mark_receipt_ocr_dispatched', {
        p_result_id: input.resultRef,
        p_claim_token: input.claimToken,
      });
      if (error || !isRecord(data) || data.status !== 'dispatched' || data.result_ref !== input.resultRef) {
        throw new DurableReceiptOcrPersistenceError();
      }
    },
    async markIndeterminate(input) {
      const { data, error } = await client.rpc('mark_receipt_ocr_result_indeterminate', {
        p_result_id: input.resultRef,
        p_claim_token: input.claimToken,
      });
      if (error || !isRecord(data) || !['indeterminate', 'succeeded'].includes(String(data.status))) {
        throw new DurableReceiptOcrPersistenceError();
      }
    },
    async release(input) {
      const { data, error } = await client.rpc('release_receipt_ocr_claim', {
        p_result_id: input.resultRef,
        p_claim_token: input.claimToken,
      });
      if (error || !isRecord(data) || data.status !== 'released') {
        throw new DurableReceiptOcrPersistenceError();
      }
    },
    async read(input) {
      const { data, error } = await client.rpc('read_receipt_ocr_result', bindingArgs(input));
      if (error) throw new DurableReceiptOcrPersistenceError();
      const result = parseRead(data);
      if (result.status === 'succeeded'
        && (result.payload.provider !== input.provider
          || !policyAllowsModel(input.modelPolicy, result.payload.model)
          || result.payload.normalization_version !== input.normalizationVersion)) {
        throw new DurableReceiptOcrPersistenceError();
      }
      return result;
    },
  };
}

export function buildOcrInputContextHash(
  imageHash: string,
  selectedRestaurant: SelectedRestaurantContext | null,
  inferenceConfig: GeminiOcrInferenceConfigSnapshot,
): string {
  const context = selectedRestaurant
    ? [
        selectedRestaurant.id ?? '',
        selectedRestaurant.name ?? '',
        selectedRestaurant.road_address ?? '',
        selectedRestaurant.jibun_address ?? '',
        selectedRestaurant.category ?? '',
      ]
    : [''];
  const inferencePolicy = [
    inferenceConfig.version,
    inferenceConfig.thinkingLevel,
    inferenceConfig.responseMimeType,
    inferenceConfig.samplingPolicy,
  ];
  return crypto.createHash('sha256').update(JSON.stringify([
    RECEIPT_OCR_INPUT_CONTEXT_VERSION,
    imageHash,
    context,
    inferencePolicy,
  ])).digest('hex');
}

export function buildDurableReceiptOcrPayload(input: {
  provider: OcrRoutingProvider;
  model: string;
  envelope: ReceiptOcrEnvelope;
}): DurableReceiptOcrPayload {
  const {
    error,
    store_name,
    date,
    time,
    total_amount,
    category,
    review_draft,
    items,
    confidence,
  } = input.envelope.normalized;
  // Persist only the public, normalized receipt contract. Raw OCR, provider
  // attempts, candidate diagnostics and applied-correction internals stay in
  // request memory and never cross the durable boundary.
  const normalized: DurableReceiptOcrNormalized = {
    ...(store_name !== undefined ? { store_name } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(time !== undefined ? { time } : {}),
    ...(total_amount !== undefined ? { total_amount } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(review_draft !== undefined ? { review_draft } : {}),
    ...(items !== undefined ? { items } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
  const failureCode = error === 'not_receipt' || error === 'unreadable' || error === 'low_quality'
    ? error
    : error ? 'ocr_failed' : undefined;
  const payload: DurableReceiptOcrPayload = {
    schema_version: DURABLE_RECEIPT_OCR_SCHEMA_VERSION,
    provider: input.provider,
    model: input.model,
    normalized,
    ...(failureCode ? { failure_code: failureCode } : {}),
    field_trust: input.envelope.field_trust.map(({ field, level, source, reason, needsReview }) => ({
      field,
      level,
      source,
      reason,
      needsReview,
    })),
    confidence: input.envelope.confidence,
    needs_review: [...input.envelope.needs_review],
    normalization_version: input.envelope.normalization_version,
  };
  if (!isDurablePayload(payload)) throw new DurableReceiptOcrPersistenceError();
  return payload;
}

export function toPublicReceiptOcrResponse(input: {
  resultRef: string;
  resultRevision: string;
  payload: DurableReceiptOcrPayload;
  cacheReused: boolean;
}) {
  return {
    ...input.payload.normalized,
    ...(input.payload.failure_code ? { error: input.payload.failure_code } : {}),
    field_trust: input.payload.field_trust,
    confidence: input.payload.confidence,
    needs_review: input.payload.needs_review,
    normalization_version: input.payload.normalization_version,
    provider: input.payload.provider,
    model: input.payload.model,
    ocr_result_ref: input.resultRef,
    ocr_result_revision: input.resultRevision,
    cache_reused: input.cacheReused,
  };
}

export async function executeDurableReceiptOcr(input: {
  store: DurableReceiptOcrStore;
  binding: DurableReceiptOcrBinding;
  operationId: string;
  forceRefresh: boolean;
  beforeProvider?: () => Promise<void>;
  runProvider: () => Promise<DurableReceiptOcrPayload>;
}): Promise<{ resultRef: string; resultRevision: string; payload: DurableReceiptOcrPayload; cacheReused: boolean }> {
  const claim = await input.store.claim({
    ...input.binding,
    operationId: input.operationId,
    forceRefresh: input.forceRefresh,
  });
  if (claim.status === 'cached') {
    return {
      resultRef: claim.resultRef,
      resultRevision: claim.resultRevision,
      payload: claim.payload,
      cacheReused: true,
    };
  }
  if (claim.status !== 'claimed') throw new DurableReceiptOcrPendingError(claim.status);

  const claimInput = {
    binding: input.binding,
    resultRef: claim.resultRef,
    claimToken: claim.claimToken,
  };
  try {
    await input.beforeProvider?.();
  } catch (error) {
    await input.store.release(claimInput);
    throw error;
  }

  // Persist the conservative dispatch boundary before the first provider byte
  // can leave this process. If acknowledgement is lost, the request stops here:
  // a later explicit recovery may mark it uncertain but must never replay it.
  await input.store.markDispatched(claimInput);

  let payload: DurableReceiptOcrPayload;
  try {
    payload = await input.runProvider();
    if (!isDurablePayload(payload)
      || payload.provider !== input.binding.provider
      || !policyAllowsModel(input.binding.modelPolicy, payload.model)
      || payload.normalization_version !== input.binding.normalizationVersion) {
      throw new DurableReceiptOcrPersistenceError();
    }
    const resultRevision = await input.store.complete({ ...claimInput, payload });
    return { resultRef: claim.resultRef, resultRevision, payload, cacheReused: false };
  } catch (error) {
    try { await input.store.markIndeterminate(claimInput); } catch { /* Processing remains non-retryable. */ }
    throw error;
  }
}
