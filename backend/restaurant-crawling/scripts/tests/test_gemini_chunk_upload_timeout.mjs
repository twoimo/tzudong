import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemini_chunk_video_request.mjs');

test('chunk video upload timeout is five minutes', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /ai\.files\.upload\(\{[\s\S]*?\}\), UPLOAD_TIMEOUT_MS\)/);
  assert.match(source, /const UPLOAD_TIMEOUT_MS = 300000;/);
  assert.doesNotMatch(source, /GoogleAIFileManager/);
});
