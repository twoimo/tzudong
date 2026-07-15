import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SERVICE_ROLE_KEY_LENGTH,
  SUPABASE_REST_CONFIGURATION_ERROR,
  SupabaseRestConfigurationError,
  resolvePrivilegedSupabaseRestCredentials,
} from '../supabase-rest.mjs';

const VALID_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const VALID_SERVICE_ROLE_KEY = `sb_${'secret_service_role_key_for_tests_only'}`;

function environment(overrides = {}) {
  return {
    SUPABASE_URL: VALID_URL,
    SUPABASE_SERVICE_ROLE_KEY: VALID_SERVICE_ROLE_KEY,
    ...overrides,
  };
}

function jwtWithRole(role) {
  const payload = Buffer.from(JSON.stringify({ role }), 'utf8').toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

function assertInvalid(values) {
  assert.throws(
    () => resolvePrivilegedSupabaseRestCredentials(values),
    (error) => error instanceof SupabaseRestConfigurationError
      && error.message === SUPABASE_REST_CONFIGURATION_ERROR
      && error.code === SUPABASE_REST_CONFIGURATION_ERROR,
  );
}

test('accepts only the canonical dedicated Supabase REST credentials', () => {
  const credentials = resolvePrivilegedSupabaseRestCredentials(environment({ SUPABASE_URL: `${VALID_URL}/` }));
  assert.deepEqual(credentials, { url: VALID_URL, serviceRoleKey: VALID_SERVICE_ROLE_KEY });
});

test('rejects attacker host suffixes and noncanonical project references', () => {
  for (const url of [
    'https://abcdefghijklmnopqrst.supabase.co.attacker.invalid',
    'https://attacker.invalid/abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co.evil',
    'https://short.supabase.co',
    'https://abcdefghijklmnopqrstu.supabase.co',
    'https://ABCDEFGHIJKLMNOPQRST.supabase.co',
    'https://аbcdefghijklmnopqrst.supabase.co',
  ]) {
    assertInvalid(environment({ SUPABASE_URL: url }));
  }
});

test('rejects URL credentials, ports, paths, queries, fragments, and controls', () => {
  for (const url of [
    'https://service:role@abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co:8443',
    'https://abcdefghijklmnopqrst.supabase.co:443',
    'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
    'https://abcdefghijklmnopqrst.supabase.co/?target=attacker',
    'https://abcdefghijklmnopqrst.supabase.co/#fragment',
    `${VALID_URL}\u0000`,
  ]) {
    assertInvalid(environment({ SUPABASE_URL: url }));
  }
});

test('rejects public fallback-only, blank, control-bearing, oversized, and public keys', () => {
  assertInvalid({
    VITE_SUPABASE_URL: VALID_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_service_role',
    NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('anon'),
    SUPABASE_ANON_KEY: jwtWithRole('anon'),
  });
  assertInvalid({ SUPABASE_URL: VALID_URL });
  assertInvalid(environment({ SUPABASE_URL: '' }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: '   ' }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: `sb_${'secret_bad\nkey'}` }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(MAX_SERVICE_ROLE_KEY_LENGTH + 1) }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_not_service_role' }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: jwtWithRole('anon') }));
  assertInvalid(environment({ SUPABASE_SERVICE_ROLE_KEY: jwtWithRole('authenticated') }));
});

test('allows only explicitly opted-in loopback HTTP for development and test', () => {
  const credentials = resolvePrivilegedSupabaseRestCredentials(environment({
    SUPABASE_URL: 'http://127.0.0.1:54321/',
    SUPABASE_REST_ALLOW_LOOPBACK_HTTP: '1',
    NODE_ENV: 'test',
  }));
  assert.deepEqual(credentials, {
    url: 'http://127.0.0.1:54321',
    serviceRoleKey: VALID_SERVICE_ROLE_KEY,
  });

  assertInvalid(environment({ SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'test' }));
  assertInvalid(environment({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_REST_ALLOW_LOOPBACK_HTTP: '1',
    NODE_ENV: 'production',
  }));
  assertInvalid(environment({
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_REST_ALLOW_LOOPBACK_HTTP: '1',
    NODE_ENV: 'development',
  }));
  assertInvalid(environment({
    SUPABASE_URL: 'http://127.0.0.2:54321',
    SUPABASE_REST_ALLOW_LOOPBACK_HTTP: '1',
    NODE_ENV: 'development',
  }));
});
