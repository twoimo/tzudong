import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { privacySafeCliLog } from './privacy-safe-cli-log.mjs';

export const PRIVACY_RETENTION_ENDPOINT = 'https://internal.tzudong.app/api/internal/privacy-retention';
export const PRIVACY_RETENTION_BATCH_SIZE = 100;
export const PRIVACY_RETENTION_REQUEST_TIMEOUT_MS = 15_000;

const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_CLASS_CODES = 20;
const MAX_CLASS_CODE_CONFIG_BYTES = 2_048;
const CLASS_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const REQUIRED_READBACK_CHECKS = [
  'expectedCountMatched',
  'databaseSourceAbsent',
  'storageProviderAbsent',
  'noActiveHoldMutated',
];
const CONFIRMATION_TEXT = '보존·분리 적용';

export class PrivacyRetentionScheduleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PrivacyRetentionScheduleError';
    this.code = code;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isCanonicalUtcTimestamp = (value) => {
  if (typeof value !== 'string' || value.length !== 24 || !value.endsWith('Z')) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
};

export const canonicalUtcCutoff = (now = new Date()) => {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_cutoff_invalid');
  }
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )).toISOString();
};

export const deriveIdempotencyKey = ({
  operationId,
  previewHash,
  adapterVersion,
  sourceMappingVersion,
  classCode,
  cutoff,
}) => {
  if (
    !UUID_PATTERN.test(operationId)
    || !HASH_PATTERN.test(previewHash)
    || !HASH_PATTERN.test(adapterVersion)
    || !HASH_PATTERN.test(sourceMappingVersion)
    || !CLASS_CODE_PATTERN.test(classCode)
    || !isCanonicalUtcTimestamp(cutoff)
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_idempotency_invalid');
  }
  return `retention:${createHash('sha256')
    .update(`${operationId}:${previewHash}:${adapterVersion}:${sourceMappingVersion}:${classCode}:${cutoff}`, 'utf8')
    .digest('hex')}`;
};

export const parseScheduleConfig = (env = process.env) => {
  if (
    env.NODE_ENV !== 'production'
    || env.PRIVACY_RETENTION_SCHEDULED_RUN !== 'true'
    || env.PRIVACY_RETENTION_ENDPOINT !== PRIVACY_RETENTION_ENDPOINT
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_not_production');
  }

  const capability = env.PRIVACY_RETENTION_INTERNAL_CAPABILITY;
  if (typeof capability !== 'string' || Buffer.byteLength(capability, 'utf8') < 32) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_capability_invalid');
  }

  const rawClassCodes = env.PRIVACY_RETENTION_CLASS_CODES;
  if (
    typeof rawClassCodes !== 'string'
    || rawClassCodes.length === 0
    || Buffer.byteLength(rawClassCodes, 'utf8') > MAX_CLASS_CODE_CONFIG_BYTES
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_classes_invalid');
  }

  const classCodes = rawClassCodes.split(',').map((value) => value.trim());
  if (
    classCodes.length === 0
    || classCodes.length > MAX_CLASS_CODES
    || classCodes.some((classCode) => !CLASS_CODE_PATTERN.test(classCode))
    || new Set(classCodes).size !== classCodes.length
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_classes_invalid');
  }

  return { endpoint: PRIVACY_RETENTION_ENDPOINT, capability, classCodes };
};

const readBoundedJson = async (response) => {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
  }

  let text = '';
  const reader = response.body?.getReader?.();
  if (!reader) {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
    }
  } else {
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
        }
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
  }
};

const parsePreview = (value, cutoff) => {
  if (!hasExactKeys(value, ['ok', 'preview']) || value.ok !== true || !isRecord(value.preview)) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_preview_invalid');
  }

  const preview = value.preview;
  if (
    !hasExactKeys(preview, [
      'operationId',
      'previewHash',
      'adapterVersion',
      'sourceMappingVersion',
      'expiresAt',
      'summary',
      'requiredConfirmation',
    ])
    || !UUID_PATTERN.test(preview.operationId)
    || !HASH_PATTERN.test(preview.previewHash)
    || !HASH_PATTERN.test(preview.adapterVersion)
    || !HASH_PATTERN.test(preview.sourceMappingVersion)
    || !isCanonicalUtcTimestamp(preview.expiresAt)
    || preview.requiredConfirmation !== CONFIRMATION_TEXT
    || !isRecord(preview.summary)
    || !hasExactKeys(preview.summary, ['cutoff', 'eligible', 'held', 'scanned'])
    || preview.summary.cutoff !== cutoff
    || !isCount(preview.summary.eligible)
    || !isCount(preview.summary.held)
    || !isCount(preview.summary.scanned)
    || preview.summary.scanned !== preview.summary.eligible + preview.summary.held
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_preview_invalid');
  }

  return preview;
};

const parseReceipt = (value, expectedPreview) => {
  if (!hasExactKeys(value, ['ok', 'receipt']) || value.ok !== true || !isRecord(value.receipt)) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_receipt_invalid');
  }

  const receipt = value.receipt;
  if (
    !hasExactKeys(receipt, [
      'operationId',
      'status',
      'adapterVersion',
      'sourceMappingVersion',
      'readback',
      'auditId',
      'errorCode',
    ])
    || receipt.operationId !== expectedPreview.operationId
    || !UUID_PATTERN.test(receipt.operationId)
    || !['applied', 'partial', 'failed'].includes(receipt.status)
    || !HASH_PATTERN.test(receipt.adapterVersion)
    || receipt.adapterVersion !== expectedPreview.adapterVersion
    || !HASH_PATTERN.test(receipt.sourceMappingVersion)
    || receipt.sourceMappingVersion !== expectedPreview.sourceMappingVersion
    || !UUID_PATTERN.test(receipt.auditId)
    || (receipt.errorCode !== null
      && (typeof receipt.errorCode !== 'string' || !SAFE_ERROR_CODE_PATTERN.test(receipt.errorCode)))
    || !isRecord(receipt.readback)
    || !hasExactKeys(receipt.readback, ['passed', 'checks'])
    || typeof receipt.readback.passed !== 'boolean'
    || !isRecord(receipt.readback.checks)
    || !hasExactKeys(receipt.readback.checks, REQUIRED_READBACK_CHECKS)
    || (receipt.status === 'applied'
      && (!receipt.readback.passed
        || receipt.errorCode !== null
        || Object.values(receipt.readback.checks).some((passed) => passed !== true)))
  ) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_receipt_invalid');
  }

  return receipt;
};

const postRetention = async ({ endpoint, capability, body, fetchImplementation, requestTimeoutMs }) => {
  const encodedBody = JSON.stringify(body);
  if (Buffer.byteLength(encodedBody, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_request_invalid');
  }

  const controller = new AbortController();
  let timer;
  try {
    const response = await Promise.race([
      fetchImplementation(endpoint, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-privacy-retention-capability': capability,
        },
        body: encodedBody,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new PrivacyRetentionScheduleError('privacy_retention_schedule_timeout'));
        }, requestTimeoutMs);
      }),
    ]);

    if (
      !response
      || response.status !== 200
      || response.redirected === true
      || (typeof response.url === 'string' && response.url.length > 0 && response.url !== endpoint)
      || !response.headers
      || typeof response.headers.get !== 'function'
    ) {
      throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
    }
    const contentType = response.headers.get('content-type');
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      throw new PrivacyRetentionScheduleError('privacy_retention_schedule_response_invalid');
    }
    return readBoundedJson(response);
  } catch (error) {
    if (error instanceof PrivacyRetentionScheduleError) throw error;
    if (controller.signal.aborted) {
      throw new PrivacyRetentionScheduleError('privacy_retention_schedule_timeout');
    }
    throw new PrivacyRetentionScheduleError('privacy_retention_schedule_request_failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const logResult = (log, classCode, status, summary) => {
  log({
    classCode,
    status,
    eligible: summary.eligible,
    held: summary.held,
    scanned: summary.scanned,
  });
};

export const runPrivacyRetentionSchedule = async ({
  env = process.env,
  fetchImplementation = globalThis.fetch,
  now = new Date(),
  log = privacySafeCliLog,
  requestTimeoutMs = PRIVACY_RETENTION_REQUEST_TIMEOUT_MS,
} = {}) => {
  let config;
  let cutoff;
  try {
    config = parseScheduleConfig(env);
    cutoff = canonicalUtcCutoff(now);
    if (typeof fetchImplementation !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new PrivacyRetentionScheduleError('privacy_retention_schedule_configuration_invalid');
    }
  } catch (error) {
    logResult(log, 'scheduler', 'failed', { eligible: 0, held: 0, scanned: 0 });
    throw error;
  }

  const results = [];
  for (const classCode of config.classCodes) {
    let summary = { eligible: 0, held: 0, scanned: 0 };
    try {
      const preview = parsePreview(await postRetention({
        endpoint: config.endpoint,
        capability: config.capability,
        fetchImplementation,
        requestTimeoutMs,
        body: {
          action: 'preview',
          classCode,
          asOf: cutoff,
          batchSize: PRIVACY_RETENTION_BATCH_SIZE,
        },
      }), cutoff);
      summary = preview.summary;

      if (summary.eligible === 0) {
        const result = { classCode, status: 'skipped', ...summary };
        results.push(result);
        logResult(log, classCode, result.status, summary);
        continue;
      }

      const idempotencyKey = deriveIdempotencyKey({
        operationId: preview.operationId,
        previewHash: preview.previewHash,
        adapterVersion: preview.adapterVersion,
        sourceMappingVersion: preview.sourceMappingVersion,
        classCode,
        cutoff,
      });
      const receipt = parseReceipt(await postRetention({
        endpoint: config.endpoint,
        capability: config.capability,
        fetchImplementation,
        requestTimeoutMs,
        body: {
          action: 'apply',
          operationId: preview.operationId,
          previewHash: preview.previewHash,
          confirmationText: CONFIRMATION_TEXT,
          idempotencyKey,
          adapterVersion: preview.adapterVersion,
          sourceMappingVersion: preview.sourceMappingVersion,
          batchSize: PRIVACY_RETENTION_BATCH_SIZE,
        },
      }), preview);

      if (
        receipt.operationId !== preview.operationId
        || receipt.status !== 'applied'
        || receipt.readback.passed !== true
      ) {
        throw new PrivacyRetentionScheduleError('privacy_retention_schedule_readback_failed');
      }

      const result = { classCode, status: 'applied', ...summary };
      results.push(result);
      logResult(log, classCode, result.status, summary);
    } catch (error) {
      logResult(log, classCode, 'failed', summary);
      throw error;
    }
  }

  return { cutoff, results };
};

const isDirectExecution = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void runPrivacyRetentionSchedule().catch(() => {
    process.exitCode = 1;
  });
}
