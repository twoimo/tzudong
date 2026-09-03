import {
  getAdminAuditCoverage,
  type AdminAuditCoverage,
} from "@/lib/admin/audit-contract";
import { ADMIN_LIST_MAX } from "@/lib/admin/admin-json";

export type AdminAuditCoverageView = AdminAuditCoverage & {
  label?: string;
  summary?: string;
  source?: string;
  sources?: string[];
  domain?: string;
  domains?: string[];
  mode?: string;
  universal?: boolean;
};

export type AdminAuditEvent = {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  status: string;
  reasonCode: string;
  correlationId: string | null;
  appliedAt: string | null;
  errorCode: string | null;
  createdAt: string | null;
  counts: Record<string, number>;
  flags: Record<string, boolean>;
};

export type AdminAuditEventsResponse = {
  asOf: string;
  source: "admin_audit_events";
  coverage?: AdminAuditCoverageView;
  events: AdminAuditEvent[];
  unavailable: {
    reason: string;
    message: string;
  } | null;
};

export type AdminAuditUnavailableReason =
  | "admin-audit-events-read-failed"
  | "admin-audit-session-expired"
  | "admin-audit-admin-required";

export const adminAuditFallbackCoverage =
  getAdminAuditCoverage() as AdminAuditCoverageView;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAdminAuditCoveragePayload(
  value: unknown,
): value is AdminAuditCoverageView {
  return (
    isRecordValue(value) &&
    value.mode === "truthful-partial-domain-specific" &&
    value.universal === false
  );
}

function isAdminAuditUnavailablePayload(
  value: unknown,
): value is AdminAuditEventsResponse["unavailable"] {
  return (
    value === null ||
    (isRecordValue(value) &&
      typeof value.reason === "string" &&
      typeof value.message === "string")
  );
}

export function isAdminAuditEventsResponsePayload(
  value: unknown,
): value is AdminAuditEventsResponse {
  return (
    isRecordValue(value) &&
    value.source === "admin_audit_events" &&
    Array.isArray(value.events) &&
    value.events.length <= 50 &&
    value.events.every(
      (event) =>
        isRecordValue(event) &&
        typeof event.id === "string" &&
        typeof event.action === "string" &&
        typeof event.status === "string" &&
        typeof event.reasonCode === "string" &&
        isRecordValue(event.counts) &&
        isRecordValue(event.flags),
    ) &&
    isAdminAuditCoveragePayload(value.coverage) &&
    isAdminAuditUnavailablePayload(value.unavailable)
  );
}

export function getPayloadErrorMessage(value: unknown) {
  return isRecordValue(value) && typeof value.error === "string"
    ? value.error
    : null;
}

export function getAdminAuditCoverageLabel(
  coverage: AdminAuditCoverageView | undefined,
) {
  return coverage?.universal === false
    ? "부분/도메인별 감사 범위"
    : (coverage?.label ?? "부분/도메인별 감사 범위");
}

export function getAdminAuditCoverageSourceSummary(
  coverage: AdminAuditCoverageView | undefined,
) {
  const sources = coverage?.sources?.length
    ? coverage.sources
    : [
        coverage?.primary?.source,
        ...(coverage?.domainSpecific?.map((feed) => feed.source) ?? []),
      ].filter((source): source is string => Boolean(source));
  return (sources.length ? sources : ["admin_audit_events"]).join(" · ");
}

export function getAdminAuditCoverageDomainSummary(
  coverage: AdminAuditCoverageView | undefined,
) {
  const domains = coverage?.domains?.length
    ? coverage.domains
    : [
        coverage?.primary?.domain,
        ...(coverage?.domainSpecific?.map((feed) => feed.domain) ?? []),
      ].filter((domain): domain is string => Boolean(domain));
  return (domains.length
    ? domains
    : ["admin_user_management", "restaurant_request_reviews"]
  ).join(" · ");
}

export function hasTruthfulAdminAuditCoverage(
  coverage: AdminAuditCoverageView | undefined,
) {
  return (
    coverage?.universal === false &&
    coverage?.mode === "truthful-partial-domain-specific"
  );
}

export function buildAdminAuditAuthUnavailableResponse(
  status: number,
): AdminAuditEventsResponse | null {
  const reason: AdminAuditUnavailableReason | null =
    status === 401
      ? "admin-audit-session-expired"
      : status === 403
        ? "admin-audit-admin-required"
        : null;

  if (!reason) return null;

  return {
    asOf: new Date().toISOString(),
    source: "admin_audit_events",
    coverage: adminAuditFallbackCoverage,
    events: [],
    unavailable: {
      reason,
      message:
        status === 401
          ? "관리자 세션이 만료되었거나 로그인이 필요합니다. 다시 로그인한 뒤 감사 로그를 새로고침해 주세요."
          : "현재 계정에 관리자 감사 로그를 볼 권한이 없습니다. 관리자 권한을 확인한 뒤 다시 시도해 주세요.",
    },
  };
}

export async function fetchAdminAuditEvents(): Promise<AdminAuditEventsResponse> {
  const response = await fetch("/api/admin/audit-events?limit=20", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);

  const authUnavailable = buildAdminAuditAuthUnavailableResponse(
    response.status,
  );
  if (authUnavailable) return authUnavailable;
  if (!response.ok) {
    if (isAdminAuditEventsResponsePayload(payload) && payload.unavailable) {
      return payload;
    }
    throw new Error(
      getPayloadErrorMessage(payload) ?? "admin-audit-events-failed",
    );
  }

  if (!isAdminAuditEventsResponsePayload(payload)) {
    throw new Error("admin-audit-events-invalid-response");
  }

  return payload;
}

export function getAdminAuditActionLabel(action: string) {
  switch (action) {
    case "admin_user_created":
      return "사용자 생성";
    case "admin_user_profile_updated":
      return "프로필 수정";
    case "admin_user_role_granted":
      return "관리자 부여";
    case "admin_user_role_revoked":
      return "권한 회수";
    case "admin_user_disabled":
      return "계정 비활성화";
    case "admin_user_reactivated":
      return "계정 재활성화";
    default:
      return action;
  }
}

export function getAdminAuditStatusClassName(status: string) {
  switch (status) {
    case "applied":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "failed":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

export function formatDashboardDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
