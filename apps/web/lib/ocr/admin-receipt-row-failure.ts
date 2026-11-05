import 'server-only';

import { isMissingReviewVerificationObject } from '@/lib/reviews/private-verification';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import type { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_SCHEMA_VERSION = 'receipt_summary_v1';
const TERMINAL_FAILURE_PROJECTION = 'id, user_id, verification_photo, receipt_hash, receipt_data, is_duplicate, ocr_processed_at';

export const ADMIN_RECEIPT_ROW_FAILURE_CODES = [
  'verification_photo_missing',
  'verification_object_invalid',
  'verification_object_missing',
] as const;
export type AdminReceiptRowFailureCode = typeof ADMIN_RECEIPT_ROW_FAILURE_CODES[number];
export type AdminReceiptRowFailureSnapshot = {
  id: string;
  user_id: string;
  verification_photo: string | null;
  receipt_hash: string | null;
  receipt_data: unknown;
  is_duplicate: boolean | null;
  ocr_processed_at: string | null;
};
export type AdminReceiptRowFailureOutcome = 'applied' | 'recovered' | 'preserved';
type ReceiptFailureData = {
  schema_version: typeof RECEIPT_SCHEMA_VERSION;
  status: 'failed';
  failure_code: AdminReceiptRowFailureCode;
};
type SupabaseAdmin = ReturnType<typeof createSupabaseServiceRoleClient>;

export class AdminReceiptRowFailurePersistenceError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExpectedReceiptData(value: unknown, expected: ReceiptFailureData): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(expected);
  return Object.keys(value).length === entries.length
    && entries.every(([key, expectedValue]) => value[key] === expectedValue);
}

function hasExpectedTerminalFailureReadback(
  value: unknown,
  snapshot: AdminReceiptRowFailureSnapshot,
  receiptData: ReceiptFailureData,
  processedAt: string,
): boolean {
  return isRecord(value)
    && value.id === snapshot.id
    && value.user_id === snapshot.user_id
    && value.verification_photo === snapshot.verification_photo
    && value.receipt_hash === null
    && value.is_duplicate === false
    && value.ocr_processed_at === processedAt
    && hasExpectedReceiptData(value.receipt_data, receiptData);
}

function hasTerminalReceiptOcrReadback(
  value: unknown,
  snapshot: AdminReceiptRowFailureSnapshot,
): boolean {
  if (!isRecord(value)
    || value.id !== snapshot.id
    || value.user_id !== snapshot.user_id
    || typeof value.ocr_processed_at !== 'string'
    || !Number.isFinite(Date.parse(value.ocr_processed_at))
    || !isRecord(value.receipt_data)) {
    return false;
  }
  return value.receipt_data.status === 'processed' || value.receipt_data.status === 'failed';
}

export function getAdminReceiptStorageRowFailureCode(error: unknown): AdminReceiptRowFailureCode | null {
  return isMissingReviewVerificationObject(error) ? 'verification_object_missing' : null;
}

/**
 * Quarantines only a deterministic row defect. The exact pending review state is
 * the CAS precondition, and both mutation-returned data and an independent read
 * must prove a terminal state before the worker may advance past this row.
 */
export async function persistAdminReceiptRowFailure(
  client: SupabaseAdmin,
  input: {
    snapshot: AdminReceiptRowFailureSnapshot;
    failureCode: AdminReceiptRowFailureCode;
    processedAt: string;
  },
): Promise<AdminReceiptRowFailureOutcome> {
  const { snapshot } = input;
  if (!UUID_PATTERN.test(snapshot.id)
    || !UUID_PATTERN.test(snapshot.user_id)
    || snapshot.ocr_processed_at !== null
    || !ADMIN_RECEIPT_ROW_FAILURE_CODES.includes(input.failureCode)
    || !Number.isFinite(Date.parse(input.processedAt))) {
    throw new AdminReceiptRowFailurePersistenceError();
  }
  const receiptData: ReceiptFailureData = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    status: 'failed',
    failure_code: input.failureCode,
  };
  const update = {
    receipt_hash: null,
    receipt_data: receiptData,
    is_duplicate: false,
    ocr_processed_at: input.processedAt,
  };
  assertPrivacySafe(update);

  let mutationReadback: unknown = null;
  let mutationFailed = true;
  try {
    let mutation = client.from('reviews')
      .update(update)
      .eq('id', snapshot.id)
      .eq('user_id', snapshot.user_id)
      .is('ocr_processed_at', null);
    mutation = snapshot.verification_photo === null
      ? mutation.is('verification_photo', null)
      : mutation.eq('verification_photo', snapshot.verification_photo);
    mutation = snapshot.receipt_hash === null
      ? mutation.is('receipt_hash', null)
      : mutation.eq('receipt_hash', snapshot.receipt_hash);
    mutation = snapshot.receipt_data === null
      ? mutation.is('receipt_data', null)
      : mutation.eq('receipt_data', JSON.stringify(snapshot.receipt_data));
    mutation = snapshot.is_duplicate === null
      ? mutation.is('is_duplicate', null)
      : mutation.eq('is_duplicate', snapshot.is_duplicate);
    const { data, error } = await mutation.select(TERMINAL_FAILURE_PROJECTION).maybeSingle();
    mutationReadback = data;
    mutationFailed = Boolean(error);
  } catch {
    // The independent read below is authoritative after an uncertain mutation response.
  }

  const { data: readback, error: readbackError } = await client.from('reviews')
    .select(TERMINAL_FAILURE_PROJECTION)
    .eq('id', snapshot.id)
    .maybeSingle();
  if (readbackError || !hasTerminalReceiptOcrReadback(readback, snapshot)) {
    throw new AdminReceiptRowFailurePersistenceError();
  }
  if (hasExpectedTerminalFailureReadback(readback, snapshot, receiptData, input.processedAt)) {
    return !mutationFailed
      && hasExpectedTerminalFailureReadback(mutationReadback, snapshot, receiptData, input.processedAt)
      ? 'applied'
      : 'recovered';
  }
  return 'preserved';
}
