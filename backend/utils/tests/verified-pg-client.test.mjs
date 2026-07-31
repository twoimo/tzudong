import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildVerifiedPgClientConfig,
  isLoopbackPgHost,
  isSupabaseProductionPgHost,
} from '../verified-pg-client.mjs';

const PRODUCTION_URL = 'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';

function env(overrides = {}) {
  return { NODE_ENV: 'production', SUPABASE_DB_URL: PRODUCTION_URL, ...overrides };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code && error.message === code);
}

test('recognizes only loopback and canonical Supabase database hosts', () => {
  assert.equal(isLoopbackPgHost('127.0.0.1'), true);
  assert.equal(isLoopbackPgHost('::1'), true);
  assert.equal(isLoopbackPgHost('127.0.0.1.attacker.example'), false);
  assert.equal(isSupabaseProductionPgHost('db.abcdefghijklmnopqrst.supabase.co'), true);
  assert.equal(isSupabaseProductionPgHost('aws-0-ap-northeast-2.pooler.supabase.com'), true);
  assert.equal(isSupabaseProductionPgHost('db.abcdefghijklmnopqrst.supabase.co.attacker.example'), false);
});

test('builds verified TLS config without exposing URL overrides', async () => {
  const config = await buildVerifiedPgClientConfig({ applicationName: 'security-test', env: env() });
  assert.equal(config.host, 'db.abcdefghijklmnopqrst.supabase.co');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, config.host);
  assert.equal(config.application_name, 'security-test');
  assert.equal(config.connectionString, undefined);
});

test('rejects URL query overrides, untrusted hosts, and legacy TLS switches', async () => {
  await rejectsCode(
    buildVerifiedPgClientConfig({ applicationName: 'security-test', env: env({ SUPABASE_DB_URL: `${PRODUCTION_URL}?sslmode=disable` }) }),
    'SUPABASE_PG_URL_OVERRIDE_REJECTED',
  );
  await rejectsCode(
    buildVerifiedPgClientConfig({ applicationName: 'security-test', env: env({ SUPABASE_DB_URL: 'postgresql://postgres:secret@evil.example/postgres' }) }),
    'SUPABASE_PG_HOST_REJECTED',
  );
  await rejectsCode(
    buildVerifiedPgClientConfig({ applicationName: 'security-test', env: env({ SUPABASE_DB_SSL: 'false' }) }),
    'SUPABASE_PG_LEGACY_TLS_OVERRIDE_REJECTED',
  );
});

test('permits plaintext only for explicitly opted-in local development or test', async () => {
  const localUrl = 'postgresql://postgres:secret@127.0.0.1:5432/postgres';
  await rejectsCode(
    buildVerifiedPgClientConfig({ applicationName: 'security-test', env: env({ SUPABASE_DB_URL: localUrl }) }),
    'SUPABASE_PG_LOOPBACK_ENV_REJECTED',
  );
  const config = await buildVerifiedPgClientConfig({
    applicationName: 'security-test',
    env: { NODE_ENV: 'test', SUPABASE_DB_URL: localUrl, SUPABASE_PG_ALLOW_PLAINTEXT_LOCAL: '1' },
  });
  assert.equal(config.ssl, false);
});

test('all address evidence PostgreSQL consumers use the verified client', async () => {
  const scripts = [
    '../../bin/apply_supabase_address_consistency_candidates.mjs',
    '../../bin/build_supabase_address_consistency_guarded_plan.mjs',
    '../../bin/build_google_maps_browser_review_queue.mjs',
    '../../bin/build_tzuyang_address_evidence_ledger.mjs',
    '../../bin/apply_tzuyang_address_evidence_ledger.mjs',
  ];
  for (const script of scripts) {
    const source = await readFile(new URL(script, import.meta.url), 'utf8');
    assert.match(source, /createVerifiedPgClient/);
    assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
    assert.doesNotMatch(source, /from ['"]pg['"]/);
  }
});
