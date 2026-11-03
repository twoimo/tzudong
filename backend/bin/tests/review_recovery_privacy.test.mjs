import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('../review_recovery_privacy.mjs', import.meta.url));
const check = input => spawnSync(process.execPath, ['--no-warnings', bridge], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000,
});
test('central sanitizer accepts business coordinates and bounded public evidence', () => {
  const value = check({ lat: 37.123, lng: 127.123, evaluation_results: { basis: 'Public restaurant evidence' } });
  assert.equal(value.status, 0); assert.equal(value.stdout, 'PRIVACY_SAFE\n'); assert.equal(value.stderr, '');
});
for (const [name, value] of Object.entries({
  email: { eval_basis: 'private-canary@example.com' },
  cookie: { cookie: 'private-cookie-canary' },
  rawOcr: { raw_ocr: 'private-ocr-canary' },
  invalid: '{private-invalid-json',
  oversized: 'x'.repeat(65537),
})) {
  test(`central sanitizer rejects ${name} without echo`, () => {
    const observed = check(value);
    assert.equal(observed.status, 1);
    assert.equal(observed.stdout, 'PRIVACY_REJECTED\n');
    assert.equal(observed.stderr, '');
  });
}
