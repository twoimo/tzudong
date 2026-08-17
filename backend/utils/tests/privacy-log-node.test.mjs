import assert from 'node:assert/strict';
import test from 'node:test';

import { logSafeError, redactLogText, safeErrorName } from '../privacy-log.mjs';

test('redactLogText removes credentials and personal data without partial bearer leakage', () => {
  const input = [
    'Authorization: Bearer private-token-value',
    'password=plain-secret',
    'email=user@example.com',
    'phone=010-1234-5678',
    'rrn=900101-1234567',
    'lat=37.5665 lng=126.9780',
    'migration=20260712000100_g010_privacy_foundation.sql',
    'raw_ocr=카드 원문',
  ].join(' ');
  const result = redactLogText(input);

  for (const forbidden of [
    'private-token-value',
    'plain-secret',
    'user@example.com',
    '010-1234-5678',
    '900101-1234567',
    '37.5665',
    '카드 원문',
  ]) {
    assert.equal(result.includes(forbidden), false);
  }
  assert.equal(result.includes('20260712000100_g010_privacy_foundation.sql'), true);
});

test('redactLogText bounds oversized diagnostics without retaining a prefix', () => {
  const secret = `password=${'x'.repeat(10_000)}`;
  assert.equal(redactLogText(secret, 64), '[TRUNCATED]');
});

test('logSafeError emits only an allowlisted name and code', () => {
  const error = Object.assign(new Error('password=plain-secret user@example.com'), { code: 'PROVIDER_FAILED' });
  let output = '';
  const line = logSafeError(error, (value) => { output += value; });

  assert.equal(line, 'error=Error code=PROVIDER_FAILED\n');
  assert.equal(output, line);
  assert.equal(safeErrorName(new Proxy({}, { get() { throw new Error('blocked'); } })), 'backend_error');
});
test('logSafeError promotes a safe Error message into code', () => {
  const error = new Error('SPLIT_VIDEO_FFMPEG_FAILED');
  let output = '';
  const line = logSafeError(error, (value) => { output += value; });
  assert.equal(line, 'error=Error code=SPLIT_VIDEO_FFMPEG_FAILED\n');
  assert.equal(output, line);
});
test('logSafeError promotes numeric SDK HTTP status into code', () => {
  const error = Object.assign(new Error('[GoogleGenerativeAI Error]: fetch failed'), { status: 403 });
  let output = '';
  const line = logSafeError(error, (value) => { output += value; });
  assert.equal(line, 'error=Error code=HTTP_403\n');
  assert.equal(output, line);
});
