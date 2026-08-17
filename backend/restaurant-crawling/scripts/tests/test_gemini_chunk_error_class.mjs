import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGeminiHttpReason, errorHttpStatus, isQuotaError, isTransientServerError } from '../gemini_chunk_video_request.mjs';

function err(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

test('does not treat HTTP 500 or 403 as quota', () => {
  assert.equal(isQuotaError(err('500 Internal Server Error')), false);
  assert.equal(isQuotaError(err('403 Forbidden')), false);
  assert.equal(isQuotaError(err('timeout 4291 ms')), false);
  assert.equal(isQuotaError(err('RESOURCE_EXHAUSTED')), true);
  assert.equal(isQuotaError(err('[QUOTA_ERROR]')), true);
  assert.equal(isQuotaError(err('HTTP 429 Too Many Requests')), true);
  assert.equal(isQuotaError(err('x', 'GEMINI_QUOTA_EXHAUSTED')), true);
});

test('treats upload timeouts as transient, not quota', () => {
  assert.equal(isTransientServerError(err('x', 'GEMINI_API_TIMEOUT')), true);
  assert.equal(isTransientServerError(err('503 Service Unavailable')), true);
  assert.equal(isTransientServerError(err('500 Internal Server Error')), true);
  assert.equal(isQuotaError(err('x', 'GEMINI_API_TIMEOUT')), false);
});
test('classifies numeric SDK status without treating 403 as quota', () => {
  const forbidden = Object.assign(new Error('fetch failed'), { status: 403 });
  const quota = Object.assign(new Error('rate limited'), { status: 429 });
  const server = Object.assign(new Error('backend exploded'), { status: 500 });
  assert.equal(errorHttpStatus(forbidden), 403);
  assert.equal(isQuotaError(forbidden), false);
  assert.equal(isTransientServerError(forbidden), false);
  assert.equal(isQuotaError(quota), true);
  assert.equal(isTransientServerError(server), true);
  assert.equal(isQuotaError(server), false);
});

test('chunk request uses @google/genai file upload', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemini_chunk_video_request.mjs');
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /from '@google\/genai'/);
  assert.match(source, /ai\.files\.upload\(/);
  assert.doesNotMatch(source, /GoogleAIFileManager/);
  assert.doesNotMatch(source, /from '@google\/generative-ai'/);
});
test('classifies HTTP 400 thinking and model rejections', () => {
  const thinking = Object.assign(new Error('{"error":{"message":"thinkingConfig is not supported"}}'), { status: 400 });
  const model = Object.assign(new Error('{"error":{"message":"model is not found"}}'), { status: 400 });
  assert.equal(classifyGeminiHttpReason(thinking), 'GEMINI_THINKING_UNSUPPORTED');
  assert.equal(classifyGeminiHttpReason(model), 'GEMINI_MODEL_REJECTED');
});
test('classifies API key INVALID_ARGUMENT as rejected key', () => {
  const rejected = Object.assign(new Error('{"error":{"message":"API key not valid","status":"INVALID_ARGUMENT"}}'), { status: 400 });
  assert.equal(classifyGeminiHttpReason(rejected), 'GEMINI_API_KEY_REJECTED');
});

test('rejected API key exits 44 instead of generic retries', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemini_chunk_video_request.mjs');
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /GEMINI_CHUNK_API_KEY_REJECTED/);
  assert.match(source, /process\.exit\(44\)/);
});

test('generate request wraps file parts in a user Content object', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemini_chunk_video_request.mjs');
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /role: 'user'/);
  assert.match(source, /parts: \[/);
  assert.match(source, /GEMINI_THINKING_RETRY_WITHOUT_CONFIG/);
});
