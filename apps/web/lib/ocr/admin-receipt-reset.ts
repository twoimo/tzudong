import 'server-only';

import type { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const OCR_RESET_PROJECTION = 'id, ocr_processed_at, receipt_data, receipt_hash, is_duplicate';

export type ReceiptOcrResetSnapshot = {
  id: string;
  ocr_processed_at: string | null;
  receipt_data: unknown;
  receipt_hash: string | null;
  is_duplicate: boolean | null;
};

export const RECEIPT_OCR_RESET_STATE = Object.freeze({
  ocr_processed_at: null,
  receipt_data: null,
  receipt_hash: null,
  is_duplicate: false,
});

export function isResetReceiptOcrState(value: ReceiptOcrResetSnapshot): boolean {
  return value.ocr_processed_at === null
    && value.receipt_data === null
    && value.receipt_hash === null
    && value.is_duplicate === false;
}

export function hasExactReceiptOcrState(
  value: ReceiptOcrResetSnapshot | null,
  expected: ReceiptOcrResetSnapshot,
): boolean {
  return Boolean(value
    && value.id === expected.id
    && value.ocr_processed_at === expected.ocr_processed_at
    && JSON.stringify(value.receipt_data) === JSON.stringify(expected.receipt_data)
    && value.receipt_hash === expected.receipt_hash
    && value.is_duplicate === expected.is_duplicate);
}

type SupabaseAdmin = ReturnType<typeof createSupabaseServiceRoleClient>;
export type ReceiptOcrRowResetResult = 'applied' | 'conflict' | 'failed';

/** Exact snapshot CAS. JSONB equality requires serialized JSON, never object coercion. */
export async function resetReceiptOcrRowWithCas(
  client: SupabaseAdmin,
  snapshot: ReceiptOcrResetSnapshot,
): Promise<ReceiptOcrRowResetResult> {
  let query = client.from('reviews')
    .update(RECEIPT_OCR_RESET_STATE)
    .eq('id', snapshot.id);
  query = snapshot.is_duplicate === null
    ? query.is('is_duplicate', null)
    : query.eq('is_duplicate', snapshot.is_duplicate);
  query = snapshot.ocr_processed_at === null
    ? query.is('ocr_processed_at', null)
    : query.eq('ocr_processed_at', snapshot.ocr_processed_at);
  query = snapshot.receipt_data === null
    ? query.is('receipt_data', null)
    : query.eq('receipt_data', JSON.stringify(snapshot.receipt_data));
  query = snapshot.receipt_hash === null
    ? query.is('receipt_hash', null)
    : query.eq('receipt_hash', snapshot.receipt_hash);
  const { data, error } = await query.select(OCR_RESET_PROJECTION).maybeSingle();
  if (error) return 'failed';
  if (data === null) return 'conflict';
  const readback = data as unknown as ReceiptOcrResetSnapshot;
  return hasExactReceiptOcrState(readback, { id: snapshot.id, ...RECEIPT_OCR_RESET_STATE })
    ? 'applied'
    : 'failed';
}

export async function resetReceiptOcrRowsWithCas(
  snapshots: readonly ReceiptOcrResetSnapshot[],
  resetOne: (snapshot: ReceiptOcrResetSnapshot) => Promise<ReceiptOcrRowResetResult>,
) {
  if (snapshots.length < 1 || snapshots.length > 50
    || new Set(snapshots.map((snapshot) => snapshot.id)).size !== snapshots.length) {
    throw new Error('OCR_RESET_BATCH_INVALID');
  }
  const appliedReviewIds: string[] = [];
  for (const snapshot of snapshots) {
    if (isResetReceiptOcrState(snapshot)) continue;
    const result = await resetOne(snapshot);
    if (result !== 'applied') {
      return { status: result, appliedReviewIds, blockedReviewId: snapshot.id } as const;
    }
    appliedReviewIds.push(snapshot.id);
  }
  return { status: 'complete', appliedReviewIds, blockedReviewId: null } as const;
}
