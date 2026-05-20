import { describe, expect, test } from 'bun:test';

import {
  ADMIN_DISABLE_CONFIRMATION,
  ADMIN_REACTIVATE_CONFIRMATION,
  ADMIN_ROLE_CONFIRMATION,
  getRequiredAdminUserConfirmation,
  countPrivilegedAdminUserMutationIntents,
  isBannedUntilActive,
  validateAdminUserConfirmation,
} from '@/lib/admin/user-management-guards';

describe('admin user-management guards', () => {
  test('requires action-specific Korean confirmation phrases', () => {
    expect(getRequiredAdminUserConfirmation({ nextRole: 'admin' })).toBe(ADMIN_ROLE_CONFIRMATION);
    expect(getRequiredAdminUserConfirmation({ nextAccountStatus: 'disabled' })).toBe(ADMIN_DISABLE_CONFIRMATION);
    expect(getRequiredAdminUserConfirmation({ nextAccountStatus: 'active' })).toBe(ADMIN_REACTIVATE_CONFIRMATION);
    expect(getRequiredAdminUserConfirmation({ hasProfileChange: true })).toBeNull();
  });

  test('rejects mismatched confirmation phrases', () => {
    expect(validateAdminUserConfirmation({ nextRole: 'user', confirmation: ADMIN_DISABLE_CONFIRMATION })).toContain(ADMIN_ROLE_CONFIRMATION);
    expect(validateAdminUserConfirmation({ nextAccountStatus: 'disabled', confirmation: ADMIN_ROLE_CONFIRMATION })).toContain(ADMIN_DISABLE_CONFIRMATION);
    expect(validateAdminUserConfirmation({ nextRole: 'admin', confirmation: ADMIN_ROLE_CONFIRMATION })).toBeNull();
  });

  test('rejects multi-intent privileged mutations', () => {
    expect(countPrivilegedAdminUserMutationIntents({ nextRole: 'user', nextAccountStatus: 'disabled' })).toBe(2);
    expect(validateAdminUserConfirmation({ nextRole: 'user', nextAccountStatus: 'disabled', confirmation: ADMIN_ROLE_CONFIRMATION })).toContain('한 번에 하나씩');
  });

  test('detects active Supabase ban windows', () => {
    const now = Date.parse('2026-05-14T00:00:00Z');
    expect(isBannedUntilActive('2026-05-15T00:00:00Z', now)).toBe(true);
    expect(isBannedUntilActive('2026-05-13T00:00:00Z', now)).toBe(false);
    expect(isBannedUntilActive(null, now)).toBe(false);
  });
});
