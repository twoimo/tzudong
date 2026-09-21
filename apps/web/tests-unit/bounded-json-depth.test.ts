import { describe, expect, test } from 'bun:test';

import { readBoundedJsonRequest } from '../lib/security/bounded-json-request';

function read(source: string) {
  return readBoundedJsonRequest(new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: source,
  }), 64 * 1024);
}

describe('bounded JSON nesting', () => {
  test('accepts ordinary JSON and the 64-container boundary', async () => {
    for (const source of ['null', '{}', '[]', '{"items":[{"name":"서울"}]}', '['.repeat(64) + '0' + ']'.repeat(64)]) {
      expect(await read(source)).toEqual({ ok: true, value: JSON.parse(source) });
    }
  });

  test('rejects excessive object, array, and mixed nesting before stack exhaustion', async () => {
    for (const source of [
      '['.repeat(65) + '0' + ']'.repeat(65),
      '{"x":'.repeat(65) + '0' + '}'.repeat(65),
      '{"x":['.repeat(33) + '0' + ']}'.repeat(33),
      '['.repeat(10_000) + '0' + ']'.repeat(10_000),
    ]) {
      expect(await read(source)).toEqual({ ok: false, code: 'INVALID_JSON' });
    }
  });

  test('rejects empty, malformed, and escaped duplicate-member injection', async () => {
    for (const source of ['', ' ', '{', '{"role":"user","\\u0072ole":"admin"}']) {
      expect(await read(source)).toEqual({ ok: false, code: 'INVALID_JSON' });
    }
  });
});
