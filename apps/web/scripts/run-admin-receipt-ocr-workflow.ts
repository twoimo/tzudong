/** Trusted workflow entrypoint. No web server, user password, cookie or session is used. */
import { createSupabaseServiceRoleClient } from '../lib/supabase/service-role';
import { processAdminReceiptOcr } from '../lib/ocr/admin-receipt-processor';
import { runAdminReceiptOcrBatch, type ReceiptOcrReviewState } from '../lib/ocr/admin-receipt-batch';
import { parseReceiptOcrWorkflowPolicy } from '../lib/ocr/workflow-policy';
import { readFeatureDatabaseReadiness } from '../lib/server/runtime-feature-readiness';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECTION = 'id, user_id, ocr_processed_at, receipt_status:receipt_data->>status';
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('OCR_WORKFLOW_CONFIGURATION_REQUIRED');
  return value;
}

function parseReviewIds(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('OCR_BATCH_INPUT_INVALID'); }
  if (!Array.isArray(value) || value.length < 1 || value.length > 50
    || new Set(value).size !== value.length
    || value.some((reviewId) => typeof reviewId !== 'string' || !UUID.test(reviewId))) {
    throw new Error('OCR_BATCH_INPUT_INVALID');
  }
  return value as string[];
}

export async function runReceiptOcrWorkflow() {
  const policy = parseReceiptOcrWorkflowPolicy(required('OCR_MODEL_POLICY'), required('OCR_THINKING_LEVEL'));
  const reviewIds = parseReviewIds(process.env.OCR_REVIEW_IDS);
  const rawLimit = process.env.OCR_BATCH_LIMIT?.trim() || '50';
  if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 50
    || (reviewIds !== null && reviewIds.length > Number(rawLimit))) {
    throw new Error('OCR_BATCH_INPUT_INVALID');
  }
  // The funded-project key is mandatory here; no fallback to another project's key.
  required('GEMINI_CREDITS_API_KEY');
  required('NEXT_PUBLIC_SUPABASE_URL');
  required('SUPABASE_SERVICE_ROLE_KEY');
  const client = createSupabaseServiceRoleClient();
  const summary = await runAdminReceiptOcrBatch({ batchLimit: Number(rawLimit), reviewIds, policy }, {
    select: async (input) => {
      let query = client.from('reviews').select(PROJECTION)
        .not('verification_photo', 'is', null)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .limit(input.reviewIds?.length ?? input.batchLimit);
      query = input.reviewIds ? query.in('id', input.reviewIds) : query.is('ocr_processed_at', null);
      const { data, error } = await query;
      if (error) throw new Error('OCR_BATCH_SELECTION_FAILED');
      return data as unknown as ReceiptOcrReviewState[];
    },
    read: async (id) => {
      const { data, error } = await client.from('reviews').select(PROJECTION).eq('id', id).maybeSingle();
      if (error) throw new Error('OCR_BATCH_READBACK_FAILED');
      return data as unknown as ReceiptOcrReviewState | null;
    },
    isReady: async (ownerId) => (await readFeatureDatabaseReadiness({ ownerId })).status === 'ready',
    process: processAdminReceiptOcr,
  });
  console.log(JSON.stringify({ event: 'receipt_ocr_batch_result', ...summary }));
  if (summary.failed || summary.indeterminate || summary.held || summary.terminalFailures) {
    throw new Error('OCR_BATCH_INCOMPLETE');
  }
  return summary;
}

if (import.meta.main) {
  runReceiptOcrWorkflow().catch(() => {
    console.error(JSON.stringify({ event: 'receipt_ocr_batch_stopped', code: 'OCR_BATCH_INCOMPLETE' }));
    process.exitCode = 1;
  });
}
