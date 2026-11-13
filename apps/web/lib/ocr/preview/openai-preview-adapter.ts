import { normalizeReceiptOcrData, type ReceiptOcrData } from '@/lib/ocr/types';
import { sanitizePrivacyValue } from '@/lib/privacy/sanitize';
import { RECEIPT_OCR_EXTRACTION_PROMPT } from '@/lib/ocr/receipt-prompt';
import { verifyCostPolicy } from './policy';
import { previewRequestSignal, readBoundedPreviewResponse } from './bounded-provider-http';
import type { OcrCostPolicy } from './types';
import {
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  type OcrPreviewInput,
  type OcrPreviewOutput,
} from './types';

export const OPENAI_DEFAULT_PREVIEW_MODEL = 'gpt-4o-mini';

export type OpenAiPreviewRunner = (input: {
  model: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<string>;

/**
 * Opt-in live fetch transport factory for OpenAI OCR preview using official `/v1/responses`.
 *
 * Rules:
 * - Requires explicit allowPaidCloud policy gate BEFORE key lookup and fetch.
 * - Enforces 10s timeout and 64KB max response body limit.
 * - No retries.
 * - Never logs or reflects API keys or raw error bodies.
 */
export function createLiveOpenAiPreviewRunner(options: {
  costPolicy?: Partial<OcrCostPolicy>;
  apiKey?: string;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
} = {}): OpenAiPreviewRunner {
  const policy = { ...options.costPolicy };
  return async (input) => {
    verifyCostPolicy('openai', policy);
    if (typeof window !== 'undefined') throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
    const env: Record<string, string | undefined> = options.env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
    const apiKey = (options.apiKey || env.OPENAI_API_KEY)?.trim();
    if (!apiKey) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR, {
        reason: 'missing_openai_api_key',
      });
    }

    const fetchImpl = options.fetchFn ?? fetch;
    const endpoint = 'https://api.openai.com/v1/responses';

    const combinedSignal = previewRequestSignal(input.signal, input.timeoutMs, 10_000);

    if (combinedSignal.aborted) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(input.payload),
        signal: combinedSignal,
      });
    } catch (err: unknown) {
      if (combinedSignal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
      }
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
    }

    const text = await readBoundedPreviewResponse(response, combinedSignal);

    return text;
  };
}

export const OPENAI_RECEIPT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    store_name: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    time: { type: ['string', 'null'] },
    total_amount: { type: ['number', 'null'] },
    category: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    error: { type: ['string', 'null'] },
  },
  required: ['store_name', 'date', 'time', 'total_amount', 'category', 'confidence', 'error'],
  additionalProperties: false,
});

/**
 * Builds the official OpenAI `/v1/responses` request payload with structured output.
 */
export function buildOpenAiResponsesPayload(input: {
  imageBase64: string;
  mimeType: string;
  model?: string;
}) {
  const model = input.model ?? OPENAI_DEFAULT_PREVIEW_MODEL;
  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;

  return {
    model,
    store: false,
    max_output_tokens: 800,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: RECEIPT_OCR_EXTRACTION_PROMPT,
          },
          {
            type: 'input_image',
            image_url: dataUrl,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'receipt_preview',
        strict: true,
        schema: OPENAI_RECEIPT_SCHEMA,
      },
    },
  };
}

/**
 * Parses structured JSON response from OpenAI `/v1/responses` or extracts message content.
 */
export function parseOpenAiResponsesOutput(responseText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
  }

  const obj = parsed as Record<string, unknown>;

  // Direct parsed schema object if already unmarshalled
  if ('store_name' in obj || 'total_amount' in obj || 'error' in obj) {
    return obj;
  }

  // Official /v1/responses envelope extraction
  if (Array.isArray(obj.output)) {
    const firstOutput = obj.output[0];
    if (firstOutput && typeof firstOutput === 'object') {
      const content = (firstOutput as Record<string, unknown>).content;
      if (typeof content === 'string') {
        try {
          return JSON.parse(content);
        } catch { /* continue */ }
      }
    }
  }

  // Fallback: standard choices[0].message.content
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    const content = obj.choices[0].message.content;
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch { /* continue */ }
    }
  }

  throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE);
}

/**
 * Bounded OpenAI OCR preview adapter using official `/v1/responses`.
 * Strictly denied unless paid cloud is explicitly approved via policy.
 * No retries; all upstream errors are redacted to fixed codes.
 */
export async function runOpenAiOcrPreview(
  input: OcrPreviewInput,
  options: {
    runner?: OpenAiPreviewRunner;
    model?: string;
  } = {},
): Promise<OcrPreviewOutput> {
  // 1. Cost Policy Gate (Rejects before any network or key operations)
  verifyCostPolicy('openai', input.costPolicy);

  // 2. Input validation
  if (!input.imageBytes || input.imageBytes.byteLength === 0) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT);
  }

  const runner = options.runner;
  if (!runner) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR, {
      reason: 'real_cloud_calls_denied_in_preview_core',
    });
  }

  const mimeType = input.mimeType || 'image/jpeg';
  const imageBase64 = Buffer.from(input.imageBytes).toString('base64');
  const payload = buildOpenAiResponsesPayload({
    imageBase64,
    mimeType,
    model: options.model,
  });

  let rawResponseText: string;
  try {
    rawResponseText = await runner({
      model: payload.model,
      payload,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? 10_000,
    });
  } catch (err: unknown) {
    if (input.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
    }
    // Redact upstream provider error details to fixed error code
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
  }

  const extracted = parseOpenAiResponsesOutput(rawResponseText);
  const normalized = normalizeReceiptOcrData(extracted);
  const privacySanitized = sanitizePrivacyValue(normalized).value as ReceiptOcrData;

  return {
    engine: 'openai-responses-preview',
    manualReviewRequired: true,
    cloudCalls: 1,
    result: privacySanitized,
  };
}
