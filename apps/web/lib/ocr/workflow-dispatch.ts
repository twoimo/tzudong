import 'server-only';

import { getGeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini';
import { getOcrModelPolicy, resolveOcrAiRuntimeConfig } from '@/lib/ocr/runtime-config';
import { parseReceiptOcrWorkflowPolicy } from '@/lib/ocr/workflow-policy';

export const RECEIPT_OCR_WORKFLOW_FILE = 'ocr-review-receipts.yml';
export const RECEIPT_OCR_WORKFLOW_REF = 'main';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReceiptOcrWorkflowDispatchResult =
  | { status: 'accepted'; httpStatus: 204 }
  | { status: 'indeterminate'; httpStatus: number | null };

export async function buildReceiptOcrWorkflowInputs(
  reviewIds?: readonly string[],
): Promise<Record<string, string>> {
  if (reviewIds && (reviewIds.length < 1 || reviewIds.length > 50
    || new Set(reviewIds).size !== reviewIds.length
    || reviewIds.some((reviewId) => !UUID.test(reviewId)))) {
    throw new Error('OCR_WORKFLOW_REVIEW_IDS_INVALID');
  }
  const runtimeConfig = await resolveOcrAiRuntimeConfig(process.env);
  if (runtimeConfig.provider !== 'gemini') {
    throw new Error('OCR_WORKFLOW_PROVIDER_INVALID');
  }

  const modelPolicy = JSON.stringify(getOcrModelPolicy(runtimeConfig));
  const inferenceConfig = getGeminiOcrInferenceConfigSnapshot(process.env);
  const validated = parseReceiptOcrWorkflowPolicy(modelPolicy, inferenceConfig.thinkingLevel);

  return {
    modelPolicy: JSON.stringify(validated.modelPolicy),
    thinkingLevel: validated.inferenceConfig.thinkingLevel,
    ...(reviewIds ? { reviewIds: JSON.stringify(reviewIds) } : {}),
  };
}

/** A non-204 or transport loss is indeterminate: callers must preserve reset state. */
export async function dispatchReceiptOcrWorkflow(input: {
  url: string;
  token: string;
  inputs: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<ReceiptOcrWorkflowDispatchResult> {
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${input.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: RECEIPT_OCR_WORKFLOW_REF,
        inputs: input.inputs,
      }),
    });
    if (response.status === 204) return { status: 'accepted', httpStatus: 204 };
    await response.body?.cancel().catch(() => undefined);
    return { status: 'indeterminate', httpStatus: response.status };
  } catch {
    return { status: 'indeterminate', httpStatus: null };
  }
}
