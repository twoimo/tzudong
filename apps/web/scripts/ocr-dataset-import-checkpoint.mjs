#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const datasetId = process.argv[2];
if (!datasetId) {
  console.error('Usage: node scripts/ocr-dataset-import-checkpoint.mjs <dataset_id>');
  process.exit(2);
}

const root = process.cwd();
const allowlistPath = path.join(root, '.omx/datasets/ocr/allowlist/candidates.json');
const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
const record = allowlist.records.find((item) => item.dataset_id === datasetId);
const reasons = [];

if (!record) {
  reasons.push(`dataset_id ${datasetId} is not allowlisted`);
} else {
  if (!record.source_url.startsWith('http://') && !record.source_url.startsWith('https://')) reasons.push('source_url must be http(s)');
  if (!record.license_url_or_text || record.license_url_or_text.toLowerCase() === 'unknown') reasons.push('license must be reviewed before reading real dataset files');
  if ((record.access_status ?? 'license_review_required') !== 'approved') {
    reasons.push(`dataset access_status must be approved before reading real files (current: ${record.access_status ?? 'license_review_required'})`);
  }
  if (!String(record.storage_path).startsWith('.omx/datasets/ocr/raw/')) reasons.push('storage_path must stay under .omx/datasets/ocr/raw/');
  if (record.committable && !record.redistribution_allowed) reasons.push('committable raw data requires redistribution permission');
  if (record.committable && !record.derivative_labels_allowed) reasons.push('committable derived labels require derivative-label permission');
  if (record.committable && record.contains_pii_risk && record.redaction_policy === 'local_only') reasons.push('committable PII-risk data must be redacted or excluded');
}

const outDir = path.join(root, '.omx/reports/ocr-datasets');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${datasetId}-checkpoint.md`);
await writeFile(outPath, [
  '# OCR dataset import checkpoint',
  '',
  `- Dataset: ${datasetId}`,
  `- Allowlist: ${path.relative(root, allowlistPath)}`,
  `- Status: ${reasons.length ? 'blocked' : 'allowed'}`,
  '',
  '## Reasons',
  '',
  ...(reasons.length ? reasons.map((reason) => `- ${reason}`) : ['- allowlist record passed pre-import checks']),
  '',
].join('\n'));

console.log(outPath);
if (reasons.length) process.exit(1);
