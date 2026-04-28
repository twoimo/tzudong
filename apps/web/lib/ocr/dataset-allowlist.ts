export type ReceiptOcrDatasetAllowlistRecord = {
  dataset_id: string;
  source_url: string;
  license_url_or_text: string;
  access_status?: 'approved' | 'license_review_required' | 'manual_download_required' | 'blocked_placeholder';
  redistribution_allowed: boolean;
  derivative_labels_allowed: boolean;
  contains_pii_risk: boolean;
  redaction_policy: 'exclude_sensitive_fields' | 'redact_text' | 'local_only';
  storage_path: `.omx/datasets/ocr/raw/${string}`;
  committable: boolean;
  notes: string;
};

export type ReceiptOcrDatasetAllowlistValidation = {
  ok: boolean;
  reasons: string[];
};

export function validateReceiptOcrDatasetAllowlistRecord(
  record: ReceiptOcrDatasetAllowlistRecord,
): ReceiptOcrDatasetAllowlistValidation {
  const reasons: string[] = [];
  if (!record.dataset_id.trim()) reasons.push('dataset_id is required');
  if (!/^https?:\/\//.test(record.source_url)) reasons.push('source_url must be an http(s) URL');
  if (!record.license_url_or_text.trim()) reasons.push('license_url_or_text is required');
  if (record.access_status && !['approved', 'license_review_required', 'manual_download_required', 'blocked_placeholder'].includes(record.access_status)) {
    reasons.push('access_status must be approved/license_review_required/manual_download_required/blocked_placeholder');
  }
  if (!record.storage_path.startsWith('.omx/datasets/ocr/raw/')) reasons.push('storage_path must stay under .omx/datasets/ocr/raw/');
  if (record.committable && !record.redistribution_allowed) reasons.push('committable raw data requires redistribution permission');
  if (record.committable && !record.derivative_labels_allowed) reasons.push('committable derived labels require derivative-label permission');
  if (record.committable && record.contains_pii_risk && record.redaction_policy === 'local_only') {
    reasons.push('committable PII-risk data must be redacted or sensitive fields excluded');
  }
  return { ok: reasons.length === 0, reasons };
}

export function canReadExternalReceiptOcrDataset(record: ReceiptOcrDatasetAllowlistRecord): ReceiptOcrDatasetAllowlistValidation {
  const base = validateReceiptOcrDatasetAllowlistRecord(record);
  const reasons = [...base.reasons];
  if (record.license_url_or_text.toLowerCase() === 'unknown') reasons.push('license must be reviewed before reading real dataset files');
  if ((record.access_status ?? 'license_review_required') !== 'approved') {
    reasons.push(`dataset access_status must be approved before reading real files (current: ${record.access_status ?? 'license_review_required'})`);
  }
  if (record.contains_pii_risk && record.redaction_policy === 'local_only' && record.committable) {
    reasons.push('local_only PII-risk data cannot be marked committable');
  }
  return { ok: reasons.length === 0, reasons };
}
