import type { ReceiptOcrData } from '@/lib/ocr/types';

export const OCR_PREVIEW_PROVIDERS = ['local', 'gemini', 'openai'] as const;
export type OcrPreviewProvider = (typeof OCR_PREVIEW_PROVIDERS)[number];

export type OcrCostPolicy = {
  /** Allow local on-device OCR (Vision on macOS). Default: true */
  allowLocal: boolean;
  /** Allow free-tier cloud execution. Default: false */
  allowFreeCloud: boolean;
  /**
   * Explicit server free-tier attestation for Gemini.
   * State limitation note: this configuration flag documents operator attestation
   * and intent; it cannot mathematically prove upstream provider billing status.
   */
  geminiFreeTierAttested: boolean;
  /** Allow paid cloud providers (OpenAI). Default: false */
  allowPaidCloud: boolean;
};

export type OcrPreviewInput = {
  imageBytes: Uint8Array;
  mimeType?: string;
  provider?: OcrPreviewProvider;
  costPolicy?: Partial<OcrCostPolicy>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OcrPreviewOutput = {
  engine: string;
  manualReviewRequired: true;
  cloudCalls: number;
  result: ReceiptOcrData;
  error?: string;
};

export type RecognizedTextLine = {
  text: string;
  confidence?: number;
};

export const OCR_PREVIEW_ERROR_CODES = {
  POLICY_DENIED_LOCAL_ONLY: 'POLICY_DENIED_LOCAL_ONLY',
  GEMINI_FREE_TIER_NOT_ATTESTED: 'GEMINI_FREE_TIER_NOT_ATTESTED',
  OPENAI_PAID_POLICY_DENIED: 'OPENAI_PAID_POLICY_DENIED',
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_IMAGE_DATA: 'INVALID_IMAGE_DATA',
  TIMEOUT: 'TIMEOUT',
  LOCAL_ENGINE_UNAVAILABLE: 'LOCAL_ENGINE_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  UNREADABLE_RECEIPT: 'UNREADABLE_RECEIPT',
} as const;

export type OcrPreviewErrorCode = (typeof OCR_PREVIEW_ERROR_CODES)[keyof typeof OCR_PREVIEW_ERROR_CODES];

export class OcrPreviewError extends Error {
  readonly code: OcrPreviewErrorCode;
  readonly safeDetails?: Record<string, unknown>;

  constructor(code: OcrPreviewErrorCode, safeDetails?: Record<string, unknown>) {
    super(code);
    this.name = 'OcrPreviewError';
    this.code = code;
    this.safeDetails = safeDetails;
  }
}
