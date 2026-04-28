import { describe, expect, test } from 'bun:test';
import {
  getReceiptOcrPromptExperiment,
  RECEIPT_OCR_EXTRACTION_PROMPT,
  RECEIPT_OCR_PREPROCESS_EXPERIMENTS,
  RECEIPT_OCR_PREPROCESS_VERSION,
  RECEIPT_OCR_PROMPT_EXPERIMENTS,
  RECEIPT_OCR_PROMPT_VERSION,
} from '@/lib/ocr/receipt-prompt';

describe('receipt OCR prompt/preprocess experiment registry', () => {
  test('keeps production prompt v2 unchanged while registering v3 experiments', () => {
    expect(RECEIPT_OCR_PROMPT_VERSION).toBe('receipt-extraction-v2');
    expect(RECEIPT_OCR_EXTRACTION_PROMPT).not.toContain('store_name_candidates');
    expect(getReceiptOcrPromptExperiment('gemini').version).toContain('v3-gemini');
    expect(RECEIPT_OCR_PROMPT_EXPERIMENTS.qwen.prompt).toContain('JSON 외 텍스트 금지');
    expect(RECEIPT_OCR_PROMPT_EXPERIMENTS.llama.prompt).toContain('compact JSON only');
  });

  test('marks the current preprocess as the only production default candidate', () => {
    const defaults = RECEIPT_OCR_PREPROCESS_EXPERIMENTS.filter((experiment) => experiment.productionDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0].version).toBe(RECEIPT_OCR_PREPROCESS_VERSION);
    expect(RECEIPT_OCR_PREPROCESS_EXPERIMENTS.map((experiment) => experiment.version)).toContain('receipt-image-grayscale-sharpen-v1');
  });
});
