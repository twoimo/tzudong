import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COST_POLICY,
  verifyCostPolicy,
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
} from '../lib/ocr/preview';

describe('OCR preview cost and execution policy', () => {
  test('defaults to local-only with all cloud providers disabled', () => {
    expect(DEFAULT_COST_POLICY.allowLocal).toBe(true);
    expect(DEFAULT_COST_POLICY.allowFreeCloud).toBe(false);
    expect(DEFAULT_COST_POLICY.geminiFreeTierAttested).toBe(false);
    expect(DEFAULT_COST_POLICY.allowPaidCloud).toBe(false);
  });

  test('permits local engine by default and rejects when local is disabled', () => {
    const verified = verifyCostPolicy('local');
    expect(verified.allowLocal).toBe(true);

    expect(() => verifyCostPolicy('local', { allowLocal: false })).toThrow(
      new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY),
    );
  });

  test('rejects Gemini under default local-only policy before any network fetch or key access', () => {
    expect(() => verifyCostPolicy('gemini')).toThrow(
      new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY),
    );
  });

  test('rejects Gemini when free cloud is allowed but explicit free-tier attestation is missing', () => {
    expect(() => verifyCostPolicy('gemini', { allowFreeCloud: true })).toThrow(
      new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.GEMINI_FREE_TIER_NOT_ATTESTED),
    );
  });

  test('permits Gemini only with explicit allowFreeCloud and freeTierAttested', () => {
    const policy = verifyCostPolicy('gemini', {
      allowFreeCloud: true,
      geminiFreeTierAttested: true,
    });
    expect(policy.allowFreeCloud).toBe(true);
    expect(policy.geminiFreeTierAttested).toBe(true);
  });

  test('rejects OpenAI without explicit allowPaidCloud configuration', () => {
    expect(() => verifyCostPolicy('openai')).toThrow(
      new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.OPENAI_PAID_POLICY_DENIED),
    );

    expect(() => verifyCostPolicy('openai', { allowFreeCloud: true })).toThrow(
      new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.OPENAI_PAID_POLICY_DENIED),
    );
  });

  test('permits OpenAI only with explicit allowPaidCloud configuration', () => {
    const policy = verifyCostPolicy('openai', { allowPaidCloud: true });
    expect(policy.allowPaidCloud).toBe(true);
  });
});
