import {
  extractJsonObject,
  normalizeReceiptOcrData,
  type ReceiptOcrData,
} from '@/lib/ocr/types';
import { RECEIPT_OCR_EXTRACTION_PROMPT } from '@/lib/ocr/receipt-prompt';
import { sanitizePrivacyValue } from '@/lib/privacy/sanitize';
import { verifyCostPolicy } from './policy';
import { previewRequestSignal, readBoundedPreviewResponse } from './bounded-provider-http';
import type { OcrCostPolicy } from './types';
import {
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  type OcrPreviewInput,
  type OcrPreviewOutput,
} from './types';

export const DEFAULT_GEMINI_FREE_PREVIEW_MODEL = 'gemini-2.5-flash';

export type GeminiPreviewRunner = (input: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<string>;

/**
 * Opt-in live fetch transport factory for Gemini OCR preview.
 *
 * Rules:
 * - Free Gemini must use dedicated `GEMINI_OCR_FREE_API_KEY`.
 * - Paid `GEMINI_CREDITS_API_KEY` is explicitly ignored in this preview path.
 * - Enforces 12s timeout and 64KB max response body limit.
 * - Never logs or reflects API keys or raw error bodies.
 */
export function createLiveGeminiPreviewRunner(options: {
  costPolicy?: Partial<OcrCostPolicy>;
  apiKey?: string;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  model?: string;
} = {}): GeminiPreviewRunner {
  const policy = { ...options.costPolicy };
  return async (input) => {
    verifyCostPolicy('gemini', policy);
    if (typeof window !== 'undefined') throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
    const env: Record<string, string | undefined> = options.env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
    // Strictly forbid paid project key in free preview path
    const apiKey = (options.apiKey || env.GEMINI_OCR_FREE_API_KEY)?.trim();
    if (!apiKey) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR, {
        reason: 'missing_free_gemini_api_key',
      });
    }

    const model = options.model || env.GEMINI_OCR_FREE_MODEL?.trim() || DEFAULT_GEMINI_FREE_PREVIEW_MODEL;
    const fetchImpl = options.fetchFn ?? fetch;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const requestBody = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.prompt },
            {
              inlineData: {
                data: input.imageBase64,
                mimeType: input.mimeType,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const combinedSignal = previewRequestSignal(input.signal, input.timeoutMs, 12_000);

    if (combinedSignal.aborted) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
        signal: combinedSignal,
      });
    } catch (err: unknown) {
      if (combinedSignal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
      }
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
    }

    const text = await readBoundedPreviewResponse(response, combinedSignal);

    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(text);
    } catch {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
    }

    const responseObject = parsedResponse as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> } | null;
    const candidateText = responseObject?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof candidateText !== 'string' || !candidateText.trim()) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
    }

    return candidateText;
  };
}

/**
 * Bounded Gemini OCR preview adapter.
 *
 * Enforces explicit server free-tier attestation before any processing.
 * By design in this preview layer, no unmocked real cloud calls or implicit secret reads occur.
 */
export async function runGeminiOcrPreview(
  input: OcrPreviewInput,
  options: {
    runner?: GeminiPreviewRunner;
  } = {},
): Promise<OcrPreviewOutput> {
  // 1. Cost Policy Gate (Rejects before any network or key operations)
  verifyCostPolicy('gemini', input.costPolicy);

  // 2. Input validation
  if (!input.imageBytes || input.imageBytes.byteLength === 0) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT);
  }

  // 3. Execution boundary: requires injected runner in this test/preview core
  const runner = options.runner;
  if (!runner) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR, {
      reason: 'real_cloud_calls_denied_in_preview_core',
    });
  }

  const mimeType = input.mimeType || 'image/jpeg';
  const imageBase64 = Buffer.from(input.imageBytes).toString('base64');

  let rawResponseText: string;
  try {
    rawResponseText = await runner({
      prompt: RECEIPT_OCR_EXTRACTION_PROMPT,
      imageBase64,
      mimeType,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? 12_000,
    });
  } catch (err: unknown) {
    if (input.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
    }
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
  }

  let extractedRaw: Record<string, unknown>;
  try {
    extractedRaw = extractJsonObject(rawResponseText);
  } catch {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
  }

  const normalized = normalizeReceiptOcrData(extractedRaw);
  const privacySanitized = sanitizePrivacyValue(normalized).value as ReceiptOcrData;

  return {
    engine: 'gemini-preview',
    manualReviewRequired: true,
    cloudCalls: 1,
    result: privacySanitized,
  };
}
