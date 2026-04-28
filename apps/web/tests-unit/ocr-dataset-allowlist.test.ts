import { describe, expect, test } from 'bun:test';
import allowlist from '../.omx/datasets/ocr/allowlist/candidates.json';
import { canReadExternalReceiptOcrDataset, validateReceiptOcrDatasetAllowlistRecord } from '@/lib/ocr/dataset-allowlist';

describe('receipt OCR external dataset allowlist', () => {
  test('keeps all candidate raw datasets outside git and validates reviewed records', () => {
    const records = allowlist.records;
    expect(records.length).toBeGreaterThanOrEqual(4);
    for (const record of records) {
      expect(record.storage_path.startsWith('.omx/datasets/ocr/raw/')).toBe(true);
      expect(validateReceiptOcrDatasetAllowlistRecord(record).ok).toBe(true);
    }
  });

  test('blocks placeholder Kaggle imports until exact license is reviewed', () => {
    const kaggle = allowlist.records.find((record) => record.dataset_id === 'kaggle-receipt-placeholder');
    expect(kaggle).toBeTruthy();
    const gate = canReadExternalReceiptOcrDataset(kaggle!);
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toContain('license must be reviewed before reading real dataset files');
    expect(gate.reasons.some((reason) => reason.includes('access_status must be approved'))).toBe(true);
  });

  test('blocks manual-download datasets until access and license review are recorded as approved', () => {
    const aihub = allowlist.records.find((record) => record.dataset_id === 'aihub-large-public-ocr');
    expect(aihub).toBeTruthy();
    const gate = canReadExternalReceiptOcrDataset(aihub!);
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toContain('dataset access_status must be approved before reading real files (current: manual_download_required)');
  });
});
