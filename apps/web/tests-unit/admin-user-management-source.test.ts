import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

describe('admin user-management source contract', () => {
  test('embeds user management as a URL-backed admin console module', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('"users"');
    expect(consoleSource).toContain('title: "사용자 관리"');
    expect(consoleSource).toContain('/admin?module=users');
    expect(consoleSource).toContain('AdminUsersModule');
    expect(consoleSource).toContain('components/admin/AdminUsersPanel');
    expect(consoleSource).toContain('getAdminModuleIdFromSearchParams');
    expect(consoleSource).toContain('router.replace');
    expect(consoleSource).toContain('scroll: false');
  });

  test('keeps user-management UI Korean, guarded, and accessible', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('사용자 관리');
    expect(panelSource).toContain('계정·권한 운영');
    expect(panelSource).toContain('xl:grid-cols-[minmax(340px,0.95fr)_minmax(400px,1.05fr)]');
    expect(panelSource).toContain('권한 변경 전 확인');
    expect(panelSource).toContain('계정 처리 전 확인');
    expect(panelSource).toContain('canApplyRoleAction');
    expect(panelSource).toContain('canDisableAction');
    expect(panelSource).toContain('canReactivateAction');
    expect(panelSource).toContain('adminConfirmation');
    expect(panelSource).toContain('관리자 생성 확인 문구');
    expect(panelSource).not.toContain('confirmation: createForm.isAdmin ? "권한변경"');
    expect(panelSource).toContain('자기 잠금 방지');
    expect(panelSource).toContain('border-b border-border bg-card px-2 py-1.5');
    expect(panelSource).toContain('bg-gradient-primary bg-clip-text text-base font-bold text-transparent');
    expect(panelSource).toContain('rounded-lg bg-muted/35 p-2');
    expect(panelSource).toContain('min-h-0 border-border bg-card shadow-sm');
    expect(panelSource).toContain('overflow-hidden rounded-lg border bg-card');
    expect(panelSource).not.toContain('border-border bg-card/95 shadow-sm');
    expect(panelSource).not.toContain('rounded-xl border border-border bg-background/80 p-3');
    expect(panelSource).toContain('aria-live="polite"');
    expect(panelSource).toContain('AdminUserMutationResponse');
    expect(panelSource).toContain('감사 ID:');
    expect(panelSource).toContain('<caption className="sr-only">관리자 사용자 목록</caption>');
    expect(panelSource).toContain('role="alert"');
    expect(panelSource).not.toContain('AdminAccessGate');
  });
  test('keeps admin user details explicit-selection only', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('users.find((candidate) => candidate.id === selectedUserId) ?? null');
    expect(panelSource).not.toContain('?? users[0]');
    expect(panelSource).not.toContain('return nextUsers[0]');
    expect(panelSource).toContain('if (current && nextUsers.some((candidate) => candidate.id === current)) return current;');
    expect(panelSource).toContain('return null;');
    expect(panelSource).toContain('!selectedUser ? (');
    expect(panelSource).toContain('사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.');
    expect(panelSource).toContain('setProfileForm({ nickname: "", username: "", avatarUrl: "" });');
    expect(panelSource).toContain('return current.targetUserId === selectedUser?.id ? current : null;');
  });

  test('keeps admin user APIs server-only and service-role contained', () => {
    const listRouteSource = source('app/api/admin/users/route.ts');
    const updateRouteSource = source('app/api/admin/users/[userId]/route.ts');
    const serviceRoleSource = source('lib/supabase/service-role.ts');
    const auditSource = source('lib/admin/user-audit.ts');
    const auditEventsRouteSource = source('app/api/admin/audit-events/route.ts');
    const requireAdminSource = source('lib/auth/require-admin.ts');
    const middlewareSource = source('lib/supabase/middleware.ts');

    for (const routeSource of [listRouteSource, updateRouteSource]) {
      expect(routeSource).toContain("export const runtime = 'nodejs'");
      expect(routeSource.indexOf('await requireAdmin()')).toBeGreaterThan(-1);
      expect(routeSource.indexOf('await requireAdmin()')).toBeLessThan(routeSource.indexOf('createSupabaseServiceRoleClient()'));
      expect(routeSource).toContain('recordAdminUserAuditEvent');
    }

    expect(listRouteSource).toContain('supabase.auth.admin.listUsers');
    expect(listRouteSource).toContain('fetchAccountStatusMap');
    expect(listRouteSource).toContain('user_account_status');
    expect(listRouteSource).toContain('supabase.auth.admin.createUser');
    expect(listRouteSource).not.toContain('const confirmationError = shouldGrantAdmin\\n    const confirmationError = shouldGrantAdmin');
    expect(updateRouteSource).toContain('supabase.auth.admin.updateUserById');
    expect(updateRouteSource).toContain('ban_duration');
    expect(updateRouteSource).toContain('applyAdminUserDbMutation');
    expect(updateRouteSource).toContain("rpc('apply_admin_user_db_mutation'");
    expect(updateRouteSource).toContain('failed to roll back auth account status after DB audit error');
    expect(updateRouteSource).not.toContain('setAccountStatus');
    expect(updateRouteSource).not.toContain('getAccountStatus');
    expect(updateRouteSource).not.toContain("const previousAccountStatus = nextAccountStatus === 'disabled' ? 'active' : 'disabled'");
    expect(updateRouteSource).toContain('validateAdminUserConfirmation');
    expect(updateRouteSource).toContain('잠금 방지를 위해 변경을 중단합니다.');
    expect(updateRouteSource).toContain('getActiveAdminUserIds');
    expect(updateRouteSource).toContain('마지막 활성 관리자 계정은 권한 회수 또는 비활성화할 수 없습니다.');
    expect(updateRouteSource).toContain('자기 자신의 관리자 권한은 회수할 수 없습니다.');
    expect(serviceRoleSource).toContain("server-only");
    expect(serviceRoleSource).toContain("typeof window !== 'undefined'");
    expect(auditSource).toContain('ip_hash');
    expect(auditSource).toContain('user_agent_hash');
    expect(listRouteSource).toContain('preflightAuditId');
    expect(listRouteSource).toContain('buildMutationAuditReceipt');
    expect(listRouteSource).toContain("domain: 'admin_user_management'");
    expect(listRouteSource).toContain('source: ADMIN_AUDIT_PRIMARY_SOURCE');
    expect(listRouteSource).toContain('recordFailedCreateAuditEvent');
    expect(listRouteSource).toContain("status: 'failed'");
    expect(listRouteSource).toContain('감사 기록 확정에 실패해 사용자 생성을 취소했습니다.');
    expect(listRouteSource).toContain('감사 로그 준비에 실패해 사용자 생성을 시작하지 않았습니다.');
    expect(listRouteSource).toContain("step: 'preflight-audit'");
    expect(listRouteSource).toContain("auditId: failedAuditId");
    expect(listRouteSource).toContain("failedStep: 'auth-user-create'");
    expect(listRouteSource).toContain('deleteCreatedAuthUserWithReadback');
    expect(listRouteSource).toContain('getUserById(userId)');
    expect(listRouteSource).toContain('isAuthUserNotFoundReadback');
    expect(listRouteSource).toContain('auth-user-cleanup-readback-failed');
    expect(listRouteSource).toContain('auth-user-cleanup-readback-empty');
    expect(listRouteSource).toContain('cleanupVerified: cleanup.verified');
    expect(listRouteSource).toContain("step: 'unhandled-create-error'");
    expect(listRouteSource).toContain("failedStep: 'applied-audit'");
    expect(updateRouteSource).toContain('getActiveAdminUserIds');
    expect(updateRouteSource).toContain('recordFailedAuditEvent');
    expect(updateRouteSource).toContain("reason: 'failed-admin-user-mutation'");
    expect(updateRouteSource).toContain('buildMutationAuditReceipt');
    expect(updateRouteSource).toContain("domain: 'admin_user_management'");
    expect(updateRouteSource).toContain('source: ADMIN_AUDIT_PRIMARY_SOURCE');
    expect(updateRouteSource).toContain('readbackId: readbackAuditId');
    expect(updateRouteSource).toContain('latestPreflightAuditId');
    expect(updateRouteSource).toContain("status: 'failed'");
    expect(requireAdminSource).toContain('user_account_status');
    expect(requireAdminSource).toContain("accountStatus?.account_status === 'disabled'");
    expect(middlewareSource).toContain('user_account_status');
    expect(middlewareSource).toContain("accountStatus?.account_status === 'disabled'");
    expect(auditSource).not.toContain('service_role');
    expect(auditEventsRouteSource).toContain('await requireAdmin()');
    expect(auditEventsRouteSource).toContain('createSupabaseServiceRoleClient()');
    expect(auditEventsRouteSource).toContain('.from("admin_audit_events")');
    expect(auditEventsRouteSource).toContain('admin-audit-events-read-failed');
    expect(auditEventsRouteSource).toContain('"Cache-Control": "no-store"');
  });

  test('does not keep ad-hoc service-role helper scripts in the web package root', () => {
    for (const relativePath of [
      'query_dups.js',
      'query_triggers.js',
      'script.ts',
      'scripts/gemini-daemon.mjs',
    ]) {
      expect(existsSync(join(import.meta.dir, '..', relativePath))).toBe(false);
    }
  });

  test('adds an admin audit trail migration with RLS read access for admins', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260514_admin_user_management_audit.sql')
      .replace(/\r\n/g, '\n');

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.admin_audit_events');
    expect(migrationSource).toContain('ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY');
    expect(migrationSource).toContain('GRANT SELECT ON public.admin_audit_events TO authenticated');
    expect(migrationSource).toContain('admin_audit_events_select_admins');
    expect(migrationSource).toContain("user_roles.role = 'admin'");
    expect(migrationSource).toContain('admin_user_role_granted');
    expect(migrationSource).toContain('admin_user_disabled');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.apply_admin_user_db_mutation');
    expect(migrationSource).toContain('RETURNS uuid');
    expect(migrationSource).toContain("status,\n    correlation_id,\n    applied_at");
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION public.apply_admin_user_db_mutation');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.apply_admin_user_db_mutation');
    expect(migrationSource).toContain("status text NOT NULL DEFAULT 'intent'");
    expect(migrationSource).toContain("status IN ('intent', 'applied', 'failed')");
    expect(migrationSource).toContain('correlation_id uuid');
    expect(migrationSource).toContain('applied_at timestamptz');
    expect(migrationSource).toContain('error_code text');

    const hardeningSource = repoSource('backend/supabase/migrations/20260514_00_admin_user_management_hardening.sql');
    expect(hardeningSource).toContain('profiles_role_allowed_check');
    expect(hardeningSource).toContain('ADD COLUMN IF NOT EXISTS username text');
    expect(hardeningSource).toContain('ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()');
    expect(hardeningSource).toContain('BEFORE INSERT OR UPDATE OF role ON public.profiles');
    expect(hardeningSource).toContain('CREATE TABLE IF NOT EXISTS public.user_account_status');
    expect(hardeningSource).toContain("account_status text NOT NULL DEFAULT 'active'");
    expect(hardeningSource).toContain('prevent_last_active_admin_status_change');
    expect(hardeningSource).toContain('user_account_status_prevent_last_active_admin_disable');
    expect(hardeningSource).toContain('INSERT INTO public.user_account_status');
    expect(hardeningSource).toContain('ON CONFLICT (user_id) DO NOTHING');
    expect(hardeningSource).toContain('BEFORE INSERT OR UPDATE OF account_status ON public.user_account_status');
    expect(hardeningSource).toContain("TG_OP = 'UPDATE' AND OLD.account_status = 'disabled'");
    expect(hardeningSource).toContain('last active admin account cannot be disabled');
    expect(hardeningSource).toContain('prevent_last_admin_role_delete');
    expect(hardeningSource).toContain('user_roles_prevent_last_admin_delete');
    expect(hardeningSource).toContain('prevent_last_admin_role_update');
    expect(hardeningSource).toContain('user_roles_prevent_last_admin_update');
    expect(hardeningSource).toContain("pg_advisory_xact_lock(hashtext('tzudong-admin-role-delete'))");
    expect(hardeningSource).toContain('last admin role cannot be removed');
    expect(hardeningSource).toContain("auth.role() <> 'service_role'");
    expect(hardeningSource).toContain("NOTIFY pgrst, 'reload schema'");
  });

  test('persists per-admin sidebar ordering with RLS and explicit Data API grants', () => {
    const routeSource = source('app/api/admin/preferences/sidebar-order/route.ts');
    const sidebarOrderSource = source('lib/admin/sidebar-order.ts');
    const migrationSource = repoSource('backend/supabase/migrations/20260514_admin_sidebar_preferences.sql');

    expect(routeSource).toContain('admin_sidebar_order');
    expect(sidebarOrderSource).toContain('DEFAULT_ADMIN_SIDEBAR_ORDER');
    expect(routeSource).toContain('normalizeAdminSidebarOrder');
    expect(routeSource).toContain('@/lib/admin/sidebar-order');
    expect(routeSource).toContain('await requireAdmin()');
    expect(routeSource.indexOf('await requireAdmin()')).toBeLessThan(routeSource.indexOf('createSupabaseServiceRoleClient()'));
    expect(routeSource).toContain(".upsert(");
    expect(routeSource).toContain('onConflict: \"user_id,preference_key\"');

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.admin_user_preferences');
    expect(migrationSource).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(migrationSource).toContain('UNIQUE (user_id, preference_key)');
    expect(migrationSource).toContain('ALTER TABLE public.admin_user_preferences ENABLE ROW LEVEL SECURITY');
    expect(migrationSource).toContain('GRANT SELECT, INSERT, UPDATE ON public.admin_user_preferences TO authenticated');
    expect(migrationSource).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_user_preferences TO authenticated');
    expect(migrationSource).toContain('admin_user_preferences_select_own_admin');
    expect(migrationSource).toContain('admin_user_preferences_insert_own_admin');
    expect(migrationSource).toContain('admin_user_preferences_update_own_admin');
    expect(migrationSource).toContain("user_roles.role = 'admin'");
  });

  test('does not add a separate global shortcut outside the admin console', () => {
    const navigationSource = source('components/layout/navigation-routes.ts');
    const headerSource = source('components/layout/Header.tsx');
    const mobileControlSource = source('components/home/MobileControlOverlay.tsx');

    expect(navigationSource).not.toContain('/admin/users');
    expect(headerSource).not.toContain('/admin/users');
    expect(mobileControlSource).not.toContain('/admin/users');
  });
});
