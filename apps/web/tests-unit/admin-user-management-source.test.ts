import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

describe('admin user-management source contract', () => {
  test('embeds user management as a URL-backed admin console module', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const registrySource = source('components/admin/console/module-panel-registry.tsx');
    const menuSource = source('lib/admin/console-menu-registry.ts');
    const routingSource = source('lib/admin/admin-module-routing.ts');

    expect(registrySource).toContain('"users"');
    expect(menuSource).toContain('title: "사용자 관리"');
    expect(routingSource).toContain('buildCanonicalAdminModuleHref');
    expect(registrySource).toContain('AdminUsersModule');
    expect(registrySource).toContain('components/admin/AdminUsersPanel');
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
    expect(panelSource).toContain('새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.');
    expect(panelSource).toContain('관리자 화면에서는 계정을 만들 수 없습니다.');
    expect(panelSource).not.toContain('createForm');
    expect(panelSource).not.toContain('createUser');
    expect(panelSource).not.toContain('data-admin-users-create-button');
    expect(panelSource).not.toContain('fetch("/api/admin/users",');
    expect(panelSource).not.toContain('method: "POST"');
    expect(panelSource).not.toContain('new-user-email');
    expect(panelSource).not.toContain('type="password"');
    expect(panelSource).toContain('자기 잠금 방지');
    expect(panelSource).toContain('border-b border-border bg-card px-2 py-1.5');
    expect(panelSource).toContain('bg-gradient-primary bg-clip-text text-base font-bold text-transparent');
    expect(panelSource).toContain('min-w-0 rounded-2xl border border-border/70 bg-muted/25 px-3 py-2 shadow-sm');
    expect(panelSource).toContain('min-h-0 border-border bg-card shadow-sm');
    expect(panelSource).toContain('hidden overflow-hidden rounded-lg border bg-card md:block');
    expect(panelSource).toContain('data-admin-users-mobile-card');
    expect(panelSource).not.toContain('border-border bg-card/95 shadow-sm');
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
    }

    const postSource = listRouteSource.slice(listRouteSource.indexOf('export async function POST'));
    expect(postSource).toContain('const auth = await requireAdmin();');
    expect(postSource).toContain('if (!auth.ok) return auth.response;');
    expect(postSource.indexOf('await requireAdmin()')).toBeLessThan(postSource.indexOf('return NextResponse.json('));
    expect(postSource).toContain('ADMIN_USER_CREATION_ONBOARDING_REQUIRED');
    expect(postSource).not.toContain('request.json()');
    expect(postSource).not.toContain('auth.admin.createUser');
    expect(postSource).not.toContain('email:');
    expect(postSource).not.toContain('password:');
    expect(postSource).not.toContain('createSupabaseServiceRoleClient');
    expect(postSource).not.toContain('email');
    expect(postSource).not.toContain('password');

    expect(listRouteSource).toContain('supabase.auth.admin.listUsers');
    expect(listRouteSource).toContain('fetchUserManagementMetadata');
    expect(listRouteSource).toContain("rpc(\n      'read_admin_user_management_metadata'");
    expect(listRouteSource).not.toContain(".from('profiles')");
    expect(listRouteSource).not.toContain(".from('user_roles')");
    expect(listRouteSource).not.toContain(".from('user_account_status')");
    expect(listRouteSource).toContain('returnedIds.size !== requestedIds.size');
    expect(listRouteSource).toContain('metadata ? metadata.account_status !== \'active\'');
    expect(listRouteSource).toContain("code: 'ADMIN_USER_CREATION_ONBOARDING_REQUIRED'");
    expect(listRouteSource).toContain("error: '새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.'");
    expect(listRouteSource).toContain("{ status: 409, headers: { 'Cache-Control': 'no-store' } }");
    expect(listRouteSource).not.toContain('auth.admin.createUser');
    expect(listRouteSource).not.toContain('recordFailedCreateAuditEvent');
    expect(listRouteSource).not.toContain('deleteCreatedAuthUserWithReadback');
    expect(listRouteSource).not.toContain('preflightAuditId');
    expect(listRouteSource).not.toContain('admin_user_created');
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
    expect(updateRouteSource).toContain("rpc('read_admin_user_ids_for_management')");
    expect(updateRouteSource).not.toContain(".from('user_roles')");
    expect(updateRouteSource).toContain('마지막 활성 관리자 계정은 권한 회수 또는 비활성화할 수 없습니다.');
    expect(updateRouteSource).toContain('자기 자신의 관리자 권한은 회수할 수 없습니다.');
    expect(serviceRoleSource).toContain("server-only");
    expect(serviceRoleSource).toContain("typeof window !== 'undefined'");
    expect(auditSource).toContain('ip_hash');
    expect(auditSource).toContain('user_agent_hash');
    expect(updateRouteSource).toContain('recordAdminUserAuditEvent');
    expect(updateRouteSource).toContain('recordFailedAuditEvent');
    expect(updateRouteSource).toContain('ADMIN_USER_AUDIT_REASON_CODES_BY_ACTION');
    expect(updateRouteSource).toContain('p_reason: auditPayload.reasonCode');
    expect(updateRouteSource).toContain('buildMutationAuditReceipt');
    expect(updateRouteSource).toContain("domain: 'admin_user_management'");
    expect(updateRouteSource).toContain('source: ADMIN_AUDIT_PRIMARY_SOURCE');
    expect(updateRouteSource).toContain('readbackId: readbackAuditId');
    expect(updateRouteSource).toContain('latestPreflightAuditId');
    expect(updateRouteSource).toContain("status: 'failed'");
    expect(requireAdminSource).toContain('user_account_status');
    expect(requireAdminSource).toContain("accountStatusError || accountStatus?.account_status !== 'active'");
    expect(requireAdminSource).not.toContain('isMissingOptionalAdminStatusStoreError');
    expect(middlewareSource).toContain('user_account_status');
    expect(middlewareSource).toContain("accountStatusError || accountStatus?.account_status !== 'active'");
    expect(middlewareSource).not.toContain('isMissingOptionalAdminStatusStoreError');
    expect(auditSource).not.toContain('service_role');
    expect(auditSource).toContain("rpc('append_admin_user_audit_event'");
    expect(auditSource).toContain("typeof data === 'string' && UUID_PATTERN.test(data)");
    expect(auditSource).not.toContain(".from('admin_audit_events')");
    expect(auditEventsRouteSource).toContain('await requireAdmin()');
    expect(auditEventsRouteSource).toContain('createSupabaseServiceRoleClient()');
    expect(auditEventsRouteSource).toContain('.rpc("read_admin_user_audit_events"');
    expect(auditEventsRouteSource).not.toContain('.from("admin_audit_events")');
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

  test('keeps eight user display fields, completeness markers, and change output kind', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');
    const displaySource = source('lib/admin/admin-user-display.ts');
    const completenessSource = source('components/admin/console/AdminConsoleModuleCompleteness.tsx');
    const registrySource = source('components/admin/console/module-panel-registry.tsx');
    const menuSource = source('lib/admin/console-menu-registry.ts');

    expect(displaySource).toContain('accountId');
    expect(displaySource).toContain('displayName');
    expect(displaySource).toContain('role');
    expect(displaySource).toContain('status');
    expect(displaySource).toContain('createdAt');
    expect(displaySource).toContain('lastLoginAt');
    expect(displaySource).toContain('emailConfirmed');
    expect(displaySource).toContain('emailMaskToken');
    expect(displaySource).toContain('계정 식별자');
    expect(displaySource).toContain('표시 이름');
    expect(displaySource).toContain('권한 역할');
    expect(displaySource).toContain('계정 상태');
    expect(displaySource).toContain('계정 생성 시각');
    expect(displaySource).toContain('최근 로그인 시각');
    expect(displaySource).toContain('이메일 확인 여부');
    expect(displaySource).toContain('이메일 마스킹 표식');
    expect(panelSource).toContain('ADMIN_USER_DISPLAY_FIELDS');
    expect(panelSource).toContain('emailMaskToken');
    expect(panelSource).not.toContain('selectedUser.email');
    expect(panelSource).not.toContain('managedUser.email');
    expect(completenessSource).toContain('data-admin-module-state={state}');
    expect(completenessSource).toContain('"loading"');
    expect(completenessSource).toContain('"empty"');
    expect(completenessSource).toContain('"error"');
    expect(registrySource).toContain('withCompleteness(\n    "users"');
    expect(menuSource).toContain('outputKind: "변경"');
    expect(completenessSource).toContain('data-admin-module-output-kind={getAdminConsoleModuleOutputKind(menuId)}');
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
