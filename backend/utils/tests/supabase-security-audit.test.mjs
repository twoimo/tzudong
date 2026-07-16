import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolve } from 'node:path';

import { SUPABASE_SECURITY_QUERIES } from '../../bin/audit_supabase_security.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

test('Supabase security audit covers exposed-schema and privileged-function risks', () => {
  const codes = new Set(SUPABASE_SECURITY_QUERIES.map(({ code }) => code));
  for (const required of [
    'PUBLIC_TABLE_RLS_DISABLED',
    'PUBLIC_TABLE_RLS_NOT_FORCED',
    'PUBLIC_DANGEROUS_TABLE_GRANT',
    'SECURITY_DEFINER_MUTABLE_SEARCH_PATH',
    'SECURITY_DEFINER_PUBLIC_EXECUTE',
    'PUBLIC_VIEW_NOT_SECURITY_INVOKER',
    'PUBLIC_SENSITIVE_COLUMN',
    'UNVALIDATED_CONSTRAINT',
    'EXTENSION_IN_EXPOSED_SCHEMA',
    'SENSITIVE_REALTIME_PUBLICATION',
  ]) {
    assert.equal(codes.has(required), true, required);
  }

  for (const query of SUPABASE_SECURITY_QUERIES) {
    assert.match(query.code, /^[A-Z][A-Z0-9_]+$/);
    assert.match(query.severity, /^(?:medium|high|critical)$/);
    assert.equal(query.sql.includes('pg_catalog.pg_authid'), false);
    assert.equal(query.sql.includes('auth.users.email'), false);
  }
});

test('Supabase security audit fails closed without printing connection secrets', () => {
  const secret = 'postgresql://person:plain-secret@localhost/private';
  const result = spawnSync(process.execPath, ['backend/bin/audit_supabase_security.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_DB_URL: '', DATABASE_URL: '' },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /^\[supabase-security-audit\] error=Error\s*$/);
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(result.stderr.includes('password'), false);
});
