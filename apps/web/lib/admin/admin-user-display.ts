import { sanitizePrivacyValue } from "@/lib/privacy/sanitize";

export const ADMIN_USER_DISPLAY_FIELDS = [
  "accountId",
  "displayName",
  "role",
  "status",
  "createdAt",
  "lastLoginAt",
  "emailConfirmed",
  "emailMaskToken",
] as const;

export const ADMIN_USER_DISPLAY_FIELD_LABELS = {
  accountId: "계정 식별자",
  displayName: "표시 이름",
  role: "권한 역할",
  status: "계정 상태",
  createdAt: "계정 생성 시각",
  lastLoginAt: "최근 로그인 시각",
  emailConfirmed: "이메일 확인 여부",
  emailMaskToken: "이메일 마스킹 표식",
} as const;

export function buildAdminUserEmailMaskToken(email: string): string {
  const result = sanitizePrivacyValue(email);
  return typeof result.value === "string" && result.value.length > 0
    ? result.value
    : "[REDACTED:email]";
}
