"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { MessageSquareText, Store } from "lucide-react";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_CONSOLE_MENU_ICONS } from "@/lib/admin/console-menu-icons";
import {
  getAdminConsoleMenu,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import { cn } from "@/lib/utils";

export type ConsoleSkeletonVariant =
  | "overview-kpi"
  | "insights-grid"
  | "llm-workspace"
  | "evaluation-table"
  | "refresh-history"
  | "submission-queue"
  | "overlay-workspace"
  | "banner-editor"
  | "route-map"
  | "user-table"
  | "pipeline-ops"
  | "audit-log"
  | "storyboard-scenes"
  | "thumbnail-tools"
  | "split-list-detail";

export type ModuleSkeletonShape = {
  readonly menuId: AdminConsoleMenuId;
  readonly regions: readonly string[];
  readonly variant: ConsoleSkeletonVariant;
};

export const ADMIN_CONSOLE_MODULE_SKELETON_SHAPES = {
  overview: {
    menuId: "overview",
    regions: [
      "kpi-card-1",
      "kpi-card-2",
      "kpi-card-3",
      "kpi-card-4",
      "gauge",
      "grid-card-1",
      "grid-card-2",
      "grid-card-3",
      "grid-card-4",
      "grid-card-5",
      "grid-card-6",
    ],
    variant: "overview-kpi",
  },
  insights: {
    menuId: "insights",
    regions: ["treemap-tiles", "range-band"],
    variant: "insights-grid",
  },
  llm: {
    menuId: "llm",
    regions: ["sparklines", "checklist"],
    variant: "llm-workspace",
  },
  restaurants: {
    menuId: "restaurants",
    regions: ["evaluation-table", "detail-panel"],
    variant: "evaluation-table",
  },
  "restaurant-refresh-history": {
    menuId: "restaurant-refresh-history",
    regions: ["candidate-list", "history-panel"],
    variant: "refresh-history",
  },
  submissions: {
    menuId: "submissions",
    regions: ["submission-queue", "decision-panel"],
    variant: "submission-queue",
  },
  reviews: {
    menuId: "reviews",
    regions: ["review-queue", "evidence-panel"],
    variant: "submission-queue",
  },
  "map-overlays": {
    menuId: "map-overlays",
    regions: ["overlay-tab-manual", "overlay-tab-proposals", "overlay-tab-runs"],
    variant: "overlay-workspace",
  },
  banners: {
    menuId: "banners",
    regions: ["banner-editor"],
    variant: "banner-editor",
  },
  routes: {
    menuId: "routes",
    regions: ["route-map", "candidate-list"],
    variant: "route-map",
  },
  users: {
    menuId: "users",
    regions: ["user-table"],
    variant: "user-table",
  },
  pipeline: {
    menuId: "pipeline",
    regions: ["run-timeline", "activity-heatmap"],
    variant: "pipeline-ops",
  },
  audit: {
    menuId: "audit",
    regions: ["coverage-card", "event-list", "activity-heatmap"],
    variant: "audit-log",
  },
  storyboard: {
    menuId: "storyboard",
    regions: ["scene-1", "scene-2", "scene-3", "scene-4"],
    variant: "storyboard-scenes",
  },
  "youtube-thumbnail-generator": {
    menuId: "youtube-thumbnail-generator",
    regions: [
      "tool-1",
      "tool-2",
      "tool-3",
      "tool-4",
      "tool-5",
      "tool-6",
      "tool-7",
      "tool-8",
      "tool-9",
      "tool-10",
      "tool-11",
      "tool-12",
    ],
    variant: "thumbnail-tools",
  },
} as const satisfies Record<AdminConsoleMenuId, ModuleSkeletonShape>;

const STORYBOARD_MODULE_LOADING_CUT_NOS = [1, 2, 3, 4] as const;
const THUMBNAIL_MODULE_LOADING_TOOL_IDS = Array.from(
  { length: 12 },
  (_, index) => index + 1,
);

type AdminConsoleCanvasSkeletonVariant =
  | "split-list-detail"
  | "evaluation-table"
  | "submission-queue"
  | "refresh-history"
  | "banner-editor"
  | "overlay-workspace"
  | "user-table"
  | "insights-grid"
  | "route-map"
  | "llm-workspace"
  | "audit-log"
  | "pipeline-ops";

type AdminConsoleCanvasSkeletonModuleId = AdminConsoleMenuId | "generic";

type AdminConsoleCanvasSkeletonConfig = {
  moduleId: AdminConsoleCanvasSkeletonModuleId;
  title: string;
  description: string;
  icon: LucideIcon;
  variant: AdminConsoleCanvasSkeletonVariant;
};

const ADMIN_CONSOLE_CANVAS_SKELETON_ROWS = [0, 1, 2, 3, 4, 5] as const;
const ADMIN_CONSOLE_CANVAS_SKELETON_CARDS = [
  "primary",
  "secondary",
  "tertiary",
  "quaternary",
] as const;
const ADMIN_CONSOLE_CANVAS_SKELETON_METRICS = [
  "metric-a",
  "metric-b",
  "metric-c",
  "metric-d",
] as const;
const ADMIN_CONSOLE_CANVAS_SKELETON_TIMELINE = [
  "queued",
  "checking",
  "applying",
  "readback",
] as const;

function wrapSkeletonRegions(
  menuId: AdminConsoleMenuId,
  children: ReactNode,
): ReactNode {
  const shape = ADMIN_CONSOLE_MODULE_SKELETON_SHAPES[menuId];
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-admin-module-skeleton="true"
      data-admin-module-skeleton-menu={shape.menuId}
      data-admin-module-skeleton-variant={shape.variant}
      data-admin-module-skeleton-regions={shape.regions.join(" ")}
      data-admin-module-header-baseline="compact-shell"
    >
      {shape.regions.map((region) => (
        <span
          key={region}
          hidden
          data-admin-module-skeleton-region={region}
        />
      ))}
      {children}
    </div>
  );
}

function AdminOverviewModuleSkeleton() {
  const shape = ADMIN_CONSOLE_MODULE_SKELETON_SHAPES.overview;
  return (
    <AdminEmbeddedModuleShell
      menuId="overview"
      contentClassName="overflow-y-auto"
    >
      <section
        className="flex h-full min-h-0 min-w-0 flex-col gap-2 bg-background p-0"
        aria-label="관리자 대시보드 (KPI) 로딩 중"
        data-admin-dashboard-management-skeleton="true"
        data-admin-sidebar-module-loading-header="true"
        role="status"
        aria-busy="true"
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {shape.regions.slice(0, 4).map((region) => (
            <div
              key={region}
              className="min-h-20 rounded-xl border border-border bg-card/95 p-3"
              data-admin-module-skeleton-slot={region}
              aria-hidden="true"
            >
              <Skeleton className="h-3 w-20 rounded-full motion-reduce:animate-none" />
              <Skeleton className="mt-3 h-6 w-24 rounded-full motion-reduce:animate-none" />
            </div>
          ))}
        </div>
        <div
          className="min-h-28 rounded-xl border border-border bg-card/95 p-3"
          data-admin-module-skeleton-slot="gauge"
          data-admin-dashboard-skeleton-card="gauge"
          aria-hidden="true"
        >
          <Skeleton className="mx-auto h-24 w-40 rounded-full motion-reduce:animate-none" />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shape.regions.slice(5).map((region, index) => (
            <div
              key={region}
              className="min-h-24 rounded-xl border border-border bg-card/95 p-3"
              data-admin-module-skeleton-slot={region}
              data-admin-dashboard-skeleton-card={
                index === 1 ? "trend" : index === 3 ? "topContent" : region
              }
              aria-hidden="true"
            >
              <Skeleton className="h-3 w-28 rounded-full motion-reduce:animate-none" />
              <Skeleton className="mt-4 h-16 w-full rounded-lg motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </section>
    </AdminEmbeddedModuleShell>
  );
}

const MODULES_WITH_OWN_INNER_SHELL = new Set<AdminConsoleMenuId>([
  "insights",
  "map-overlays",
  "storyboard",
  "youtube-thumbnail-generator",
]);

export function AdminConsoleModuleSkeleton({
  menuId,
  title,
}: {
  menuId: AdminConsoleMenuId;
  title?: string;
}) {
  if (menuId === "overview") {
    return wrapSkeletonRegions(menuId, <AdminOverviewModuleSkeleton />);
  }

  if (menuId === "storyboard") {
    return wrapSkeletonRegions(menuId, <AdminStoryboardModuleLoadingSkeleton />);
  }

  if (menuId === "youtube-thumbnail-generator") {
    return wrapSkeletonRegions(
      menuId,
      <AdminYoutubeThumbnailModuleLoadingSkeleton />,
    );
  }

  const canvas = (
    <AdminConsoleCanvasSkeleton
      moduleId={menuId}
      title={title}
      hideHeader={!MODULES_WITH_OWN_INNER_SHELL.has(menuId)}
    />
  );

  if (MODULES_WITH_OWN_INNER_SHELL.has(menuId)) {
    return wrapSkeletonRegions(menuId, canvas);
  }

  return wrapSkeletonRegions(
    menuId,
    <AdminEmbeddedModuleShell menuId={menuId} contentClassName="overflow-hidden">
      {canvas}
    </AdminEmbeddedModuleShell>,
  );
}

export function getAdminConsoleModuleLoadingSkeleton(
  moduleId: AdminConsoleMenuId,
  title?: string,
) {
  return <AdminConsoleModuleSkeleton menuId={moduleId} title={title} />;
}

function getAdminConsoleCanvasSkeletonConfig({
  moduleId,
  title,
}: {
  moduleId: AdminConsoleCanvasSkeletonModuleId;
  title?: string;
}): AdminConsoleCanvasSkeletonConfig {
  const menuTitle =
    moduleId === "generic" ? undefined : getAdminConsoleMenu(moduleId).title;
  const menuIcon =
    moduleId === "generic" ? Store : ADMIN_CONSOLE_MENU_ICONS[moduleId];

  switch (moduleId) {
    case "restaurants":
      return {
        moduleId,
        title: title ?? menuTitle ?? "맛집 관리",
        description: "검수 테이블과 세부 액션 영역을 뷰포트 안에서 준비합니다.",
        icon: menuIcon,
        variant: "evaluation-table",
      };
    case "submissions":
      return {
        moduleId,
        title: title ?? menuTitle ?? "제보 관리",
        description: "제보·수정 요청 목록과 판정 패널을 함께 준비합니다.",
        icon: menuIcon,
        variant: "submission-queue",
      };
    case "reviews":
      return {
        moduleId,
        title: title ?? menuTitle ?? "리뷰 관리",
        description: "리뷰 검수 큐와 증빙 확인 패널을 함께 준비합니다.",
        icon: menuIcon,
        variant: "submission-queue",
      };
    case "restaurant-refresh-history":
      return {
        moduleId,
        title: title ?? menuTitle ?? "맛집 최신화",
        description: "최신화 후보 목록과 변경 이력 패널을 먼저 배치합니다.",
        icon: menuIcon,
        variant: "refresh-history",
      };
    case "map-overlays":
      return {
        moduleId,
        title: title ?? menuTitle ?? "지도 오버레이",
        description: "수동 오버레이, 트렌드 제안, 트렌드 실행 탭을 준비합니다.",
        icon: menuIcon,
        variant: "overlay-workspace",
      };
    case "banners":
      return {
        moduleId,
        title: title ?? menuTitle ?? "배너 관리",
        description: "배너 목록, 미디어 미리보기, 편집 폼을 한 화면에 준비합니다.",
        icon: menuIcon,
        variant: "banner-editor",
      };
    case "users":
      return {
        moduleId,
        title: title ?? menuTitle ?? "사용자 관리",
        description: "계정 요약 카드와 사용자 표 구조를 먼저 고정합니다.",
        icon: menuIcon,
        variant: "user-table",
      };
    case "insights":
      return {
        moduleId,
        title: title ?? menuTitle ?? "핵심 인사이트",
        description: "지표 카드, 트리맵, 추세 차트를 뷰포트에 맞춰 준비합니다.",
        icon: menuIcon,
        variant: "insights-grid",
      };
    case "pipeline":
      return {
        moduleId,
        title: title ?? menuTitle ?? "크롤러 파이프라인",
        description: "control-plane 대상 상태와 환경 칩을 준비합니다.",
        icon: menuIcon,
        variant: "pipeline-ops",
      };
    case "routes":
      return {
        moduleId,
        title: title ?? menuTitle ?? "맛집 동선 추천",
        description: "지도, 후보 목록, 동선 준비도 패널을 먼저 배치합니다.",
        icon: menuIcon,
        variant: "route-map",
      };
    case "llm":
      return {
        moduleId,
        title: title ?? menuTitle ?? "운영 보조",
        description: "읽기 전용 요약 카드와 위험 액션 체크리스트를 준비합니다.",
        icon: menuIcon,
        variant: "llm-workspace",
      };
    case "audit":
      return {
        moduleId,
        title: title ?? menuTitle ?? "감사 로그",
        description: "결정 기록과 상태 재확인 타임라인 구조를 준비합니다.",
        icon: menuIcon,
        variant: "audit-log",
      };
    default:
      return {
        moduleId: "generic",
        title: title ?? menuTitle ?? "관리자 작업 화면",
        description: "사이드바 메뉴 화면의 구조를 먼저 준비합니다.",
        icon: Store,
        variant: "split-list-detail",
      };
  }
}

function AdminConsoleCanvasSkeleton({
  title,
  moduleId = "generic",
  hideHeader = false,
}: {
  title?: string;
  moduleId?: AdminConsoleCanvasSkeletonModuleId;
  hideHeader?: boolean;
} = {}) {
  const config = getAdminConsoleCanvasSkeletonConfig({ moduleId, title });
  const HeaderIcon = config.icon;

  return (
    <section
      className="flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm md:min-h-0"
      data-admin-console-content-loading="true"
      data-admin-sidebar-module-loading="page-shell"
      data-admin-sidebar-module-loading-viewport="true"
      data-admin-sidebar-module-loading-module={config.moduleId}
      data-admin-sidebar-module-loading-title={config.title}
      data-admin-sidebar-module-loading-variant={config.variant}
      role="status"
      aria-busy="true"
      aria-label={`${config.title} 화면 로딩 중`}
    >
      <span className="sr-only">
        {config.title} 화면의 뷰포트 기준 레이아웃을 먼저 준비하고 내부 데이터를
        불러오는 중입니다.
      </span>
      {hideHeader ? (
        <span hidden data-admin-sidebar-module-loading-header="true" />
      ) : null}
      <header
        className={cn(
          "flex shrink-0 flex-col gap-1.5 border-b border-border bg-card px-2 py-1.5 lg:flex-row lg:items-center lg:justify-between",
          hideHeader && "hidden",
        )}
        data-admin-sidebar-module-loading-header="true"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center text-[var(--admin-tone-2)]">
            <HeaderIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-bold text-foreground">
              {config.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {config.description}
            </p>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-hidden="true"
          data-admin-sidebar-module-loading-toolbar="true"
        >
          {ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((card) => (
            <Skeleton
              key={card}
              className="h-7 w-20 rounded-full motion-reduce:animate-none"
            />
          ))}
        </div>
      </header>

      <AdminConsoleCanvasSkeletonBody variant={config.variant} />
    </section>
  );
}

function AdminConsoleSkeletonMetricStrip({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {ADMIN_CONSOLE_CANVAS_SKELETON_METRICS.map((metric) => (
        <div
          key={metric}
          className="min-h-20 rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
        >
          <Skeleton className="h-3 w-20 rounded-full motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-6 w-24 rounded-full motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-2 w-full rounded-full motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function AdminConsoleSkeletonRows({
  count = ADMIN_CONSOLE_CANVAS_SKELETON_ROWS.length,
  withMedia = false,
}: {
  count?: number;
  withMedia?: boolean;
}) {
  return (
    <div className="divide-y divide-border">
      {ADMIN_CONSOLE_CANVAS_SKELETON_ROWS.slice(0, count).map((row) => (
        <div
          key={row}
          className={cn(
            "grid items-center gap-2 px-3 py-3",
            withMedia
              ? "sm:grid-cols-[56px_minmax(0,1fr)_90px]"
              : "sm:grid-cols-[minmax(0,1fr)_80px]",
          )}
        >
          {withMedia ? (
            <Skeleton className="h-10 w-14 rounded-md motion-reduce:animate-none" />
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-4/5 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-3 w-3/5 rounded-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-7 rounded-lg motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function AdminConsoleCanvasSkeletonBody({
  variant,
}: {
  variant: AdminConsoleCanvasSkeletonVariant;
}) {
  if (variant === "evaluation-table" || variant === "submission-queue") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-evaluation="viewport-table"
      >
        <AdminConsoleSkeletonMetricStrip className="xl:grid-cols-5" />
        <section
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card/95"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <div className="grid border-b border-border bg-muted/30 px-3 py-2 lg:grid-cols-[40px_minmax(180px,1fr)_repeat(5,78px)_112px]">
            {ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((cell) => (
              <Skeleton
                key={cell}
                className="h-3 w-20 rounded-full motion-reduce:animate-none"
              />
            ))}
          </div>
          <AdminConsoleSkeletonRows count={6} withMedia />
        </section>
      </div>
    );
  }

  if (variant === "refresh-history") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-refresh-history="viewport-split"
      >
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <div className="border-b border-border bg-muted/30 px-3 py-2">
            <Skeleton className="h-4 w-32 rounded-full motion-reduce:animate-none" />
          </div>
          <AdminConsoleSkeletonRows count={6} />
        </section>
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3 md:grid-cols-2"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          {ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((card) => (
            <Skeleton
              key={card}
              className="h-full min-h-28 rounded-xl motion-reduce:animate-none"
            />
          ))}
        </section>
      </div>
    );
  }

  if (variant === "banner-editor") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-banners="viewport-editor"
      >
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <div className="border-b border-border bg-muted/30 px-3 py-2">
            <Skeleton className="h-4 w-28 rounded-full motion-reduce:animate-none" />
          </div>
          <AdminConsoleSkeletonRows count={5} withMedia />
        </section>
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(300px,0.8fr)]"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <Skeleton className="min-h-48 rounded-2xl motion-reduce:animate-none" />
          <div className="space-y-2">
            {ADMIN_CONSOLE_CANVAS_SKELETON_ROWS.slice(0, 5).map((row) => (
              <Skeleton
                key={row}
                className="h-10 rounded-lg motion-reduce:animate-none"
              />
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (variant === "user-table") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-users="viewport-table"
      >
        <AdminConsoleSkeletonMetricStrip />
        <section
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card/95"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <div className="grid border-b border-border bg-muted/30 px-3 py-2 md:grid-cols-[minmax(0,1.2fr)_120px_120px_96px]">
            {ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((cell) => (
              <Skeleton
                key={cell}
                className="h-3 w-24 rounded-full motion-reduce:animate-none"
              />
            ))}
          </div>
          <AdminConsoleSkeletonRows count={6} />
        </section>
      </div>
    );
  }

  if (variant === "insights-grid") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-insights="viewport-charts"
      >
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <AdminConsoleSkeletonMetricStrip />
          <Skeleton className="min-h-72 flex-1 rounded-2xl motion-reduce:animate-none" />
        </section>
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <Skeleton className="min-h-48 rounded-2xl motion-reduce:animate-none" />
          <AdminConsoleSkeletonRows count={4} />
        </section>
      </div>
    );
  }

  if (variant === "route-map") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-routes="viewport-map"
      >
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <Skeleton className="h-full min-h-96 rounded-2xl motion-reduce:animate-none" />
        </section>
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          <div className="border-b border-border bg-muted/30 px-3 py-2">
            <Skeleton className="h-4 w-36 rounded-full motion-reduce:animate-none" />
          </div>
          <AdminConsoleSkeletonRows count={6} />
        </section>
      </div>
    );
  }

  if (variant === "llm-workspace" || variant === "audit-log") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-ops="viewport-cards"
      >
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          {ADMIN_CONSOLE_CANVAS_SKELETON_TIMELINE.map((item) => (
            <div key={item} className="rounded-xl border border-border/70 p-3">
              <Skeleton className="h-4 w-32 rounded-full motion-reduce:animate-none" />
              <Skeleton className="mt-3 h-3 w-full rounded-full motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-3 w-4/5 rounded-full motion-reduce:animate-none" />
            </div>
          ))}
        </section>
        <section
          className="grid min-h-0 gap-2 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <Skeleton className="min-h-32 rounded-2xl motion-reduce:animate-none" />
          <Skeleton className="min-h-32 rounded-2xl motion-reduce:animate-none" />
        </section>
      </div>
    );
  }

  if (variant === "overlay-workspace") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-overlays="viewport-tabs"
      >
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/35 p-1">
          {ADMIN_CONSOLE_CANVAS_SKELETON_TIMELINE.slice(0, 3).map((tab) => (
            <Skeleton
              key={tab}
              className="h-14 rounded-lg motion-reduce:animate-none"
            />
          ))}
        </div>
        <section
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <Skeleton className="h-full min-h-48 rounded-xl motion-reduce:animate-none" />
        </section>
      </div>
    );
  }

  if (variant === "pipeline-ops") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"
        data-admin-sidebar-module-loading-grid="true"
        data-admin-sidebar-module-loading-pipeline="viewport-ops"
      >
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-list="true"
        >
          {ADMIN_CONSOLE_CANVAS_SKELETON_TIMELINE.map((item) => (
            <div key={item} className="mb-2 rounded-xl border border-border/70 p-3 last:mb-0">
              <Skeleton className="h-4 w-32 rounded-full motion-reduce:animate-none" />
              <Skeleton className="mt-3 h-3 w-full rounded-full motion-reduce:animate-none" />
            </div>
          ))}
        </section>
        <section
          className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/95 p-3"
          aria-hidden="true"
          data-admin-sidebar-module-loading-detail="true"
        >
          <div className="grid grid-cols-7 gap-1">
            {ADMIN_CONSOLE_CANVAS_SKELETON_ROWS.map((row) =>
              ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((cell) => (
                <Skeleton
                  key={`${row}-${cell}`}
                  className="h-6 rounded-sm motion-reduce:animate-none"
                />
              )),
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]"
      data-admin-sidebar-module-loading-grid="true"
    >
      <section
        className="min-h-[300px] overflow-hidden rounded-xl border border-border bg-card/95 lg:min-h-0"
        aria-hidden="true"
        data-admin-sidebar-module-loading-list="true"
      >
        <div className="border-b border-border bg-muted/30 px-3 py-2">
          <Skeleton className="h-4 w-28 rounded-full motion-reduce:animate-none" />
        </div>
        <AdminConsoleSkeletonRows count={5} />
      </section>

      <section
        className="min-h-[360px] overflow-hidden rounded-xl border border-border bg-card/95 p-3 lg:min-h-0"
        aria-hidden="true"
        data-admin-sidebar-module-loading-detail="true"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-36 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-3 w-56 max-w-full rounded-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-8 w-20 rounded-lg motion-reduce:animate-none" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ADMIN_CONSOLE_CANVAS_SKELETON_CARDS.map((card) => (
            <Skeleton
              key={card}
              className="h-24 rounded-xl motion-reduce:animate-none"
            />
          ))}
          <Skeleton className="h-32 rounded-xl motion-reduce:animate-none sm:col-span-2" />
        </div>
      </section>
    </div>
  );
}

function AdminStoryboardModuleLoadingSkeleton() {
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background p-2"
      data-admin-console-content-loading="true"
      data-admin-storyboard-generator-loading="true"
      data-storyboard-module-loading="true"
      data-storyboard-module-loading-layout="page-shell"
      data-storyboard-viewport-fit="bounded"
      style={{
        height: "calc(var(--full-height, 100vh) - 2rem)",
        maxHeight: "100%",
        minHeight: 0,
      }}
      role="status"
      aria-busy="true"
      aria-label="스토리보드 생성 화면 로딩 중"
    >
      <div
        className="grid h-full min-h-0 gap-3 overflow-hidden"
        data-storyboard-desktop-split-layout="inline-grid"
        data-storyboard-module-loading-grid="true"
        style={{
          display: "grid",
          gridTemplateColumns:
            "var(--storyboard-split-columns, minmax(0, 1fr) minmax(320px, 400px))",
          gridTemplateRows: "var(--storyboard-split-rows, minmax(0, 1fr))",
        }}
      >
        <Card
          className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm"
          aria-label="스토리보드 도우미 준비 영역"
          data-storyboard-module-loading-chat-shell="static"
          style={{
            gridColumn: "var(--storyboard-input-panel-column, 2)",
            gridRow: "var(--storyboard-input-panel-row, 1)",
            minWidth: 0,
          }}
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="h-4 w-32 rounded-full bg-muted/80" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="h-4 w-4 rounded-full bg-muted/80" />
                <div className="h-8 w-8 rounded-full bg-muted/70" />
                <div className="h-8 w-8 rounded-full bg-muted/70" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-3 pt-0">
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background"
              data-storyboard-module-loading-chat="true"
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3">
                <div className="max-w-[88%] space-y-2">
                  <div className="h-3 w-56 max-w-full rounded-full bg-muted-foreground/14" />
                  <div className="h-3 w-40 max-w-full rounded-full bg-muted-foreground/12" />
                  <div className="mt-2 flex gap-2">
                    <div className="h-7 w-20 rounded-full border border-border/60 bg-background" />
                    <div className="h-7 w-20 rounded-full bg-primary/75" />
                  </div>
                </div>
                <div className="max-w-[92%] space-y-2">
                  <div className="h-3 w-64 max-w-full rounded-full bg-muted-foreground/14" />
                  <div className="h-3 w-48 max-w-full rounded-full bg-muted-foreground/12" />
                  <div className="h-3 w-52 max-w-full rounded-full bg-muted-foreground/12" />
                </div>
              </div>
              <div
                className="shrink-0 border-t border-border/70 bg-background/80 p-2.5"
                data-storyboard-module-loading-composer="true"
              >
                <div className="flex h-11 items-center gap-2 rounded-full border border-border/70 bg-background px-3">
                  <div className="h-5 w-5 shrink-0 rounded-full bg-muted/80" />
                  <div className="h-3 flex-1 rounded-full bg-muted-foreground/12" />
                  <div className="h-9 w-9 shrink-0 rounded-full bg-muted/80" />
                </div>
              </div>
            </div>
            <span className="sr-only">
              스토리보드 도우미 영역을 준비하고 있습니다.
            </span>
          </CardContent>
        </Card>

        <Card
          className="flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="스토리보드 캔버스 준비 영역"
          data-storyboard-module-loading-canvas="true"
          style={{
            gridColumn: "var(--storyboard-result-panel-column, 1)",
            gridRow: "var(--storyboard-result-panel-row, 1)",
            minWidth: 0,
          }}
        >
          <CardHeader className="flex shrink-0 flex-row items-center gap-2 p-2 pb-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-4 w-12 shrink-0 rounded-full bg-muted/80" />
              <div className="h-6 w-20 shrink-0 rounded-full border border-border/70 bg-background" />
              <div className="h-3 w-48 max-w-[32vw] rounded-full bg-muted/70" />
            </div>
            <div
              className="ml-auto flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden px-1 py-1"
              data-storyboard-module-loading-toolbar="true"
            >
              <div className="h-8 w-16 shrink-0 rounded-md border border-border/70 bg-background" />
              <div className="h-8 w-32 shrink-0 rounded-md border border-border/70 bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md border border-border/70 bg-background" />
              <div className="h-8 w-28 shrink-0 rounded-md bg-muted/70" />
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-2 pt-1">
            <div
              className="h-full min-h-0"
              data-storyboard-module-loading-frame-grid="true"
              aria-hidden="true"
            >
              {STORYBOARD_MODULE_LOADING_CUT_NOS.map((cutNo) => (
                <div
                  key={`storyboard-loading-cut-${cutNo}`}
                  className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80"
                  data-storyboard-module-loading-cut={String(cutNo)}
                >
                  <div className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-slate-100 via-slate-200/85 to-slate-400/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:from-slate-800/72 dark:via-slate-700/58 dark:to-slate-600/52">
                    <span className="absolute left-3 top-3 z-10 h-5 w-14 rounded-full bg-slate-700/70" />
                    <span className="absolute right-3 top-3 z-10 h-6 w-12 rounded-full bg-white/80" />
                    <span
                      className="absolute inset-0 bg-gradient-to-br from-white/58 via-slate-200/28 to-slate-500/24"
                      aria-hidden="true"
                      data-storyboard-module-loading-glass="true"
                    />
                    <span
                      className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                      aria-hidden="true"
                      data-storyboard-module-loading-shimmer="true"
                    />
                  </div>
                  <div className="shrink-0 space-y-1 border-t border-border/45 bg-background/90 px-2.5 py-1.5">
                    <div className="grid items-center gap-2 rounded-lg bg-muted/15 px-2 py-0.5" style={{ gridTemplateColumns: "58px minmax(0, 1fr)" }}>
                      <div className="h-4 rounded-full bg-muted/65" />
                      <div className="h-3 rounded-full bg-muted-foreground/12" />
                    </div>
                    <div className="grid items-center gap-2 rounded-lg bg-rose-500/[0.045] px-2 py-0.5" style={{ gridTemplateColumns: "58px minmax(0, 1fr)" }}>
                      <div className="h-4 rounded-full bg-rose-100/70" />
                      <div className="h-3 rounded-full bg-muted-foreground/12" />
                    </div>
                    <div className="grid items-center gap-2 rounded-lg bg-amber-400/[0.10] px-2 py-0.5" style={{ gridTemplateColumns: "58px minmax(0, 1fr)" }}>
                      <div className="h-4 rounded-full bg-amber-100/75" />
                      <div className="h-3 rounded-full bg-muted-foreground/12" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <span className="sr-only">
              스토리보드 캔버스 영역을 준비하고 있습니다.
            </span>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function AdminYoutubeThumbnailModuleLoadingSkeleton() {
  return (
    <section
      className="relative flex h-full min-h-[640px] min-w-0 flex-col overflow-hidden bg-background p-3 md:min-h-0"
      data-thumbnail-module-loading="true"
      data-thumbnail-module-loading-layout="page-shell"
      data-thumbnail-module-loading-parity="storyboard-shell"
      role="status"
      aria-busy="true"
      aria-label="유튜브 썸네일 생성 화면 로딩 중"
    >
      <span
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-background via-slate-50/72 to-slate-200/48 dark:via-slate-900/54 dark:to-slate-700/32"
        aria-hidden="true"
        data-thumbnail-module-loading-glass-shell="true"
      />
      <span
        className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/3 z-0 w-1/3 bg-gradient-to-r from-transparent via-white/62 to-transparent dark:via-white/22"
        aria-hidden="true"
        data-thumbnail-module-loading-page-shimmer="true"
      />
      <div className="relative z-10 grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <Card
          className="relative order-2 flex min-h-0 flex-col overflow-hidden border border-border/70 bg-background/86 shadow-none"
          aria-label="유튜브 썸네일 도우미 준비 영역"
          data-thumbnail-module-loading-chat-shell="static"
          data-thumbnail-module-loading-card-glass="chat"
        >
          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/36 via-slate-100/14 to-slate-300/18 dark:from-slate-800/22 dark:via-slate-700/12 dark:to-slate-500/14"
            aria-hidden="true"
            data-thumbnail-module-loading-chat-shell-glass="true"
          />
          <span
            className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/52 to-transparent dark:via-white/18"
            aria-hidden="true"
            data-thumbnail-module-loading-chat-shell-shimmer="true"
          />
          <CardHeader className="relative z-10 shrink-0 space-y-1 p-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">
                  유튜브 썸네일 생성 도우미
                </span>
              </CardTitle>
              <Badge
                variant="outline"
                className="h-6 shrink-0 rounded-full px-2 text-[10px]"
              >
                준비 중
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col p-3 pt-0">
            <div
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background/92 to-muted/32 shadow-sm"
              data-thumbnail-module-loading-chat="true"
              data-thumbnail-module-loading-chat-tone="neutral-storyboard"
            >
              <span
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/42 via-slate-100/16 to-slate-300/18 dark:from-slate-800/26 dark:via-slate-700/14 dark:to-slate-600/16"
                aria-hidden="true"
                data-thumbnail-module-loading-chat-glass="true"
              />
              <span
                className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/56 to-transparent dark:via-white/18"
                aria-hidden="true"
                data-thumbnail-module-loading-chat-shimmer="true"
              />
              <div
                className="relative z-10 min-h-0 flex-1 space-y-3 overflow-hidden p-3"
                data-thumbnail-module-loading-chat-log="true"
                aria-hidden="true"
              >
                <div
                  className="flex gap-2"
                  data-thumbnail-module-loading-chat-message="assistant"
                >
                  <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/80">
                    <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/20" />
                  </div>
                  <div className="max-w-[86%] space-y-1 text-left">
                    <div className="h-2.5 w-14 rounded-full bg-muted-foreground/18" />
                    <div
                      className="space-y-2 rounded-2xl rounded-bl-md bg-background px-3 py-2 shadow-sm ring-1 ring-border/60"
                      data-thumbnail-module-loading-chat-bubble="guide"
                    >
                      <div className="h-3 w-44 max-w-full rounded-full bg-muted-foreground/14" />
                      <div className="h-3 w-64 max-w-full rounded-full bg-muted-foreground/12" />
                    </div>
                    <div
                      className="flex flex-wrap gap-1.5 pl-1"
                      data-thumbnail-module-loading-chat-actions="outside-bubble"
                    >
                      <div className="h-7 w-20 rounded-full border border-border/70 bg-background/80" />
                      <div className="h-7 w-20 rounded-full bg-muted/80" />
                    </div>
                  </div>
                </div>

                <div
                  className="flex justify-end gap-2"
                  data-thumbnail-module-loading-chat-message="user"
                >
                  <div className="max-w-[78%] space-y-1 text-right">
                    <div className="ml-auto h-2.5 w-5 rounded-full bg-muted-foreground/16" />
                    <div className="rounded-2xl rounded-br-md bg-muted/70 px-3 py-2">
                      <div className="h-3 w-56 max-w-full rounded-full bg-muted-foreground/16" />
                    </div>
                  </div>
                  <div className="mt-5 h-7 w-7 shrink-0 rounded-full bg-muted/80" />
                </div>

                <div
                  className="flex gap-2"
                  data-thumbnail-module-loading-chat-message="assistant"
                >
                  <div className="mt-5 h-7 w-7 shrink-0 rounded-full bg-muted/80" />
                  <div className="max-w-[86%] space-y-1 text-left">
                    <div className="h-2.5 w-16 rounded-full bg-muted-foreground/16" />
                    <div
                      className="space-y-2 rounded-2xl rounded-bl-md border border-border/60 bg-muted/55 px-3 py-2"
                      data-thumbnail-module-loading-chat-bubble="assistant"
                    >
                      <div className="h-3 w-48 max-w-full rounded-full bg-muted-foreground/16" />
                      <div className="h-3 w-32 max-w-full rounded-full bg-muted-foreground/12" />
                    </div>
                  </div>
                </div>
              </div>
              <div
                className="relative z-10 shrink-0 border-t border-border/70 bg-background/74 p-2.5"
                data-thumbnail-module-loading-composer="true"
                aria-hidden="true"
              >
                <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-2">
                  <div className="h-3 flex-1 rounded-full bg-muted-foreground/12" />
                  <div className="h-9 w-9 shrink-0 rounded-full bg-muted/80" />
                </div>
              </div>
            </div>
            <span className="sr-only">
              도우미 영역의 말풍선과 입력창을 준비하고 있습니다.
            </span>
          </CardContent>
        </Card>

        <Card
          className="relative order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-card/72 shadow-none"
          aria-label="유튜브 썸네일 캔버스 로딩"
          data-thumbnail-module-loading-canvas="true"
          data-thumbnail-module-loading-card-glass="canvas"
        >
          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/34 via-slate-100/14 to-slate-300/20 dark:from-slate-800/24 dark:via-slate-700/14 dark:to-slate-600/18"
            aria-hidden="true"
            data-thumbnail-module-loading-canvas-shell-glass="true"
          />
          <span
            className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/18"
            aria-hidden="true"
            data-thumbnail-module-loading-canvas-shell-shimmer="true"
          />
          <CardHeader className="relative z-10 flex shrink-0 flex-row items-center gap-2 p-2 pb-1">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0 whitespace-nowrap font-semibold">
                캔버스 편집 / PNG 내보내기
              </span>
            </CardTitle>
            <div className="ml-auto hidden min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pb-1 sm:flex">
              <div className="h-8 w-24 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-20 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md bg-muted/80" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 pt-0">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <div
                className="relative aspect-video w-full max-w-full overflow-hidden rounded-2xl border border-slate-300/80 bg-gradient-to-br from-slate-100 via-slate-200 to-slate-400/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-slate-700/70 dark:from-slate-800/72 dark:via-slate-700/58 dark:to-slate-600/52"
                data-thumbnail-module-loading-canvas-frame="true"
                data-thumbnail-module-loading-canvas-aspect="16:9"
              >
                <span
                  className="absolute inset-0 bg-gradient-to-br from-white/42 via-slate-200/22 to-slate-500/18"
                  aria-hidden="true"
                  data-thumbnail-module-loading-canvas-glass="true"
                />
                <span
                  className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                  aria-hidden="true"
                  data-thumbnail-module-loading-shimmer="true"
                />
              </div>
            </div>
            <div
              className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6"
              data-thumbnail-module-loading-toolbar="true"
            >
              {THUMBNAIL_MODULE_LOADING_TOOL_IDS.map((toolId) => (
                <div
                  key={`thumbnail-module-loading-tool-${toolId}`}
                  className="relative h-8 overflow-hidden rounded-lg border border-border/60 bg-gradient-to-br from-background/88 via-slate-50/68 to-slate-200/54 dark:via-slate-800/44 dark:to-slate-700/34"
                >
                  <span
                    className="absolute inset-0 bg-gradient-to-br from-white/28 via-transparent to-slate-400/14"
                    aria-hidden="true"
                    data-thumbnail-module-loading-tool-glass="true"
                  />
                  <span
                    className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/54 to-transparent dark:via-white/16"
                    aria-hidden="true"
                    data-thumbnail-module-loading-tool-shimmer="true"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <span className="sr-only">
        유튜브 썸네일 페이지 구조와 캔버스, 채팅 도우미를 함께 준비하고
        있습니다.
      </span>
    </section>
  );
}

