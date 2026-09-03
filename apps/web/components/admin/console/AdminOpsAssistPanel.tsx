"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import Link from "next/link";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { ConsoleVizFormRenderer } from "@/components/admin/viz/console-viz-forms";
import { RiskyWorkProcedureSteps } from "@/components/admin/console/RiskyWorkProcedureSteps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCanonicalAdminModuleHref } from "@/lib/admin/admin-module-routing";
import { fetchAdminAuditEvents } from "@/lib/admin/admin-audit-events";
import { reportAdminClientError } from "@/lib/admin/admin-client-error";
import { getAdminConsoleMenu } from "@/lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import { getConsoleVizBindings } from "@/lib/admin/console-visualization-map";
import type {
  ConsoleVizRequestStatus,
  ConsoleVizSeries,
} from "@/lib/admin/console-viz-state";
import {
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountsResponse,
} from "@/lib/admin/pending-counts";
import { RISKY_WORK_STEPS } from "@/lib/admin/risky-work-procedure";
import type { AdminSystemStatusResponse } from "@/types/admin-system-status";

type OpsAssistSuggestion = {
  kind: "초안" | "제안";
  title: string;
  sourceName: string;
  menuId: "submissions" | "reviews" | "users" | "pipeline" | "restaurants";
};

async function fetchAdminPendingCounts(): Promise<AdminPendingCountsResponse> {
  const response = await fetch("/api/admin/pending-counts", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("admin-pending-counts-failed");
  }
  return normalizeAdminPendingCountsResponse(await response.json());
}

async function fetchAdminSystemStatus(): Promise<AdminSystemStatusResponse> {
  const response = await fetch("/api/admin/system-status", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("admin-system-status-failed");
  }
  return response.json() as Promise<AdminSystemStatusResponse>;
}

function pendingSeries(
  payload: AdminPendingCountsResponse | undefined,
): ConsoleVizSeries[] {
  if (!payload) return [];
  return [
    {
      label: "맛집 제보",
      points: [payload.domains.restaurant_submissions.count, payload.domains.restaurant_submissions.count],
      unit: "건",
      fractionDigits: 0,
    },
    {
      label: "추천 요청",
      points: [
        payload.domains.restaurant_recommendation_requests.count,
        payload.domains.restaurant_recommendation_requests.count,
      ],
      unit: "건",
      fractionDigits: 0,
    },
    {
      label: "리뷰",
      points: [payload.domains.reviews.count, payload.domains.reviews.count],
      unit: "건",
      fractionDigits: 0,
    },
  ];
}

function countFailedOrDegraded(status: AdminSystemStatusResponse | undefined) {
  if (!status) return 0;
  const providers = Object.values(status.providerReadiness ?? {}).filter(
    (provider) =>
      provider.status === "degraded" || provider.status === "unavailable",
  ).length;
  const integrations = [
    status.storyboardAgent?.reachable === false,
    status.bgeEmbedding?.reachable === false,
    status.frameCaption?.reachable === false,
    status.pipelineControl?.reachable === false,
  ].filter(Boolean).length;
  return providers + integrations;
}

function isGenerationReady(status: AdminSystemStatusResponse | undefined) {
  if (!status) return false;
  return countFailedOrDegraded(status) === 0;
}

function collectSuggestions(input: {
  pending?: AdminPendingCountsResponse;
  status?: AdminSystemStatusResponse;
  auditActions: string[];
}): OpsAssistSuggestion[] {
  const suggestions: OpsAssistSuggestion[] = [];
  if ((input.pending?.submissions ?? 0) > 0) {
    suggestions.push({
      kind: "초안",
      title: "대기 중인 제보를 검토합니다",
      sourceName: "pending-counts",
      menuId: "submissions",
    });
  }
  if ((input.pending?.reviews ?? 0) > 0) {
    suggestions.push({
      kind: "제안",
      title: "대기 중인 리뷰를 검수합니다",
      sourceName: "pending-counts",
      menuId: "reviews",
    });
  }
  if (countFailedOrDegraded(input.status) > 0) {
    suggestions.push({
      kind: "초안",
      title: "실패·저하 상태를 확인합니다",
      sourceName: "system-status",
      menuId: "pipeline",
    });
  }
  if (input.auditActions.some((action) => action.startsWith("admin_user_"))) {
    suggestions.push({
      kind: "제안",
      title: "최근 사용자 관리 감사를 담당 메뉴에서 이어서 확인합니다",
      sourceName: "audit-events",
      menuId: "users",
    });
  }
  return suggestions;
}

export function AdminOpsAssistPanel() {
  const pendingQuery = useQuery({
    queryKey: ["admin-ops-assist", "pending-counts"],
    queryFn: fetchAdminPendingCounts,
    staleTime: 30 * 1000,
  });
  const statusQuery = useQuery({
    queryKey: ["admin-ops-assist", "system-status"],
    queryFn: fetchAdminSystemStatus,
    staleTime: 30 * 1000,
  });
  const auditQuery = useQuery({
    queryKey: ["admin-ops-assist", "audit-events"],
    queryFn: fetchAdminAuditEvents,
    staleTime: 30 * 1000,
  });

  const pending = pendingQuery.data;
  const status = statusQuery.data;
  const auditActions = (auditQuery.data?.events ?? []).map((event) => event.action);
  const suggestions = collectSuggestions({
    pending,
    status,
    auditActions,
  });
  const generationReady = isGenerationReady(status) && !statusQuery.isError;
  const sparklineBinding = getConsoleVizBindings("llm").find(
    (binding) => binding.form === "compact-sparkline-row",
  );
  const sparklineStatus: ConsoleVizRequestStatus = pendingQuery.isError
    ? "error"
    : pendingQuery.isLoading
      ? "loading"
      : "settled";
  const failedOrDegradedCount = countFailedOrDegraded(status);

  if (pendingQuery.isError) {
    reportAdminClientError("llm", "ADMIN_OPS_PENDING_UNAVAILABLE");
  }
  if (statusQuery.isError) {
    reportAdminClientError("llm", "ADMIN_OPS_STATUS_UNAVAILABLE");
  }
  if (auditQuery.isError) {
    reportAdminClientError("llm", "ADMIN_OPS_AUDIT_UNAVAILABLE");
  }

  return (
    <AdminEmbeddedModuleShell
      menuId="llm"
      contentClassName="overflow-y-auto p-2 md:p-3"
    >
      <section aria-label="운영 보조 제안" className="space-y-3">
        {sparklineBinding ? (
          <ConsoleVizFormRenderer
            binding={sparklineBinding}
            requestStatus={sparklineStatus}
            series={pendingSeries(pending)}
            metaLeft="대기 건수 방향"
            metaRight={`${pending?.total ?? 0}건`}
          />
        ) : null}

        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="border-border bg-card/95 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">현재 화면 요약</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                대기 {pending?.total ?? 0}건 · 실패·저하 {failedOrDegradedCount}건 ·
                위험 작업 후보 {suggestions.length}건
              </p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/95 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">다음 검수 추천</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                제보 {pending?.submissions ?? 0}건, 리뷰 {pending?.reviews ?? 0}건을
                우선 확인합니다.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card/95 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">위험 액션 체크리스트</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {RISKY_WORK_STEPS.join(" → ")} 순서를 담당 메뉴에서 확인합니다.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          {suggestions.map((suggestion) => {
            const menu = getAdminConsoleMenu(suggestion.menuId);
            return (
              <Link
                key={`${suggestion.menuId}-${suggestion.sourceName}-${suggestion.title}`}
                href={buildCanonicalAdminModuleHref(suggestion.menuId)}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm"
                data-admin-ops-assist-suggestion="true"
                data-admin-ops-assist-source={suggestion.sourceName}
              >
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{suggestion.kind}</Badge>
                    <span className="font-semibold text-foreground">
                      {suggestion.title}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    근거 출처 {suggestion.sourceName} · 위임 대상 {menu.title}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-primary/15 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">안전 적용 원칙</CardTitle>
                <Badge variant="outline" className="border-primary/30 text-primary">
                  관리자 확인 필수
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <RiskyWorkProcedureSteps menuId="restaurants" />
              <p className="text-sm leading-6 text-muted-foreground">
                이 화면은 읽기 전용 제안만 보여 줍니다. 변경은 위임 대상 메뉴의
                위험 작업 절차에서만 적용합니다.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!generationReady}
                data-admin-ops-assist-generate="true"
                onClick={() => {
                  void pendingQuery.refetch();
                  void statusQuery.refetch();
                  void auditQuery.refetch();
                }}
              >
                제안 다시 만들기
              </Button>
              {!generationReady ? (
                <p className="text-sm text-muted-foreground" data-admin-ops-generation-unavailable="true">
                  {CONSOLE_FIXED_MESSAGES.generationUnavailable}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="border-border bg-card/95 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
                운영 원칙
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>1. 자동 운영 보조는 읽기 전용 제안 화면으로 유지합니다.</p>
              <p>
                2. 데이터 변경, 권한 정책, 데이터 구조 변경은 이 화면에서 직접
                수행하지 않습니다.
              </p>
              <p>
                3. 위험 작업은 반드시 관리자 UI의 명시적 확인과 상태 재확인을
                거칩니다.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </AdminEmbeddedModuleShell>
  );
}
