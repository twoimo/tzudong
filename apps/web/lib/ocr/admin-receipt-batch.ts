import type { ReceiptOcrWorkflowPolicy } from '@/lib/ocr/workflow-policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ReceiptOcrReviewState = {
  id: string;
  user_id: string;
  ocr_processed_at: string | null;
  receipt_status: string | null;
};
export type ReceiptOcrBatchInput = {
  batchLimit: number;
  reviewIds: string[] | null;
  policy: ReceiptOcrWorkflowPolicy;
};
export type ReceiptOcrBatchDependencies = {
  select: (input: ReceiptOcrBatchInput) => Promise<ReceiptOcrReviewState[]>;
  read: (reviewId: string) => Promise<ReceiptOcrReviewState | null>;
  isReady: (ownerId: string) => Promise<boolean>;
  process: (input: { reviewId: string; policy: ReceiptOcrWorkflowPolicy; signal: AbortSignal }) => Promise<Response>;
};

function isTerminal(row: ReceiptOcrReviewState | null): row is ReceiptOcrReviewState {
  return Boolean(row?.ocr_processed_at && (row.receipt_status === 'processed' || row.receipt_status === 'failed'));
}

/** Serial and bounded; an uncertain response is reconciled by reads, never resent. */
export async function runAdminReceiptOcrBatch(input: ReceiptOcrBatchInput, deps: ReceiptOcrBatchDependencies) {
  if (!Number.isInteger(input.batchLimit) || input.batchLimit < 1 || input.batchLimit > 50
    || (input.reviewIds !== null && (input.reviewIds.length < 1
      || input.reviewIds.length > input.batchLimit
      || new Set(input.reviewIds).size !== input.reviewIds.length
      || input.reviewIds.some((reviewId) => !UUID.test(reviewId))))) {
    throw new Error('OCR_BATCH_INPUT_INVALID');
  }
  const requestedIds = input.reviewIds === null ? null : new Set(input.reviewIds);
  const rows = await deps.select(input);
  if (rows.length > (requestedIds?.size ?? input.batchLimit)
    || new Set(rows.map((row) => row.id)).size !== rows.length
    || rows.some((row) => !UUID.test(row.id) || !UUID.test(row.user_id)
      || (requestedIds !== null && !requestedIds.has(row.id)))) throw new Error('OCR_BATCH_SELECTION_INVALID');
  if (requestedIds !== null && rows.length !== requestedIds.size) throw new Error('OCR_BATCH_REVIEW_NOT_FOUND');
  const summary = {
    selected: rows.length, processed: 0, preserved: 0, recovered: 0,
    failed: 0, indeterminate: 0, held: 0, unattempted: 0, terminalFailures: 0,
  };
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (!await deps.isReady(row.user_id)) {
      summary.held += 1;
      summary.unattempted = rows.length - i - 1;
      break;
    }
    const before = await deps.read(row.id);
    if (!before || before.id !== row.id || before.user_id !== row.user_id) {
      throw new Error('OCR_BATCH_READBACK_INVALID');
    }
    if (isTerminal(before)) {
      summary.preserved += 1;
      summary.terminalFailures += Number(before.receipt_status === 'failed');
      continue;
    }
    let response: Response | undefined;
    try {
      response = await deps.process({ reviewId: row.id, policy: input.policy, signal: AbortSignal.timeout(240_000) });
    } catch { /* Reconcile the single invocation below. */ }
    let after: ReceiptOcrReviewState | null;
    try { after = await deps.read(row.id); } catch {
      summary.indeterminate += 1;
      summary.unattempted = rows.length - i - 1;
      break;
    }
    if (!after || after.id !== row.id || after.user_id !== row.user_id) {
      summary.indeterminate += 1;
      summary.unattempted = rows.length - i - 1;
      break;
    }
    if (isTerminal(after)) {
      if (response?.ok) summary.processed += 1;
      else summary.recovered += 1;
      summary.terminalFailures += Number(after.receipt_status === 'failed');
    } else if (!response || response.ok) {
      summary.indeterminate += 1;
      summary.unattempted = rows.length - i - 1;
      break;
    } else {
      // A capability or persistence failure must not amplify into the rest of a batch.
      summary.failed += 1;
      summary.unattempted = rows.length - i - 1;
      break;
    }
  }
  return summary;
}
