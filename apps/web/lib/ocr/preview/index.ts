import { parseReceiptLinesDeterministically } from './deterministic-parser';
import { runMacosVisionOcr, type LocalVisionRunner } from './local-vision-engine';
import { runGeminiOcrPreview, type GeminiPreviewRunner } from './gemini-preview-adapter';
import { runOpenAiOcrPreview, type OpenAiPreviewRunner } from './openai-preview-adapter';
import { DEFAULT_COST_POLICY, verifyCostPolicy } from './policy';
import {
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  type OcrCostPolicy,
  type OcrPreviewInput,
  type OcrPreviewOutput,
  type OcrPreviewProvider,
  type RecognizedTextLine,
} from './types';

export * from './types';
export * from './policy';
export * from './deterministic-parser';
export * from './local-vision-engine';
export * from './gemini-preview-adapter';
export * from './openai-preview-adapter';

export type ReceiptOcrPreviewEngineOptions = {
  localVisionRunner?: LocalVisionRunner;
  geminiRunner?: GeminiPreviewRunner;
  openAiRunner?: OpenAiPreviewRunner;
};

/**
 * Main bounded Receipt OCR Preview interface.
 *
 * Local-first by default.
 * Outputs bounded normalized suggestions with `manualReviewRequired: true`.
 * No raw OCR text persistence or logging.
 * No automatic fallback or silent cloud invocation.
 */
export async function previewReceiptOcr(
  input: OcrPreviewInput,
  options: ReceiptOcrPreviewEngineOptions = {},
): Promise<OcrPreviewOutput> {
  const provider: OcrPreviewProvider = input.provider ?? 'local';
  const costPolicy: OcrCostPolicy = {
    ...DEFAULT_COST_POLICY,
    ...input.costPolicy,
  };

  // 1. Cost Policy Gate check (fail-closed before any processing)
  verifyCostPolicy(provider, costPolicy);

  // 2. Input validation
  if (!input.imageBytes || input.imageBytes.byteLength === 0) {
    throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.EMPTY_INPUT);
  }

  if (input.imageBytes.byteLength > 10 * 1024 * 1024) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.INPUT_TOO_LARGE);
  if (input.signal?.aborted) throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);

  // 3. Provider Routing (no silent fallback between engines)
  if (provider === 'local') {
    let lines: RecognizedTextLine[];
    const runner = options.localVisionRunner ?? runMacosVisionOcr;
    try {
      lines = await runner(input.imageBytes, {
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });
    } catch (err: unknown) {
      if (err instanceof OcrPreviewError) throw err;
      throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR);
    }

    const normalizedResult = parseReceiptLinesDeterministically(lines);

    return {
      engine: 'local-vision',
      manualReviewRequired: true,
      cloudCalls: 0,
      result: normalizedResult,
    };
  }

  if (provider === 'gemini') {
    return await runGeminiOcrPreview(input, {
      runner: options.geminiRunner,
    });
  }

  if (provider === 'openai') {
    return await runOpenAiOcrPreview(input, {
      runner: options.openAiRunner,
    });
  }

  throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY);
}
