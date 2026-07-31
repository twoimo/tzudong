import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const CREATE_REASON_CODES = [
  'ADMIN_USER_CREATE_INTENT',
  'ADMIN_USER_CREATE_APPLIED',
  'ADMIN_USER_CREATE_FAILED',
];

const MUTATION_REASON_CODES = [
  'ADMIN_USER_PROFILE_UPDATE_INTENT',
  'ADMIN_USER_PROFILE_UPDATE_APPLIED',
  'ADMIN_USER_PROFILE_UPDATE_FAILED',
  'ADMIN_USER_ROLE_GRANT_INTENT',
  'ADMIN_USER_ROLE_GRANT_APPLIED',
  'ADMIN_USER_ROLE_GRANT_FAILED',
  'ADMIN_USER_ROLE_REVOKE_INTENT',
  'ADMIN_USER_ROLE_REVOKE_APPLIED',
  'ADMIN_USER_ROLE_REVOKE_FAILED',
  'ADMIN_USER_DISABLE_INTENT',
  'ADMIN_USER_DISABLE_APPLIED',
  'ADMIN_USER_DISABLE_FAILED',
  'ADMIN_USER_REACTIVATE_INTENT',
  'ADMIN_USER_REACTIVATE_APPLIED',
  'ADMIN_USER_REACTIVATE_FAILED',
];

const assertNoLegacyAuditPayloadFields = (routeSource: string) => {
  expect(routeSource).not.toMatch(/\b(?:reason|beforeState|afterState)\s*:/);
  expect(routeSource).not.toContain('body.reason');
};

describe('admin user audit privacy contract', () => {
  test('keeps historical creation audit schema while the admin creation route fails closed', () => {
    const createRouteSource = source('app/api/admin/users/route.ts');
    const auditSource = source('lib/admin/user-audit.ts');

    assertNoLegacyAuditPayloadFields(createRouteSource);
    expect(createRouteSource).toContain('ADMIN_USER_CREATION_ONBOARDING_REQUIRED');
    expect(createRouteSource).not.toContain('recordAdminUserAuditEvent');
    expect(createRouteSource).not.toContain('AdminUserAuditPayload');
    expect(createRouteSource).not.toContain('satisfies AdminUserAuditPayload');
    expect(createRouteSource).not.toContain('auth.admin.createUser');
    expect(auditSource).toContain("'admin_user_created'");
    expect(auditSource).toContain("admin_user_created: 'ADMIN_USER_CREATE'");

    for (const reasonCode of CREATE_REASON_CODES) {
      expect(auditSource).toContain(reasonCode);
    }
  });

  test('uses keyed full-length request minimization and fails closed without a key', () => {
    const auditSource = source('lib/admin/user-audit.ts');
    const migration = source('../../backend/supabase/migrations/20260712000300_g010_account_deletion.sql');

    expect(auditSource).toContain("createHmac('sha256', key)");
    expect(auditSource).toContain('PRIVACY_AUDIT_HASH_KEY');
    expect(auditSource).toContain("Buffer.byteLength(key, 'utf8') < 32");
    expect(auditSource).toContain("hashValue(forwardedFor, 'ip')");
    expect(auditSource).toContain("hashValue(userAgent, 'user-agent')");
    expect(auditSource).not.toContain('.slice(0, 24)');
    expect(migration).toContain("p_ip_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("p_user_agent_hash ~ '^[0-9a-f]{64}$'");
  });

  test('mutation route derives matched canonical reason and error codes without snapshots', () => {
    const mutationRouteSource = source('app/api/admin/users/[userId]/route.ts');

    assertNoLegacyAuditPayloadFields(mutationRouteSource);
    expect(mutationRouteSource).toContain('type AdminUserAuditPayload');
    expect(mutationRouteSource).toContain('buildCanonicalAdminUserAuditPayload');
    expect(mutationRouteSource).toContain('ADMIN_USER_AUDIT_REASON_CODES.includes(reasonCode)');
    expect(mutationRouteSource).toContain("status: 'failed'");
    expect(mutationRouteSource).toContain('errorCode: reasonCode');
    expect(mutationRouteSource).toContain("counts: { requested: 1 }");
    expect(mutationRouteSource).toContain("counts: { failed: 1 }");
    expect(mutationRouteSource).toContain('p_reason: auditPayload.reasonCode');
    expect(mutationRouteSource).toContain('p_before_state: {}');
    expect(mutationRouteSource).toContain('p_after_state: {}');

    for (const reasonCode of MUTATION_REASON_CODES) {
      expect(mutationRouteSource).toContain(reasonCode);
    }
  });
});
