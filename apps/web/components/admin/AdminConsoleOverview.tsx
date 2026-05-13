"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2,
  Bot,
  ClipboardList,
  FileCheck2,
  Image as ImageIcon,
  ListChecks,
  MapPin,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Sparkles,
  Store,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlobalLoader } from "@/components/ui/global-loader";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useAdBannersAdmin } from "@/hooks/use-ad-banners";
import { fetchSupabaseExactCount } from "@/lib/supabase-rest-client";
import { cn } from "@/lib/utils";
import type { DashboardSummaryResponse } from "@/types/dashboard";

type AdminModuleId = "overview" | "restaurants" | "submissions" | "reviews" | "banners" | "insights" | "audit" | "llm";
type ConsoleModuleId = Exclude<AdminModuleId, "overview" | "llm">;

type ConsoleModule = {
  id: ConsoleModuleId;
  title: string;
  description: string;
  href: string;
  icon: typeof Store;
  badge: string;
  actionLabel: string;
  tone: "primary" | "muted" | "safe" | "warning";
  priority?: "urgent" | "normal";
};

type SidebarSection = {
  label: string;
  items: Array<{
    id: AdminModuleId;
    title: string;
    description: string;
    icon: typeof Store;
    badge?: string;
  }>;
};

const consoleModules: ConsoleModule[] = [
  {
    id: "restaurants",
    title: "맛집 관리",
    description: "승인된 맛집, 삭제/복구, 지오코딩 실패 후보를 한 흐름에서 점검합니다.",
    href: "/admin/evaluations",
    icon: Store,
    badge: "데이터 검수",
    actionLabel: "맛집 데이터 검수",
    tone: "primary",
    priority: "urgent",
  },
  {
    id: "submissions",
    title: "제보 관리",
    description: "사용자 신규/수정 제보를 검토하고 안전 적용 절차로 반영합니다.",
    href: "/admin/evaluations?view=submissions",
    icon: ClipboardList,
    badge: "승인 대기",
    actionLabel: "제보 검토하기",
    tone: "warning",
    priority: "urgent",
  },
  {
    id: "reviews",
    title: "리뷰 관리",
    description: "미승인 리뷰, OCR 증빙, 중복/삭제 후보를 운영 기준에 맞춰 처리합니다.",
    href: "/admin/evaluations?view=submissions&tab=reviews",
    icon: MessageSquareText,
    badge: "검수 큐",
    actionLabel: "리뷰 검수하기",
    tone: "safe",
    priority: "urgent",
  },
  {
    id: "banners",
    title: "배너 관리",
    description: "사이드바/모바일 팝업 배너의 노출 위치, 우선순위, 미디어 상태를 관리합니다.",
    href: "/admin/banners",
    icon: ImageIcon,
    badge: "공개 노출",
    actionLabel: "배너 노출 관리",
    tone: "muted",
  },
  {
    id: "insights",
    title: "인사이트",
    description: "조회수/좋아요/댓글/영상 길이 기반 트리맵과 변화 추이를 확인합니다.",
    href: "/insights",
    icon: BarChart2,
    badge: "분석",
    actionLabel: "인사이트 보기",
    tone: "safe",
  },
  {
    id: "audit",
    title: "감사 로그",
    description: "승인·반려·삭제·복구 이력을 상태 재확인과 함께 추적하는 영역입니다.",
    href: "/admin/evaluations",
    icon: ScrollText,
    badge: "준비 중",
    actionLabel: "감사 기준 보기",
    tone: "muted",
  },
];

const statusChips = ["읽기 전용 요약", "안전 적용 원칙", "감사 기록 준비", "기존 라우트 보존"];

const guardedSteps = ["미리보기", "확인", "적용", "재확인", "감사 기록"];
const SIDEBAR_LABEL_REVEAL_DELAY_MS = 180;

const sidebarSections: SidebarSection[] = [
  {
    label: "홈",
    items: [
      {
        id: "overview",
        title: "개요",
        description: "오늘의 운영 상태와 주요 진입점을 봅니다.",
        icon: Sparkles,
      },
    ],
  },
  {
    label: "검수",
    items: consoleModules
      .filter((module) => ["restaurants", "submissions", "reviews"].includes(module.id))
      .map(({ id, title, description, icon, badge }) => ({ id, title, description, icon, badge })),
  },
  {
    label: "운영",
    items: consoleModules
      .filter((module) => ["banners", "insights", "audit"].includes(module.id))
      .map(({ id, title, description, icon, badge }) => ({ id, title, description, icon, badge })),
  },
  {
    label: "보조",
    items: [
      {
        id: "llm",
        title: "운영 보조",
        description: "위험 액션 전 읽기 전용 운영 보조를 확인합니다.",
        icon: Bot,
        badge: "읽기 전용",
      },
    ],
  },
];

const adminModuleIds: AdminModuleId[] = sidebarSections.flatMap((section) => section.items.map((item) => item.id));

function isAdminModuleId(value: string | null): value is AdminModuleId {
  return Boolean(value && adminModuleIds.includes(value as AdminModuleId));
}

function getAdminModuleIdFromLocation(location: Location): AdminModuleId {
  const moduleId = new URL(location.href).searchParams.get("module");
  return isAdminModuleId(moduleId) ? moduleId : "overview";
}

const AdminEvaluationModule = dynamic(() => import("@/app/admin/evaluations/page"), {
  ssr: false,
  loading: () => <InlineModuleLoading title="검수 큐 작업 화면 연결 중" variant="moderation" />,
});

const AdminBannerModule = dynamic(() => import("@/app/admin/banners/page"), {
  ssr: false,
  loading: () => <InlineModuleLoading title="배너 관리 화면 준비 중" variant="banners" />,
});

const InsightsModule = dynamic(() => import("@/app/insights/insights-client"), {
  ssr: false,
  loading: () => <InlineModuleLoading title="인사이트 화면 준비 중" variant="insights" />,
});

type AdminPendingCounts = {
  submissions: number;
  reviews: number;
};

type AdminOverviewStats = {
  pendingSubmissions: number | null;
  pendingReviews: number | null;
  totalRestaurants: number | null;
  withCoordinates: number | null;
  activeBanners: number | null;
  inactiveBanners: number | null;
  latestRestaurantUpdate: string | null;
};

const toneClassName: Record<ConsoleModule["tone"], string> = {
  primary: "border-primary/25 bg-primary/5 text-primary",
  muted: "border-border bg-muted/40 text-muted-foreground",
  safe: "border-emerald-700/20 bg-emerald-50 text-emerald-800",
  warning: "border-amber-700/20 bg-amber-50 text-amber-800",
};

const loadingPreviewCopy = {
  moderation: {
    eyebrow: "작업 화면 전환 중",
    description: "기존 페이지로 이동하지 않고 통합 콘솔 작업 화면에서 제보·리뷰 검수 큐를 준비하고 있습니다.",
    chips: ["권한 확인", "큐 동기화", "검수 화면 구성", "안전 적용 순서 유지"],
    rows: ["대기 제보", "수정 제보", "증빙 확인", "중복 후보"],
  },
  banners: {
    eyebrow: "공개 노출 관리",
    description: "사이드바/모바일 배너의 노출 상태와 우선순위를 이 화면에서 준비하고 있습니다.",
    chips: ["활성 배너", "우선순위", "공개 전 확인"],
    rows: ["데스크톱 배너", "모바일 팝업", "비활성 배너", "미디어 점검"],
  },
  insights: {
    eyebrow: "운영 인사이트",
    description: "조회수, 좋아요, 댓글, 영상 길이 기반 분석 화면을 불러오고 있습니다.",
    chips: ["트리맵", "변화 추이", "읽기 전용"],
    rows: ["조회 상위", "반응 변화", "영상 길이", "댓글 신호"],
  },
} satisfies Record<
  "moderation" | "banners" | "insights",
  {
    eyebrow: string;
    description: string;
    chips: string[];
    rows: string[];
  }
>;

function InlineModuleLoading({
  title,
  variant = "moderation",
}: {
  title: string;
  variant?: keyof typeof loadingPreviewCopy;
}) {
  const preview = loadingPreviewCopy[variant];

  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={`${title} 작업 화면 준비 상태`}
      className="h-full min-h-[420px] overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-card via-card to-primary/5 p-4 shadow-sm sm:min-h-[520px] sm:p-5"
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-background/80 p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">{preview.eyebrow}</p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.04em] text-foreground md:text-2xl">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {preview.description}
            </p>
          </div>
          <div className="flex w-fit shrink-0 items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
            통합 콘솔 작업 화면
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="준비 중인 검수 상태">
          {preview.chips.map((chip, index) => (
            <span
              key={chip}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                index === 0
                  ? "border-primary/25 bg-primary/5 text-primary"
                  : "border-border bg-background/70 text-muted-foreground",
              )}
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 rounded-2xl border border-border bg-background/80 p-3">
            <div className="mb-3 grid gap-2 sm:grid-cols-[1.3fr_0.7fr_0.7fr_0.5fr]">
              <Skeleton className="h-10 rounded-xl motion-reduce:animate-none" />
              <Skeleton className="h-10 rounded-xl motion-reduce:animate-none" />
              <Skeleton className="h-10 rounded-xl motion-reduce:animate-none" />
              <Skeleton className="h-10 rounded-xl motion-reduce:animate-none" />
            </div>
            <div className="space-y-2">
              {preview.rows.map((row, index) => (
                <div
                  key={row}
                  className="grid items-center gap-2 rounded-xl border border-border bg-card/80 p-3 sm:grid-cols-[1.2fr_0.8fr_0.8fr_0.4fr]"
                >
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-xl motion-reduce:animate-none" aria-hidden="true" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-xs font-semibold text-foreground">{row}</p>
                      <Skeleton className={cn("h-2.5 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-40" : "w-32")} aria-hidden="true" />
                    </div>
                  </div>
                  <Skeleton className="hidden h-8 rounded-full motion-reduce:animate-none sm:block" aria-hidden="true" />
                  <Skeleton className="hidden h-8 rounded-full motion-reduce:animate-none sm:block" aria-hidden="true" />
                  <Skeleton className="h-8 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-primary/10 bg-background/75 p-4 shadow-sm">
            <p className="text-sm font-semibold text-foreground">안전 처리 순서</p>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              {guardedSteps.map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      index === 0 ? "border-primary/30 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 space-y-2" aria-hidden="true">
              <Skeleton className="h-16 rounded-xl motion-reduce:animate-none" />
              <Skeleton className="h-10 rounded-xl motion-reduce:animate-none" />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function formatNumber(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("ko-KR");
}

function formatCount(value: number | null, unit: string) {
  if (value == null) return "—";
  return `${formatNumber(value)}${unit}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "확인 필요";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 필요";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function fetchAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [submissions, reviews] = await Promise.all([
    fetchSupabaseExactCount("restaurant_submissions", [
      ["select", "id"],
      ["status", "eq.pending"],
    ]),
    fetchSupabaseExactCount("reviews", [
      ["select", "id"],
      ["is_verified", "eq.false"],
    ]),
  ]);

  return { submissions, reviews };
}

async function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await fetch("/api/dashboard/summary", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("관리자 홈 요약을 불러오지 못했습니다.");
  }

  return response.json() as Promise<DashboardSummaryResponse>;
}

function useAdminOverviewStats(isAdmin: boolean): {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
} {
  const pendingCountsQuery = useQuery({
    queryKey: ["admin-overview", "pending-counts"],
    queryFn: fetchAdminPendingCounts,
    enabled: isAdmin,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const dashboardSummaryQuery = useQuery({
    queryKey: ["admin-overview", "dashboard-summary"],
    queryFn: fetchDashboardSummary,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const bannersQuery = useAdBannersAdmin();
  const banners = bannersQuery.data ?? [];

  return {
    stats: {
      pendingSubmissions: pendingCountsQuery.data?.submissions ?? null,
      pendingReviews: pendingCountsQuery.data?.reviews ?? null,
      totalRestaurants: dashboardSummaryQuery.data?.totals.restaurants ?? null,
      withCoordinates: dashboardSummaryQuery.data?.totals.withCoordinates ?? null,
      activeBanners: bannersQuery.isSuccess ? banners.filter((banner) => banner.is_active).length : null,
      inactiveBanners: bannersQuery.isSuccess ? banners.filter((banner) => !banner.is_active).length : null,
      latestRestaurantUpdate: dashboardSummaryQuery.data?.asOf ?? null,
    },
    isLoading: pendingCountsQuery.isLoading || dashboardSummaryQuery.isLoading || bannersQuery.isLoading,
    hasError: pendingCountsQuery.isError || dashboardSummaryQuery.isError || bannersQuery.isError,
  };
}

function AdminSidebar({
  activeModuleId,
  onSelectModule,
  isCollapsed,
  showLabels,
  onToggleCollapsed,
  stats,
}: {
  activeModuleId: AdminModuleId;
  onSelectModule: (moduleId: AdminModuleId) => void;
  isCollapsed: boolean;
  showLabels: boolean;
  onToggleCollapsed: () => void;
  stats: AdminOverviewStats;
}) {
  const getItemStatus = (moduleId: AdminModuleId) => {
    if (moduleId === "submissions" && stats.pendingSubmissions != null) {
      return {
        value: formatNumber(stats.pendingSubmissions),
        label: `대기 ${formatCount(stats.pendingSubmissions, "건")}`,
        urgent: stats.pendingSubmissions > 0,
      };
    }

    if (moduleId === "reviews" && stats.pendingReviews != null) {
      return {
        value: formatNumber(stats.pendingReviews),
        label: `대기 ${formatCount(stats.pendingReviews, "건")}`,
        urgent: stats.pendingReviews > 0,
      };
    }

    return null;
  };

  return (
    <aside
      className={cn(
        "w-full shrink-0 overflow-x-hidden border-y border-border bg-gradient-to-b from-card via-card to-background/95 p-3 shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-[calc(100dvh-var(--app-header-height,56px))] lg:w-60 lg:overflow-y-auto lg:border-y-0 lg:border-r",
        isCollapsed && "lg:w-14 lg:px-1.5",
      )}
      aria-label="관리자 콘솔 사이드바"
    >
      <div
        className={cn(
          "mb-3 flex h-11 items-center gap-2 rounded-2xl border border-border bg-background/75 px-2.5 shadow-sm",
          isCollapsed && "lg:grid lg:place-items-center lg:gap-0 lg:border-transparent lg:bg-transparent lg:px-0 lg:shadow-none",
        )}
      >
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
            (!showLabels || isCollapsed) && "lg:hidden",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <h2 className="truncate whitespace-nowrap text-sm font-bold tracking-[-0.02em] text-foreground">
              관리자 메뉴
            </h2>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "ml-auto hidden h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background lg:inline-flex",
            isCollapsed && "lg:m-0",
          )}
          aria-pressed={isCollapsed}
          aria-expanded={!isCollapsed}
          aria-controls="admin-console-menu"
          aria-label={isCollapsed ? "관리자 사이드바 펼치기" : "관리자 사이드바 접기"}
          onClick={onToggleCollapsed}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <nav id="admin-console-menu" aria-label="관리자 통합 메뉴" className="space-y-4">
        {sidebarSections.map((section) => (
          <div key={section.label} className="space-y-1.5">
            <p
              className={cn(
                "px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none",
                (!showLabels || isCollapsed) && "lg:h-px lg:px-0 lg:opacity-0",
              )}
            >
              {section.label}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeModuleId === item.id;
              const itemStatus = getItemStatus(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.title}
                  aria-label={itemStatus ? `${item.title} ${itemStatus.label}` : item.title}
                  aria-current={isActive ? "page" : undefined}
                  aria-controls="admin-console-canvas"
                  className={cn(
                    "group relative flex min-h-12 w-full items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-2xl border px-2.5 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                    isCollapsed && "lg:h-11 lg:min-h-11 lg:w-11 lg:justify-center lg:gap-0 lg:px-0",
                    isActive
                      ? "border-primary/20 bg-primary text-primary-foreground shadow-primary"
                      : "border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground",
                  )}
                  onClick={() => onSelectModule(item.id)}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors motion-reduce:transition-none",
                      isActive
                        ? "border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
                        : "border-border bg-background/80 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
                      (!showLabels || isCollapsed) && "lg:hidden lg:w-0 lg:flex-none lg:opacity-0",
                    )}
                  >
                    <span className="block truncate font-semibold leading-5">{item.title}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[11px] leading-4",
                          isActive ? "text-primary-foreground/75" : "text-muted-foreground",
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                  {itemStatus && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 transition-all duration-100 motion-reduce:transition-none",
                        itemStatus.urgent
                          ? isActive
                            ? "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground"
                            : "border-primary/25 bg-primary/5 text-primary"
                          : isActive
                            ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80"
                            : "border-border bg-background/80 text-muted-foreground",
                        !showLabels && "lg:absolute lg:right-1 lg:top-1 lg:h-2 lg:w-2 lg:border-0 lg:p-0 lg:text-[0px]",
                      )}
                      aria-hidden="true"
                    >
                      {itemStatus.value}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function GuardedApplyCard() {
  return (
    <Card className="border-primary/15 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">안전 적용 원칙</CardTitle>
          <Badge variant="outline" className="border-primary/30 text-primary">관리자 확인 필수</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {guardedSteps.map((step, index) => (
            <div key={step} className="flex items-center gap-2">
              <Badge
                variant={index === 0 ? "default" : "secondary"}
                className={cn(index === 0 && "bg-primary text-primary-foreground")}
              >
                {step}
              </Badge>
              {index < guardedSteps.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          제보 승인, 리뷰 반려, 맛집 삭제/복구, 배너 공개처럼 사용자에게 보이는 변경은 적용 전에 한 번 더 확인하고,
          적용 후에는 실제 상태를 다시 읽어 관리자에게 보여주는 흐름을 기본값으로 둡니다.
        </p>
      </CardContent>
    </Card>
  );
}

function OverviewMetricCard({
  title,
  value,
  description,
  onSelect,
  icon: Icon,
  isLoading,
  tone = "muted",
  priority = "normal",
}: {
  title: string;
  value: string;
  description: string;
  onSelect: () => void;
  icon: typeof Store;
  isLoading: boolean;
  tone?: ConsoleModule["tone"];
  priority?: "urgent" | "normal";
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${title} 작업 화면 열기`}
      className={cn(
        "group rounded-2xl border bg-gradient-to-b from-card via-card to-muted/20 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        priority === "urgent" ? "border-primary/25 ring-1 ring-primary/10" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", toneClassName[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className={cn(
          "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
          priority === "urgent"
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-border bg-background/70 text-muted-foreground group-hover:border-primary/30 group-hover:text-primary",
        )}>
          {priority === "urgent" ? "검토 필요" : "열기 →"}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-1 text-2xl font-bold tracking-[-0.04em] text-foreground">
        {isLoading ? <Skeleton className="h-8 w-20 rounded-full" aria-hidden="true" /> : value}
      </div>
      <p className="mt-2 text-xs leading-5 text-foreground/70">{description}</p>
    </button>
  );
}

function OperationalSummary({
  stats,
  isLoading,
  hasError,
  onSelectModule,
}: {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
  onSelectModule: (moduleId: AdminModuleId) => void;
}) {
  const coordinateRatio =
    stats.totalRestaurants && stats.withCoordinates != null
      ? Math.round((stats.withCoordinates / stats.totalRestaurants) * 100)
      : null;
  const coordinateDescription =
    stats.withCoordinates == null || stats.totalRestaurants == null
      ? "좌표 커버리지 확인 필요"
      : `${formatCount(stats.withCoordinates, "개")} / ${formatCount(stats.totalRestaurants, "개")} 좌표 보유`;
  const bannerDescription =
    stats.inactiveBanners == null
      ? "비활성 배너 확인 필요 · 공개 노출 관리"
      : `비활성 ${formatCount(stats.inactiveBanners, "개")} · 공개 노출 관리`;

  return (
    <section aria-labelledby="admin-overview-summary" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="admin-overview-summary" className="text-lg font-bold text-foreground">
            운영 요약
          </h2>
          <p className="text-sm text-muted-foreground">
            기존 운영 데이터를 다시 읽어 만든 읽기 전용 요약입니다.
          </p>
        </div>
        <Badge
          aria-live="polite"
          variant="outline"
          className={cn(
            "w-fit rounded-md",
            hasError ? "border-amber-700/30 text-amber-800" : "border-emerald-700/20 text-emerald-800",
          )}
        >
          {hasError ? "일부 요약 확인 필요" : "실시간 요약"}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewMetricCard
          title="미처리 제보"
          value={formatCount(stats.pendingSubmissions, "건")}
          description="신규·수정 제보 중 아직 처리하지 않은 건"
          onSelect={() => onSelectModule("submissions")}
          icon={ClipboardList}
          isLoading={isLoading}
          tone="warning"
          priority="urgent"
        />
        <OverviewMetricCard
          title="미승인 리뷰"
          value={formatCount(stats.pendingReviews, "건")}
          description="증빙과 내용을 확인해야 하는 리뷰 큐"
          onSelect={() => onSelectModule("reviews")}
          icon={MessageSquareText}
          isLoading={isLoading}
          tone="safe"
          priority="urgent"
        />
        <OverviewMetricCard
          title="맛집 좌표 커버리지"
          value={coordinateRatio == null ? "—" : `${coordinateRatio}%`}
          description={coordinateDescription}
          onSelect={() => onSelectModule("restaurants")}
          icon={MapPin}
          isLoading={isLoading}
          tone="primary"
        />
        <OverviewMetricCard
          title="활성 배너"
          value={formatCount(stats.activeBanners, "개")}
          description={bannerDescription}
          onSelect={() => onSelectModule("banners")}
          icon={ImageIcon}
          isLoading={isLoading}
        />
      </div>

      <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
        맛집/좌표 기준 최신 업데이트: <span className="font-medium text-foreground">{formatDateTime(stats.latestRestaurantUpdate)}</span>
        {" · "}
        요약 수치가 실패하면 카드 값은 — 로 표시하고 기존 상세 화면 진입은 유지합니다.
      </div>
    </section>
  );
}

function LlmSessionPanel() {
  return (
    <aside id="llm-session" className="rounded-2xl border border-primary/15 bg-card/95 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-primary">읽기 전용 보조</p>
          <h2 className="text-xl font-bold text-foreground">자동 운영 보조</h2>
        </div>
        <Bot className="h-6 w-6 text-primary" aria-hidden="true" />
      </div>

      <div className="space-y-3">
        {[
          ["현재 화면 요약", "선택한 모듈의 대기 건수와 위험 액션을 요약합니다."],
          ["다음 검수 추천", "오래된 제보, 지오코딩 실패, 미승인 리뷰를 우선순위로 정리합니다."],
          ["위험 액션 체크리스트", "삭제/반려/공개 배너 변경 전 확인 항목을 생성합니다."],
        ].map(([title, description]) => (
          <div key={title} className="rounded-xl border border-border bg-muted/30 p-3">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>

      <Separator className="my-4" />
      <p className="text-xs leading-5 text-muted-foreground">
        자동 운영 보조는 읽기/제안 전용입니다. 실제 승인·삭제·공개 적용은 관리자 확인 버튼과 상태 재확인 이후에만 진행됩니다.
      </p>
    </aside>
  );
}

function LlmSessionWorkspace() {
  return (
    <section aria-labelledby="admin-llm-session-title" className="space-y-5">
      <div className="rounded-2xl border border-primary/15 bg-card/95 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">읽기 전용 보조</p>
            <h2 id="admin-llm-session-title" className="mt-1 text-2xl font-bold tracking-[-0.04em] text-foreground md:text-3xl">
              자동 운영 보조
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              선택한 운영 모듈의 상황을 요약하고 다음 검수 순서를 제안하는 읽기 전용 보조 화면입니다.
              실제 승인·삭제·공개 변경은 관리자 확인과 상태 재확인 이후에만 진행됩니다.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-primary/30 text-primary">
            읽기 전용
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {[
          ["현재 화면 요약", "선택한 모듈의 대기 건수, 실패 상태, 위험 액션 후보를 한 문단으로 요약합니다."],
          ["다음 검수 추천", "오래된 제보, 지오코딩 실패, 미승인 리뷰, 배너 공개 변경을 우선순위로 정리합니다."],
          ["위험 액션 체크리스트", "삭제·반려·공개 배너 변경 전 미리보기 → 확인 → 적용 → 재확인 → 감사 기록 순서를 확인합니다."],
        ].map(([title, description]) => (
          <Card key={title} className="border-border bg-card/95 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <GuardedApplyCard />
        <Card className="border-border bg-card/95 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
              운영 원칙
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>1. 자동 운영 보조는 읽기 전용 제안 화면으로 유지합니다.</p>
            <p>2. 데이터 변경, 권한 정책, 데이터 구조 변경은 이 화면에서 직접 수행하지 않습니다.</p>
            <p>3. 위험 작업은 반드시 관리자 UI의 명시적 확인과 상태 재확인을 거칩니다.</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function ConnectedRoutesCard() {
  return (
    <Card className="border-border bg-card/95 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
          현재 연결된 화면
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" aria-hidden="true" /> 데이터 검수 독립 화면도 유지됩니다 · /admin/evaluations</p>
        <p className="flex items-center gap-2"><ImageIcon className="h-4 w-4" aria-hidden="true" /> 배너 독립 화면도 유지됩니다 · /admin/banners</p>
        <p className="flex items-center gap-2"><BarChart2 className="h-4 w-4" aria-hidden="true" /> 인사이트 독립 화면도 유지됩니다 · /insights</p>
      </CardContent>
    </Card>
  );
}

function AuditPlaceholder() {
  return (
    <Card className="min-h-[560px] border-border bg-card/95 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">준비 중</p>
            <CardTitle className="mt-1 text-2xl tracking-[-0.04em]">감사 로그</CardTitle>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              승인·반려·삭제·복구 이력을 한 화면에서 확인하는 영역입니다. 실제 audit persistence schema가 확정되기 전까지는
              안전 적용 원칙과 상태 재확인 체크리스트만 표시합니다.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-primary/30 text-primary">
            저장 설계 필요
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {[
          ["결정 기록", "관리자가 어떤 결정을 했는지 승인/반려/삭제/복구 단위로 저장합니다."],
          ["안전 적용", "위험 변경은 미리보기 → 확인 → 적용 순서를 거칩니다."],
          ["상태 재확인", "적용 후 실제 데이터 상태를 다시 읽어 최종 상태를 확인합니다."],
          ["재수집 연결", "필요 시 재수집/재평가 큐로 넘길 수 있게 연결합니다."],
        ].map(([title, description]) => (
          <div key={title} className="rounded-2xl border border-border bg-muted/25 p-4">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function InlineModulePanel({ module }: { module: ConsoleModule }) {
  if (module.id === "audit") {
    return <AuditPlaceholder />;
  }

  const moduleContent = (() => {
    switch (module.id) {
      case "restaurants":
        return <AdminEvaluationModule key="restaurants" embedded initialView="evaluations" />;
      case "submissions":
        return <AdminEvaluationModule key="submissions" embedded initialView="submissions" initialSubmissionTab="new" />;
      case "reviews":
        return <AdminEvaluationModule key="reviews" embedded initialView="submissions" initialSubmissionTab="reviews" />;
      case "banners":
        return <AdminBannerModule key="admin-banners" embedded />;
      case "insights":
        return <InsightsModule key="admin-insights" />;
      default: {
        const exhaustiveModuleId: never = module.id;
        return exhaustiveModuleId;
      }
    }
  })();

  return (
    <section aria-label={`${module.title} 작업 화면`} className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "min-h-[560px] flex-1 rounded-2xl border border-border bg-background shadow-sm lg:min-h-0",
          module.id === "banners" ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        {moduleContent}
      </div>
    </section>
  );
}

export function AdminConsoleOverview() {
  const router = useRouter();
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const { stats, isLoading: statsLoading, hasError: statsHasError } = useAdminOverviewStats(isAdmin);
  const [activeModuleId, setActiveModuleId] = useState<AdminModuleId>("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSidebarLabels, setShowSidebarLabels] = useState(true);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeModule = consoleModules.find((module) => module.id === activeModuleId);

  const selectModule = useCallback((moduleId: AdminModuleId) => {
    setActiveModuleId(moduleId);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (moduleId === "overview") {
        url.searchParams.delete("module");
      } else {
        url.searchParams.set("module", moduleId);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    window.requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      canvasRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      router.push("/");
    }
  }, [authLoading, isAdmin, router, user]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncModuleFromUrl = () => {
      setActiveModuleId(getAdminModuleIdFromLocation(window.location));
    };

    syncModuleFromUrl();
    window.addEventListener("popstate", syncModuleFromUrl);

    return () => window.removeEventListener("popstate", syncModuleFromUrl);
  }, []);

  useEffect(() => {
    if (isSidebarCollapsed) {
      setShowSidebarLabels(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowSidebarLabels(true);
    }, SIDEBAR_LABEL_REVEAL_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isSidebarCollapsed]);

  const handleToggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((current) => {
      if (!current) {
        setShowSidebarLabels(false);
        return true;
      }

      return false;
    });
  };

  if (authLoading || !user || !isAdmin) {
    return <GlobalLoader fullScreen message="관리자 콘솔 로딩 중..." />;
  }

  const heroStatusChips = [
    statsHasError ? "요약 확인 필요" : statsLoading ? "요약 갱신 중" : "요약 정상",
    ...statusChips,
  ];
  const submissionCtaLabel = statsLoading
    ? "제보 큐 건수 확인 중"
    : stats.pendingSubmissions && stats.pendingSubmissions > 0
      ? `미처리 제보 ${formatCount(stats.pendingSubmissions, "건")} 검수 시작`
      : "제보 큐 확인";
  const activeModuleLabel = activeModuleId === "overview"
    ? "개요"
    : activeModuleId === "llm"
      ? "운영 보조"
      : activeModule?.title;

  return (
    <main className="h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <a
        href="#admin-console-canvas"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-primary"
      >
        작업 화면으로 건너뛰기
      </a>
      <div
        id="overview"
        className={cn(
          "flex h-full min-h-0 w-full flex-col gap-0 lg:flex-row",
        )}
      >
        <AdminSidebar
          activeModuleId={activeModuleId}
          onSelectModule={selectModule}
          isCollapsed={isSidebarCollapsed}
          showLabels={showSidebarLabels}
          onToggleCollapsed={handleToggleSidebarCollapsed}
          stats={stats}
        />

        <section
          id="admin-console-canvas"
          ref={canvasRef}
          tabIndex={-1}
          aria-label="관리자 콘솔 작업 화면"
          className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain border-y border-border bg-background p-3 sm:p-4 lg:border-y-0 lg:p-5 xl:p-6"
        >
          <p className="sr-only" aria-live="polite">
            {activeModuleLabel} 작업 화면으로 전환됨
          </p>
          {activeModuleId === "overview" ? (
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-card via-card to-primary/5 p-4 shadow-sm sm:p-5">
                <div
                  className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
                  aria-hidden="true"
                />
                <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">오늘 운영 현황</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-[-0.04em] text-foreground md:text-3xl">
                      관리자 운영 콘솔
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/70">
                      제보·리뷰·배너·인사이트를 한 화면에서 전환하고, 위험 변경은 미리보기와 재확인 후 처리합니다.
                    </p>
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 w-full rounded-xl bg-primary text-primary-foreground shadow-primary hover:bg-primary/90 sm:w-fit"
                    aria-controls="admin-console-canvas"
                    onClick={() => selectModule("submissions")}
                  >
                    {submissionCtaLabel}
                  </Button>
                </div>

                <div className="relative mt-4 flex flex-wrap gap-2">
                  {heroStatusChips.map((chip, index) => (
                    <Badge
                      key={chip}
                      variant={index === 0 ? "outline" : "secondary"}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        index === 0
                          ? statsHasError
                            ? "border-amber-700/30 bg-amber-50 text-amber-800"
                            : "border-emerald-700/20 bg-emerald-50 text-emerald-800"
                          : "border-border bg-background/70 text-muted-foreground",
                      )}
                    >
                      {chip}
                    </Badge>
                  ))}
                </div>
                <div className="relative mt-3 flex flex-col gap-2 rounded-2xl border border-border bg-background/70 px-3 py-2.5 text-xs text-foreground/70 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-semibold text-foreground">위험 변경 처리 순서</span>
                  <ol aria-label="위험 변경 처리 순서" className="flex flex-wrap items-center gap-1.5">
                    {guardedSteps.map((step, index) => (
                      <li key={step} className="flex items-center gap-1.5">
                        <span className={cn(
                          "rounded-full border px-2 py-1",
                          index === 0 ? "border-primary/30 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground",
                        )}>
                          {step}
                        </span>
                        {index < guardedSteps.length - 1 && <span aria-hidden="true">→</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <OperationalSummary
                stats={stats}
                isLoading={statsLoading}
                hasError={statsHasError}
                onSelectModule={selectModule}
              />

              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {consoleModules.map((module) => {
                      const Icon = module.icon;
                      return (
                        <Card
                          key={module.title}
                          className={cn(
                            "group bg-gradient-to-b from-card via-card to-muted/20 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-glow motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                            module.priority === "urgent" ? "border-primary/20 ring-1 ring-primary/10" : "border-border",
                          )}
                        >
                          <CardHeader className="space-y-3 pb-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl border", toneClassName[module.tone])}>
                                <Icon className="h-5 w-5" aria-hidden="true" />
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full bg-background/70",
                                  module.priority === "urgent" && "border-primary/30 bg-primary/5 text-primary",
                                )}
                              >
                                {module.priority === "urgent" ? `검토 필요 · ${module.badge}` : module.badge}
                              </Badge>
                            </div>
                            <CardTitle className="text-lg tracking-[-0.02em]">{module.title}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <p className="min-h-12 text-sm leading-6 text-foreground/70">{module.description}</p>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 w-full justify-between rounded-xl bg-background/70 group-hover:border-primary/30 group-hover:text-primary"
                              aria-controls="admin-console-canvas"
                              aria-label={module.actionLabel}
                              onClick={() => selectModule(module.id)}
                            >
                              {module.actionLabel}
                              <span aria-hidden="true">→</span>
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <GuardedApplyCard />
                    <Card className="border-border bg-card/95 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
                          운영 안전 기준
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                        <p>1. 사이드바 선택은 오른쪽 작업 화면만 바꾸고 기존 흐름은 유지합니다.</p>
                        <p>2. 검수·배너·인사이트 화면은 직접 렌더링하되 독립 라우트도 보존합니다.</p>
                        <p>3. 위험 변경은 미리보기, 관리자 확인, 상태 재확인 이후에만 완료로 봅니다.</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="min-w-0 space-y-5">
                  <LlmSessionPanel />
                  <ConnectedRoutesCard />
                </div>
              </div>
            </div>
          ) : activeModuleId === "llm" ? (
            <LlmSessionWorkspace />
          ) : activeModule ? (
            <InlineModulePanel module={activeModule} />
          ) : null}
        </section>
      </div>
    </main>
  );
}
