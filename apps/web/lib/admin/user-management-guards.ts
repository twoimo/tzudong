export const ADMIN_ROLE_CONFIRMATION = '권한변경';
export const ADMIN_DISABLE_CONFIRMATION = '비활성화';
export const ADMIN_REACTIVATE_CONFIRMATION = '재활성화';

export type AdminUserMutationIntent = {
  nextRole?: 'admin' | 'user';
  nextAccountStatus?: 'active' | 'disabled';
  hasProfileChange?: boolean;
  confirmation?: string;
};

export function getRequiredAdminUserConfirmation(intent: AdminUserMutationIntent): string | null {
  if (intent.nextRole) return ADMIN_ROLE_CONFIRMATION;
  if (intent.nextAccountStatus === 'disabled') return ADMIN_DISABLE_CONFIRMATION;
  if (intent.nextAccountStatus === 'active') return ADMIN_REACTIVATE_CONFIRMATION;
  return null;
}

export function countPrivilegedAdminUserMutationIntents(intent: AdminUserMutationIntent) {
  return [Boolean(intent.nextRole), Boolean(intent.nextAccountStatus)].filter(Boolean).length;
}

export function validateAdminUserConfirmation(intent: AdminUserMutationIntent): string | null {
  if (countPrivilegedAdminUserMutationIntents(intent) > 1) {
    return '권한 변경과 계정 상태 변경은 한 번에 하나씩 적용해 주세요.';
  }

  const required = getRequiredAdminUserConfirmation(intent);
  if (!required) return null;

  return intent.confirmation === required
    ? null
    : `${required} 확인 문구를 정확히 입력해 주세요.`;
}

export function isBannedUntilActive(bannedUntil: string | null | undefined, nowMs = Date.now()) {
  if (!bannedUntil) return false;
  const timestamp = Date.parse(bannedUntil);
  return Number.isFinite(timestamp) && timestamp > nowMs;
}
