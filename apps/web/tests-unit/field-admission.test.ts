import { expect, test } from 'bun:test';
import { createFieldAdmissionGate } from '../lib/performance/field-admission';
import { isCredentiallessFieldVitalsPost } from '../lib/auth/public-eligibility-session';

test('bounds each platform source, the worker and reset window without persistent identities', () => {
  const gate = createFieldAdmissionGate();
  for (let i = 0; i < 36; i++) expect(gate('192.0.2.1', 60_001)).toBe(true);
  expect(gate('192.0.2.1', 60_001)).toBe(false);
  for (let i = 0; i < 36; i++) expect(gate('192.0.2.2', 60_001)).toBe(true);
  for (let i = 0; i < 8; i++) expect(gate('192.0.2.3', 60_001)).toBe(true);
  expect(gate('192.0.2.4', 60_001)).toBe(false);
  expect(gate('192.0.2.1', 120_001)).toBe(true);
});
test('unknown or untrusted sources share a bounded bucket', () => {
  const gate = createFieldAdmissionGate();
  for (let i = 0; i < 36; i++) expect(gate(null, 1)).toBe(true);
  expect(gate('forged-invalid-address', 1)).toBe(false);
});
test('session bypass is exact, credentialless and leaves other paths protected', () => {
  const base = { pathname: '/api/performance/web-vitals', method: 'POST', hasCookie: false, hasAuthorization: false };
  expect(isCredentiallessFieldVitalsPost(base)).toBe(true);
  for (const patch of [{ hasCookie: true }, { hasAuthorization: true }, { method: 'GET' },
    { pathname: '/api/admin/performance' }, { pathname: '/api/performance/web-vitals/' }]) {
    expect(isCredentiallessFieldVitalsPost({ ...base, ...patch })).toBe(false);
  }
});
