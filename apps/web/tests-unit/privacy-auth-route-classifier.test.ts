import { expect, test } from 'bun:test';
import {
  classifyPublicEligibilitySessionRoute,
  type PublicEligibilitySessionRouteClass,
} from '@/lib/auth/public-eligibility-session';

function classify(path: string, method = 'GET'): PublicEligibilitySessionRouteClass {
  const url = new URL(path, 'http://localhost:3000');
  return classifyPublicEligibilitySessionRoute({
    pathname: url.pathname,
    method,
  });
}

const readMethods = ['GET', 'HEAD'] as const;
const writeMethods = ['POST', 'PUT'] as const;

test('admits only literal credentialless public routes for GET and HEAD', () => {
  for (const path of [
    '/',
    '/home-frame',
    '/stamp',
    '/privacy',
    '/data-deletion',
    '/api/health',
    '/api/shorten',
  ]) {
    for (const method of readMethods) {
      expect(classify(path, method)).toBe('credentialless-public');
    }
    for (const method of writeMethods) {
      expect(classify(path, method)).toBe('protected');
    }
  }
});

test('admits only declared loop-safe recovery and onboarding routes', () => {
  for (const path of [
    '/privacy/onboarding',
    '/auth/required?reason=eligibility&next=%2Fmypage',
    '/auth/reset-password?code=once-only-recovery-token&type=recovery',
  ]) {
    for (const method of readMethods) {
      expect(classify(path, method)).toBe('loop-safe');
    }
    for (const method of writeMethods) {
      expect(classify(path, method)).toBe('protected');
    }
  }

  expect(classify('/auth/callback', 'GET')).toBe('loop-safe');
  expect(classify('/auth/callback', 'HEAD')).toBe('protected');
  expect(classify('/auth/callback', 'POST')).toBe('protected');
  expect(classify('/auth/callback', 'PUT')).toBe('protected');

  expect(classify('/api/privacy/onboarding', 'GET')).toBe('loop-safe');
  expect(classify('/api/privacy/onboarding', 'POST')).toBe('loop-safe');
  expect(classify('/api/privacy/onboarding', 'HEAD')).toBe('protected');
  expect(classify('/api/privacy/onboarding', 'PUT')).toBe('protected');
  expect(classify('/api/auth/logout', 'POST')).toBe('loop-safe');
  expect(classify('/api/auth/logout', 'GET')).toBe('protected');
});

test('fails closed for encoded separators, repeated separators, and near-miss paths', () => {
  for (const path of [
    '/api%2fhealth',
    '/api%2Fhealth',
    '/api%5chealth',
    '/api%5Chealth',
    '/api//health',
    '/api/health/',
    '/api/healthz',
    '/api/shorten/extra',
    '/auth%2freset-password',
    '/auth%5crequired',
    '/auth//required',
    '/auth/required/',
    '/auth/reset-password-confirm',
    '/privacy/onboarding-extra',
  ]) {
    for (const method of [...readMethods, ...writeMethods]) {
      expect(classify(path, method)).toBe('protected');
    }
  }
});

test('queries, malformed query strings, and hostile next values never broaden access', () => {
  for (const path of [
    '/admin?next=/auth/required',
    '/mypage?next=https://attacker.example/auth/required',
    '/api/healthz?next=//attacker.example',
    '/auth/requiredly?next=%2Fauth%2Frequired',
    '/api/health/extra?%',
  ]) {
    expect(classify(path)).toBe('protected');
  }

  expect(
    classify('/auth/required?next=https://attacker.example/%2Fapi%2Fhealth'),
  ).toBe('loop-safe');
  expect(
    classify('/auth/reset-password?code=once-only-token&type=recovery&next=//attacker.example', 'HEAD'),
  ).toBe('loop-safe');
});
