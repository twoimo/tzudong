# Receipt OCR datasets and compliance policy

This document defines the allowed acquisition/evaluation policy for receipt OCR experiments.
Raw third-party images must stay outside git unless redistribution and derivative-label rights are explicitly verified.

## Local storage policy

- Raw downloads: `.omx/datasets/ocr/raw/<dataset_id>/` (git-ignored)
- Converted local-only reports: `.omx/reports/ocr-datasets/<timestamp>-<dataset_id>.md`
- Commit-safe fixtures: `tests-unit/fixtures/ocr/*.gold.json` only when labels are original, redacted, or license-compatible.
- Never commit card numbers, approval numbers, tax IDs, phone numbers, personal names, or full addresses unless intentionally redacted.

## Dataset allowlist schema

```json
{
  "dataset_id": "string",
  "source_url": "string",
  "license_url_or_text": "string",
  "access_status": "approved | license_review_required | manual_download_required | blocked_placeholder",
  "redistribution_allowed": false,
  "derivative_labels_allowed": false,
  "contains_pii_risk": true,
  "redaction_policy": "exclude_sensitive_fields | redact_text | local_only",
  "storage_path": ".omx/datasets/ocr/raw/<dataset_id>",
  "committable": false,
  "notes": "string"
}
```

## Current candidate allowlist

| dataset_id | Source | License/status | Fit | Policy |
| --- | --- | --- | --- | --- |
| `cord` | https://github.com/clovaai/cord | CC-BY-4.0 shown by upstream repo. Indonesian receipt images with OCR and parsing labels. | Good for menu/receipt layout and item extraction; weak for Korean restaurant names. | `access_status=approved`; local raw import allowed after attribution. Commit only derived aggregate metrics or explicitly attributed/redacted labels. |
| `sroie-hf` | https://huggingface.co/datasets/jsdnrs/ICDAR2019-SROIE | HF card states original SROIE and modifications remain CC-BY-4.0. | Good for company/date/total KIE and noisy scanned receipts; weak for Korean/menu fields. | `access_status=approved`; local raw import allowed after attribution. Treat addresses as sensitive; committed fixtures must redact addresses. |
| `aihub-large-public-ocr` | https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71299 | AI Hub account/license terms must be checked at download time. Page describes public administrative OCR data, not restaurant receipts. | Useful only for Korean text recognition robustness; poor receipt-domain fit. | `access_status=manual_download_required`; block raw import until signed-in license/application review is recorded. Local-only unless redistribution/derivative rights are clear. |
| `kaggle-receipt-*` | Kaggle receipt OCR datasets | Dataset-specific license must be read from exact Kaggle metadata before use. | Potentially useful but heterogeneous and often non-Korean. | `access_status=license_review_required`; block automation until a per-dataset allowlist record confirms exact URL/license/no-PII policy. |

## Acceptance gates before production model/prompt changes

- At least 10 validated gold fixtures.
- At least 5 Korean restaurant or delivery/order receipts.
- Every fixture has `redaction_status` of `redacted` or `no_sensitive_fields_detected`.
- Candidate beats baseline by `overall_avg >= baseline_avg + 3`, or is within 1 point with `p95_latency_ms <= baseline_p95 * 0.8`.
- Store canonical/date/total average score must not regress by more than 2 points.
- Error/timeout rate must be `<= 5%`.
- OCR request path DB lookups must stay `<= 3` and context-building DB p95 should stay `<= 300ms` when measured.

## Enforced checkpoints

- Dataset records are persisted in `.omx/datasets/ocr/allowlist/candidates.json`.
- `validateReceiptOcrDatasetAllowlistRecord` blocks malformed or committable-without-rights records before real dataset reads.
- `canReadExternalReceiptOcrDataset` additionally requires `access_status=approved` before reading raw files. This prevents accidental AI Hub/Kaggle reads when the page is only a search result, a manual-download flow, or an unreviewed license.
- `evaluateReceiptOcrProductionPromotionGate`/`assertReceiptOcrProductionPromotionAllowed` must be used before changing production OCR prompt, preprocess, or model-routing defaults.
- Legacy OCR cache rows are reusable only when they contain `raw_ocr_result`; corrected-only `ocr_result` rows are intentionally ignored to avoid stale selected-restaurant corrections.
