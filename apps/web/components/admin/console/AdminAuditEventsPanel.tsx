"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { ConsoleVizFormRenderer } from "@/components/admin/viz/console-viz-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  adminAuditFallbackCoverage,
  fetchAdminAuditEvents,
  formatDashboardDateTime,
  getAdminAuditActionLabel,
  getAdminAuditCoverageDomainSummary,
  getAdminAuditCoverageLabel,
  getAdminAuditCoverageSourceSummary,
  getAdminAuditStatusClassName,
  hasTruthfulAdminAuditCoverage,
} from "@/lib/admin/admin-audit-events";
import { ADMIN_LIST_MAX } from "@/lib/admin/admin-json";
import { reportAdminClientError } from "@/lib/admin/admin-client-error";
import { getConsoleVizBindings } from "@/lib/admin/console-visualization-map";
import type { ConsoleVizSeries } from "@/lib/admin/console-viz-state";
import { cn } from "@/lib/utils";

function buildAuditHeatmapSeries(
  events: Array<{ createdAt: string | null; status: string }>,
): ConsoleVizSeries[] {
  const days = Array.from({ length: 7 }, () => 0);
  const failed = Array.from({ length: 7 }, () => 0);
  const now = Date.now();
  for (const event of events) {
    if (!event.createdAt) continue;
    const parsed = Date.parse(event.createdAt);
    if (!Number.isFinite(parsed)) continue;
    const dayOffset = Math.floor((now - parsed) / 86_400_000);
    if (dayOffset < 0 || dayOffset > 6) continue;
    const index = 6 - dayOffset;
    days[index] += 1;
    if (event.status === "failed") failed[index] += 1;
  }
  return [
    { label: "기록", points: days, unit: "건", fractionDigits: 0 },
    { label: "실패", points: failed, unit: "건", fractionDigits: 0 },
  ];
}

export function AdminAuditEventsPanel() {
  const auditEventsQuery = useQuery({
    queryKey: ["admin-audit-events", "recent"],
    queryFn: fetchAdminAuditEvents,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  const auditPayload = auditEventsQuery.data;
  const events = auditPayload?.events ?? [];
  const unavailable = auditPayload?.unavailable ?? null;
  const coverage = auditPayload?.coverage ?? adminAuditFallbackCoverage;
  const isAuditCoverageMissing =
    auditPayload !== undefined && !auditPayload.coverage;
  const hasTruthfulCoverage =
    !isAuditCoverageMissing && hasTruthfulAdminAuditCoverage(coverage);
  const isAuditAuthUnavailable =
    unavailable?.reason === "admin-audit-session-expired" ||
    unavailable?.reason === "admin-audit-admin-required";
  const coverageBadgeLabel = isAuditAuthUnavailable
    ? "세션 확인 필요"
    : unavailable || auditEventsQuery.isError
      ? "읽기 확인 필요"
      : hasTruthfulCoverage
        ? `부분 감사 · ${events.length}개`
        : "범위 확인 필요";
  const adminAuditLoginHref =
    "/?auth=login&reason=admin&next=%2Fadmin%3Fmodule%3Daudit";
  const heatmapBinding = getConsoleVizBindings("audit").find(
    (binding) => binding.form === "activity-heatmap",
  );
  const cappedCount = Math.min(events.length, ADMIN_LIST_MAX);
  const domainSummary = getAdminAuditCoverageDomainSummary(coverage);
  const heatmapMetaLeft = hasTruthfulCoverage
    ? `부분 범위 · ${domainSummary}`
    : "범위 확인 필요";
  const heatmapMetaRight = hasTruthfulCoverage ? `${cappedCount}건` : "—";

  if (auditEventsQuery.isError) {
    reportAdminClientError("audit", "ADMIN_AUDIT_EVENTS_UNAVAILABLE");
  }

  return (
    <AdminEmbeddedModuleShell
      menuId="audit"
      contentClassName="overflow-y-auto p-2 md:p-3"
    >
      <div className="min-h-[480px] space-y-3">
        <div
          className="rounded-2xl border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground"
          data-admin-audit-coverage="partial-domain-specific"
          data-admin-audit-coverage-source={getAdminAuditCoverageSourceSummary(coverage)}
          data-admin-audit-coverage-domain={getAdminAuditCoverageDomainSummary(coverage)}
          data-admin-audit-universal={coverage.universal ? "true" : "false"}
        >
          <p className="font-bold text-foreground">
            {getAdminAuditCoverageLabel(coverage)}
          </p>
          <p className="mt-1">
            소스: {getAdminAuditCoverageSourceSummary(coverage)} · 도메인:{" "}
            {getAdminAuditCoverageDomainSummary(coverage)}
          </p>
          <p className="mt-1">
            admin_audit_events는 사용자 관리 감사의 현재 1차 피드이며, 맛집 추천
            검토 감사는 restaurant_request_review_audit의 별도 도메인별 경로입니다.
            전체 운영 변경을 포괄하는 범용 감사 로그처럼 표시하지 않습니다.
          </p>
          <p className="mt-1 font-semibold text-foreground">{coverageBadgeLabel}</p>
        </div>

        {heatmapBinding ? (
          <ConsoleVizFormRenderer
            binding={heatmapBinding}
            requestStatus={
              auditEventsQuery.isError
                ? "error"
                : auditEventsQuery.isLoading
                  ? "loading"
                  : "settled"
            }
            series={buildAuditHeatmapSeries(events)}
            metaLeft={heatmapMetaLeft}
            metaRight={heatmapMetaRight}
            columnLabels={["6", "5", "4", "3", "2", "1", "0"]}
          />
        ) : null}

        <Link
          href="/admin/privacy-incidents"
          className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          data-admin-privacy-incidents-link="true"
        >
          <span>
            <strong className="block">개인정보 사고 대응</strong>
            <span className="mt-1 block text-xs">
              사람의 평가·외부 제출 기록·72시간 기준을 관리하며 자동 신고나 수리 완료를 주장하지 않습니다.
            </span>
          </span>
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>

        {auditEventsQuery.isLoading ? (
          <div className="space-y-2" aria-label="감사 로그 로딩 중">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : null}

        {!auditEventsQuery.isLoading && (unavailable || auditEventsQuery.isError) ? (
          <div
            className={cn(
              "rounded-2xl p-4 text-sm leading-6",
              isAuditAuthUnavailable
                ? "border border-destructive/20 bg-destructive/10 text-destructive"
                : "border border-amber-200 bg-amber-50/80 text-amber-900",
            )}
            role="status"
            data-admin-audit-unavailable-state="true"
            data-admin-audit-session-expired-state={isAuditAuthUnavailable ? "true" : undefined}
          >
            <p className="font-bold">
              {isAuditAuthUnavailable
                ? "관리자 세션 확인이 필요합니다."
                : "감사 로그를 읽지 못했습니다."}
            </p>
            <p className="mt-1">
              {unavailable?.message ??
                "관리자 감사 로그 API 또는 데이터베이스 권한을 확인해 주세요."}
            </p>
            {isAuditAuthUnavailable ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    window.location.assign(adminAuditLoginHref);
                  }}
                >
                  다시 로그인하기
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
                  onClick={() => auditEventsQuery.refetch()}
                >
                  감사 로그 다시 확인
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!auditEventsQuery.isLoading && !unavailable && !auditEventsQuery.isError && events.length === 0 ? (
          <div
            className="rounded-2xl border border-border bg-muted/25 p-4 text-center text-sm leading-6 text-muted-foreground"
            role="status"
            data-admin-audit-empty-state="true"
          >
            아직 표시할 사용자 관리 감사 이벤트가 없습니다. 새 사용자 생성이나 권한 변경을 적용하면
            부분 감사 범위 안에서 intent → applied/failed 순서로 이 영역에 표시됩니다.
          </div>
        ) : null}

        {events.length > 0 ? (
          <ol
            className="divide-y divide-border overflow-hidden rounded-2xl border border-border"
            data-admin-audit-event-list="admin_audit_events"
          >
            {events.map((event) => (
              <li key={event.id} className="bg-background p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      {getAdminAuditActionLabel(event.action)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {formatDashboardDateTime(event.createdAt)}
                      {event.reasonCode ? ` · ${event.reasonCode}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                      getAdminAuditStatusClassName(event.status),
                    )}
                  >
                    {event.status}
                  </Badge>
                </div>
                <dl className="mt-2 grid gap-1 text-[11px] leading-5 text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-foreground">감사 ID</dt>
                    <dd className="break-all font-mono">{event.id}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">대상</dt>
                    <dd className="break-all font-mono">{event.targetUserId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">범위</dt>
                    <dd className="break-all font-mono">
                      admin_user_management · admin_audit_events
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">적용 시각</dt>
                    <dd className="break-all font-mono">
                      {event.appliedAt ? formatDashboardDateTime(event.appliedAt) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">상관 ID</dt>
                    <dd className="break-all font-mono">{event.correlationId ?? "—"}</dd>
                  </div>
                  {event.errorCode ? (
                    <div className="sm:col-span-2">
                      <dt className="font-semibold text-destructive">오류 코드</dt>
                      <dd className="break-all font-mono text-destructive">{event.errorCode}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </AdminEmbeddedModuleShell>
  );
}
