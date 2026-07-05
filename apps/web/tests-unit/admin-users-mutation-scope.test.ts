import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin users mutation result scope contract', () => {
  test('scopes mutation results by action and selected target', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('type AdminUserMutationAction = "create" | "profile" | "role" | "accountStatus";');
    expect(panelSource).toContain('type AdminUserMutationResult = {');
    expect(panelSource).toContain('targetUserId: string | null;');
    expect(panelSource).toContain('const [mutationResult, setMutationResult]');
    expect(panelSource).not.toContain('lastActionMessage');

    expect(panelSource).toContain('current?.action === "create" && current.status === "error" ? null : current');
    expect(panelSource).toContain('clearCreateErrorResult();');
    expect(panelSource).toContain('current.targetUserId === selectedUser?.id ? current : null');
    expect(panelSource).toContain('const visibleMutationResult =');
    expect(panelSource).toContain('!mutationResult?.targetUserId || mutationResult.targetUserId === selectedUser?.id');
    expect(panelSource).toContain('data-admin-user-mutation-action={visibleMutationResult?.action ?? undefined}');
    expect(panelSource).toContain('data-admin-user-mutation-target={visibleMutationResult?.targetUserId ?? undefined}');
  });

  test('preserves audit/readback metadata in scoped action messages', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('function getMutationAuditText(payload: AdminUserMutationResponse | null)');
    expect(panelSource).toContain('payload?.auditId ? `감사 ID: ${payload.auditId}`');
    expect(panelSource).toContain('payload?.preflightAuditId ? `사전 감사 ID: ${payload.preflightAuditId}`');
    expect(panelSource).toContain('payload?.step ? `단계: ${payload.step}`');
    expect(panelSource).toContain('const auditText = getMutationAuditText(payload);');
    expect(panelSource).toContain('message: `적용 완료: ${message}${auditText} 상태를 다시 확인했습니다.`');
    expect(panelSource).toContain('message: `적용 완료: ${message}${auditText} 목록을 다시 확인했습니다.`');
    expect(panelSource).toContain('message: `적용 실패: ${message}`');
  });

  test('binds each admin user mutation callsite to its isolated action', () => {
    const panelSource = source('components/admin/AdminUsersPanel.tsx');

    expect(panelSource).toContain('patchSelectedUser({ profile: profileForm }, "프로필 정보를 저장했습니다.", "profile")');
    expect(panelSource).toContain('patchSelectedUser({ role: "admin" }, "관리자 권한을 부여했습니다.", "role")');
    expect(panelSource).toContain('patchSelectedUser({ role: "user" }, "관리자 권한을 회수했습니다.", "role")');
    expect(panelSource).toContain('patchSelectedUser({ accountStatus: "disabled" }, "계정을 비활성화했습니다.", "accountStatus")');
    expect(panelSource).toContain('patchSelectedUser({ accountStatus: "active" }, "계정을 재활성화했습니다.", "accountStatus")');
    expect(panelSource).toContain('action: "create"');
  });
});
