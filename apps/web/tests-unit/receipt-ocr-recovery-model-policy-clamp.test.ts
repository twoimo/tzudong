import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

mock.module('server-only', () => ({}));

const root = resolve(import.meta.dir, '..');
const source = readFileSync(join(root, 'lib/ocr/admin-receipt-recovery.ts'), 'utf8');
const { clampReceiptOcrRecoveryModelPolicy, RECEIPT_OCR_RECOVERY_MODEL_LIMIT, RECEIPT_OCR_RECOVERY_MODEL_NAME_LIMIT } =
  await import('../lib/ocr/admin-receipt-recovery');

describe('receipt OCR recovery model policy clamp', () => {
  test('keeps a policy that already fits the sealed guard untouched', () => {
    const policy = ['gemini-3.8-flash', 'gemini-3.6-flash'];
    expect(clampReceiptOcrRecoveryModelPolicy(policy)).toEqual(policy);
  });

  test('trims to the three models the sealed RPC accepts', () => {
    const clamped = clampReceiptOcrRecoveryModelPolicy(['a', 'b', 'c', 'd', 'e']);
    expect(clamped).toEqual(['a', 'b', 'c']);
    expect(clamped).toHaveLength(RECEIPT_OCR_RECOVERY_MODEL_LIMIT);
  });

  test('drops names the guard would reject and keeps the rest', () => {
    const long = 'm'.repeat(RECEIPT_OCR_RECOVERY_MODEL_NAME_LIMIT + 1);
    const atLimit = 'm'.repeat(RECEIPT_OCR_RECOVERY_MODEL_NAME_LIMIT);
    expect(clampReceiptOcrRecoveryModelPolicy([long, atLimit, 'gemini-3.8-flash'])).toEqual([atLimit, 'gemini-3.8-flash']);
  });

  test('normalizes whitespace and removes duplicates without reordering', () => {
    expect(clampReceiptOcrRecoveryModelPolicy([' gemini-3.8-flash ', 'gemini-3.8-flash', 'gemini-3.6-flash']))
      .toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
  });

  test('returns an empty policy when nothing fits, so the caller fails closed', () => {
    expect(clampReceiptOcrRecoveryModelPolicy(['m'.repeat(121)])).toEqual([]);
    expect(clampReceiptOcrRecoveryModelPolicy([])).toEqual([]);
  });

  test('the RPC call receives the clamped policy and refuses an empty one', () => {
    expect(source).toContain('const recoveryModelPolicy = clampReceiptOcrRecoveryModelPolicy(policy.modelPolicy);');
    expect(source).toContain('if (recoveryModelPolicy.length === 0) throw new ReceiptOcrRecoveryPersistenceError();');
    expect(source).toContain('p_model_policy: recoveryModelPolicy,');
    // The execution authorization keeps the resolved policy: the recovery readback
    // hands it the stored (clamped) list, and the RPC compares equality with it.
    expect(source).toContain("p_model_policy: policy.modelPolicy,\n    p_thinking_level: policy.inferenceConfig.thinkingLevel,\n    p_prompt_version: input.promptVersion,\n    p_preprocess_version: input.preprocessVersion,\n    p_normalization_version: input.normalizationVersion,\n  });\n  if (error || !isRecord(data)\n    || !hasOnlyKeys(data, ['schema_version', 'status', 'review_id', 'generation', 'recovery_operation_id'])");
  });
});
