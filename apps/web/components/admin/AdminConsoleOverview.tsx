"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEventHandler,
  type ReactNode,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart2,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clapperboard,
  ClipboardList,
  ExternalLink,
  FileDown,
  Image as ImageIcon,
  MessageSquareText,
  LayoutList,
  Info,
  Menu,
  Layers3,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Sun,
  ScrollText,
  RefreshCw,
  Search,
  Store,
  MonitorPlay,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useAdBannersAdmin } from "@/hooks/use-ad-banners";
import { useMobileBottomNavAutoHide } from "@/hooks/use-mobile-bottom-nav-auto-hide";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
  isAdminDashboardWidgetId,
  normalizeAdminDashboardWidgetOrder,
  type AdminDashboardWidgetId,
} from "@/lib/admin/dashboard-widget-order";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
  type AdminSidebarOrderPreference,
} from "@/lib/admin/sidebar-order";
import { getMobileScrollNavVisibilityAction } from "@/lib/mobile-scroll-nav-visibility";
import {
  ADMIN_PENDING_COUNTS_QUERY_KEY,
  getAdminPendingCountsTotal,
  getAdminPendingReviewCount,
  getAdminPendingSubmissionCount,
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountsResponse,
} from "@/lib/admin/pending-counts";
import { cn } from "@/lib/utils";
import { resolveGitHubActionsRunUrl } from "@/lib/open-external-url";
import { buildScopedBrowserTitle } from "@/lib/seo";
import type { DashboardSummaryResponse } from "@/types/dashboard";
import type {
  InsightTreemapPeriod,
  InsightTreemapDataQualityStatus,
  InsightTreemapResponse,
  InsightTreemapVideoRow,
  InsightTreemapQualityFlag,
} from "@/lib/public-insights/treemap";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";
import {
  getAdminAuditCoverage,
  type AdminAuditCoverage,
} from "@/lib/admin/audit-contract";
import {
  buildCanonicalAdminHrefFromSearchParams,
  buildCanonicalAdminModuleHref,
  getAdminModuleIdFromSearchParams,
  getAdminModuleStateWarning,
  type AdminConsoleRouteModuleId,
} from "@/lib/admin/admin-module-routing";
import { TrendProposalQueue } from "@/components/admin/TrendProposalQueue";
import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";

type AdminModuleId = AdminConsoleRouteModuleId;
type ConsoleModuleId = Exclude<AdminModuleId, "overview" | "routes" | "llm">;

type ConsoleModule = {
  id: ConsoleModuleId;
  title: string;
  description: string;
  href: string;
  icon: typeof Store;
  badge: string;
  actionLabel: string;
  priority?: "urgent" | "normal";
};

const STORYBOARD_MODULE_LOADING_CUT_NOS = [1, 2, 3, 4] as const;
const THUMBNAIL_MODULE_LOADING_TOOL_IDS = Array.from(
  { length: 12 },
  (_, index) => index + 1,
);

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
    description:
      "승인된 맛집, 삭제/복구, 지도 좌표 오류 후보를 한 흐름에서 점검합니다.",
    href: "/admin?module=restaurants",
    icon: Store,
    badge: "데이터 검수",
    actionLabel: "맛집 데이터 검수",
    priority: "urgent",
  },
  {
    id: "restaurant-refresh-history",
    title: "맛집 최신화",
    description:
      "승인된 맛집의 상호명, 전화번호, 폐업·이전 후보와 과거 변경 이력을 관리합니다.",
    href: "/admin?module=restaurant-refresh-history",
    icon: RefreshCw,
    badge: "기록 관리",
    actionLabel: "최신화 이력 보기",
    priority: "urgent",
  },
  {
    id: "submissions",
    title: "제보 관리",
    description:
      "사용자 신규/수정 제보를 검토하고 안전 적용 절차로 반영합니다.",
    href: "/admin?module=submissions",
    icon: ClipboardList,
    badge: "승인 대기",
    actionLabel: "제보 검토하기",
    priority: "urgent",
  },
  {
    id: "reviews",
    title: "리뷰 관리",
    description:
      "미승인 리뷰, OCR 증빙, 중복/삭제 후보를 운영 기준에 맞춰 처리합니다.",
    href: "/admin?module=reviews",
    icon: MessageSquareText,
    badge: "검수 큐",
    actionLabel: "리뷰 검수하기",
    priority: "urgent",
  },
  {
    id: "storyboard",
    title: "스토리보드 생성",
    description:
      "쯔양 유튜브 히트맵을 바탕으로 다음 영상 소재와 씬별 촬영안을 생성합니다.",
    href: "/admin?module=storyboard",
    icon: Clapperboard,
    badge: "영상 기획",
    actionLabel: "스토리보드 만들기",
    priority: "urgent",
  },
  {
    id: "map-overlays",
    title: "지도 오버레이",
    description:
      "수동 오버레이, 트렌드 제안, 트렌드 실행 상태를 한 작업대에서 확인합니다.",
    href: "/admin?module=map-overlays",
    icon: Layers3,
    badge: "오버레이",
    actionLabel: "지도 오버레이 관리",
    priority: "urgent",
  },

  {
    id: "banners",
    title: "배너 관리",
    description:
      "사이드바/모바일 팝업 배너의 노출 위치, 우선순위, 미디어 상태를 관리합니다.",
    href: "/admin?module=banners",
    icon: ImageIcon,
    badge: "공개 노출",
    actionLabel: "배너 노출 관리",
  },
  {
    id: "users",
    title: "사용자 관리",
    description:
      "사용자 계정, 관리자 권한, 비활성 상태, 프로필 정보를 안전한 편집 흐름으로 관리합니다.",
    href: "/admin?module=users",
    icon: UsersRound,
    badge: "권한 관리",
    actionLabel: "사용자 계정 관리",
  },
  {
    id: "insights",
    title: "핵심 인사이트",
    description:
      "조회수/좋아요/댓글/영상 길이 기반 트리맵과 변화 추이를 확인합니다.",
    href: "/admin?module=insights",
    icon: BarChart2,
    badge: "분석",
    actionLabel: "핵심 인사이트 보기",
  },
  {
    id: "audit",
    title: "감사 로그",
    description:
      "사용자 관리 감사는 admin_audit_events 기준의 부분/도메인별 범위로 추적합니다.",
    href: "/admin?module=audit",
    icon: ScrollText,
    badge: "부분 감사",
    actionLabel: "감사 범위 보기",
  },
  {
    id: "youtube-thumbnail-generator",
    title: "유튜브 썸네일 생성",
    description:
      "다음 업로드 주제와 참고 이미지를 바탕으로 16:9 먹방 썸네일 초안을 만들고 텍스트를 편집합니다.",
    href: "/admin?module=youtube-thumbnail-generator",
    icon: ImageIcon,
    badge: "썸네일",
    actionLabel: "썸네일 생성하기",
    priority: "urgent",
  },
];

const consoleModuleById = new Map<ConsoleModuleId, ConsoleModule>(
  consoleModules.map((module) => [module.id, module]),
);

function getSidebarConsoleItems(
  moduleIds: ConsoleModuleId[],
): SidebarSection["items"] {
  return moduleIds.flatMap((moduleId) => {
    const consoleModule = consoleModuleById.get(moduleId);
    if (!consoleModule) return [];

    const { id, title, description, icon, badge } = consoleModule;
    return [{ id, title, description, icon, badge }];
  });
}

const guardedSteps = ["미리보기", "확인", "적용", "재확인", "감사 기록"];
const ADMIN_THEME_STORAGE_KEY = "tzudong-admin-theme";
const ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY = "tzudong-admin-sidebar-collapsed";
const SIDEBAR_LABEL_REVEAL_DELAY_MS = 120;

type AdminThemePreference = "light" | "dark" | "system";

function getSystemThemePreference(): Exclude<AdminThemePreference, "system"> {
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyAdminThemePreference(theme: AdminThemePreference) {
  if (typeof document === "undefined") return;

  const resolvedTheme = theme === "system" ? getSystemThemePreference() : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}

function normalizeAdminThemePreference(
  theme: string | null,
): AdminThemePreference {
  if (theme === "dark" || theme === "system") return theme;

  return "light";
}
const ADMIN_THEME_OPTIONS = [
  ["light", "라이트 모드", "다크모드", Sun],
  ["dark", "다크모드", "시스템 모드", Moon],
  ["system", "시스템 모드", "라이트 모드", Monitor],
] as const;

function getAdminThemeOption(theme: AdminThemePreference) {
  return (
    ADMIN_THEME_OPTIONS.find(([themeValue]) => themeValue === theme) ??
    ADMIN_THEME_OPTIONS[0]
  );
}

function getNextAdminThemePreference(theme: AdminThemePreference) {
  const currentIndex = ADMIN_THEME_OPTIONS.findIndex(
    ([themeValue]) => themeValue === theme,
  );
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + 1) % ADMIN_THEME_OPTIONS.length;

  return ADMIN_THEME_OPTIONS[nextIndex][0];
}

function getAdminThemeChangeLabel(themeLabel: string) {
  return `${themeLabel}${themeLabel.endsWith("모드") ? "로" : "으로"} 변경`;
}


function getSidebarBadgeClassName(sectionLabel: string, isActive: boolean) {
  if (isActive) return "text-primary-foreground/75";
  if (sectionLabel === "검수") return "text-amber-700 dark:text-amber-300";
  if (sectionLabel === "운영") return "text-sky-700 dark:text-sky-300";
  if (sectionLabel === "실험실") return "text-violet-700 dark:text-violet-300";
  if (sectionLabel === "홈") return "text-emerald-700 dark:text-emerald-300";

  return "text-muted-foreground";
}
const sidebarSections: SidebarSection[] = [
  {
    label: "홈",
    items: [
      {
        id: "overview",
        title: "대시보드 (KPI)",
        description: "구독자·좋아요·댓글 추이를 확인합니다.",
        icon: Activity,
        badge: "성과 요약",
      },
    ],
  },
  {
    label: "검수",
    items: consoleModules
      .filter((module) =>
        [
          "restaurants",
          "restaurant-refresh-history",
          "submissions",
          "reviews",
        ].includes(module.id),
      )
      .map(({ id, title, description, icon, badge }) => ({
        id,
        title,
        description,
        icon,
        badge,
      })),
  },
  {
    label: "운영",
    items: getSidebarConsoleItems(["map-overlays", "users", "banners", "insights"]),
  },
  {
    label: "실험실",
    items: [
      ...getSidebarConsoleItems(["youtube-thumbnail-generator", "storyboard"]),
      {
        id: "routes",
        title: "맛집 동선 추천",
        description: "지도에서 맛집 후보와 실제 도로 동선을 관리합니다.",
        icon: Route,
        badge: "지도 동선",
      },
      {
        id: "llm",
        title: "운영 보조",
        description: "위험 액션 전 읽기 전용 운영 보조를 확인합니다.",
        icon: Bot,
        badge: "실험 중",
      },
      ...getSidebarConsoleItems(["audit"]),
    ],
  },
];

function moveItemInArray<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

type AdminDashboardTableWidgetId = Extract<
  AdminDashboardWidgetId,
  "impact" | "trend" | "ops" | "topContent" | "engagementRate"
>;

type AdminDashboardCardView = "chart" | "table";

type AdminDashboardTrendSeriesKey = "views" | "engagement" | "engagementRate";
type AdminDashboardTopContentSeriesKey = "views" | "likes" | "comments";

type AdminDashboardSeriesVisibility<Key extends string> = Record<Key, boolean>;
type AdminDashboardSkeletonVariant =
  | "chart"
  | "table"
  | "ops"
  | "bubble"
  | "line"
  | "stacked"
  | "diagnosis";

type AdminDashboardCardReorderProps = {
  draggable: boolean;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onDragEnd: DragEventHandler<HTMLDivElement>;
  "aria-grabbed": boolean;
  "data-admin-dashboard-direct-reorder-card": AdminDashboardWidgetId;
};

const ADMIN_DASHBOARD_WIDGET_LABELS: Record<AdminDashboardWidgetId, string> = {
  subscribers: "구독자",
  views: "조회수",
  likes: "좋아요",
  comments: "댓글",
  videos: "영상 수",
  impact: "상위 영상 영향도",
  trend: "조회·참여 추이",
  ops: "운영·검수 요약",
  topContent: "콘텐츠 성과 TOP 5",
  engagementRate: "성과 진단",
};

const ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS = [
  ["subscribers", "views", "likes", "comments", "videos"],
  ["impact", "trend"],
  ["ops", "topContent", "engagementRate"],
] as const satisfies ReadonlyArray<ReadonlyArray<AdminDashboardWidgetId>>;

const adminDashboardWidgetLayoutGroupMap = new Map<
  AdminDashboardWidgetId,
  number
>(
  ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS.flatMap((group, groupIndex) =>
    group.map((widgetId) => [widgetId, groupIndex] as const),
  ),
);

function getAdminDashboardWidgetLayoutGroup(widgetId: AdminDashboardWidgetId) {
  return adminDashboardWidgetLayoutGroupMap.get(widgetId) ?? 0;
}

const DEFAULT_ADMIN_DASHBOARD_CARD_VIEWS: Record<
  AdminDashboardTableWidgetId,
  AdminDashboardCardView
> = {
  impact: "chart",
  trend: "chart",
  ops: "chart",
  topContent: "chart",
  engagementRate: "chart",
};

const DEFAULT_ADMIN_DASHBOARD_TREND_SERIES_VISIBILITY: AdminDashboardSeriesVisibility<AdminDashboardTrendSeriesKey> =
  {
    views: true,
    engagement: true,
    engagementRate: true,
  };

const DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY: AdminDashboardSeriesVisibility<AdminDashboardTopContentSeriesKey> =
  {
    views: true,
    likes: true,
    comments: true,
  };

type AdminDashboardViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => unknown;
};

function updateAdminDashboardOrderWithViewTransition(
  updateCallback: () => void,
) {
  if (typeof document === "undefined") {
    updateCallback();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    updateCallback();
    return;
  }

  const startViewTransition = (document as AdminDashboardViewTransitionDocument)
    .startViewTransition;

  if (!startViewTransition) {
    updateCallback();
    return;
  }

  try {
    startViewTransition.call(document, updateCallback);
  } catch {
    updateCallback();
  }
}

function areAdminDashboardWidgetOrdersEqual(
  left: AdminDashboardWidgetId[],
  right: AdminDashboardWidgetId[],
) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function moveAdminDashboardWidgetBeforeOrAfter(
  order: AdminDashboardWidgetId[],
  sourceWidgetId: AdminDashboardWidgetId,
  targetWidgetId: AdminDashboardWidgetId,
  placement: "before" | "after",
) {
  const normalizedOrder = normalizeAdminDashboardWidgetOrder(order);
  if (sourceWidgetId === targetWidgetId) return normalizedOrder;

  if (
    getAdminDashboardWidgetLayoutGroup(sourceWidgetId) !==
    getAdminDashboardWidgetLayoutGroup(targetWidgetId)
  ) {
    return normalizedOrder;
  }

  const nextOrder = normalizedOrder.filter(
    (widgetId) => widgetId !== sourceWidgetId,
  );
  const targetIndex = nextOrder.indexOf(targetWidgetId);
  if (targetIndex < 0) return normalizedOrder;

  nextOrder.splice(
    placement === "after" ? targetIndex + 1 : targetIndex,
    0,
    sourceWidgetId,
  );
  return nextOrder;
}

function moveAdminDashboardWidget(
  order: AdminDashboardWidgetId[],
  widgetId: AdminDashboardWidgetId,
  direction: -1 | 1,
) {
  const normalized = normalizeAdminDashboardWidgetOrder(order);
  const index = normalized.indexOf(widgetId);
  return index < 0 ? normalized : moveItemInArray(normalized, index, direction);
}

function moveAdminSidebarSection(
  order: AdminSidebarOrderPreference,
  section: string,
  direction: -1 | 1,
): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const index = normalized.sections.indexOf(section);
  return {
    ...normalized,
    sections:
      index < 0
        ? normalized.sections
        : moveItemInArray(normalized.sections, index, direction),
  };
}

function moveAdminSidebarItem(
  order: AdminSidebarOrderPreference,
  section: string,
  itemId: AdminModuleId,
  direction: -1 | 1,
): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const sectionItems = normalized.items[section] ?? [];
  const index = sectionItems.indexOf(itemId);

  return {
    ...normalized,
    items: {
      ...normalized.items,
      [section]:
        index < 0
          ? sectionItems
          : moveItemInArray(sectionItems, index, direction),
    },
  };
}

function buildOrderedSidebarSections(
  order: AdminSidebarOrderPreference,
): SidebarSection[] {
  const normalized = normalizeAdminSidebarOrder(order);
  const sourceSections = new Map(
    sidebarSections.map((section) => [section.label, section]),
  );

  return normalized.sections.flatMap((sectionLabel) => {
    const section = sourceSections.get(sectionLabel);
    if (!section) return [];

    const itemMap = new Map(section.items.map((item) => [item.id, item]));
    const orderedItems = (normalized.items[sectionLabel] ?? [])
      .map((itemId) => itemMap.get(itemId))
      .filter((item): item is SidebarSection["items"][number] => Boolean(item));

    return [{ ...section, items: orderedItems }];
  });
}

function loadAdminEvaluationModule() {
  return import("@/app/admin/evaluations/page").then(
    (module) => module.default.Embedded,
  );
}

function loadAdminBannerModule() {
  return import("@/app/admin/banners/page").then(
    (module) => module.default.Embedded,
  );
}

function loadAdminRestaurantRefreshHistoryModule() {
  return import("@/components/admin/AdminRestaurantRefreshHistoryPanel").then(
    (module) => module.AdminRestaurantRefreshHistoryPanel,
  );
}

function loadAdminUsersModule() {
  return import("@/components/admin/AdminUsersPanel");
}

function loadAdminStoryboardGenerator() {
  return import("@/components/admin/storyboard/AdminStoryboardGenerator").then(
    (module) => module.AdminStoryboardGenerator,
  );
}

function loadAdminYoutubeThumbnailGenerator() {
  return import(
    "@/components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator"
  ).then((module) => module.AdminYoutubeThumbnailGenerator);
}

function loadInsightsModule() {
  return import("@/app/insights/insights-client");
}

function loadAdminRouteRecommendationModule() {
  return import("@/components/admin/AdminOverviewDashboard").then(
    (module) => module.AdminOverviewDashboard,
  );
}

function loadAdminSystemStatusCenter() {
  return import("@/components/admin/system-status/AdminSystemStatusCenter").then(
    (module) => module.AdminSystemStatusCenter,
  );
}

const ADMIN_EVALUATION_STATIC_STATUS_FILTERS = ["전체", "미처리", "승인대기", "승인됨", "누락", "삭제됨"] as const;

function AdminEvaluationModuleStaticShell() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 데이터 검수 화면 로딩 중"
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-admin-evaluation-dynamic-loading-shell="true"
    >
      <span className="sr-only">정적인 관리자 데이터 검수 컨트롤은 바로 표시하고, 동적인 검수 데이터만 불러오는 중입니다.</span>
      <div className="border-b border-border bg-card px-2 py-1.5">
        <div className="flex min-h-10 items-start justify-between gap-1.5 lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-primary" aria-hidden="true">
                <ClipboardCheck className="h-5 w-5" strokeWidth={2.25} />
              </span>
              <h1 className="whitespace-nowrap bg-gradient-primary bg-clip-text text-base font-bold text-transparent">
                관리자 데이터 검수
              </h1>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중
            </div>
          </div>
          <div className="ml-auto flex items-center justify-end gap-1.5" data-admin-evaluation-view-actions="top-right">
            <Button type="button" variant="secondary" size="sm" disabled className="h-8 w-8 p-0 disabled:opacity-100" aria-label="리스트 뷰" aria-pressed="true">
              <LayoutList className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">리스트</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled className="h-8 w-8 p-0 disabled:opacity-100" aria-label="슬라이드 뷰" aria-pressed="false">
              <MonitorPlay className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">슬라이드</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">
        <div className="space-y-2 lg:hidden" data-admin-evaluation-static-loading-controls="true">
          <div className="grid grid-cols-3 gap-1.5">
            {ADMIN_EVALUATION_STATIC_STATUS_FILTERS.map((label, index) => (
              <Button
                key={label}
                type="button"
                variant={index === 0 ? "default" : "outline"}
                size="sm"
                disabled
                className="h-8 min-w-0 rounded-full px-2 text-xs font-medium disabled:opacity-100"
                aria-pressed={index === 0}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <div className="flex h-9 items-center rounded-md border bg-background pl-8 pr-3 text-sm text-muted-foreground">
              영상 제목 검색...
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-between gap-2 py-0.5">
            <div className="min-w-0 truncate px-0.5 text-xs text-muted-foreground">
              <span>검수 항목</span>
              <span className="ml-1 font-medium">집계 중</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="outline" size="sm" disabled className="h-8 rounded-full px-2.5 text-xs font-semibold disabled:opacity-100">
                상세 필터
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled aria-label="필터 초기화" className="h-8 w-8 rounded-full p-0 text-muted-foreground disabled:opacity-100">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <Skeleton className="h-12 w-16 shrink-0 rounded-md motion-reduce:animate-none" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" />
                  <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" />
                  <div className="grid grid-cols-3 gap-1.5">
                    <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
                    <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
                    <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden min-h-0 overflow-hidden rounded-lg border bg-background lg:block">
          <div className="border-b bg-muted/35 lg:grid lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="px-2 py-2">
                <Skeleton className={index === 1 ? "h-3 w-24 rounded-full motion-reduce:animate-none" : "mx-auto h-3 w-12 rounded-full motion-reduce:animate-none"} />
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid items-center gap-2 p-2 lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]"
              >
                <Skeleton className="h-6 w-6 rounded-md motion-reduce:animate-none" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-10 w-14 shrink-0 rounded-md motion-reduce:animate-none" aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                    <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </div>
                </div>
                {Array.from({ length: 6 }).map((__, cellIndex) => (
                  <Skeleton key={cellIndex} className="h-6 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                ))}
                <Skeleton className="h-7 rounded-md motion-reduce:animate-none" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const AdminEvaluationModule = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => <AdminEvaluationModuleStaticShell />,
});

const AdminBannerModule = dynamic(loadAdminBannerModule, {
  ssr: false,
  loading: () => null,
});

const AdminRestaurantRefreshHistoryModule = dynamic(
  loadAdminRestaurantRefreshHistoryModule,
  {
    ssr: false,
    loading: () => null,
  },
);

const AdminUsersModule = dynamic(loadAdminUsersModule, {
  ssr: false,
  loading: () => null,
});

const AdminStoryboardGenerator = dynamic(loadAdminStoryboardGenerator, {
  ssr: false,
  loading: () => null,
});

const AdminYoutubeThumbnailGenerator = dynamic(
  loadAdminYoutubeThumbnailGenerator,
  {
    ssr: false,
    loading: () => null,
  },
);

const InsightsModule = dynamic(loadInsightsModule, {
  ssr: false,
  loading: () => null,
});

const AdminRouteRecommendationModule = dynamic(
  loadAdminRouteRecommendationModule,
  {
    ssr: false,
    loading: () => null,
  },
);

const AdminSystemStatusCenter = dynamic(loadAdminSystemStatusCenter, {
  ssr: false,
  loading: () => null,
});
const ADMIN_CONSOLE_INLINE_MODULE_IDS = new Set<AdminModuleId>([
  "overview",
  "map-overlays",
  "llm",
  "audit",
]);

function preloadAdminConsoleModule(moduleId: AdminModuleId): Promise<unknown> {
  switch (moduleId) {
    case "overview":
    case "llm":
    case "audit":
    case "map-overlays":
      return Promise.resolve();
    case "restaurants":
    case "submissions":
    case "reviews":
      return loadAdminEvaluationModule();
    case "restaurant-refresh-history":
      return loadAdminRestaurantRefreshHistoryModule();
    case "banners":
      return loadAdminBannerModule();
    case "storyboard":
      return loadAdminStoryboardGenerator();
    case "youtube-thumbnail-generator":
      return loadAdminYoutubeThumbnailGenerator();
    case "users":
      return loadAdminUsersModule();
    case "insights":
      return loadInsightsModule();
    case "routes":
      return loadAdminRouteRecommendationModule();
    default: {
      const exhaustiveModuleId: never = moduleId;
      return Promise.resolve(exhaustiveModuleId);
    }
  }
}

function createInitialAdminConsoleLoadedModuleIds() {
  return new Set<AdminModuleId>(ADMIN_CONSOLE_INLINE_MODULE_IDS);
}



type AdminOverviewStats = {
  pendingSubmissions: number | null;
  pendingReviews: number | null;
  pendingRestaurantSubmissions: number | null;
  pendingRecommendationRequests: number | null;
  pendingTotal: number | null;
  totalRestaurants: number | null;
  totalVideos: number | null;
  withCoordinates: number | null;
  activeBanners: number | null;
  inactiveBanners: number | null;
  latestRestaurantUpdate: string | null;
  dashboardVideos: DashboardSummaryResponse["videos"] | null;
};

type AdminYouTubeChannelStats = {
  channelId: string | null;
  title: string | null;
  handle: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  hiddenSubscriberCount: boolean;
  fetchedAt: string | null;
  previousSubscriberCount?: number | null;
  previousViewCount?: number | null;
  previousVideoCount?: number | null;
  subscriberDelta?: number | null;
  viewDelta?: number | null;
  videoDelta?: number | null;
  comparisonFetchedAt?: string | null;
  qualityFlags?: InsightTreemapQualityFlag[];
  deltaSource?:
    | "snapshot-delta"
    | "derived-live-comparison"
    | "derived-snapshot-comparison"
    | "unavailable";
  unavailable?: {
    code: "LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE";
  };
};

type AdminYouTubeKpiCollectionRun = {
  id: number | null;
  runNumber: number | null;
  title: string;
  event: string | null;
  status: string;
  conclusion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  htmlUrl: string | null;
};

type AdminYouTubeKpiCollectionJob = {
  id: number | null;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
};

type AdminYouTubeKpiCollectionLogs = {
  asOf: string;
  workflow: {
    available: boolean;
    repository: string;
    workflowId: string;
    runs: AdminYouTubeKpiCollectionRun[];
    latestJobs: AdminYouTubeKpiCollectionJob[];
    error: string | null;
  };
  snapshot: {
    available: boolean;
    bucketStartedAt?: string;
    fetchedAt?: string;
    channelId?: string | null;
    channelTitle?: string | null;
    subscriberCount?: number | null;
    viewCount?: number | null;
    videoCount?: number | null;
    previousBucketStartedAt?: string | null;
    subscriberDelta?: number | null;
    viewDelta?: number | null;
    videoDelta?: number | null;
    videoSnapshotCount?: number | null;
    error?: string | null;
  };
};
type AdminAuditCoverageView = AdminAuditCoverage & {
  label?: string;
  summary?: string;
  source?: string;
  sources?: string[];
  domain?: string;
  domains?: string[];
  mode?: string;
  universal?: boolean;
};

type AdminAuditEvent = {
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

type AdminAuditEventsResponse = {
  asOf: string;
  source: "admin_audit_events";
  coverage?: AdminAuditCoverageView;
  events: AdminAuditEvent[];
  unavailable: {
    reason: string;
    message: string;
  } | null;
};
type AdminAuditUnavailableReason =
  | "admin-audit-events-read-failed"
  | "admin-audit-session-expired"
  | "admin-audit-admin-required";
const adminAuditFallbackCoverage =
  getAdminAuditCoverage() as AdminAuditCoverageView;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAdminAuditCoveragePayload(value: unknown): value is AdminAuditCoverageView {
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

function isAdminAuditEventsResponsePayload(
  value: unknown,
): value is AdminAuditEventsResponse {
  return (
    isRecordValue(value) &&
    value.source === "admin_audit_events" &&
    Array.isArray(value.events) &&
    value.events.length <= 50 &&
    value.events.every((event) => (
      isRecordValue(event) &&
      typeof event.id === "string" &&
      typeof event.action === "string" &&
      typeof event.status === "string" &&
      typeof event.reasonCode === "string" &&
      isRecordValue(event.counts) &&
      isRecordValue(event.flags)
    )) &&
    isAdminAuditCoveragePayload(value.coverage) &&
    isAdminAuditUnavailablePayload(value.unavailable)
  );
}

function getPayloadErrorMessage(value: unknown) {
  return isRecordValue(value) && typeof value.error === "string"
    ? value.error
    : null;
}

function getAdminAuditCoverageLabel(
  coverage: AdminAuditCoverageView | undefined,
) {
  return coverage?.universal === false
    ? "부분/도메인별 감사 범위"
    : (coverage?.label ?? "부분/도메인별 감사 범위");
}

function getAdminAuditCoverageSourceSummary(
  coverage: AdminAuditCoverageView | undefined,
) {
  const sources =
    coverage?.sources?.length
      ? coverage.sources
      : [
          coverage?.primary?.source,
          ...(coverage?.domainSpecific?.map((feed) => feed.source) ?? []),
        ].filter((source): source is string => Boolean(source));
  return (sources.length ? sources : ["admin_audit_events"]).join(" · ");
}

function getAdminAuditCoverageDomainSummary(
  coverage: AdminAuditCoverageView | undefined,
) {
  const domains =
    coverage?.domains?.length
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

function hasTruthfulAdminAuditCoverage(
  coverage: AdminAuditCoverageView | undefined,
) {
  return (
    coverage?.universal === false &&
    coverage?.mode === "truthful-partial-domain-specific"
  );
}



const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = "tzudong:e2e-admin-shell-bypass";

function isLocalE2EAdminShellBypassHost(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function hasLocalE2EAdminShellBypass() {
  if (typeof window === "undefined") return false;
  if (!isLocalE2EAdminShellBypassHost(window.location.hostname)) return false;

  try {
    return (
      window.localStorage.getItem(E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

const adminNumberFormatter = new Intl.NumberFormat("ko-KR");

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? adminNumberFormatter.format(value)
    : "—";
}

function formatSignedNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatCount(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatNumber(value)}${unit}`
    : "—";
}

type AdminDashboardPdfReportMetric = {
  label: string;
  value: string;
  caption: string;
};

type AdminDashboardPdfReportContentRow = {
  rank: string;
  title: string;
  views: string;
  likes: string;
  comments: string;
  contribution: string;
};

type AdminDashboardPdfReportInsightRow = {
  label: string;
  title: string;
  description: string;
  scoreLabel: string;
};

type AdminDashboardPdfReportData = {
  title: string;
  generatedAtLabel: string;
  periodLabel: string;
  basisLabel: string;
  summaryLabel: string;
  contributionFormula: string;
  metrics: AdminDashboardPdfReportMetric[];
  topContents: AdminDashboardPdfReportContentRow[];
  insights: AdminDashboardPdfReportInsightRow[];
};

const adminDashboardReportDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatAdminDashboardReportGeneratedAt(date = new Date()) {
  return adminDashboardReportDateFormatter.format(date);
}

function escapeAdminDashboardReportHtml(
  value: string | number | null | undefined,
) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAdminDashboardPdfReportHtml(report: AdminDashboardPdfReportData) {
  const metricCards = report.metrics.length
    ? report.metrics
        .map(
          (metric) => `
            <section>
              <h3>${escapeAdminDashboardReportHtml(metric.label)}</h3>
              <dl>
                <div>
                  <dt>값</dt>
                  <dd>${escapeAdminDashboardReportHtml(metric.value)}</dd>
                </div>
                <div>
                  <dt>설명</dt>
                  <dd>${escapeAdminDashboardReportHtml(metric.caption)}</dd>
                </div>
              </dl>
            </section>`,
        )
        .join("")
    : `<p>표시할 핵심 KPI가 없습니다.</p>`;
  const topRows = report.topContents.length
    ? report.topContents
        .map(
          (row) => `
            <tr>
              <td>${escapeAdminDashboardReportHtml(row.rank)}</td>
              <td>${escapeAdminDashboardReportHtml(row.title)}</td>
              <td>${escapeAdminDashboardReportHtml(row.views)}</td>
              <td>${escapeAdminDashboardReportHtml(row.likes)}</td>
              <td>${escapeAdminDashboardReportHtml(row.comments)}</td>
              <td>${escapeAdminDashboardReportHtml(row.contribution)}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="6">표시할 상위 콘텐츠가 없습니다.</td></tr>`;
  const insightCards = report.insights.length
    ? report.insights
        .map(
          (insight) => `
            <article>
              <p><strong>${escapeAdminDashboardReportHtml(insight.label)}</strong></p>
              <h3>${escapeAdminDashboardReportHtml(insight.title)}</h3>
              <p>${escapeAdminDashboardReportHtml(insight.description)}</p>
              <p>${escapeAdminDashboardReportHtml(insight.scoreLabel)}</p>
            </article>`,
        )
        .join("")
    : `<p>표시할 성과 진단이 없습니다.</p>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeAdminDashboardReportHtml(report.title)}</title>
</head>
<body>
  <main>
    <header>
      <img src="/logo.webp" alt="Tzudong 로고" />
      <h1>${escapeAdminDashboardReportHtml(report.title)}</h1>
      <p>${escapeAdminDashboardReportHtml(report.summaryLabel)}</p>
      <p>${escapeAdminDashboardReportHtml(report.periodLabel)}</p>
      <p>${escapeAdminDashboardReportHtml(report.generatedAtLabel)}</p>
      <p>${escapeAdminDashboardReportHtml(report.basisLabel)}</p>
    </header>
    <section aria-label="핵심 KPI">
      <h2>핵심 KPI</h2>
      ${metricCards}
    </section>
    <section>
      <h2>콘텐츠 성과 TOP 5</h2>
      <table>
        <thead>
          <tr><th>순위</th><th>영상</th><th>조회</th><th>좋아요</th><th>댓글</th><th>성과 기여</th></tr>
        </thead>
        <tbody>${topRows}</tbody>
      </table>
      <p>${escapeAdminDashboardReportHtml(report.contributionFormula)}</p>
    </section>
    <section>
      <h2>성과 진단</h2>
      ${insightCards}
    </section>
    <aside aria-label="인쇄 안내">
      <p>PDF로 저장하거나 인쇄하려면 브라우저의 인쇄 명령(Ctrl+P 또는 ⌘+P)을 사용하세요.</p>
    </aside>
  </main>
</body>
</html>`;
}

function openAdminDashboardPdfReport(report: AdminDashboardPdfReportData) {
  if (typeof window === "undefined") return false;

  let reportWindow: Window | null = null;
  try {
    reportWindow = window.open("", "_blank", "noopener,width=960,height=1200");
    if (!reportWindow) return false;

    reportWindow.opener = null;
    if (reportWindow.opener !== null) {
      throw new Error("admin-dashboard-report-opener-severing-failed");
    }

    reportWindow.document.open();
    reportWindow.document.write(buildAdminDashboardPdfReportHtml(report));
    reportWindow.document.close();
    reportWindow.focus();
    window.setTimeout(() => {
      reportWindow?.focus();
      reportWindow?.print();
    }, 250);
    return true;
  } catch {
    reportWindow?.close();
    return false;
  }
}

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

async function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await fetch("/api/dashboard/summary", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("dashboard-summary-failed");
  }

  return response.json() as Promise<DashboardSummaryResponse>;
}

async function fetchAdminYouTubeChannelStats(
  period: AdminDashboardPeriod,
): Promise<AdminYouTubeChannelStats> {
  const params = new URLSearchParams({ period });
  const response = await fetch(`/api/admin/youtube-channel?${params}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("admin-youtube-channel-stats-failed");
  }

  return response.json() as Promise<AdminYouTubeChannelStats>;
}

async function fetchAdminYouTubeKpiCollectionLogs(): Promise<AdminYouTubeKpiCollectionLogs> {
  const response = await fetch("/api/admin/youtube-kpi-collection-logs", {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("admin-youtube-kpi-collection-logs-failed");
  }

  return response.json() as Promise<AdminYouTubeKpiCollectionLogs>;
}

function buildAdminAuditAuthUnavailableResponse(
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
async function fetchAdminAuditEvents(): Promise<AdminAuditEventsResponse> {
  const response = await fetch("/api/admin/audit-events?limit=20", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);

  const authUnavailable = buildAdminAuditAuthUnavailableResponse(response.status);
  if (authUnavailable) return authUnavailable;
  if (!response.ok) {
    if (isAdminAuditEventsResponsePayload(payload) && payload.unavailable) {
      return payload;
    }
    throw new Error(getPayloadErrorMessage(payload) ?? "admin-audit-events-failed");
  }

  if (!isAdminAuditEventsResponsePayload(payload)) {
    throw new Error("admin-audit-events-invalid-response");
  }

  return payload;
}

function useAdminOverviewStats(isAdmin: boolean): {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
} {
  const pendingCountsQuery = useQuery({
    queryKey: ADMIN_PENDING_COUNTS_QUERY_KEY,
    queryFn: fetchAdminPendingCounts,
    enabled: isAdmin,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  });

  const dashboardSummaryQuery = useQuery({
    queryKey: ["admin-overview", "dashboard-summary"],
    queryFn: fetchDashboardSummary,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const bannersQuery = useAdBannersAdmin(isAdmin);
  const banners = bannersQuery.data ?? [];
  const pendingCounts = pendingCountsQuery.data ?? null;

  return {
    stats: {
      pendingSubmissions: pendingCounts
        ? getAdminPendingSubmissionCount(pendingCounts)
        : null,
      pendingRestaurantSubmissions: pendingCounts
        ? pendingCounts.domains.restaurant_submissions.count
        : null,
      pendingRecommendationRequests: pendingCounts
        ? pendingCounts.domains.restaurant_recommendation_requests.count
        : null,
      pendingTotal: pendingCounts ? getAdminPendingCountsTotal(pendingCounts) : null,
      pendingReviews: pendingCounts ? getAdminPendingReviewCount(pendingCounts) : null,
      totalRestaurants: dashboardSummaryQuery.data?.totals.restaurants ?? null,
      totalVideos: dashboardSummaryQuery.data?.totals.videos ?? null,
      withCoordinates:
        dashboardSummaryQuery.data?.totals.withCoordinates ?? null,
      activeBanners: bannersQuery.isSuccess
        ? banners.filter((banner) => banner.is_active).length
        : null,
      inactiveBanners: bannersQuery.isSuccess
        ? banners.filter((banner) => !banner.is_active).length
        : null,
      latestRestaurantUpdate: dashboardSummaryQuery.data?.asOf ?? null,
      dashboardVideos: dashboardSummaryQuery.data?.videos ?? null,
    },
    isLoading:
      pendingCountsQuery.isLoading ||
      dashboardSummaryQuery.isLoading ||
      bannersQuery.isLoading,
    hasError:
      pendingCountsQuery.isError ||
      dashboardSummaryQuery.isError ||
      bannersQuery.isError,
  };
}

type AdminDashboardPeriod = Extract<
  InsightTreemapPeriod,
  | "30MIN"
  | "1H"
  | "6H"
  | "12H"
  | "1D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "1Y"
  | "ALL"
>;

type AdminDashboardInsightScope = "cohort" | "channel-growth";

type AdminDashboardTrendPoint = {
  label: string;
  value: number;
  secondaryValue: number;
};

type AdminDashboardSparklinePoint = {
  label: string;
  value: number;
};

type AdminDashboardBarRow = {
  label: string;
  value: number;
  likeCount: number;
  viewCount: number;
  commentCount: number;
  viewAverage: number;
  likeAverage: number;
  commentAverage: number;
  viewMedian: number;
  viewRank: number;
  totalRows: number;
  viewContributionPercent: number | null;
  likeContributionPercent: number | null;
  commentContributionPercent: number | null;
  performanceContributionPercent: number | null;
  viewTopPercentLabel: string;
  viewMedianMultipleLabel: string;
  viewBenchmarkLabel: string;
  viewBenchmark: string;
  viewBenchmarkTooltip: string;
  viewBenchmarkTooltipLines: string[];
  qualityBadges: AdminDashboardDataQualityBadge[];
  meta: string;
};


type AdminDashboardDataQualityBadge = {
  label: string;
  description: string;
  severity: "info" | "warning" | "risk";
};



const ADMIN_DASHBOARD_PERIOD_OPTIONS: Array<{
  value: AdminDashboardPeriod;
  label: string;
}> = [
  { value: "30MIN", label: "30분" },
  { value: "1H", label: "1시간" },
  { value: "6H", label: "6시간" },
  { value: "12H", label: "12시간" },
  { value: "1D", label: "1일" },
  { value: "1W", label: "1주" },
  { value: "1M", label: "1개월" },
  { value: "3M", label: "3개월" },
  { value: "6M", label: "6개월" },
  { value: "1Y", label: "1년" },
  { value: "ALL", label: "전체" },
];

const ADMIN_DASHBOARD_IMPACT_FULL_CHART_LIMIT = 60;
const ADMIN_DASHBOARD_IMPACT_MAX_CHART_LIMIT = 80;
const ADMIN_DASHBOARD_PROGRESSIVE_INITIAL_ROWS = 40;
const ADMIN_DASHBOARD_PROGRESSIVE_BATCH_ROWS = 80;
const ADMIN_DASHBOARD_PROGRESSIVE_DELAY_MS = 24;
const ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_INITIAL_ROWS = 18;
const ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_BATCH_ROWS = 24;
const ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_DELAY_MS = 48;
const ADMIN_DASHBOARD_MOBILE_DEFER_ROOT_MARGIN = "420px 0px";
const ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT = 7;
const ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT = 4;
const ADMIN_DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_DASHBOARD_PERIOD_DURATION_MS: Record<
  Exclude<AdminDashboardPeriod, "ALL">,
  number
> = {
  "30MIN": 30 * 60 * 1000,
  "1H": 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "12H": 12 * 60 * 60 * 1000,
  "1D": ADMIN_DASHBOARD_DAY_MS,
  "1W": 7 * ADMIN_DASHBOARD_DAY_MS,
  "1M": 30 * ADMIN_DASHBOARD_DAY_MS,
  "3M": 91 * ADMIN_DASHBOARD_DAY_MS,
  "6M": 182 * ADMIN_DASHBOARD_DAY_MS,
  "1Y": 365 * ADMIN_DASHBOARD_DAY_MS,
};
const ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHTS = {
  views: 0.6,
  likes: 0.25,
  comments: 0.15,
} as const;
const ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHT_LABEL =
  "조회 60% · 좋아요 25% · 댓글 15%";

const adminCompactNumberFormatter = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const adminDashboardDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
});

const adminDashboardDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatCompactNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? adminCompactNumberFormatter.format(value)
    : "—";
}

function formatDashboardDateLabel(value: string | null) {
  if (!value) return "날짜 없음";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? adminDashboardDateFormatter.format(date)
    : "날짜 없음";
}

function getAdminDashboardImpactChartLimit(videoCount: number) {
  if (!Number.isFinite(videoCount) || videoCount <= 0) return 0;
  if (videoCount <= ADMIN_DASHBOARD_IMPACT_FULL_CHART_LIMIT) {
    return videoCount;
  }

  return Math.min(videoCount, ADMIN_DASHBOARD_IMPACT_MAX_CHART_LIMIT);
}

function useAdminDashboardProgressiveItems<T>(
  items: T[],
  initialCount = ADMIN_DASHBOARD_PROGRESSIVE_INITIAL_ROWS,
  batchCount = ADMIN_DASHBOARD_PROGRESSIVE_BATCH_ROWS,
  delayMs = ADMIN_DASHBOARD_PROGRESSIVE_DELAY_MS,
) {
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(initialCount, items.length),
  );

  useEffect(() => {
    let isCancelled = false;
    let timer: number | undefined;

    setVisibleCount(Math.min(initialCount, items.length));
    if (items.length <= initialCount) return;

    const scheduleNextBatch = () => {
      timer = window.setTimeout(() => {
        if (isCancelled) return;

        setVisibleCount((currentCount) => {
          const nextCount = Math.min(items.length, currentCount + batchCount);
          if (nextCount < items.length) scheduleNextBatch();
          return nextCount;
        });
      }, delayMs);
    };

    scheduleNextBatch();

    return () => {
      isCancelled = true;
      if (typeof timer === "number") window.clearTimeout(timer);
    };
  }, [batchCount, delayMs, initialCount, items]);

  return items.slice(0, Math.min(visibleCount, items.length));
}

function getIsAdminDashboardMobileViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

function AdminDashboardDeferredBody({
  enabled,
  resetKey,
  variant,
  children,
}: {
  enabled: boolean;
  resetKey: string;
  variant: AdminDashboardSkeletonVariant;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(() => !enabled);

  useEffect(() => {
    if (!enabled) {
      setIsReady(true);
      return;
    }

    setIsReady(false);

    const container = containerRef.current;
    if (!container || !("IntersectionObserver" in window)) {
      const fallbackTimer = window.setTimeout(() => setIsReady(true), 80);
      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
          )
        ) {
          setIsReady(true);
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin: ADMIN_DASHBOARD_MOBILE_DEFER_ROOT_MARGIN,
        threshold: 0.01,
      },
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, [enabled, resetKey]);

  if (isReady) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1"
      data-admin-dashboard-mobile-deferred="true"
      data-admin-dashboard-mobile-deferred-reset-key={resetKey}
    >
      <AdminDashboardPanelBodySkeleton variant={variant} />
    </div>
  );
}

function formatDashboardDateTime(value: string | null | undefined) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? adminDashboardDateTimeFormatter.format(date)
    : "시간 없음";
}

function getAdminDashboardCoverageLabel(
  coverage:
    | NonNullable<InsightTreemapResponse["meta"]>["comparisonCoverage"]
    | undefined,
) {
  if (!coverage || !coverage.comparisonAvailable) return "비교 대기";
  return `비교 ${formatNumber(coverage.comparedVideos)}/${formatNumber(coverage.totalVideos)}`;
}


function getAdminDashboardVideoQualityBadges(_video?: InsightTreemapVideoRow) {
  return [] as AdminDashboardDataQualityBadge[];
}



function getAdminDashboardDataQualityStatus(
  flags: InsightTreemapQualityFlag[],
): InsightTreemapDataQualityStatus {
  if (flags.some((flag) => flag.severity === "risk")) return "risk";
  if (flags.some((flag) => flag.severity === "warning")) return "watch";
  return "ok";
}


function getAdminDashboardDeltaSourceLabel(
  source: AdminYouTubeChannelStats["deltaSource"],
) {
  if (source === "snapshot-delta") return "수집 delta";
  if (source === "derived-live-comparison") return "실시간-스냅샷 비교";
  if (source === "derived-snapshot-comparison") return "스냅샷 재계산";
  return "delta 대기";
}

function getVideoEngagementTotal(video: InsightTreemapVideoRow) {
  return video.likeCount + video.commentCount;
}

function getVideoMetricDelta(
  video: InsightTreemapVideoRow,
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  const currentValue = getCurrentValue(video);
  const previousValue = getPreviousValue(video);

  if (!Number.isFinite(currentValue)) {
    return null;
  }

  if (typeof previousValue !== "number" || !Number.isFinite(previousValue)) {
    if (video.comparisonStatus === "missing_previous") {
      return null;
    }

    return currentValue;
  }

  return currentValue - previousValue;
}

function getVideoViewDelta(video: InsightTreemapVideoRow) {
  return getVideoMetricDelta(
    video,
    (row) => row.viewCount,
    (row) => row.previousViewCount,
  );
}

function getVideoLikeDelta(video: InsightTreemapVideoRow) {
  return getVideoMetricDelta(
    video,
    (row) => row.likeCount,
    (row) => row.previousLikeCount,
  );
}

function getVideoCommentDelta(video: InsightTreemapVideoRow) {
  return getVideoMetricDelta(
    video,
    (row) => row.commentCount,
    (row) => row.previousCommentCount,
  );
}

function getVideoEngagementDelta(video: InsightTreemapVideoRow) {
  const likeDelta = getVideoLikeDelta(video);
  const commentDelta = getVideoCommentDelta(video);

  if (likeDelta == null && commentDelta == null) return null;
  return (likeDelta ?? 0) + (commentDelta ?? 0);
}

function getNonNegativeMetricDelta(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function hasDashboardSnapshotComparison(
  videos: InsightTreemapVideoRow[],
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  return videos.some((video) => {
    const previousValue = getPreviousValue(video);
    return typeof previousValue === "number" && Number.isFinite(previousValue);
  });
}

function getDashboardPeriodMetricValue(
  videos: InsightTreemapVideoRow[],
  period: AdminDashboardPeriod,
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  if (period === "ALL") {
    return videos.reduce((sum, video) => sum + getCurrentValue(video), 0);
  }

  if (!hasDashboardSnapshotComparison(videos, getPreviousValue)) {
    return null;
  }

  return videos.reduce((sum, video) => {
    if (video.comparisonStatus === "missing_previous") return sum;

    const previousValue = getPreviousValue(video);
    const safePreviousValue =
      typeof previousValue === "number" && Number.isFinite(previousValue)
        ? previousValue
        : 0;

    return sum + (getCurrentValue(video) - safePreviousValue);
  }, 0);
}

function calculateDashboardChange(current: number, previous: number) {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous <= 0
  ) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function formatDashboardChangeLabel(change: number | null) {
  if (typeof change !== "number" || !Number.isFinite(change)) return "—";
  if (Math.abs(change) < 0.05) return "0.0%";

  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function getVideoPublishedTime(video: InsightTreemapVideoRow) {
  const time = video.publishedAt ? new Date(video.publishedAt).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function calculateRecentWindowChange(
  videos: InsightTreemapVideoRow[],
  getValue: (video: InsightTreemapVideoRow) => number,
) {
  const orderedVideos = [...videos].sort(
    (a, b) => getVideoPublishedTime(a) - getVideoPublishedTime(b),
  );

  if (orderedVideos.length < 2) return null;

  const midpoint = Math.floor(orderedVideos.length / 2);
  const previousWindow = orderedVideos.slice(0, midpoint);
  const currentWindow = orderedVideos.slice(midpoint);
  const previousTotal = previousWindow.reduce(
    (sum, video) => sum + getValue(video),
    0,
  );
  const currentTotal = currentWindow.reduce(
    (sum, video) => sum + getValue(video),
    0,
  );

  return calculateDashboardChange(currentTotal, previousTotal);
}

function calculateDashboardMetricChange(
  videos: InsightTreemapVideoRow[],
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue?: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  if (getPreviousValue) {
    const hasSnapshotComparison = hasDashboardSnapshotComparison(
      videos,
      getPreviousValue,
    );

    if (hasSnapshotComparison) {
      const currentTotal = videos.reduce(
        (sum, video) =>
          video.comparisonStatus === "missing_previous"
            ? sum
            : sum + getCurrentValue(video),
        0,
      );
      const previousTotal = videos.reduce((sum, video) => {
        if (video.comparisonStatus === "missing_previous") return sum;
        const previousValue = getPreviousValue(video);
        return sum + (typeof previousValue === "number" ? previousValue : 0);
      }, 0);
      const snapshotChange = calculateDashboardChange(
        currentTotal,
        previousTotal,
      );

      if (snapshotChange != null) return snapshotChange;
    }
  }

  return calculateRecentWindowChange(videos, getCurrentValue);
}

function calculateDashboardPeriodMetricChange(
  videos: InsightTreemapVideoRow[],
  period: AdminDashboardPeriod,
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  if (period === "ALL") return null;
  if (!hasDashboardSnapshotComparison(videos, getPreviousValue)) return null;

  return calculateDashboardMetricChange(
    videos,
    getCurrentValue,
    getPreviousValue,
  );
}

function getAdminDashboardPeriodDurationMs(period: AdminDashboardPeriod) {
  if (period === "ALL") return null;
  return ADMIN_DASHBOARD_PERIOD_DURATION_MS[period] ?? null;
}

function countDashboardPublishedVideosInWindow(
  videos: InsightTreemapVideoRow[],
  windowStartMs: number,
  windowEndMs: number,
) {
  return videos.reduce((count, video) => {
    const publishedAtMs = getVideoPublishedTime(video);
    if (publishedAtMs >= windowStartMs && publishedAtMs < windowEndMs) {
      return count + 1;
    }

    return count;
  }, 0);
}

function calculateDashboardUploadCountChange(
  videos: InsightTreemapVideoRow[],
  period: AdminDashboardPeriod,
) {
  const durationMs = getAdminDashboardPeriodDurationMs(period);
  if (!durationMs || videos.length === 0) return null;

  const now = Date.now();
  const currentWindowStartMs = now - durationMs;
  const previousWindowStartMs = currentWindowStartMs - durationMs;
  const currentCount = countDashboardPublishedVideosInWindow(
    videos,
    currentWindowStartMs,
    now,
  );
  const previousCount = countDashboardPublishedVideosInWindow(
    videos,
    previousWindowStartMs,
    currentWindowStartMs,
  );

  return calculateDashboardChange(currentCount, previousCount);
}
function buildAdminDashboardFallbackInsightMeta(
  payload: InsightTreemapResponse,
  fallbackReasonCode: string,
): NonNullable<InsightTreemapResponse["meta"]> {
  const fallbackSource = "public-insights-treemap";
  const dataSource = "public-treemap-fallback" as const;
  const fallbackFlag: InsightTreemapQualityFlag = {
    reason: "fallback_source",
    severity: "warning",
    source: dataSource,
  };
  const dataQuality = payload.meta?.dataQuality;
  const nextFlags = [...(dataQuality?.flags ?? []), fallbackFlag];
  const existingFallbackCount =
    dataQuality?.reasonCounts.find((item) => item.reason === "fallback_source")
      ?.count ?? 0;
  const nextReasonCounts = dataQuality
    ? [
        ...dataQuality.reasonCounts.filter(
          (item) => item.reason !== "fallback_source",
        ),
        {
          reason: "fallback_source" as const,
          severity: "warning" as const,
          count: existingFallbackCount + 1,
        },
      ]
    : [];

  return {
    ...payload.meta,
    dataSource,
    fallbackSource,
    fallbackReasonCode,
    ...(dataQuality
      ? {
          dataQuality: {
            ...dataQuality,
            status: getAdminDashboardDataQualityStatus(nextFlags),
            flags: nextFlags,
            reasonCounts: nextReasonCounts,
          },
        }
      : {}),
  };
}


async function fetchAdminDashboardInsightSummary(
  period: AdminDashboardPeriod,
  scope: AdminDashboardInsightScope = "cohort",
): Promise<InsightTreemapResponse> {
  const params = new URLSearchParams({
    period,
    viewMode: "all",
    metricMode: "views",
  });

  if (scope === "channel-growth") {
    params.set("scope", scope);
  }

  const liveResponse = await fetch(
    `/api/admin/youtube-kpis?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (liveResponse.ok) {
    return liveResponse.json() as Promise<InsightTreemapResponse>;
  }

  const fallbackResponse = await fetch(
    `/api/insights/treemap?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!fallbackResponse.ok) {
    throw new Error("admin-dashboard-insight-summary-failed");
  }

  const fallbackPayload =
    (await fallbackResponse.json()) as InsightTreemapResponse;

  return {
    ...fallbackPayload,
    meta: buildAdminDashboardFallbackInsightMeta(
      fallbackPayload,
      `admin-youtube-kpis-${liveResponse.status}`,
    ),
  };
}

function buildAdminDashboardTrendPoints(
  videosByPublishedAt: InsightTreemapVideoRow[],
): AdminDashboardTrendPoint[] {
  return videosByPublishedAt.map((video) => ({
    label: formatDashboardDateLabel(video.publishedAt),
    value: getVideoEngagementTotal(video),
    secondaryValue: video.viewCount,
  }));
}

function sampleAdminDashboardPeriodPoints<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return items.slice(-1);

  const sampled: T[] = [];
  const seenIndexes = new Set<number>();
  const lastIndex = items.length - 1;

  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    if (seenIndexes.has(sourceIndex)) continue;
    seenIndexes.add(sourceIndex);
    sampled.push(items[sourceIndex]);
  }

  return sampled;
}

function buildAdminDashboardSparklinePoints(
  videosByPublishedAt: InsightTreemapVideoRow[],
  getValue: (video: InsightTreemapVideoRow, index: number) => number,
): AdminDashboardSparklinePoint[] {
  return sampleAdminDashboardPeriodPoints(
    videosByPublishedAt,
    ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT,
  ).map((video, index) => ({
    label: formatDashboardDateLabel(video.publishedAt),
    value: getValue(video, index),
  }));
}

function buildAdminDashboardPeriodDeltaSparklinePoints(
  videosByPublishedAt: InsightTreemapVideoRow[],
  period: AdminDashboardPeriod,
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
): AdminDashboardSparklinePoint[] {
  const hasComparison =
    period === "ALL" ||
    hasDashboardSnapshotComparison(videosByPublishedAt, getPreviousValue);

  if (!hasComparison) return [];

  const comparableVideos = videosByPublishedAt.filter(
    (video) => video.comparisonStatus !== "missing_previous",
  );

  return sampleAdminDashboardPeriodPoints(
    comparableVideos,
    ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT,
  ).map((video) => {
    const previousValue = getPreviousValue(video);
    const safePreviousValue =
      period === "ALL"
        ? 0
        : typeof previousValue === "number" && Number.isFinite(previousValue)
          ? previousValue
          : 0;

    return {
      label: formatDashboardDateLabel(video.publishedAt),
      value: getCurrentValue(video) - safePreviousValue,
    };
  });
}

function buildAdminDashboardChannelGrowthSparklinePoints(
  previousValue: number | null | undefined,
  currentValue: number | null | undefined,
): AdminDashboardSparklinePoint[] {
  if (
    typeof previousValue !== "number" ||
    !Number.isFinite(previousValue) ||
    typeof currentValue !== "number" ||
    !Number.isFinite(currentValue)
  ) {
    return [];
  }

  return [
    { label: "비교 스냅샷", value: previousValue },
    { label: "현재", value: currentValue },
  ];
}

function buildAdminDashboardBarRows(
  videosByViews: InsightTreemapVideoRow[],
  metricMode: "current" | "delta" = "current",
  contributionTotalOverride?: number | null,
  periodUploadVideoCount?: number | null,
): AdminDashboardBarRow[] {
  const metricRows = videosByViews.map((video) => {
    const viewCount =
      metricMode === "delta"
        ? getNonNegativeMetricDelta(getVideoViewDelta(video))
        : video.viewCount;
    const likeCount =
      metricMode === "delta"
        ? getNonNegativeMetricDelta(getVideoLikeDelta(video))
        : video.likeCount;
    const commentCount =
      metricMode === "delta"
        ? getNonNegativeMetricDelta(getVideoCommentDelta(video))
        : video.commentCount;

    return { video, viewCount, likeCount, commentCount };
  });
  const viewAverage = getDashboardAverage(
    metricRows.map((row) => row.viewCount),
  );
  const likeAverage = getDashboardAverage(
    metricRows.map((row) => row.likeCount),
  );
  const commentAverage = getDashboardAverage(
    metricRows.map((row) => row.commentCount),
  );
  const viewMedian = getDashboardMedian(metricRows.map((row) => row.viewCount));
  const calculatedTotalViewValue = metricRows.reduce(
    (sum, row) => sum + row.viewCount,
    0,
  );
  const totalLikeValue = metricRows.reduce(
    (sum, row) => sum + row.likeCount,
    0,
  );
  const totalCommentValue = metricRows.reduce(
    (sum, row) => sum + row.commentCount,
    0,
  );
  const totalViewValue =
    typeof contributionTotalOverride === "number" &&
    Number.isFinite(contributionTotalOverride) &&
    contributionTotalOverride > 0
      ? contributionTotalOverride
      : calculatedTotalViewValue;
  const metricPrefix = metricMode === "delta" ? "증가" : "";
  const viewBenchmarkLabel = metricMode === "delta" ? "성과 증가" : "성과";
  const contributionLabel =
    metricMode === "delta" ? "기간 성과 기여" : "성과 기여";
  const contributionTotalSourceLabel =
    metricMode === "delta"
      ? "전체값: 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다."
      : "전체값: 조회·좋아요·댓글 합계를 각각 분모로 사용합니다.";
  const hasPeriodUploadVideoCount =
    typeof periodUploadVideoCount === "number" &&
    Number.isFinite(periodUploadVideoCount) &&
    periodUploadVideoCount >= 0;
  const scoredRows = metricRows
    .map((row) => {
      const viewContributionPercent = getDashboardMetricContributionPercent(
        row.viewCount,
        totalViewValue,
      );
      const likeContributionPercent = getDashboardMetricContributionPercent(
        row.likeCount,
        totalLikeValue,
      );
      const commentContributionPercent = getDashboardMetricContributionPercent(
        row.commentCount,
        totalCommentValue,
      );
      const performanceContributionPercent =
        getDashboardWeightedPerformanceContribution({
          viewContributionPercent,
          likeContributionPercent,
          commentContributionPercent,
        });

      return {
        ...row,
        viewContributionPercent,
        likeContributionPercent,
        commentContributionPercent,
        performanceContributionPercent,
      };
    })
    .sort((a, b) => {
      const contributionDelta =
        (b.performanceContributionPercent ?? -Infinity) -
        (a.performanceContributionPercent ?? -Infinity);
      if (contributionDelta !== 0) return contributionDelta;

      return b.viewCount - a.viewCount;
    });

  return scoredRows.map((row, index) => {
    const viewRank = index + 1;
    const viewMedianMultiple =
      viewMedian > 0 ? row.viewCount / viewMedian : null;
    const viewTopPercentLabel = getDashboardTopPercentLabel(
      viewRank,
      scoredRows.length,
    );
    const viewMedianMultipleLabel = formatDashboardMultiple(viewMedianMultiple);
    const averageComparison = formatDashboardAverageComparison(
      row.viewCount,
      viewAverage,
    );
    const viewBenchmark = `${formatDashboardContribution(
      row.performanceContributionPercent,
    )} · ${viewRank}위 · ${viewTopPercentLabel}`;
    const comparisonTargetLine =
      metricMode === "delta"
        ? `비교 대상: 선택 기간 업로드 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`
        : `비교 대상: 선택 기간 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`;
    const uploadScopeLine =
      metricMode === "delta" &&
      hasPeriodUploadVideoCount &&
      periodUploadVideoCount !== scoredRows.length
        ? `업로드 영상 수 카드는 ${formatNumber(periodUploadVideoCount)}개이고, 이 비교에는 성과 데이터가 있는 ${formatNumber(scoredRows.length)}개를 사용합니다.`
        : null;
    const viewBenchmarkTooltipLines = [
      contributionLabel,
      comparisonTargetLine,
      ...(uploadScopeLine ? [uploadScopeLine] : []),
      `조회 ${formatDashboardPercent(row.viewContributionPercent)} · 좋아요 ${formatDashboardPercent(row.likeContributionPercent)} · 댓글 ${formatDashboardPercent(row.commentContributionPercent)}`,
      `계산식: 조회×60% + 좋아요×25% + 댓글×15% = ${formatDashboardPercent(row.performanceContributionPercent)}`,
      `가중치: ${ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHT_LABEL}`,
      contributionTotalSourceLabel,
    ];
    const viewBenchmarkTooltip = viewBenchmarkTooltipLines.join(" ");

    return {
      label: row.video.title,
      value: row.viewCount,
      likeCount: row.likeCount,
      viewCount: row.viewCount,
      commentCount: row.commentCount,
      viewAverage,
      likeAverage,
      commentAverage,
      viewMedian,
      viewRank,
      totalRows: scoredRows.length,
      viewContributionPercent: row.viewContributionPercent,
      likeContributionPercent: row.likeContributionPercent,
      commentContributionPercent: row.commentContributionPercent,
      performanceContributionPercent: row.performanceContributionPercent,
      viewTopPercentLabel,
      viewMedianMultipleLabel,
      viewBenchmarkLabel,
      viewBenchmark,
      viewBenchmarkTooltip,
      viewBenchmarkTooltipLines,
      qualityBadges: getAdminDashboardVideoQualityBadges(row.video),
      meta: `조회${metricPrefix} ${formatCompactNumber(row.viewCount)} · ${viewBenchmark} · ${viewMedianMultipleLabel} · 좋아요${metricPrefix} ${formatCompactNumber(
        row.likeCount,
      )} · 댓글${metricPrefix} ${formatCompactNumber(row.commentCount)}`,
    };
  });
}

function clampDashboardPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function formatDashboardPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(value >= 10 ? 0 : 1)}%`
    : "—";
}

function getDashboardAverage(values: number[]) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return 0;

  return (
    finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
  );
}

function getDashboardMedian(values: number[]) {
  const finiteValues = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (finiteValues.length === 0) return 0;

  const middle = Math.floor(finiteValues.length / 2);
  if (finiteValues.length % 2 === 1) return finiteValues[middle] ?? 0;

  return ((finiteValues[middle - 1] ?? 0) + (finiteValues[middle] ?? 0)) / 2;
}

function formatDashboardMultiple(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "중앙값 비교 대기";
  if (value >= 20) return "중앙값 대비 20배+";
  if (value >= 10) return `중앙값 대비 ${value.toFixed(0)}배`;
  if (value >= 1) return `중앙값 대비 ${value.toFixed(1)}배`;
  return `중앙값 대비 ${value.toFixed(2)}배`;
}

function getDashboardTopPercentLabel(rank: number, total: number) {
  if (
    !Number.isFinite(rank) ||
    !Number.isFinite(total) ||
    rank <= 0 ||
    total <= 0
  ) {
    return "상위권 계산 대기";
  }

  return `상위 ${Math.max(1, Math.ceil((rank / total) * 100))}%`;
}

function formatDashboardContribution(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatDashboardPercent(value)} 기여`
    : "기여도 계산 대기";
}

function getDashboardMetricContributionPercent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return (value / total) * 100;
}

function getDashboardWeightedPerformanceContribution({
  viewContributionPercent,
  likeContributionPercent,
  commentContributionPercent,
}: {
  viewContributionPercent: number | null;
  likeContributionPercent: number | null;
  commentContributionPercent: number | null;
}) {
  const weightedMetrics: Array<{ value: number; weight: number }> = [
    {
      value: viewContributionPercent,
      weight: ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHTS.views,
    },
    {
      value: likeContributionPercent,
      weight: ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHTS.likes,
    },
    {
      value: commentContributionPercent,
      weight: ADMIN_DASHBOARD_TOP_CONTENT_CONTRIBUTION_WEIGHTS.comments,
    },
  ].flatMap((metric) =>
    typeof metric.value === "number" && Number.isFinite(metric.value)
      ? [{ value: metric.value, weight: metric.weight }]
      : [],
  );

  const totalWeight = weightedMetrics.reduce(
    (sum, metric) => sum + metric.weight,
    0,
  );

  if (totalWeight <= 0) return null;

  return weightedMetrics.reduce(
    (sum, metric) => sum + metric.value * (metric.weight / totalWeight),
    0,
  );
}

function getDashboardAverageDeltaPercent(value: number, average: number) {
  if (!Number.isFinite(value) || !Number.isFinite(average) || average <= 0) {
    return null;
  }

  return ((value - average) / average) * 100;
}

function formatDashboardAverageComparison(value: number, average: number) {
  const deltaPercent = getDashboardAverageDeltaPercent(value, average);

  if (deltaPercent == null) return "평균 비교 대기";
  if (Math.abs(deltaPercent) < 0.05) return "평균 수준 0%";

  const direction = deltaPercent > 0 ? "평균 이상" : "평균 이하";
  const sign = deltaPercent > 0 ? "+" : "";

  return `${direction} ${sign}${formatDashboardPercent(deltaPercent)}`;
}

type AdminDashboardContentInsight = {
  label: string;
  title: string;
  description: string;
  tone: "primary" | "warning" | "risk";
  score: number;
  scoreLabel: string;
  qualityBadges: AdminDashboardDataQualityBadge[];
};

function getDashboardInsightSignalScore(value: number, average: number) {
  const deltaPercent = getDashboardAverageDeltaPercent(value, average);
  if (deltaPercent == null) return 50;

  return Math.max(8, Math.min(100, Math.abs(deltaPercent)));
}

function getDashboardVideoAgeDays(
  video: InsightTreemapVideoRow,
  asOf: string | null | undefined,
) {
  const publishedMs = video.publishedAt
    ? new Date(video.publishedAt).getTime()
    : Number.NaN;
  const asOfMs = asOf ? new Date(asOf).getTime() : Date.now();

  if (!Number.isFinite(publishedMs) || !Number.isFinite(asOfMs)) return null;

  return Math.max(1, (asOfMs - publishedMs) / ADMIN_DASHBOARD_DAY_MS);
}

function getDashboardVideoMetricSnapshot(
  video: InsightTreemapVideoRow,
  metricMode: "current" | "delta",
) {
  const viewValue =
    metricMode === "delta"
      ? getNonNegativeMetricDelta(getVideoViewDelta(video))
      : video.viewCount;
  const likeValue =
    metricMode === "delta"
      ? getNonNegativeMetricDelta(getVideoLikeDelta(video))
      : video.likeCount;
  const commentValue =
    metricMode === "delta"
      ? getNonNegativeMetricDelta(getVideoCommentDelta(video))
      : video.commentCount;
  const engagementValue = likeValue + commentValue;

  return {
    video,
    viewValue,
    likeValue,
    commentValue,
    engagementValue,
    engagementRate: getDashboardRatio(engagementValue, viewValue) ?? 0,
  };
}

function buildAdminDashboardContentInsights(
  videos: InsightTreemapVideoRow[],
  metricMode: "current" | "delta",
  asOf: string | null | undefined,
  subscriberDelta: number | null,
  contributionTotalOverride?: number | null,
): AdminDashboardContentInsight[] {
  const metricRows = videos
    .map((video) => {
      const metric = getDashboardVideoMetricSnapshot(video, metricMode);
      const ageDays = getDashboardVideoAgeDays(video, asOf);

      return {
        ...metric,
        ageDays,
        viewsPerDay: ageDays ? metric.viewValue / ageDays : 0,
      };
    })
    .filter((row) => row.viewValue > 0);

  if (metricRows.length === 0) return [];

  const viewAverage = getDashboardAverage(
    metricRows.map((row) => row.viewValue),
  );
  const engagementRateAverage = getDashboardAverage(
    metricRows.map((row) => row.engagementRate),
  );
  const dailyViewAverage = getDashboardAverage(
    metricRows.map((row) => row.viewsPerDay),
  );
  const metricNoun = metricMode === "delta" ? "증가" : "성과";
  const calculatedTotalViewValue = metricRows.reduce(
    (sum, row) => sum + row.viewValue,
    0,
  );
  const totalViewValue =
    typeof contributionTotalOverride === "number" &&
    Number.isFinite(contributionTotalOverride) &&
    contributionTotalOverride > 0
      ? contributionTotalOverride
      : calculatedTotalViewValue;
  const totalLikeValue = metricRows.reduce(
    (sum, row) => sum + row.likeValue,
    0,
  );
  const totalCommentValue = metricRows.reduce(
    (sum, row) => sum + row.commentValue,
    0,
  );
  const metricRowsWithContribution = metricRows.map((row) => {
    const viewContributionPercent = getDashboardMetricContributionPercent(
      row.viewValue,
      totalViewValue,
    );
    const likeContributionPercent = getDashboardMetricContributionPercent(
      row.likeValue,
      totalLikeValue,
    );
    const commentContributionPercent = getDashboardMetricContributionPercent(
      row.commentValue,
      totalCommentValue,
    );
    const performanceContributionPercent =
      getDashboardWeightedPerformanceContribution({
        viewContributionPercent,
        likeContributionPercent,
        commentContributionPercent,
      });

    return {
      ...row,
      performanceContributionPercent,
    };
  });
  const rankedByContribution = [...metricRowsWithContribution].sort((a, b) => {
    const contributionDelta =
      (b.performanceContributionPercent ?? -Infinity) -
      (a.performanceContributionPercent ?? -Infinity);
    if (contributionDelta !== 0) return contributionDelta;

    return b.viewValue - a.viewValue;
  });
  const strongestContribution = rankedByContribution[0];
  const strongestContributionRank = strongestContribution
    ? rankedByContribution.findIndex(
        (row) => row.video.id === strongestContribution.video.id,
      ) + 1
    : 0;
  const strongestContributionTopPercentLabel = getDashboardTopPercentLabel(
    strongestContributionRank,
    metricRowsWithContribution.length,
  );
  const strongestContributionScore =
    strongestContribution?.performanceContributionPercent ?? 0;
  const strongestEngagement = [...metricRows].sort(
    (a, b) =>
      (getDashboardAverageDeltaPercent(
        b.engagementRate,
        engagementRateAverage,
      ) ?? -Infinity) -
      (getDashboardAverageDeltaPercent(
        a.engagementRate,
        engagementRateAverage,
      ) ?? -Infinity),
  )[0];
  const recentUnderperformer = metricRows
    .filter((row) => row.ageDays != null && row.ageDays <= 14)
    .sort(
      (a, b) =>
        (getDashboardAverageDeltaPercent(a.viewsPerDay, dailyViewAverage) ??
          Infinity) -
        (getDashboardAverageDeltaPercent(b.viewsPerDay, dailyViewAverage) ??
          Infinity),
    )[0];
  const reboundCandidate = metricRows
    .filter((row) => row.ageDays != null && row.ageDays >= 90)
    .sort((a, b) => b.viewValue - a.viewValue)[0];
  const insights: AdminDashboardContentInsight[] = [];

  if (strongestContribution) {
    const scoreLabel = formatDashboardContribution(
      strongestContribution.performanceContributionPercent,
    );
    const averageComparison = formatDashboardAverageComparison(
      strongestContribution.viewValue,
      viewAverage,
    );

    insights.push({
      label: "성과 기여",
      title: strongestContribution.video.title,
      description: `${metricNoun} ${scoreLabel} · ${strongestContributionRank}위 · ${strongestContributionTopPercentLabel}`,
      tone: "primary",
      score: Math.max(8, Math.min(100, strongestContributionScore * 2)),
      scoreLabel: `${scoreLabel} · 평균 참고 ${averageComparison}`,
      qualityBadges: getAdminDashboardVideoQualityBadges(strongestContribution.video),
    });
  }

  if (strongestEngagement) {
    const scoreLabel = formatDashboardAverageComparison(
      strongestEngagement.engagementRate,
      engagementRateAverage,
    );

    insights.push({
      label: "참여율 강세",
      title: strongestEngagement.video.title,
      description: `참여율 ${scoreLabel} · ${formatDashboardPercent(strongestEngagement.engagementRate)}`,
      tone: "warning",
      score: getDashboardInsightSignalScore(
        strongestEngagement.engagementRate,
        engagementRateAverage,
      ),
      scoreLabel,
      qualityBadges: getAdminDashboardVideoQualityBadges(strongestEngagement.video),
    });
  }

  if (recentUnderperformer) {
    const scoreLabel = formatDashboardAverageComparison(
      recentUnderperformer.viewsPerDay,
      dailyViewAverage,
    );

    insights.push({
      label: "초반 반응 점검",
      title: recentUnderperformer.video.title,
      description: `일평균 조회 ${scoreLabel} · 업로드 ${Math.round(recentUnderperformer.ageDays ?? 0)}일`,
      tone: "risk",
      score: getDashboardInsightSignalScore(
        recentUnderperformer.viewsPerDay,
        dailyViewAverage,
      ),
      scoreLabel,
      qualityBadges: getAdminDashboardVideoQualityBadges(recentUnderperformer.video),
    });
  }

  if (reboundCandidate && reboundCandidate !== strongestContribution) {
    const scoreLabel = formatDashboardAverageComparison(
      reboundCandidate.viewValue,
      viewAverage,
    );

    insights.push({
      label: metricMode === "delta" ? "재상승 후보" : "롱테일 후보",
      title: reboundCandidate.video.title,
      description: `업로드 ${Math.round(
        reboundCandidate.ageDays ?? 0,
      )}일 · 조회 ${metricNoun} ${formatCompactNumber(reboundCandidate.viewValue)}`,
      tone: "warning",
      score: getDashboardInsightSignalScore(
        reboundCandidate.viewValue,
        viewAverage,
      ),
      scoreLabel,
      qualityBadges: getAdminDashboardVideoQualityBadges(reboundCandidate.video),
    });
  }

  if (
    typeof subscriberDelta === "number" &&
    subscriberDelta > 0 &&
    strongestContribution
  ) {
    insights.push({
      label: "구독자 기여 후보",
      title: strongestContribution.video.title,
      description: `구독자 ${formatSignedNumber(
        subscriberDelta,
      )} 기간의 성과 ${metricNoun} 1위 후보`,
      tone: "primary",
      score: Math.max(8, Math.min(100, strongestContributionScore)),
      scoreLabel: `구독자 ${formatSignedNumber(subscriberDelta)}`,
      qualityBadges: getAdminDashboardVideoQualityBadges(strongestContribution.video),
    });
  }

  const addFallbackInsight = (insight: AdminDashboardContentInsight) => {
    if (insights.length >= ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT) return;
    if (insights.some((existing) => existing.label === insight.label)) return;
    insights.push(insight);
  };

  const newestCandidate = [...metricRows].sort(
    (a, b) => (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity),
  )[0];

  if (newestCandidate) {
    const scoreLabel = formatDashboardAverageComparison(
      newestCandidate.viewsPerDay,
      dailyViewAverage,
    );

    addFallbackInsight({
      label: "신규 반응 확인",
      title: newestCandidate.video.title,
      description: `업로드 ${Math.round(newestCandidate.ageDays ?? 0)}일 · 일평균 조회 ${scoreLabel}`,
      tone: "warning",
      score: getDashboardInsightSignalScore(
        newestCandidate.viewsPerDay,
        dailyViewAverage,
      ),
      scoreLabel,
      qualityBadges: getAdminDashboardVideoQualityBadges(newestCandidate.video),
    });
  }

  return insights.slice(0, ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT);
}

function getDashboardRatio(
  numerator: number | null,
  denominator: number | null,
) {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return (numerator / denominator) * 100;
}

function getDashboardChangeProgress(change: number | null) {
  if (typeof change !== "number" || !Number.isFinite(change)) {
    return 50;
  }

  return clampDashboardPercent(50 + change * 2);
}

const adminDashboardCardClass =
  "min-h-0 min-w-0 w-full overflow-hidden border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.06)]";

const adminDashboardChartMargin = { top: 10, right: 10, bottom: 2, left: 0 };
const adminDashboardScatterChartMargin = {
  top: 10,
  right: 12,
  bottom: 2,
  left: 0,
};
const adminDashboardVisualizationShellClassName =
  "min-h-0 flex-1 overflow-hidden rounded-xl p-1 sm:p-1.5";
const adminDashboardChartViewportClassName =
  "relative h-full min-h-0 w-full overflow-visible [&_.recharts-surface]:overflow-visible [&_.recharts-wrapper]:overflow-visible";
const adminDashboardTooltipWrapperStyle = {
  zIndex: 50,
  pointerEvents: "none",
} satisfies CSSProperties;
const adminDashboardTooltipContentClassName =
  "max-w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover px-2.5 py-1.5 text-xs leading-4 text-popover-foreground shadow-xl";
const adminDashboardTooltipPortalClassName =
  "border-0 bg-transparent p-0 text-popover-foreground shadow-none";
const adminDashboardTooltipLineClassName =
  "whitespace-normal break-keep text-muted-foreground [text-wrap:pretty]";
const adminDashboardTooltipFirstLineClassName =
  "font-extrabold text-foreground";
const adminDashboardGridColor = "hsl(var(--border) / 0.55)";
const adminDashboardAxisColor = "hsl(var(--muted-foreground))";
const adminDashboardFocusPalette = {
  primary: "#14b8a6",
  primarySoft: "#5eead4",
  primaryFaint: "#99f6e4",
  reach: "#38a5db",
  muted: "#94a3b8",
  mutedStrong: "#64748b",
  warning: "#f59e0b",
  risk: "#f43f5e",
} as const;
const adminDashboardControlGroupClassName =
  "inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/25 p-0.5";
const adminDashboardControlButtonClassName =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-extrabold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const adminDashboardFullscreenCardClassName =
  "fixed inset-2 z-[80] h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] overflow-auto scrollbar-hide rounded-3xl border-primary/35 bg-card p-4 shadow-2xl sm:inset-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]";

function formatRechartsTooltipValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? formatCompactNumber(value)
    : String(value ?? "—");
}

type AdminDashboardLineTooltipPayload = {
  color?: string;
  name?: string | number;
  value?: string | number;
  payload?: unknown;
};

type AdminDashboardLineTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: AdminDashboardLineTooltipPayload[];
};

type AdminDashboardTooltipPanelRow = {
  label: string;
  value: ReactNode;
  note?: string;
  color?: string;
};

function AdminDashboardTooltipPanel({
  title,
  descriptionLines,
  rows,
  footer,
  dataAttribute,
  className,
}: {
  title: ReactNode;
  descriptionLines?: string[];
  rows?: AdminDashboardTooltipPanelRow[];
  footer?: string;
  dataAttribute?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        adminDashboardTooltipContentClassName,
        "min-w-44 space-y-1",
        className,
      )}
      data-admin-dashboard-tooltip-content="standard"
      data-admin-dashboard-tooltip-kind={dataAttribute}
    >
      <p className={adminDashboardTooltipFirstLineClassName}>{title}</p>
      {descriptionLines?.length ? (
        <div className="grid gap-0.5">
          {descriptionLines.map((line, index) => (
            <p
              key={`${line}-${index}`}
              className={adminDashboardTooltipLineClassName}
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {rows?.length ? (
        <div className="grid gap-0.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-0"
            >
              {row.color ? (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="h-2 w-2 rounded-full bg-muted"
                  aria-hidden="true"
                />
              )}
              <span className="truncate font-bold text-foreground">
                {row.label}
              </span>
              <span className="font-black tabular-nums text-foreground">
                {row.value}
              </span>
              {row.note ? (
                <span className="col-start-2 col-end-4 truncate text-[10px] font-semibold leading-3 text-muted-foreground">
                  {row.note}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {footer ? (
        <p className="border-t border-border/70 pt-0.5 text-[10px] font-semibold leading-3 text-muted-foreground [text-wrap:pretty]">
          {footer}
        </p>
      ) : null}
    </div>
  );
}

function AdminDashboardTooltipLinesPanel({
  lines,
  dataAttribute,
  className,
}: {
  lines: string[];
  dataAttribute?: string;
  className?: string;
}) {
  const [title = "설명", ...details] = lines;
  const formulaIndex = details.findIndex((line) => line.startsWith("계산식:"));
  const footer = formulaIndex >= 0 ? details[formulaIndex] : undefined;
  const descriptionLines = details.filter((_, index) => index !== formulaIndex);

  return (
    <AdminDashboardTooltipPanel
      title={title}
      descriptionLines={descriptionLines}
      footer={footer}
      dataAttribute={dataAttribute}
      className={className}
    />
  );
}

function AdminDashboardKpiSparklineTooltip({
  active,
  label,
  payload,
  title,
}: AdminDashboardLineTooltipProps & { title: string }) {
  const value = payload?.[0]?.value;
  if (!active || value == null) return null;

  return (
    <AdminDashboardTooltipPanel
      title={`${title} · ${String(label ?? "기간")}`}
      rows={[
        {
          label: "값",
          value: formatRechartsTooltipValue(value),
          note: "해당 지점의 카드 값",
          color: payload?.[0]?.color,
        },
      ]}
      footer="계산식: 점 값 = 해당 기간의 카드 값."
      dataAttribute="kpi-sparkline"
    />
  );
}

const adminDashboardTrendTooltipLabels: Record<string, string> = {
  조회수: "조회수",
  참여: "참여",
  참여율: "참여율",
};

const adminDashboardTrendTooltipNotes: Record<string, string> = {
  조회수: "영상 조회수 기준",
  참여: "좋아요+댓글 기준",
  참여율: "조회수 대비 참여 기준",
};

function AdminDashboardTrendTooltip({
  active,
  label,
  payload,
}: AdminDashboardLineTooltipProps) {
  if (!active || !payload?.length) return null;

  const rows = payload.filter(
    (item) =>
      typeof item.name === "string" &&
      item.name in adminDashboardTrendTooltipLabels,
  );

  if (rows.length === 0) return null;

  return (
    <AdminDashboardTooltipPanel
      title={String(label ?? "날짜 없음")}
      rows={rows.map((item) => {
        const name = String(item.name);

        return {
          label: adminDashboardTrendTooltipLabels[name] ?? name,
          value: `${formatRechartsTooltipValue(item.value)}점`,
          note: adminDashboardTrendTooltipNotes[name],
          color: item.color,
        };
      })}
      footer="100점은 선택 기간에서 해당 지표가 가장 큰 영상입니다."
      dataAttribute="trend-simple"
    />
  );
}

function AdminDashboardInfoTooltip({
  label,
  lines,
}: {
  label: string;
  lines: string[];
}) {
  return (
    <UiTooltipProvider delayDuration={150}>
      <UiTooltip>
        <UiTooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`${label} · 초보자 설명`}
            data-admin-dashboard-metric-tooltip="beginner-plain"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </UiTooltipTrigger>
        <UiTooltipContent
          side="top"
          align="start"
          className={adminDashboardTooltipPortalClassName}
        >
          <AdminDashboardTooltipLinesPanel
            lines={lines}
            dataAttribute="metric-info"
          />
        </UiTooltipContent>
      </UiTooltip>
    </UiTooltipProvider>
  );
}

function AdminDashboardInlineTooltip({
  label,
  lines,
  className,
  style,
  rankSegment,
  children,
}: {
  label: string;
  lines: string[];
  className?: string;
  style?: CSSProperties;
  rankSegment?: number;
  children: ReactNode;
}) {
  return (
    <UiTooltipProvider delayDuration={120}>
      <UiTooltip>
        <UiTooltipTrigger asChild>
          <span
            tabIndex={0}
            className={className}
            style={style}
            aria-label={`${label}: ${lines.join(" ")}`}
            data-admin-dashboard-inline-tooltip="true"
            data-admin-dashboard-rank-segment={rankSegment}
          >
            {children}
          </span>
        </UiTooltipTrigger>
        <UiTooltipContent
          side="top"
          align="start"
          className={adminDashboardTooltipPortalClassName}
        >
          <AdminDashboardTooltipLinesPanel
            lines={lines}
            dataAttribute="inline-info"
          />
        </UiTooltipContent>
      </UiTooltip>
    </UiTooltipProvider>
  );
}

function AdminDashboardViewToggle({
  value,
  onChange,
  label,
}: {
  value: AdminDashboardCardView;
  onChange: (value: AdminDashboardCardView) => void;
  label: string;
}) {
  return (
    <div
      className={cn(adminDashboardControlGroupClassName, "overflow-hidden")}
      aria-label={`${label} 보기 방식`}
      data-admin-dashboard-card-view-toggle="true"
    >
      {(["chart", "table"] as const).map((view) => (
        <button
          key={view}
          type="button"
          className={cn(
            adminDashboardControlButtonClassName,
            "text-muted-foreground hover:text-foreground",
            value === view && "bg-background text-foreground shadow-sm",
          )}
          aria-pressed={value === view}
          onClick={() => onChange(view)}
        >
          {view === "chart" ? "그래프" : "표"}
        </button>
      ))}
    </div>
  );
}

function AdminDashboardFullscreenButton({
  widgetId,
  label,
  isFullscreen,
  onToggle,
}: {
  widgetId: AdminDashboardWidgetId;
  label: string;
  isFullscreen: boolean;
  onToggle: (widgetId: AdminDashboardWidgetId) => void;
}) {
  const Icon = isFullscreen ? Minimize2 : Maximize2;

  return (
    <button
      type="button"
      className={cn(
        adminDashboardControlButtonClassName,
        "h-7 w-7 border border-border bg-background p-0 text-muted-foreground shadow-sm hover:text-foreground",
        isFullscreen && "border-primary/50 text-primary",
      )}
      aria-label={`${label} 카드 ${isFullscreen ? "전체화면 닫기" : "전체화면으로 보기"}`}
      aria-pressed={isFullscreen}
      data-admin-dashboard-card-fullscreen-trigger={widgetId}
      onClick={() => onToggle(widgetId)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function AdminDashboardDiagnosisMeta({ periodLabel }: { periodLabel: string }) {
  return (
    <div
      className="hidden min-w-0 max-w-[28rem] items-center justify-end gap-1.5 text-[11px] font-bold leading-none text-muted-foreground lg:flex"
      aria-label={`성과 진단 기준 ${periodLabel}, 비교 채널 평균`}
      data-admin-dashboard-diagnosis-meta="header-inline"
    >
      <span className="min-w-0 truncate">
        기준 <b className="font-black text-foreground">{periodLabel}</b>
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">
        비교 <b className="font-black text-foreground">채널 평균</b>
      </span>
    </div>
  );
}

function AdminDashboardSeriesToggle<Key extends string>({
  label,
  options,
  visibility,
  onToggle,
}: {
  label: string;
  options: Array<{
    key: Key;
    label: string;
    dotClassName: string;
  }>;
  visibility: AdminDashboardSeriesVisibility<Key>;
  onToggle: (key: Key) => void;
}) {
  const visibleCount = options.filter(
    (option) => visibility[option.key],
  ).length;

  return (
    <div
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-full border border-transparent bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      aria-label={`${label} 지표 숨김/보임`}
      data-admin-dashboard-series-toggle="true"
      data-allow-horizontal-scroll="true"
      data-horizontal-scroll-owner="admin-dashboard-series-toggle"
    >
      {options.map((option) => {
        const isVisible = visibility[option.key];
        const isLastVisible = isVisible && visibleCount <= 1;

        return (
          <button
            key={option.key}
            type="button"
            className={cn(
              adminDashboardControlButtonClassName,
              "shrink-0 border",
              isVisible
                ? "border-border bg-background text-foreground shadow-sm"
                : "border-transparent bg-muted/35 text-muted-foreground hover:text-foreground",
              isLastVisible && "cursor-not-allowed opacity-70",
            )}
            aria-pressed={isVisible}
            aria-label={`${option.label} ${isVisible ? "숨기기" : "보이기"}`}
            disabled={isLastVisible}
            onClick={() => onToggle(option.key)}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                option.dotClassName,
              )}
              aria-hidden="true"
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AdminDashboardImpactRankLegend() {
  const rankLegendColors = [
    "bg-teal-500",
    "bg-teal-500/75",
    "bg-teal-500/55",
    "bg-muted-foreground/40",
    "bg-muted-foreground/25",
  ];

  return (
    <div
      className={cn(
        adminDashboardControlGroupClassName,
        "gap-1 px-2.5 text-[11px] font-extrabold leading-none text-muted-foreground shadow-sm",
      )}
      aria-label="상위 영상 영향도 색상 범례: 순위 구분"
      data-admin-dashboard-rank-legend="impact"
    >
      <span>순위 구분</span>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {rankLegendColors.map((className, index) => (
          <span
            key={`${className}-${index}`}
            className={cn("h-2 w-2 rounded-full", className)}
          />
        ))}
      </span>
    </div>
  );
}

type AdminDashboardTableColumn<Row> = {
  key: string;
  header: string;
  cell: (row: Row, index: number) => ReactNode;
  align?: "left" | "right";
  className?: string;
};

function AdminDashboardScrollTable<Row>({
  rows,
  columns,
  getRowKey,
  emptyText,
  totalRows = rows.length,
}: {
  rows: Row[];
  columns: Array<AdminDashboardTableColumn<Row>>;
  getRowKey: (row: Row, index: number) => string;
  emptyText: string;
  totalRows?: number;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/80 bg-background text-xs font-semibold text-muted-foreground"
        data-admin-dashboard-table-view="true"
      >
        {emptyText}
      </div>
    );
  }

  const hasMoreRows = rows.length < totalRows;

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide rounded-xl border border-border/70 bg-background"
      data-admin-dashboard-table-view="true"
      data-admin-dashboard-progressive-table="true"
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "min-w-0 border-b border-border/70 px-2.5 py-2 text-left text-[11px] font-extrabold text-muted-foreground",
                  column.align === "right" && "text-right",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={getRowKey(row, rowIndex)} className="odd:bg-muted/20">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "min-w-0 border-b border-border/45 px-2.5 py-2 align-middle text-foreground last:border-b-0",
                    column.align === "right" &&
                      "text-right font-extrabold tabular-nums",
                    column.className,
                  )}
                >
                  {column.cell(row, rowIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMoreRows ? (
        <div className="sticky bottom-0 border-t border-border/70 bg-background/95 px-2.5 py-1.5 text-right text-[11px] font-extrabold tabular-nums text-muted-foreground backdrop-blur">
          추가 행 표시 중 {formatNumber(rows.length)}/{formatNumber(totalRows)}
        </div>
      ) : null}
    </div>
  );
}

function AdminDashboardKpiValueSkeleton() {
  return (
    <div
      className="flex min-h-0 min-w-0 items-center justify-between gap-3"
      data-admin-dashboard-dynamic-skeleton="kpi"
      aria-hidden="true"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-8 w-32 max-w-full rounded-full motion-reduce:animate-none" />
        <Skeleton className="h-3 w-24 max-w-full rounded-full motion-reduce:animate-none" />
      </div>
      <Skeleton className="h-11 w-24 shrink-0 rounded-xl motion-reduce:animate-none" />
    </div>
  );
}

function AdminDashboardPanelBodySkeleton({
  variant = "chart",
}: {
  variant?: AdminDashboardSkeletonVariant;
}) {
  if (variant === "table") {
    return (
      <div
        className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-xl border border-border/70 bg-background p-3"
        data-admin-dashboard-dynamic-skeleton="table"
        aria-hidden="true"
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] gap-3"
          >
            <Skeleton className="h-4 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-4 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-4 rounded-full motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "ops") {
    return (
      <div
        className="grid min-h-0 flex-1 gap-3"
        data-admin-dashboard-dynamic-skeleton="ops"
        aria-hidden="true"
      >
        {Array.from({ length: 2 }).map((_, sectionIndex) => (
          <div key={sectionIndex} className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-20 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-4 w-12 rounded-full motion-reduce:animate-none" />
            </div>
            {Array.from({ length: 4 }).map((__, rowIndex) => (
              <div
                key={rowIndex}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2"
              >
                <Skeleton className="h-3 rounded-full motion-reduce:animate-none" />
                <Skeleton className="h-2 rounded-full motion-reduce:animate-none" />
                <Skeleton className="h-3 rounded-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (variant === "bubble") {
    return (
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-background p-3"
        data-admin-dashboard-dynamic-skeleton="bubble"
        aria-hidden="true"
      >
        <div className="absolute inset-x-5 bottom-10 h-px bg-border/60" />
        <div className="absolute inset-y-5 left-10 w-px bg-border/60" />
        {[
          ["left-[9%] top-[58%] h-10 w-10", "bg-teal-100 dark:bg-teal-950/45"],
          ["left-[25%] top-[38%] h-14 w-14", "bg-teal-100/80 dark:bg-teal-950/35"],
          [
            "left-[43%] top-[52%] h-11 w-11",
            "bg-teal-100/60 dark:bg-teal-950/25",
          ],
          [
            "left-[62%] top-[30%] h-16 w-16",
            "bg-muted-foreground/20 dark:bg-muted-foreground/18",
          ],
          [
            "left-[78%] top-[62%] h-9 w-9",
            "bg-muted-foreground/10 dark:bg-muted-foreground/12",
          ],
        ].map(([positionClassName, colorClassName], index) => (
          <Skeleton
            key={index}
            className={cn(
              "absolute rounded-full motion-reduce:animate-none",
              positionClassName,
              colorClassName,
            )}
          />
        ))}
      </div>
    );
  }

  if (variant === "line") {
    return (
      <div
        className="min-h-0 flex-1 rounded-xl border border-border/70 bg-background p-3"
        data-admin-dashboard-dynamic-skeleton="line"
        aria-hidden="true"
      >
        <div className="relative h-full min-h-[8rem] overflow-hidden">
          <div className="absolute inset-x-1 top-1/4 h-px bg-border/50" />
          <div className="absolute inset-x-1 top-1/2 h-px bg-border/50" />
          <div className="absolute inset-x-1 top-3/4 h-px bg-border/50" />
          <svg
            className="absolute inset-0 h-full w-full text-muted/80"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            focusable="false"
          >
            <polyline
              points="2,68 18,44 34,58 50,30 66,48 82,24 98,38"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="2,48 18,56 34,34 50,52 66,26 82,45 98,28"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.62"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="2,75 18,72 34,82 50,61 66,70 82,54 98,63"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.42"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton
              key={index}
              className="absolute bottom-0 h-2 w-2 rounded-full motion-reduce:animate-none"
              style={{ left: `${7 + index * 17}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "stacked") {
    return (
      <div
        className="grid min-h-0 flex-1 content-evenly gap-2 overflow-hidden rounded-xl border border-border/70 bg-background p-3"
        data-admin-dashboard-dynamic-skeleton="stacked"
        aria-hidden="true"
      >
        {Array.from({ length: 3 }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-16 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-3 w-24 rounded-full motion-reduce:animate-none" />
            </div>
            <div className="flex h-9 overflow-hidden rounded-xl bg-muted/40">
              {[28, 23, 19, 17, 13].map((width, segmentIndex) => (
                <Skeleton
                  key={segmentIndex}
                  className="h-full rounded-none motion-reduce:animate-none"
                  style={{
                    width: `${width + ((rowIndex + segmentIndex) % 3)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "diagnosis") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1"
        data-admin-dashboard-dynamic-skeleton="diagnosis"
        aria-hidden="true"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5"
          >
            <Skeleton className="h-4 w-20 rounded-full motion-reduce:animate-none" />
            <div className="space-y-1">
              <Skeleton className="h-3 w-full rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-3 w-3/4 rounded-full motion-reduce:animate-none" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 rounded-xl border border-border/70 bg-background p-3"
      data-admin-dashboard-dynamic-skeleton="chart"
      aria-hidden="true"
    >
      <div className="flex h-full min-h-[8rem] items-end gap-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton
            key={index}
            className="flex-1 rounded-t-xl motion-reduce:animate-none"
            style={{ height: `${36 + ((index * 17) % 48)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function AdminDashboardManagementSkeleton() {
  const placeholderInfoLines = ["설명: 관리자 KPI 데이터를 불러오는 중입니다."];

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:min-h-0 lg:overflow-visible"
      aria-label="관리자 대시보드 (KPI) 로딩 중"
      data-admin-dashboard-management-skeleton="true"
      data-layout-recipe="command-surface"
      role="status"
      aria-busy="true"
    >
      <div className="mb-2 flex shrink-0 flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="hidden min-w-0 md:block">
          <h1 className="text-xl font-extrabold leading-tight tracking-[0.01em] text-foreground text-balance">
            Tzuyang KPI Dashboard
          </h1>
        </div>
        <div
          className="flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pb-1 scrollbar-hide [scrollbar-width:none] md:w-auto md:flex-wrap md:items-start md:justify-end md:overflow-visible md:pb-0 md:gap-1 [&::-webkit-scrollbar]:hidden"
          data-admin-dashboard-action-bar="true"
          data-admin-dashboard-action-order="order-reset-report-collection-period"
          data-allow-horizontal-scroll="true"
          data-horizontal-scroll-owner="admin-dashboard-action-bar"
        >
          <div
            className="order-1 flex shrink-0 items-center justify-end gap-1"
            data-admin-dashboard-action-group="order"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-full px-2 text-[11px]"
              disabled
            >
              카드 순서
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-full px-2 text-[11px]"
              disabled
            >
              초기화
            </Button>
          </div>
          <div
            className="order-2 flex shrink-0 items-center justify-end gap-1"
            data-admin-dashboard-action-group="report"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 rounded-full px-2 text-[11px] font-bold"
              disabled
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">PDF 보고서</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 shrink-0 rounded-full p-0"
              aria-label="데이터 수집 상태 로딩 중"
              disabled
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="order-3 h-7 shrink-0 gap-1 rounded-full px-2 text-[11px] font-bold text-muted-foreground md:hidden"
            aria-label="대시보드 타임프레임 로딩 중: 1개월"
            disabled
          >
            <span className="text-muted-foreground">기간</span>
            <span className="text-foreground">1개월</span>
          </Button>
          <div
            className="order-3 hidden shrink-0 flex-wrap justify-end gap-1 md:flex"
            aria-label="대시보드 타임프레임 로딩 중"
          >
            {ADMIN_DASHBOARD_PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={option.value === "1M" ? "default" : "outline"}
                size="sm"
                className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                aria-pressed={option.value === "1M"}
                disabled
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <p
        className="mb-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[11px] font-semibold leading-5 text-muted-foreground md:hidden"
        data-admin-dashboard-mobile-loading-prompt="true"
      >
        KPI 데이터를 불러오는 중입니다. 모바일에서는 핵심 카드부터 순서대로 표시됩니다.
      </p>

      <div className="grid min-w-0 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-10 lg:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-visible">
        <AdminDashboardKpiCard
          widgetId="subscribers"
          title="현재 구독자"
          value="—"
          progress={0}
          tone="neutral"
          className="lg:col-span-2"
          delta="—"
          deltaLabel="기간 대비"
          isLoading
          infoLines={placeholderInfoLines}
        />
        <AdminDashboardKpiCard
          widgetId="views"
          title="기간 조회 합계"
          value="—"
          progress={0}
          tone="neutral"
          className="lg:col-span-2"
          delta="—"
          deltaLabel="기간 대비"
          isLoading
          infoLines={placeholderInfoLines}
        />
        <AdminDashboardKpiCard
          widgetId="likes"
          title="기간 좋아요 합계"
          value="—"
          progress={0}
          tone="neutral"
          className="lg:col-span-2"
          delta="—"
          deltaLabel="기간 대비"
          isLoading
          infoLines={placeholderInfoLines}
        />
        <AdminDashboardKpiCard
          widgetId="comments"
          title="기간 댓글 합계"
          value="—"
          progress={0}
          tone="neutral"
          className="lg:col-span-2"
          delta="—"
          deltaLabel="기간 대비"
          isLoading
          infoLines={placeholderInfoLines}
        />
        <AdminDashboardKpiCard
          widgetId="videos"
          title="업로드 영상 수"
          value="—"
          progress={0}
          tone="neutral"
          className="lg:col-span-2"
          delta="—"
          deltaLabel="기간 대비"
          isLoading
          infoLines={placeholderInfoLines}
        />

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-3",
          )}
          data-admin-dashboard-skeleton-card="impact"
        >
          <AdminDashboardCardTitle
            title="상위 영상 영향도"
            metric="현재값 기준 · 전체 0개"
            infoLines={placeholderInfoLines}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardImpactRankLegend />
                <AdminDashboardViewToggle
                  value="chart"
                  onChange={() => undefined}
                  label="상위 영상 영향도"
                />
              </div>
            }
          />
          <AdminDashboardPanelBodySkeleton variant="bubble" />
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-4",
          )}
          data-admin-dashboard-skeleton-card="trend"
        >
          <AdminDashboardCardTitle
            title="영상별 성과 분포"
            metric="현재값 기준 · 전체 0개"
            infoLines={placeholderInfoLines}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardSeriesToggle
                  label="영상별 성과 분포"
                  options={[
                    {
                      key: "views",
                      label: "조회수",
                      dotClassName: "bg-teal-500",
                    },
                    {
                      key: "engagement",
                      label: "참여",
                      dotClassName: "bg-muted-foreground/45",
                    },
                    {
                      key: "engagementRate",
                      label: "참여율",
                      dotClassName: "bg-amber-500",
                    },
                  ]}
                  visibility={DEFAULT_ADMIN_DASHBOARD_TREND_SERIES_VISIBILITY}
                  onToggle={() => undefined}
                />
                <AdminDashboardViewToggle
                  value="chart"
                  onChange={() => undefined}
                  label="영상별 성과 분포"
                />
              </div>
            }
          />
          <AdminDashboardPanelBodySkeleton variant="line" />
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col p-3 text-xs sm:col-span-2 lg:col-span-3",
          )}
          data-admin-dashboard-skeleton-card="ops"
        >
          <AdminDashboardCardTitle
            title="운영·검수 요약"
            metric="검수 리스크 0"
            infoLines={placeholderInfoLines}
            action={
              <AdminDashboardViewToggle
                value="chart"
                onChange={() => undefined}
                label="운영·검수 요약"
              />
            }
          />
          <AdminDashboardPanelBodySkeleton variant="ops" />
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[220px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-5",
          )}
          data-admin-dashboard-skeleton-card="topContent"
        >
          <AdminDashboardCardTitle
            title="콘텐츠 성과 TOP 5"
            metric="선택 영상 0개"
            infoLines={placeholderInfoLines}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardSeriesToggle
                  label="콘텐츠 성과 TOP 5"
                  options={[
                    {
                      key: "views",
                      label: "조회수",
                      dotClassName: "bg-teal-500",
                    },
                    {
                      key: "likes",
                      label: "좋아요",
                      dotClassName: "bg-muted-foreground/45",
                    },
                    {
                      key: "comments",
                      label: "댓글",
                      dotClassName: "bg-muted-foreground/30",
                    },
                  ]}
                  visibility={
                    DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY
                  }
                  onToggle={() => undefined}
                />
                <AdminDashboardViewToggle
                  value="chart"
                  onChange={() => undefined}
                  label="콘텐츠 성과 TOP 5"
                />
              </div>
            }
          />
          <AdminDashboardPanelBodySkeleton variant="stacked" />
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[220px] flex-col overflow-hidden p-2 sm:col-span-2 lg:col-span-5",
          )}
          data-admin-dashboard-skeleton-card="engagementRate"
        >
          <AdminDashboardCardTitle
            title="성과 진단"
            metric="진단 신호 0개 · 선택 영상 0개"
            infoLines={placeholderInfoLines}
            action={
              <div className="ml-auto flex min-w-fit shrink-0 flex-nowrap items-center gap-2">
                <AdminDashboardDiagnosisMeta periodLabel="1개월" />
                <AdminDashboardViewToggle
                  value="chart"
                  onChange={() => undefined}
                  label="성과 진단"
                />
              </div>
            }
          />
          <AdminDashboardPanelBodySkeleton variant="diagnosis" />
        </div>
      </div>
    </section>
  );
}

function AdminDashboardCardTitle({
  title,
  metric,
  infoLines,
  action,
}: {
  title: string;
  metric?: string;
  infoLines: string[];
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 grid min-w-0 shrink-0 gap-2">
      <div
        className="flex min-w-0 items-center justify-between gap-2 overflow-hidden"
        data-admin-dashboard-card-title-row="single-line"
      >
        <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5">
          <p className="truncate whitespace-nowrap text-xs font-extrabold leading-none text-foreground">
            {title}
            {metric ? (
              <span
                className="ml-1 font-extrabold text-muted-foreground"
                data-admin-dashboard-card-title-delta="true"
              >
                ({metric})
              </span>
            ) : null}
          </p>
          <AdminDashboardInfoTooltip
            label={`${title} 축과 산정 방식 설명`}
            lines={infoLines}
          />
        </div>
        {action ? (
          <div
            className="ml-auto flex max-w-[52%] min-w-0 shrink-0 items-center overflow-x-auto [scrollbar-width:none] sm:max-w-none sm:min-w-fit [&::-webkit-scrollbar]:hidden"
            data-allow-horizontal-scroll="true"
            data-horizontal-scroll-owner="admin-dashboard-card-title-actions"
            data-admin-dashboard-card-title-actions="single-line-scroll"
          >
            {action}
          </div>
        ) : null}
      </div>
      <div className="h-px bg-border/70" aria-hidden="true" />
    </div>
  );
}
function AdminDashboardQualityBadges({
  badges,
  maxVisible = 2,
}: {
  badges?: AdminDashboardDataQualityBadge[];
  maxVisible?: number;
}) {
  const visibleBadges = (badges ?? []).slice(0, maxVisible);
  if (visibleBadges.length === 0) return null;

  const toneClass = {
    info: "border-muted-foreground/20 bg-muted/35 text-muted-foreground",
    warning: "border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
    risk: "border-rose-500/30 bg-rose-50 text-rose-800 dark:bg-rose-950/25 dark:text-rose-200",
  } satisfies Record<AdminDashboardDataQualityBadge["severity"], string>;

  return (
    <span
      className="ml-1 inline-flex max-w-full flex-wrap items-center gap-1 align-middle"
      data-admin-dashboard-anomaly-badges="true"
    >
      {visibleBadges.map((badge, index) => (
        <AdminDashboardInlineTooltip
          key={`${badge.label}-${badge.description}-${index}`}
          label={`${badge.label} 데이터 신호`}
          lines={[badge.description]}
          className={cn(
            "inline-flex max-w-[7rem] items-center rounded-full border px-1.5 py-0.5 text-[10px] font-black leading-none outline-none focus-visible:ring-2 focus-visible:ring-primary",
            toneClass[badge.severity],
          )}
        >
          <span className="truncate">{badge.label}</span>
        </AdminDashboardInlineTooltip>
      ))}
    </span>
  );
}


function AdminDashboardKpiCard({
  widgetId,
  title,
  value,
  caption,
  progress,
  delta,
  deltaLabel = "기간 대비",
  className,
  style,
  reorderProps,
  tone = "teal",
  emphasis = "supporting",
  sparklineData = [],
  infoLines = [],
  isLoading = false,
  isFullscreen = false,
  fullscreenAction,
}: {
  widgetId: AdminDashboardWidgetId;
  title: string;
  value: string;
  caption?: string;
  progress: number;
  delta?: string;
  deltaLabel?: string;
  className?: string;
  style?: CSSProperties;
  reorderProps?: AdminDashboardCardReorderProps;
  tone?: "sky" | "teal" | "amber" | "rose" | "neutral";
  emphasis?: "primary" | "supporting";
  sparklineData?: AdminDashboardSparklinePoint[];
  infoLines?: string[];
  isLoading?: boolean;
  isFullscreen?: boolean;
  fullscreenAction?: ReactNode;
}) {
  const safeProgress = clampDashboardPercent(progress);
  const toneClass = {
    sky: {
      bar: "bg-sky-500 dark:bg-sky-400",
      text: "text-sky-700 dark:text-sky-300",
      stroke: adminDashboardFocusPalette.reach,
    },
    teal: {
      bar: "bg-teal-500 dark:bg-teal-400",
      text: "text-teal-700 dark:text-teal-300",
      stroke: adminDashboardFocusPalette.primary,
    },
    amber: {
      bar: "bg-amber-500 dark:bg-amber-400",
      text: "text-amber-700 dark:text-amber-300",
      stroke: adminDashboardFocusPalette.warning,
    },
    rose: {
      bar: "bg-rose-500 dark:bg-rose-400",
      text: "text-rose-700 dark:text-rose-300",
      stroke: adminDashboardFocusPalette.risk,
    },
    neutral: {
      bar: "bg-muted-foreground/55",
      text: "text-muted-foreground",
      stroke: adminDashboardFocusPalette.muted,
    },
  }[tone];
  const emphasisClass = {
    primary:
      "border-sky-500/35 bg-sky-50/20 dark:border-sky-400/45 dark:bg-sky-950/20",
    supporting: undefined,
  }[emphasis];
  const cursorStrokeOpacity = emphasis === "primary" ? 0.45 : 0.32;
  const sparklineFillOpacity = emphasis === "primary" ? 0.36 : 0.24;
  const chartData = sparklineData.filter((point) =>
    Number.isFinite(point.value),
  );

  return (
    <div
      className={cn(
        adminDashboardCardClass,
        "relative z-0 grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-visible p-3 sm:p-3.5 hover:z-20 focus-within:z-20",
        emphasisClass,
        className,
        isFullscreen && adminDashboardFullscreenCardClassName,
      )}
      data-admin-dashboard-kpi-card="recharts-sparkline"
      data-admin-dashboard-widget-card={widgetId}
      data-admin-dashboard-kpi-emphasis={emphasis}
      data-admin-dashboard-kpi-tone={tone}
      data-admin-dashboard-card-fullscreen={isFullscreen ? "true" : undefined}
      style={style}
      {...reorderProps}
    >
      <div className="grid gap-1.5">
        <div
          className="flex min-w-0 items-center justify-between gap-2 overflow-hidden"
          data-admin-dashboard-kpi-title-row="single-line"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <p className="truncate whitespace-nowrap text-xs font-extrabold tracking-[0.04em] text-muted-foreground">
              {title}
            </p>
            {infoLines.length > 0 ? (
              <AdminDashboardInfoTooltip
                label={`${title} 지표 설명`}
                lines={infoLines}
              />
            ) : null}
          </div>
          <div
            className="flex max-w-[56%] min-w-0 shrink-0 items-center justify-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-allow-horizontal-scroll="true"
            data-horizontal-scroll-owner="admin-dashboard-kpi-title-actions"
            data-admin-dashboard-kpi-title-actions="single-line-scroll"
          >
            {isLoading ? (
              <Skeleton
                className="h-5 w-20 shrink-0 rounded-full motion-reduce:animate-none"
                data-admin-dashboard-dynamic-skeleton="delta"
                aria-label={`${title} 기간 대비 로딩 중`}
              />
            ) : delta !== undefined ? (
              <AdminDashboardInlineTooltip
                label={`${title} ${deltaLabel}`}
                lines={[
                  `${title} ${deltaLabel}: ${delta}`,
                  "계산식: 기간 대비 = (현재값 - 이전값) / 이전값 × 100",
                ]}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/45 px-2 py-0.5 text-[11px] font-black leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-muted/35",
                  toneClass.text,
                )}
              >
                <span data-admin-dashboard-kpi-delta="timeframe">
                  <span className="font-extrabold text-muted-foreground">
                    {deltaLabel}
                  </span>{" "}
                  {delta}
                </span>
              </AdminDashboardInlineTooltip>
            ) : null}
            {fullscreenAction}
          </div>
        </div>
        <div className="h-px bg-border/70" aria-hidden="true" />
      </div>
      {isLoading ? (
        <AdminDashboardKpiValueSkeleton />
      ) : (
        <div className="flex min-h-0 min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="whitespace-nowrap text-lg font-black leading-none tracking-[-0.035em] tabular-nums text-foreground sm:text-xl"
              data-admin-dashboard-kpi-value-size="bounded"
            >
              {value}
            </p>
            {caption ? (
              <p className="mt-1.5 truncate text-[11px] font-semibold leading-none text-muted-foreground">
                {caption}
              </p>
            ) : null}
          </div>
          {chartData.length > 1 ? (
            <div
              className="h-11 w-24 shrink-0 overflow-visible [&_.recharts-surface]:overflow-visible [&_.recharts-wrapper]:overflow-visible"
              aria-hidden="true"
              data-admin-dashboard-kpi-sparkline="true"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 6, right: 2, bottom: 2, left: 2 }}
                >
                  <RechartsTooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    content={
                      <AdminDashboardKpiSparklineTooltip title={title} />
                    }
                    wrapperStyle={adminDashboardTooltipWrapperStyle}
                    cursor={{
                      stroke: toneClass.stroke,
                      strokeOpacity: cursorStrokeOpacity,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={toneClass.stroke}
                    strokeWidth={2}
                    fill={toneClass.stroke}
                    fillOpacity={sparklineFillOpacity}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      )}
      {isLoading ? (
        <Skeleton
          className="h-1.5 rounded-full motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <div className="grid gap-1.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className={cn("h-full rounded-full", toneClass.bar)}
              style={{ width: `${safeProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboardOpsSummaryCard({
  sections,
  className,
  style,
  reorderProps,
  view = "chart",
  onViewChange,
  isLoading = false,
}: {
  sections: Array<{
    title: string;
    rows: Array<{ label: string; value: string; rawValue: number | null }>;
    totalLabel: string;
    totalValue: string;
  }>;
  className?: string;
  style?: CSSProperties;
  reorderProps?: AdminDashboardCardReorderProps;
  view?: AdminDashboardCardView;
  onViewChange?: (value: AdminDashboardCardView) => void;
  isLoading?: boolean;
}) {
  const tableRows = sections.flatMap((section) =>
    section.rows.map((row) => ({
      section: section.title,
      label: row.label,
      value: row.value,
      rawValue: row.rawValue,
    })),
  );
  const riskTotal = sections.reduce(
    (sum, section) =>
      section.title === "검수 리스크"
        ? sum +
          section.rows.reduce((rowSum, row) => rowSum + (row.rawValue ?? 0), 0)
        : sum,
    0,
  );

  return (
    <div
      className={cn(
        adminDashboardCardClass,
        "flex h-full min-h-[320px] flex-col p-3 text-xs sm:min-h-[280px]",
        className,
      )}
      data-admin-dashboard-ops-summary-visual="progress-bars"
      data-admin-dashboard-widget-card="ops"
      style={style}
      {...reorderProps}
    >
      <AdminDashboardCardTitle
        title="운영·검수 요약"
        metric={`검수 리스크 ${formatNumber(riskTotal)}`}
        infoLines={[
          "설명: 위쪽은 운영 중인 데이터 수, 아래쪽은 확인이 필요한 데이터 수입니다.",
          "읽는 법: 막대는 같은 묶음 안에서 가장 큰 항목을 기준으로 얼마나 큰지 보여줍니다.",
          "막대 기준: 같은 묶음 안에서 가장 큰 항목을 100%로 두고 비교합니다.",
          "계산식: 검수 리스크 합계 = 제보 대기 + 추천 대기 + 리뷰 대기 + 좌표 미완료 + 비활성 배너.",
          "주의: 검수 리스크가 큰 항목부터 운영자가 먼저 확인해야 합니다.",
        ]}
        action={
          <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
            {onViewChange ? (
              <AdminDashboardViewToggle
                value={view}
                onChange={onViewChange}
                label="운영·검수 요약"
              />
            ) : null}
          </div>
        }
      />
      {isLoading ? (
        <AdminDashboardPanelBodySkeleton
          variant={view === "table" ? "table" : "ops"}
        />
      ) : view === "table" ? (
        <AdminDashboardScrollTable
          rows={tableRows}
          emptyText="표시할 운영·검수 데이터가 없습니다."
          getRowKey={(row) => `${row.section}-${row.label}`}
          columns={[
            {
              key: "section",
              header: "구분",
              className: "w-[34%]",
              cell: (row) => (
                <span className="block truncate font-bold text-muted-foreground">
                  {row.section}
                </span>
              ),
            },
            {
              key: "label",
              header: "항목",
              className: "w-[38%]",
              cell: (row) => (
                <span className="block truncate">{row.label}</span>
              ),
            },
            {
              key: "value",
              header: "값",
              align: "right",
              className: "w-[28%]",
              cell: (row) => row.value,
            },
          ]}
        />
      ) : (
        <div
          className={cn(
            adminDashboardVisualizationShellClassName,
            "grid content-stretch gap-2",
          )}
        >
          {sections.map((section, sectionIndex) => {
            const maxRawValue = Math.max(
              1,
              ...section.rows.map((row) => row.rawValue ?? 0),
            );
            const barTone =
              sectionIndex === 0
                ? "bg-muted-foreground/35"
                : "bg-rose-500 dark:bg-rose-400";
            const labelTone =
              sectionIndex === 0
                ? "text-muted-foreground"
                : "text-rose-700 dark:text-rose-300";

            return (
              <div key={section.title} className="grid min-h-0 gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p
                    className={cn("truncate text-xs font-extrabold", labelTone)}
                  >
                    {section.title}
                  </p>
                  <span className="shrink-0 text-xs font-black tabular-nums text-foreground">
                    {section.totalValue}
                  </span>
                </div>
                <div className="grid gap-2">
                  {section.rows.map((row) => {
                    const rowPercent = clampDashboardPercent(
                      ((row.rawValue ?? 0) / maxRawValue) * 100,
                    );

                    return (
                      <div
                        key={`${section.title}-${row.label}`}
                        className="grid grid-cols-[minmax(4.5rem,5.5rem)_minmax(0,1fr)_minmax(3.25rem,max-content)] items-center gap-2"
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {row.label}
                        </span>
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                          aria-hidden="true"
                        >
                          <div
                            className={cn("h-full rounded-full", barTone)}
                            style={{ width: `${rowPercent}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-right text-[12px] font-extrabold tabular-nums text-foreground sm:text-[13px]">
                          {row.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildAdminDashboardExtremeLabels(
  values: number[],
  formatValue: (value: number) => string,
) {
  const labels = values.map(() => ({ high: "", low: "" }));
  const finiteValues = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => Number.isFinite(value));

  if (finiteValues.length === 0) return labels;

  const maxValue = Math.max(...finiteValues.map(({ value }) => value));
  const minValue = Math.min(...finiteValues.map(({ value }) => value));
  const maxIndex = finiteValues.find(({ value }) => value === maxValue)?.index;
  const minIndex = [...finiteValues]
    .reverse()
    .find(({ value }) => value === minValue)?.index;

  if (typeof maxIndex === "number") {
    labels[maxIndex].high = `최고 ${formatValue(maxValue)}`;
  }

  if (typeof minIndex === "number" && minIndex !== maxIndex) {
    labels[minIndex].low = `최저 ${formatValue(minValue)}`;
  }

  return labels;
}

function AdminDashboardMultiLineChart({
  points,
  seriesVisibility,
  totalPointCount = points.length,
}: {
  points: AdminDashboardTrendPoint[];
  seriesVisibility: AdminDashboardSeriesVisibility<AdminDashboardTrendSeriesKey>;
  totalPointCount?: number;
}) {
  const isDenseChart = points.length > 80;
  const normalizeValues = (values: number[]) => {
    const maxSeriesValue = Math.max(1, ...values);
    return values.map((value) => Math.round((value / maxSeriesValue) * 100));
  };
  const viewIndex = normalizeValues(
    points.map((point) => point.secondaryValue),
  );
  const engagementIndex = normalizeValues(points.map((point) => point.value));
  const rateIndex = normalizeValues(
    points.map((point) =>
      point.secondaryValue > 0 ? (point.value / point.secondaryValue) * 100 : 0,
    ),
  );
  const viewExtremeLabels = buildAdminDashboardExtremeLabels(
    viewIndex,
    (value) => `${Math.round(value)}점`,
  );
  const engagementExtremeLabels = buildAdminDashboardExtremeLabels(
    engagementIndex,
    (value) => `${Math.round(value)}점`,
  );
  const rateExtremeLabels = buildAdminDashboardExtremeLabels(
    rateIndex,
    (value) => `${Math.round(value)}점`,
  );
  const chartData = points.map((point, index) => ({
    label: point.label,
    조회수: viewIndex[index] ?? 0,
    참여: engagementIndex[index] ?? 0,
    참여율: rateIndex[index] ?? 0,
    조회수최고: viewExtremeLabels[index]?.high ?? "",
    조회수최저: viewExtremeLabels[index]?.low ?? "",
    참여최고: engagementExtremeLabels[index]?.high ?? "",
    참여최저: engagementExtremeLabels[index]?.low ?? "",
    참여율최고: rateExtremeLabels[index]?.high ?? "",
    참여율최저: rateExtremeLabels[index]?.low ?? "",
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center bg-background text-xs font-semibold text-muted-foreground">
        표시할 추이 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div
      className={cn(
        adminDashboardVisualizationShellClassName,
        adminDashboardChartViewportClassName,
        "min-h-[190px] flex flex-1 flex-col",
      )}
      role="group"
      aria-label="영상별 성과 분포: 조회수, 참여, 참여율 정규화 비교"
      data-admin-dashboard-line-chart="recharts"
      data-admin-dashboard-progressive-chart="true"
    >
      <p className="sr-only">
        조회수, 참여, 참여율을 선택 기간 영상의 게시일 순서로 정규화해
        비교합니다. 현재 {formatNumber(points.length)}개를 표시하고 전체 대상은{" "}
        {formatNumber(totalPointCount)}개입니다. 사용자가 각 지표를 숨김/보임
        처리할 수 있습니다.
      </p>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%" minHeight={180}>
          <LineChart data={chartData} margin={adminDashboardChartMargin}>
            <CartesianGrid stroke={adminDashboardGridColor} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              height={18}
              tickMargin={2}
              minTickGap={12}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={2}
              width={28}
            />
            <RechartsTooltip
              content={<AdminDashboardTrendTooltip />}
              wrapperStyle={adminDashboardTooltipWrapperStyle}
              cursor={{ stroke: adminDashboardGridColor }}
            />
            {seriesVisibility.views ? (
              <Line
                type="monotone"
                dataKey="조회수"
                stroke={adminDashboardFocusPalette.primary}
                strokeWidth={2.4}
                dot={isDenseChart ? false : { r: 2.4 }}
                activeDot={{ r: isDenseChart ? 3 : 4 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="조회수최고"
                  position="top"
                  fill={adminDashboardFocusPalette.primary}
                  fontSize={10}
                  fontWeight={800}
                />
                <LabelList
                  dataKey="조회수최저"
                  position="bottom"
                  fill={adminDashboardFocusPalette.mutedStrong}
                  fontSize={10}
                  fontWeight={800}
                />
              </Line>
            ) : null}
            {seriesVisibility.engagement ? (
              <Line
                type="monotone"
                dataKey="참여"
                stroke={adminDashboardFocusPalette.muted}
                strokeWidth={2.4}
                dot={isDenseChart ? false : { r: 2.4 }}
                activeDot={{ r: isDenseChart ? 3 : 4 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="참여최고"
                  position="top"
                  fill={adminDashboardFocusPalette.mutedStrong}
                  fontSize={10}
                  fontWeight={800}
                />
                <LabelList
                  dataKey="참여최저"
                  position="bottom"
                  fill={adminDashboardFocusPalette.mutedStrong}
                  fontSize={10}
                  fontWeight={800}
                />
              </Line>
            ) : null}
            {seriesVisibility.engagementRate ? (
              <Line
                type="monotone"
                dataKey="참여율"
                stroke={adminDashboardFocusPalette.warning}
                strokeWidth={2.8}
                dot={isDenseChart ? false : { r: 2.6 }}
                activeDot={{ r: isDenseChart ? 3 : 4.2 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="참여율최고"
                  position="top"
                  fill={adminDashboardFocusPalette.warning}
                  fontSize={10}
                  fontWeight={900}
                />
                <LabelList
                  dataKey="참여율최저"
                  position="bottom"
                  fill={adminDashboardFocusPalette.warning}
                  fontSize={10}
                  fontWeight={900}
                />
              </Line>
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AdminDashboardBubbleChart({
  videos,
  metricMode = "current",
  displayLimit,
}: {
  videos: InsightTreemapVideoRow[];
  metricMode?: "current" | "delta";
  displayLimit: number;
}) {
  const topVideos = [...videos]
    .sort((a, b) => {
      if (metricMode === "delta") {
        return (
          getNonNegativeMetricDelta(getVideoViewDelta(b)) -
          getNonNegativeMetricDelta(getVideoViewDelta(a))
        );
      }

      return b.viewCount - a.viewCount;
    })
    .slice(0, displayLimit);
  const rawChartData = topVideos.map((video) => {
    const viewValue =
      metricMode === "delta"
        ? getNonNegativeMetricDelta(getVideoViewDelta(video))
        : video.viewCount;
    const engagementValue =
      metricMode === "delta"
        ? getNonNegativeMetricDelta(getVideoEngagementDelta(video))
        : getVideoEngagementTotal(video);

    return {
      title: video.title,
      조회수: viewValue,
      참여: engagementValue,
      규모: Math.max(1, engagementValue),
    };
  });
  const viewExtremeLabels = buildAdminDashboardExtremeLabels(
    rawChartData.map((row) => row.조회수),
    formatCompactNumber,
  );
  const chartData = rawChartData.map((row, index) => ({
    ...row,
    조회수최고: viewExtremeLabels[index]?.high ?? "",
    조회수최저: viewExtremeLabels[index]?.low ?? "",
  }));
  const colors = [
    adminDashboardFocusPalette.primary,
    adminDashboardFocusPalette.primarySoft,
    adminDashboardFocusPalette.primaryFaint,
    "#cbd5e1",
    "#e2e8f0",
  ];

  if (topVideos.length === 0) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center bg-background text-xs font-semibold text-muted-foreground">
        표시할 영상 분산 데이터가 없습니다.
      </div>
    );
  }

  const topVideo = topVideos[0];

  return (
    <div
      className={cn(
        adminDashboardVisualizationShellClassName,
        adminDashboardChartViewportClassName,
        "min-h-[230px] flex flex-1 flex-col",
      )}
      role="img"
      aria-label={`성과 분산 분석: 조회수와 참여 규모 ${topVideos.length}개 버블 차트`}
      data-admin-dashboard-bubble-chart="recharts"
    >
      <p className="sr-only">
        상위 영상 영향도 첫 항목은 {topVideo.title}이며 조회수는{" "}
        {formatNumber(chartData[0]?.조회수 ?? 0)}, 참여는{" "}
        {formatNumber(chartData[0]?.참여 ?? 0)}입니다. 색은 순위 구분용이고
        위치와 크기가 의미값입니다.
      </p>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%" minHeight={210}>
          <ScatterChart margin={adminDashboardScatterChartMargin}>
            <CartesianGrid stroke={adminDashboardGridColor} />
            <XAxis
              type="number"
              dataKey="조회수"
              name="조회수"
              domain={[
                (dataMin: number) => Math.max(0, dataMin * 0.92),
                (dataMax: number) => Math.max(1, dataMax * 1.08),
              ]}
              tickFormatter={formatCompactNumber}
              tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              height={18}
              tickMargin={2}
            />
            <YAxis
              type="number"
              dataKey="참여"
              name="참여"
              domain={[
                (dataMin: number) => Math.max(0, dataMin * 0.9),
                (dataMax: number) => Math.max(1, dataMax * 1.12),
              ]}
              tickFormatter={formatCompactNumber}
              tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={2}
              width={38}
            />
            <ZAxis type="number" dataKey="규모" range={[120, 1200]} />
            <RechartsTooltip
              cursor={{ stroke: adminDashboardGridColor }}
              wrapperStyle={adminDashboardTooltipWrapperStyle}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | (typeof chartData)[number]
                  | undefined;

                if (!active || !row) return null;

                return (
                  <AdminDashboardTooltipPanel
                    title={
                      <span className="line-clamp-2 leading-5">
                        {row.title}
                      </span>
                    }
                    rows={[
                      {
                        label: "조회수",
                        value: formatNumber(row.조회수),
                        note: "오른쪽일수록 큼",
                        color: adminDashboardFocusPalette.primary,
                      },
                      {
                        label: "참여",
                        value: formatNumber(row.참여),
                        note: "좋아요+댓글",
                        color: adminDashboardFocusPalette.muted,
                      },
                    ]}
                    footer="계산식: 참여 = 좋아요 + 댓글 · 원 크기 = 참여"
                    dataAttribute="bubble-video"
                  />
                );
              }}
            />
            <Scatter data={chartData} isAnimationActive={false}>
              <LabelList
                dataKey="조회수최고"
                position="top"
                fill={adminDashboardFocusPalette.primary}
                fontSize={10}
                fontWeight={900}
              />
              <LabelList
                dataKey="조회수최저"
                position="bottom"
                fill={adminDashboardFocusPalette.mutedStrong}
                fontSize={10}
                fontWeight={900}
              />
              {chartData.map((entry, index) => (
                <Cell key={entry.title} fill={colors[index % colors.length]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AdminDashboardGroupedBarChart({
  rows,
  seriesVisibility,
  isFullscreen = false,
}: {
  rows: AdminDashboardBarRow[];
  seriesVisibility: AdminDashboardSeriesVisibility<AdminDashboardTopContentSeriesKey>;
  isFullscreen?: boolean;
}) {
  const visibleRows = rows.slice(0, 5);

  if (visibleRows.length === 0) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center bg-background text-xs font-semibold text-muted-foreground">
        표시할 영상 성과 데이터가 없습니다.
      </div>
    );
  }

  const topRow = visibleRows[0];
  const rankColors = [
    {
      barClass: "bg-teal-500 text-white dark:bg-teal-500 dark:text-white",
      dotClass: "bg-teal-500 dark:bg-teal-400",
    },
    {
      barClass: "bg-teal-500/75 text-white dark:bg-teal-400/75 dark:text-white",
      dotClass: "bg-teal-500/75 dark:bg-teal-400/75",
    },
    {
      barClass: "bg-teal-500/55 text-white dark:bg-teal-400/55 dark:text-white",
      dotClass: "bg-teal-500/55 dark:bg-teal-400/55",
    },
    {
      barClass:
        "bg-muted-foreground/42 text-foreground dark:bg-muted-foreground/45 dark:text-foreground",
      dotClass: "bg-muted-foreground/55 dark:bg-muted-foreground/60",
    },
    {
      barClass:
        "bg-muted text-foreground ring-1 ring-inset ring-border/60 dark:bg-muted-foreground/28 dark:text-foreground dark:ring-border/40",
      dotClass: "bg-muted-foreground/35 dark:bg-muted-foreground/45",
    },
  ] as const;
  const metricRows = [
    {
      seriesKey: "views",
      key: "viewCount",
      label: "조회수",
      labelClass:
        "border-teal-500/25 bg-teal-50 text-foreground dark:border-teal-400/30 dark:bg-teal-950/35",
    },
    {
      seriesKey: "likes",
      key: "likeCount",
      label: "좋아요",
      labelClass:
        "border-border bg-muted/35 text-muted-foreground dark:bg-muted/20",
    },
    {
      seriesKey: "comments",
      key: "commentCount",
      label: "댓글",
      labelClass:
        "border-border bg-muted/35 text-muted-foreground dark:bg-muted/20",
    },
  ] as const satisfies ReadonlyArray<{
    seriesKey: AdminDashboardTopContentSeriesKey;
    key: keyof Pick<
      AdminDashboardBarRow,
      "viewCount" | "likeCount" | "commentCount"
    >;
    label: string;
    labelClass: string;
  }>;
  const visibleMetricRows = metricRows.filter(
    (metric) => seriesVisibility[metric.seriesKey],
  );

  return (
    <div
      className={cn(
        adminDashboardVisualizationShellClassName,
        "grid h-full grid-rows-[auto_auto] gap-2 pb-0 sm:grid-rows-[minmax(0,1fr)_auto]",
        isFullscreen && "gap-4 p-3 sm:gap-5 sm:p-4",
      )}
      role="img"
      aria-label="영상 성과 분석: 상위 5개 영상의 조회수, 좋아요, 댓글 비중 분포"
      data-admin-dashboard-bar-chart="rank-distribution"
    >
      <p className="sr-only">
        콘텐츠 성과 상위 항목은 {topRow.label}이며 조회수는{" "}
        {formatNumber(topRow.viewCount)}, 좋아요는{" "}
        {formatNumber(topRow.likeCount)}, 댓글은{" "}
        {formatNumber(topRow.commentCount)}입니다.
      </p>
      <div
        className={cn(
          "grid min-h-0 content-start gap-2 sm:content-evenly",
          isFullscreen && "gap-4 sm:gap-5",
        )}
      >
        {visibleMetricRows.map((metric) => {
          const total = visibleRows.reduce(
            (sum, row) => sum + row[metric.key],
            0,
          );

          const average =
            metric.key === "viewCount"
              ? (visibleRows[0]?.viewAverage ?? 0)
              : metric.key === "likeCount"
                ? (visibleRows[0]?.likeAverage ?? 0)
                : (visibleRows[0]?.commentAverage ?? 0);

          return (
            <div
              key={metric.key}
              className={cn("grid gap-1.5", isFullscreen && "gap-2.5")}
              data-admin-dashboard-top-content-metric={metric.label}
            >
              <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black leading-none",
                    metric.labelClass,
                  )}
                >
                  {metric.label}
                </span>
                <span className="max-w-full truncate text-[10px] font-black tabular-nums text-muted-foreground sm:shrink-0 sm:text-[11px]">
                  합계 {formatCompactNumber(total)} · 전체 평균{" "}
                  {formatCompactNumber(average)}
                </span>
              </div>
              <div
                className={cn(
                  "flex min-w-0 overflow-x-auto overflow-y-visible rounded-xl bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  isFullscreen ? "h-12 sm:h-14" : "h-9",
                )}
              >
                {visibleRows.map((row, index) => {
                  const value = row[metric.key];
                  const percent = total > 0 ? (value / total) * 100 : 0;

                  return (
                    <AdminDashboardInlineTooltip
                      key={`${metric.key}-${row.label}`}
                      label={`${row.label} ${metric.label} 비중`}
                      lines={
                        metric.key === "viewCount"
                          ? [
                              `${row.label}`,
                              `막대 비중: ${formatDashboardPercent(percent)}`,
                              `성과 기여: ${row.viewBenchmark}`,
                            ]
                          : [
                              `${row.label}`,
                              `${metric.label}: ${formatNumber(value)}`,
                              `막대 비중: ${formatDashboardPercent(percent)}`,
                              formatDashboardAverageComparison(value, average),
                            ]
                      }
                      className={cn(
                        "flex min-w-[8%] items-center justify-center px-0.5 text-[11px] font-black leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        rankColors[index]?.barClass ??
                          "bg-muted-foreground/28 text-foreground dark:bg-muted-foreground/35 dark:text-foreground",
                      )}
                      rankSegment={index + 1}
                      style={{ width: `${Math.max(8, percent)}%` }}
                    >
                      {percent.toFixed(0)}%
                    </AdminDashboardInlineTooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ol
        className={cn(
          "grid max-h-[8.5rem] shrink-0 gap-1 overflow-y-auto scrollbar-hide sm:max-h-none sm:grid-cols-5 sm:overflow-visible",
          isFullscreen && "gap-2",
        )}
        data-admin-dashboard-top-content-rank-list="true"
        aria-label="콘텐츠 성과 TOP 5 영상 순위"
      >
        {visibleRows.map((row, index) => (
          <li
            key={row.label}
            className="min-w-0 rounded-lg bg-muted/20 px-1.5 py-1"
            data-admin-dashboard-top-content-rank-item={index + 1}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  rankColors[index]?.dotClass ?? "bg-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[10px] font-black tabular-nums text-muted-foreground">
                {index + 1}위
              </span>
              <span
                className="min-w-0 truncate text-[11px] font-extrabold text-foreground"
                title={row.label}
              >
                {row.label}
              </span>
            </div>
            <AdminDashboardInlineTooltip
              label={`${row.label} 성과 기여`}
              lines={row.viewBenchmarkTooltipLines}
              className="mt-0.5 block truncate text-[10px] font-semibold tabular-nums text-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {formatDashboardContribution(row.performanceContributionPercent)} ·{" "}
              {row.viewTopPercentLabel}
            </AdminDashboardInlineTooltip>
          </li>
        ))}
      </ol>
    </div>
  );
}


function AdminDashboardDiagnosisBoard({
  insights,
  metricMode,
  periodLabel,
  isFullscreen = false,
}: {
  insights: AdminDashboardContentInsight[];
  metricMode: "current" | "delta";
  periodLabel: string;
  isFullscreen?: boolean;
}) {
  const modeLabel =
    metricMode === "delta" ? "기간 순증 평균 대비" : "기간 영상 현재 평균 대비";
  const signalBarClass = {
    primary: "bg-teal-500",
    warning: "bg-amber-500",
    risk: "bg-rose-500",
  } satisfies Record<AdminDashboardContentInsight["tone"], string>;

  const visibleInsights = insights.slice(
    0,
    ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT,
  );

  if (visibleInsights.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-muted/20 text-xs font-semibold text-muted-foreground"
        data-admin-dashboard-diagnosis-board="empty"
      >
        진단할 영상 성과 신호가 아직 없습니다.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 content-start gap-2 sm:content-stretch sm:gap-1",
        isFullscreen && "h-full gap-3 p-2 sm:gap-4 sm:p-4",
      )}
      role="img"
      aria-label="영상 성과 신호 진단"
      data-admin-dashboard-diagnosis-board="actionable-insights"
    >
      <p className="sr-only">
        {periodLabel} 기준으로 조회 성장, 참여율, 초반 반응, 롱테일 후보를 채널
        기여도와 참여율로 우선 점검할 영상을 표시합니다.
      </p>
      <div className="grid min-h-0 grid-cols-1 gap-2 sm:h-full sm:grid-cols-2 sm:grid-rows-2 sm:gap-1">
        {visibleInsights.map((insight) => {
          const tooltipLines = [
            `${insight.label}: ${insight.title}`,
            insight.description,
            `신호 강도: ${insight.scoreLabel}`,
            ...insight.qualityBadges.map((badge) => badge.description),
            "계산식: 신호 강도 = 카드별 규칙 점수를 0~100으로 표시합니다.",
          ];

          return (
            <UiTooltipProvider
              key={`${insight.label}-${insight.title}`}
              delayDuration={120}
            >
              <UiTooltip>
                <div
                  className={cn(
                    "flex min-h-[5.5rem] min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5 sm:min-h-0",
                    isFullscreen && "px-4 py-3 sm:px-5 sm:py-4",
                  )}
                  aria-label={tooltipLines.join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-black text-primary">
                      {insight.label}
                    </span>
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                      {modeLabel}
                    </span>
                  </div>
                  <UiTooltipTrigger asChild>
                    <div
                      tabIndex={0}
                      className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={tooltipLines.join(" ")}
                      data-admin-dashboard-diagnosis-tooltip-trigger="title"
                    >
                      <p className="truncate text-sm font-extrabold text-foreground">
                        {insight.title}
                      </p>
                      <AdminDashboardQualityBadges badges={insight.qualityBadges} />
                    </div>
                  </UiTooltipTrigger>
                  <p className="mt-1 truncate text-[11px] font-semibold text-muted-foreground">
                    {insight.description}
                  </p>
                  <div
                    className="mt-1.5 grid gap-1"
                    data-admin-dashboard-diagnosis-visual="signal-bar"
                  >
                    <div className="h-1.5 overflow-hidden rounded-full bg-background/80">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          signalBarClass[insight.tone],
                        )}
                        style={{
                          width: `${Math.max(8, Math.min(100, insight.score))}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px] font-black leading-none text-muted-foreground">
                      <span>신호 강도</span>
                      <span className="min-w-0 truncate text-foreground">
                        {insight.scoreLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <UiTooltipContent
                  side="top"
                  align="start"
                  sideOffset={4}
                  collisionPadding={12}
                  className={adminDashboardTooltipPortalClassName}
                  data-admin-dashboard-diagnosis-tooltip="standard"
                >
                  <AdminDashboardTooltipLinesPanel
                    lines={tooltipLines}
                    dataAttribute="diagnosis-card"
                  />
                </UiTooltipContent>
              </UiTooltip>
            </UiTooltipProvider>
          );
        })}
      </div>
    </div>
  );
}

function AdminDashboardAreaChart({
  points,
}: {
  points: AdminDashboardTrendPoint[];
}) {
  const rawChartData = points.map((point) => ({
    label: point.label,
    참여율:
      point.secondaryValue > 0 ? (point.value / point.secondaryValue) * 100 : 0,
  }));
  const rateExtremeLabels = buildAdminDashboardExtremeLabels(
    rawChartData.map((row) => row.참여율),
    formatDashboardPercent,
  );
  const chartData = rawChartData.map((row, index) => ({
    ...row,
    참여율최고: rateExtremeLabels[index]?.high ?? "",
    참여율최저: rateExtremeLabels[index]?.low ?? "",
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center bg-background text-xs font-semibold text-muted-foreground">
        표시할 변동 데이터가 없습니다.
      </div>
    );
  }

  const latestPoint = chartData.at(-1);

  return (
    <div
      className={cn(
        adminDashboardVisualizationShellClassName,
        adminDashboardChartViewportClassName,
        "min-h-[190px] flex-1",
      )}
      role="img"
      aria-label="참여율 상세 알림: 영상별 참여율 추이"
      data-admin-dashboard-area-chart="recharts"
    >
      <p className="sr-only">
        최근 참여율 지표는{" "}
        {latestPoint ? formatDashboardPercent(latestPoint.참여율) : "—"}입니다.
      </p>
      <ResponsiveContainer width="100%" height="100%" minHeight={160}>
        <AreaChart data={chartData} margin={adminDashboardChartMargin}>
          <defs>
            <linearGradient
              id="adminDashboardEngagementArea"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={adminDashboardFocusPalette.warning}
                stopOpacity={0.42}
              />
              <stop
                offset="95%"
                stopColor={adminDashboardFocusPalette.warning}
                stopOpacity={0.08}
              />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={adminDashboardGridColor} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            height={18}
            tickMargin={2}
            minTickGap={12}
          />
          <YAxis
            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            tick={{ fill: adminDashboardAxisColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickMargin={2}
            width={42}
          />
          <RechartsTooltip
            content={({ active, label, payload }) => {
              const value = payload?.[0]?.value;
              if (!active || value == null) return null;

              return (
                <AdminDashboardTooltipPanel
                  title={String(label ?? "날짜 없음")}
                  rows={[
                    {
                      label: "참여율",
                      value: `${Number(value).toFixed(2)}%`,
                      note: "조회수 대비 참여 비율",
                      color: adminDashboardFocusPalette.warning,
                    },
                  ]}
                  footer="계산식: 참여율 = 참여 / 조회수 × 100."
                  dataAttribute="engagement-area"
                />
              );
            }}
            wrapperStyle={adminDashboardTooltipWrapperStyle}
            cursor={{ stroke: adminDashboardGridColor }}
          />
          <Area
            type="monotone"
            dataKey="참여율"
            stroke={adminDashboardFocusPalette.warning}
            strokeWidth={2.6}
            fill="url(#adminDashboardEngagementArea)"
            dot={{ r: 2.4 }}
            activeDot={{ r: 4.2 }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="참여율최고"
              position="top"
              fill={adminDashboardFocusPalette.warning}
              fontSize={10}
              fontWeight={900}
            />
            <LabelList
              dataKey="참여율최저"
              position="bottom"
              fill={adminDashboardFocusPalette.warning}
              fontSize={10}
              fontWeight={900}
            />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function getCollectionLogStatusLabel(
  status: string,
  conclusion: string | null,
) {
  if (status !== "completed") return "진행 중";
  if (conclusion === "success") return "성공";
  if (conclusion === "cancelled") return "취소";
  if (conclusion) return "실패";
  return "완료";
}

function getCollectionLogStatusClassName(
  status: string,
  conclusion: string | null,
) {
  if (status !== "completed") {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (conclusion === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (conclusion === "cancelled") {
    return "border-muted bg-muted/60 text-muted-foreground";
  }
  return "border-destructive/20 bg-destructive/10 text-destructive";
}

function AdminDashboardPdfReportButton({ onExport }: { onExport: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 shrink-0 gap-1 rounded-full px-2 text-[11px] font-bold text-muted-foreground hover:text-foreground"
      aria-label="KPI 대시보드를 PDF 보고서로 내보내기"
      data-admin-dashboard-kpi-pdf-export-trigger="true"
      onClick={onExport}
    >
      <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">PDF 보고서</span>
      <span className="sr-only">PDF 보고서 내보내기</span>
    </Button>
  );
}

function AdminDashboardPeriodSelector({
  value,
  onChange,
}: {
  value: AdminDashboardPeriod;
  onChange: (period: AdminDashboardPeriod) => void;
}) {
  const selectedOption =
    ADMIN_DASHBOARD_PERIOD_OPTIONS.find((option) => option.value === value) ??
    ADMIN_DASHBOARD_PERIOD_OPTIONS[0];

  return (
    <>
      <div
        className="order-3 hidden shrink-0 flex-wrap justify-end gap-1 md:flex"
        aria-label="대시보드 타임프레임"
        data-admin-dashboard-period-options-inline="desktop"
      >
        {ADMIN_DASHBOARD_PERIOD_OPTIONS.map((option) => {
          const isSelected = option.value === value;

          return (
            <Button
              key={option.value}
              type="button"
              variant={isSelected ? "default" : "outline"}
              size="sm"
              className="h-7 shrink-0 rounded-full px-2 text-[11px] font-bold"
              aria-pressed={isSelected}
              data-admin-dashboard-period-option={option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="order-3 h-7 shrink-0 gap-1 rounded-full px-2 text-[11px] font-bold text-muted-foreground hover:text-foreground md:hidden"
            aria-label={`대시보드 타임프레임 설정: ${selectedOption.label}`}
            data-admin-dashboard-period-select-trigger="true"
          >
            <span className="text-muted-foreground">기간</span>
            <span className="text-foreground">{selectedOption.label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[min(18rem,calc(100vw-24px))] rounded-2xl border-border bg-card p-2 shadow-primary"
          aria-label="대시보드 타임프레임 설정"
          data-admin-dashboard-period-menu="true"
        >
          <div className="mb-2 px-1">
            <p className="text-xs font-bold text-foreground">기간 설정</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              KPI와 차트에 적용할 조회 기간을 선택합니다.
            </p>
          </div>
          <div
            className="grid grid-cols-3 gap-1"
            aria-label="대시보드 타임프레임"
          >
            {ADMIN_DASHBOARD_PERIOD_OPTIONS.map((option) => {
              const isSelected = option.value === value;

              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                  size="sm"
                  className="h-11 min-h-11 min-w-[44px] rounded-xl px-2 text-[11px] font-bold"
                  style={{ minWidth: 44 }}
                  aria-pressed={isSelected}
                  data-admin-dashboard-period-option={option.value}
                  onClick={() => onChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function AdminDashboardCollectionLogPopover({
  open,
  logs,
  isLoading,
  isFetching,
  isError,
  onOpenChange,
  onRefresh,
}: {
  open: boolean;
  logs: AdminYouTubeKpiCollectionLogs | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}) {
  const latestRun = logs?.workflow.runs[0];
  const latestRunUrl = resolveGitHubActionsRunUrl(latestRun?.htmlUrl);
  const latestJobs = logs?.workflow.latestJobs.slice(0, 3) ?? [];
  const snapshot = logs?.snapshot;
  const hasSavedSnapshot = Boolean(snapshot?.available);
  const isWorkflowHealthy = latestRun
    ? latestRun.status !== "completed" || latestRun.conclusion === "success"
    : logs?.workflow.available;
  const collectionStatusLabel = hasSavedSnapshot
    ? "수집 정상"
    : "저장 확인 필요";
  const collectionStatusClassName = hasSavedSnapshot
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300";
  const workflowStatusLabel = !logs?.workflow.available
    ? "로그 권한 필요"
    : latestRun
      ? getCollectionLogStatusLabel(latestRun.status, latestRun.conclusion)
      : "실행 없음";
  const workflowStatusClassName = !logs?.workflow.available
    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300"
    : getCollectionLogStatusClassName(
        latestRun?.status ?? "completed",
        latestRun?.conclusion ?? (isWorkflowHealthy ? "success" : "failure"),
      );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-7 w-7 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground",
            isError && "border-destructive/30 text-destructive",
          )}
          aria-label="GitHub Actions KPI 데이터 수집 로그 열기"
          data-admin-dashboard-kpi-collection-log-trigger="true"
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">데이터 수집 로그</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(92vw,25rem)] overflow-hidden rounded-2xl border-border/80 p-0 shadow-xl"
        data-admin-dashboard-kpi-collection-log-panel="simple"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-background px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-foreground">
              데이터 수집 상태
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">
              Supabase 저장 기준 ·{" "}
              {logs?.workflow.workflowId ?? "youtube-kpi-snapshot.yml"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 min-h-11 min-w-[44px] shrink-0 rounded-full px-2 text-[11px] font-bold md:h-7 md:min-h-0 md:min-w-0"
            disabled={isFetching}
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")}
              aria-hidden="true"
            />
            갱신
          </Button>
        </div>

        <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          ) : null}

          {!isLoading ? (
            <>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-extrabold text-foreground">
                      {hasSavedSnapshot ? (
                        <CheckCircle2
                          className="h-3.5 w-3.5 text-emerald-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="h-3.5 w-3.5 text-amber-600"
                          aria-hidden="true"
                        />
                      )}
                      {hasSavedSnapshot
                        ? "최근 스냅샷 저장됨"
                        : "저장된 스냅샷 없음"}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {hasSavedSnapshot
                        ? `마지막 저장: ${formatDashboardDateTime(snapshot?.fetchedAt)}`
                        : "수집 결과가 아직 저장되지 않았습니다."}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                      collectionStatusClassName,
                    )}
                  >
                    {collectionStatusLabel}
                  </Badge>
                </div>

                {hasSavedSnapshot ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">영상</span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatNumber(snapshot?.videoSnapshotCount)}개
                      </span>
                    </div>
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">
                        구독자
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatNumber(snapshot?.subscriberCount)}
                      </span>
                    </div>
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">
                        총 조회수
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatCompactNumber(snapshot?.viewCount)}
                      </span>
                    </div>
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">
                        조회 증감
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatSignedNumber(snapshot?.viewDelta)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-foreground">
                      GitHub Actions 로그
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {logs?.workflow.available
                        ? latestRun
                          ? `최근 실행: #${latestRun.runNumber ?? "—"} · ${formatDashboardDateTime(latestRun.startedAt ?? latestRun.createdAt)}`
                          : "워크플로는 찾았지만 실행 기록은 아직 없습니다."
                        : "수집 실패가 아니라, 이 서버가 GitHub 실행 로그를 읽을 권한이 없는 상태입니다."}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        workflowStatusClassName,
                      )}
                    >
                      {workflowStatusLabel}
                    </Badge>
                    {latestRunUrl ? (
                      <a
                        href={latestRunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 min-h-11 w-11 min-w-[44px] items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:h-6 md:min-h-0 md:w-6 md:min-w-0"
                        aria-label="GitHub Actions 실행 로그 새 탭에서 열기"
                      >
                        <ExternalLink
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </a>
                    ) : null}
                  </div>
                </div>

                {!logs?.workflow.available ? (
                  <p className="mt-2 rounded-xl bg-muted/40 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                    서버 환경 변수에 GitHub 읽기 토큰이 없거나 권한이
                    부족합니다. GITHUB_ACTIONS_TOKEN 또는 GH_TOKEN을 설정하면
                    실행 로그도 표시됩니다.
                    {logs?.workflow.error ? ` (${logs.workflow.error})` : ""}
                  </p>
                ) : null}

                {latestJobs.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {latestJobs.map((job) => (
                      <span
                        key={job.id ?? job.name}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                          getCollectionLogStatusClassName(
                            job.status,
                            job.conclusion,
                          ),
                        )}
                      >
                        {job.name}:{" "}
                        {getCollectionLogStatusLabel(
                          job.status,
                          job.conclusion,
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <p className="text-[10px] leading-4 text-muted-foreground">
                판정 기준: 최신 스냅샷이 저장되어 있으면 대시보드 데이터 수집은
                정상으로 봅니다.
              </p>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AdminDashboardManagementPanel({
  stats,
  isLoading,
  hasError,
  isAdmin,
}: {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const hasShownDashboardDataErrorToastRef = useRef(false);
  const [period, setPeriod] = useState<AdminDashboardPeriod>("1M");
  const [pendingSkeletonPeriod, setPendingSkeletonPeriod] =
    useState<AdminDashboardPeriod | null>(null);
  const [dashboardCardViews, setDashboardCardViews] = useState(
    DEFAULT_ADMIN_DASHBOARD_CARD_VIEWS,
  );
  const [fullscreenWidgetId, setFullscreenWidgetId] =
    useState<AdminDashboardWidgetId | null>(null);
  const [trendSeriesVisibility, setTrendSeriesVisibility] = useState(
    DEFAULT_ADMIN_DASHBOARD_TREND_SERIES_VISIBILITY,
  );
  const [topContentSeriesVisibility, setTopContentSeriesVisibility] = useState(
    DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY,
  );
  const [dashboardWidgetOrder, setDashboardWidgetOrder] = useState<
    AdminDashboardWidgetId[]
  >(DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER);
  const [isDashboardOrderEditorOpen, setIsDashboardOrderEditorOpen] =
    useState(false);
  const [isCollectionLogsOpen, setIsCollectionLogsOpen] = useState(false);
  const [isDashboardOrderLoading, setIsDashboardOrderLoading] = useState(false);
  const [isDashboardOrderSaving, setIsDashboardOrderSaving] = useState(false);
  const [draggedDashboardWidgetId, setDraggedDashboardWidgetId] =
    useState<AdminDashboardWidgetId | null>(null);
  const [dashboardOrderMessage, setDashboardOrderMessage] = useState(
    "카드 순서는 관리자 계정별로 저장됩니다.",
  );
  const [isDashboardMobileViewport, setIsDashboardMobileViewport] = useState(
    () => getIsAdminDashboardMobileViewport(),
  );
  const orderedDashboardWidgetIds = useMemo(
    () => normalizeAdminDashboardWidgetOrder(dashboardWidgetOrder),
    [dashboardWidgetOrder],
  );
  const isDashboardWidgetOrderDefault = useMemo(
    () =>
      areAdminDashboardWidgetOrdersEqual(
        orderedDashboardWidgetIds,
        DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
      ),
    [orderedDashboardWidgetIds],
  );
  const latestDashboardWidgetOrderRef = useRef<AdminDashboardWidgetId[]>(
    DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
  );
  const dragStartDashboardWidgetOrderRef = useRef<
    AdminDashboardWidgetId[] | null
  >(null);
  const draggedDashboardWidgetIdRef = useRef<AdminDashboardWidgetId | null>(
    null,
  );
  const hasPersistedDraggedDashboardWidgetRef = useRef(false);
  const insightQuery = useQuery({
    queryKey: ["admin-dashboard-management", "insights", "cohort", period],
    queryFn: () => fetchAdminDashboardInsightSummary(period, "cohort"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const growthInsightQuery = useQuery({
    queryKey: [
      "admin-dashboard-management",
      "insights",
      "channel-growth",
      period,
    ],
    queryFn: () => fetchAdminDashboardInsightSummary(period, "channel-growth"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const youtubeChannelQuery = useQuery({
    queryKey: ["admin-dashboard-management", "youtube-channel", period],
    queryFn: () => fetchAdminYouTubeChannelStats(period),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const collectionLogsQuery = useQuery({
    queryKey: ["admin-dashboard-management", "youtube-kpi-collection-logs"],
    queryFn: fetchAdminYouTubeKpiCollectionLogs,
    staleTime: 60 * 1000,
    enabled: isCollectionLogsOpen,
    refetchInterval: isCollectionLogsOpen ? 60 * 1000 : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateIsMobileViewport = () => {
      setIsDashboardMobileViewport(mediaQuery.matches);
    };

    updateIsMobileViewport();
    mediaQuery.addEventListener("change", updateIsMobileViewport);

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobileViewport);
    };
  }, []);

  useEffect(() => {
    if (
      pendingSkeletonPeriod === period &&
      !insightQuery.isFetching &&
      !insightQuery.isLoading &&
      !growthInsightQuery.isFetching &&
      !growthInsightQuery.isLoading &&
      !youtubeChannelQuery.isFetching &&
      !youtubeChannelQuery.isLoading
    ) {
      setPendingSkeletonPeriod(null);
    }
  }, [
    growthInsightQuery.isFetching,
    growthInsightQuery.isLoading,
    insightQuery.isFetching,
    insightQuery.isLoading,
    pendingSkeletonPeriod,
    period,
    youtubeChannelQuery.isFetching,
    youtubeChannelQuery.isLoading,
  ]);

  useEffect(() => {
    latestDashboardWidgetOrderRef.current = orderedDashboardWidgetIds;
  }, [orderedDashboardWidgetIds]);

  useEffect(() => {
    if (!fullscreenWidgetId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreenWidgetId(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenWidgetId]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboardWidgetOrder() {
      setIsDashboardOrderLoading(true);
      try {
        const response = await fetch(
          "/api/admin/preferences/dashboard-widget-order",
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) return;

        const payload = (await response.json()) as { order?: unknown };
        if (!controller.signal.aborted) {
          setDashboardWidgetOrder(
            normalizeAdminDashboardWidgetOrder(payload.order),
          );
        }
      } catch {
        if (!controller.signal.aborted) {
          setDashboardOrderMessage(
            "저장된 카드 순서를 불러오지 못해 처음 상태로 표시합니다.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsDashboardOrderLoading(false);
        }
      }
    }

    void loadDashboardWidgetOrder();

    return () => {
      controller.abort();
    };
  }, []);

  const persistDashboardWidgetOrder = useCallback(
    async (nextOrder: AdminDashboardWidgetId[], successMessage: string) => {
      const normalizedOrder = normalizeAdminDashboardWidgetOrder(nextOrder);
      latestDashboardWidgetOrderRef.current = normalizedOrder;
      setDashboardWidgetOrder(normalizedOrder);
      setIsDashboardOrderSaving(true);
      setDashboardOrderMessage("카드 순서를 저장하는 중입니다.");

      try {
        const response = await fetch(
          "/api/admin/preferences/dashboard-widget-order",
          {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ order: normalizedOrder }),
          },
        );

        if (!response.ok) throw new Error("dashboard-widget-order-save-failed");

        const payload = (await response.json()) as { order?: unknown };
        const savedOrder = normalizeAdminDashboardWidgetOrder(payload.order);
        latestDashboardWidgetOrderRef.current = savedOrder;
        setDashboardWidgetOrder(savedOrder);
        setDashboardOrderMessage(successMessage);
      } catch {
        setDashboardOrderMessage(
          "저장하지 못했습니다. 화면에는 임시 순서가 반영되어 있습니다.",
        );
      } finally {
        setIsDashboardOrderSaving(false);
      }
    },
    [],
  );
  const resetDashboardWidgetOrder = useCallback(async () => {
    const defaultOrder = normalizeAdminDashboardWidgetOrder(null);
    latestDashboardWidgetOrderRef.current = defaultOrder;
    setDashboardWidgetOrder(defaultOrder);
    setDraggedDashboardWidgetId(null);
    draggedDashboardWidgetIdRef.current = null;
    dragStartDashboardWidgetOrderRef.current = null;
    setIsDashboardOrderSaving(true);
    setDashboardOrderMessage("카드 순서를 처음 상태로 초기화하는 중입니다.");

    try {
      const response = await fetch(
        "/api/admin/preferences/dashboard-widget-order",
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );

      if (!response.ok) throw new Error("dashboard-widget-order-reset-failed");

      const payload = (await response.json()) as { order?: unknown };
      const resetOrder = normalizeAdminDashboardWidgetOrder(payload.order);
      latestDashboardWidgetOrderRef.current = resetOrder;
      setDashboardWidgetOrder(resetOrder);
      setDashboardOrderMessage(
        "처음 카드 순서로 초기화했습니다. 새로고침해도 처음 상태가 유지됩니다.",
      );
    } catch {
      setDashboardOrderMessage(
        "초기화하지 못했습니다. 화면에는 임시 처음 상태가 반영되어 있습니다.",
      );
    } finally {
      setIsDashboardOrderSaving(false);
    }
  }, []);
  const getDashboardWidgetOrder = useCallback(
    (widgetId: AdminDashboardWidgetId) => {
      const groupIndex = getAdminDashboardWidgetLayoutGroup(widgetId);
      const groupWidgetIds = ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS[groupIndex];
      const groupWidgetSet = new Set<AdminDashboardWidgetId>(groupWidgetIds);
      const orderedGroupWidgetIds = orderedDashboardWidgetIds.filter((item) =>
        groupWidgetSet.has(item),
      );

      return (
        groupIndex * 100 + Math.max(0, orderedGroupWidgetIds.indexOf(widgetId))
      );
    },
    [orderedDashboardWidgetIds],
  );
  const getDashboardCardOrderStyle = useCallback(
    (widgetId: AdminDashboardWidgetId): CSSProperties => ({
      order: getDashboardWidgetOrder(widgetId),
      viewTransitionName: isDashboardOrderEditorOpen
        ? `admin-dashboard-${widgetId}`
        : undefined,
    }),
    [getDashboardWidgetOrder, isDashboardOrderEditorOpen],
  );
  const getDashboardCardView = useCallback(
    (widgetId: AdminDashboardTableWidgetId) =>
      dashboardCardViews[widgetId] ?? "chart",
    [dashboardCardViews],
  );
  const setDashboardCardView = useCallback(
    (widgetId: AdminDashboardTableWidgetId, view: AdminDashboardCardView) => {
      setDashboardCardViews((current) => ({
        ...current,
        [widgetId]: view,
      }));
    },
    [],
  );
  const toggleDashboardFullscreenWidget = useCallback(
    (widgetId: AdminDashboardWidgetId) => {
      setFullscreenWidgetId((current) =>
        current === widgetId ? null : widgetId,
      );
    },
    [],
  );
  const renderDashboardFullscreenButton = useCallback(
    (widgetId: AdminDashboardWidgetId) => (
      <AdminDashboardFullscreenButton
        widgetId={widgetId}
        label={ADMIN_DASHBOARD_WIDGET_LABELS[widgetId]}
        isFullscreen={fullscreenWidgetId === widgetId}
        onToggle={toggleDashboardFullscreenWidget}
      />
    ),
    [fullscreenWidgetId, toggleDashboardFullscreenWidget],
  );
  const isDashboardWidgetFullscreen = useCallback(
    (widgetId: AdminDashboardWidgetId) => fullscreenWidgetId === widgetId,
    [fullscreenWidgetId],
  );

  const toggleTrendSeries = useCallback(
    (series: AdminDashboardTrendSeriesKey) => {
      setTrendSeriesVisibility((current) => {
        const visibleCount = Object.values(current).filter(Boolean).length;

        if (current[series] && visibleCount <= 1) return current;

        return {
          ...current,
          [series]: !current[series],
        };
      });
    },
    [],
  );
  const toggleTopContentSeries = useCallback(
    (series: AdminDashboardTopContentSeriesKey) => {
      setTopContentSeriesVisibility((current) => {
        const visibleCount = Object.values(current).filter(Boolean).length;

        if (current[series] && visibleCount <= 1) return current;

        return {
          ...current,
          [series]: !current[series],
        };
      });
    },
    [],
  );
  const previewDraggedDashboardWidget = useCallback(
    (
      targetWidgetId: AdminDashboardWidgetId,
      placement: "before" | "after",
      sourceWidgetId = draggedDashboardWidgetIdRef.current,
    ) => {
      if (!sourceWidgetId || sourceWidgetId === targetWidgetId) return;

      if (
        getAdminDashboardWidgetLayoutGroup(sourceWidgetId) !==
        getAdminDashboardWidgetLayoutGroup(targetWidgetId)
      ) {
        setDashboardOrderMessage(
          "같은 레이아웃 영역 안에서만 순서를 바꿀 수 있습니다.",
        );
        return;
      }

      const nextOrder = moveAdminDashboardWidgetBeforeOrAfter(
        latestDashboardWidgetOrderRef.current,
        sourceWidgetId,
        targetWidgetId,
        placement,
      );

      if (
        areAdminDashboardWidgetOrdersEqual(
          latestDashboardWidgetOrderRef.current,
          nextOrder,
        )
      ) {
        return;
      }

      latestDashboardWidgetOrderRef.current = nextOrder;
      updateAdminDashboardOrderWithViewTransition(() => {
        setDashboardWidgetOrder(nextOrder);
      });
      setDashboardOrderMessage(
        `${ADMIN_DASHBOARD_WIDGET_LABELS[sourceWidgetId]} 카드를 옮기는 중입니다. 놓으면 저장됩니다.`,
      );
    },
    [],
  );
  const finishDraggedDashboardWidget = useCallback(
    (sourceWidgetId = draggedDashboardWidgetIdRef.current) => {
      if (hasPersistedDraggedDashboardWidgetRef.current) return;
      hasPersistedDraggedDashboardWidgetRef.current = true;
      draggedDashboardWidgetIdRef.current = null;
      setDraggedDashboardWidgetId(null);

      if (!sourceWidgetId) return;

      const startOrder = dragStartDashboardWidgetOrderRef.current;
      const nextOrder = normalizeAdminDashboardWidgetOrder(
        latestDashboardWidgetOrderRef.current,
      );
      dragStartDashboardWidgetOrderRef.current = null;

      if (
        startOrder &&
        areAdminDashboardWidgetOrdersEqual(startOrder, nextOrder)
      ) {
        setDashboardOrderMessage("카드 순서 변경 없이 편집을 마쳤습니다.");
        return;
      }

      void persistDashboardWidgetOrder(
        nextOrder,
        `${ADMIN_DASHBOARD_WIDGET_LABELS[sourceWidgetId]} 카드 순서를 저장했습니다.`,
      );
    },
    [persistDashboardWidgetOrder],
  );
  const getDashboardReorderCardClassName = useCallback(
    (widgetId: AdminDashboardWidgetId) =>
      cn(
        isDashboardOrderEditorOpen &&
          "cursor-grab select-none ring-1 ring-primary/20 transition-[box-shadow,opacity,transform] hover:ring-primary/45 active:cursor-grabbing",
        draggedDashboardWidgetId === widgetId &&
          "scale-[0.99] opacity-70 ring-2 ring-primary/50",
      ),
    [draggedDashboardWidgetId, isDashboardOrderEditorOpen],
  );
  const getDashboardCardReorderProps = useCallback(
    (widgetId: AdminDashboardWidgetId): AdminDashboardCardReorderProps => ({
      draggable: isDashboardOrderEditorOpen && !isDashboardOrderSaving,
      "aria-grabbed": draggedDashboardWidgetId === widgetId,
      "data-admin-dashboard-direct-reorder-card": widgetId,
      onDragStart: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) {
          event.preventDefault();
          return;
        }
        const normalizedOrder = normalizeAdminDashboardWidgetOrder(
          latestDashboardWidgetOrderRef.current,
        );
        latestDashboardWidgetOrderRef.current = normalizedOrder;
        dragStartDashboardWidgetOrderRef.current = normalizedOrder;
        draggedDashboardWidgetIdRef.current = widgetId;
        hasPersistedDraggedDashboardWidgetRef.current = false;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", widgetId);
        setDraggedDashboardWidgetId(widgetId);
        setDashboardOrderMessage(
          `${ADMIN_DASHBOARD_WIDGET_LABELS[widgetId]} 카드를 잡았습니다. 원하는 위치로 끌면 즉시 자리가 바뀝니다.`,
        );
      },
      onDragEnter: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) return;
        event.preventDefault();
        const rawWidgetId = event.dataTransfer.getData("text/plain");
        const sourceWidgetId = isAdminDashboardWidgetId(rawWidgetId)
          ? rawWidgetId
          : draggedDashboardWidgetIdRef.current;
        previewDraggedDashboardWidget(widgetId, "before", sourceWidgetId);
      },
      onDragOver: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rawWidgetId = event.dataTransfer.getData("text/plain");
        const sourceWidgetId = isAdminDashboardWidgetId(rawWidgetId)
          ? rawWidgetId
          : draggedDashboardWidgetIdRef.current;
        const rect = event.currentTarget.getBoundingClientRect();
        const useHorizontalMidpoint = rect.width >= rect.height;
        const placement = useHorizontalMidpoint
          ? event.clientX > rect.left + rect.width / 2
            ? "after"
            : "before"
          : event.clientY > rect.top + rect.height / 2
            ? "after"
            : "before";
        previewDraggedDashboardWidget(widgetId, placement, sourceWidgetId);
      },
      onDrop: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) return;
        event.preventDefault();
        const rawWidgetId = event.dataTransfer.getData("text/plain");
        const sourceWidgetId = isAdminDashboardWidgetId(rawWidgetId)
          ? rawWidgetId
          : draggedDashboardWidgetIdRef.current;
        finishDraggedDashboardWidget(sourceWidgetId);
      },
      onDragEnd: () => finishDraggedDashboardWidget(),
    }),
    [
      draggedDashboardWidgetId,
      finishDraggedDashboardWidget,
      isDashboardOrderEditorOpen,
      isDashboardOrderSaving,
      previewDraggedDashboardWidget,
    ],
  );

  const videos = useMemo(
    () => insightQuery.data?.videos ?? [],
    [insightQuery.data?.videos],
  );
  const growthVideos = useMemo(
    () => growthInsightQuery.data?.videos ?? [],
    [growthInsightQuery.data?.videos],
  );
  const videosByPublishedAt = useMemo(
    () =>
      [...videos].sort((a, b) => {
        const aMs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bMs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return aMs - bMs;
      }),
    [videos],
  );
  const videosByViews = useMemo(
    () => [...videos].sort((a, b) => b.viewCount - a.viewCount),
    [videos],
  );
  const growthVideosByPublishedAt = useMemo(
    () =>
      [...growthVideos].sort((a, b) => {
        const aMs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bMs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return aMs - bMs;
      }),
    [growthVideos],
  );
  const hasPeriodGrowthComparison =
    period !== "ALL" &&
    hasDashboardSnapshotComparison(
      growthVideos,
      (video) => video.previousViewCount,
    );
  const videosByInsightScore = useMemo(() => {
    if (!hasPeriodGrowthComparison) return videosByViews;

    return [...videosByViews].sort(
      (a, b) =>
        getNonNegativeMetricDelta(getVideoViewDelta(b)) -
        getNonNegativeMetricDelta(getVideoViewDelta(a)),
    );
  }, [hasPeriodGrowthComparison, videosByViews]);
  const topContentVideosByInsightScore = hasPeriodGrowthComparison
    ? videosByInsightScore.filter(
        (video) => video.comparisonStatus !== "missing_previous",
      )
    : videosByInsightScore;
  const topContentMetricMode = hasPeriodGrowthComparison ? "delta" : "current";
  const periodViewValue = getDashboardPeriodMetricValue(
    growthVideos,
    period,
    (video) => video.viewCount,
    (video) => video.previousViewCount,
  );
  const periodLikeValue = getDashboardPeriodMetricValue(
    growthVideos,
    period,
    (video) => video.likeCount,
    (video) => video.previousLikeCount,
  );
  const periodCommentValue = getDashboardPeriodMetricValue(
    growthVideos,
    period,
    (video) => video.commentCount,
    (video) => video.previousCommentCount,
  );
  const viewChange = calculateDashboardPeriodMetricChange(
    growthVideos,
    period,
    (video) => video.viewCount,
    (video) => video.previousViewCount,
  );
  const likeChange = calculateDashboardPeriodMetricChange(
    growthVideos,
    period,
    (video) => video.likeCount,
    (video) => video.previousLikeCount,
  );
  const commentChange = calculateDashboardPeriodMetricChange(
    growthVideos,
    period,
    (video) => video.commentCount,
    (video) => video.previousCommentCount,
  );
  const trendPoints = useMemo(
    () => buildAdminDashboardTrendPoints(videosByPublishedAt),
    [videosByPublishedAt],
  );
  const viewSparklinePoints = useMemo(
    () =>
      buildAdminDashboardPeriodDeltaSparklinePoints(
        growthVideosByPublishedAt,
        period,
        (video) => video.viewCount,
        (video) => video.previousViewCount,
      ),
    [growthVideosByPublishedAt, period],
  );
  const likeSparklinePoints = useMemo(
    () =>
      buildAdminDashboardPeriodDeltaSparklinePoints(
        growthVideosByPublishedAt,
        period,
        (video) => video.likeCount,
        (video) => video.previousLikeCount,
      ),
    [growthVideosByPublishedAt, period],
  );
  const commentSparklinePoints = useMemo(
    () =>
      buildAdminDashboardPeriodDeltaSparklinePoints(
        growthVideosByPublishedAt,
        period,
        (video) => video.commentCount,
        (video) => video.previousCommentCount,
      ),
    [growthVideosByPublishedAt, period],
  );
  const fallbackViewSparklinePoints = useMemo(
    () =>
      buildAdminDashboardSparklinePoints(
        videosByPublishedAt,
        (video) => video.viewCount,
      ),
    [videosByPublishedAt],
  );
  const fallbackLikeSparklinePoints = useMemo(
    () =>
      buildAdminDashboardSparklinePoints(
        videosByPublishedAt,
        (video) => video.likeCount,
      ),
    [videosByPublishedAt],
  );
  const fallbackCommentSparklinePoints = useMemo(
    () =>
      buildAdminDashboardSparklinePoints(
        videosByPublishedAt,
        (video) => video.commentCount,
      ),
    [videosByPublishedAt],
  );
  const viewSparklineDisplayPoints =
    viewSparklinePoints.length > 0
      ? viewSparklinePoints
      : fallbackViewSparklinePoints;
  const likeSparklineDisplayPoints =
    likeSparklinePoints.length > 0
      ? likeSparklinePoints
      : fallbackLikeSparklinePoints;
  const commentSparklineDisplayPoints =
    commentSparklinePoints.length > 0
      ? commentSparklinePoints
      : fallbackCommentSparklinePoints;
  const videoCountSparklinePoints = useMemo(
    () =>
      buildAdminDashboardSparklinePoints(
        videosByPublishedAt,
        (_, index) => index + 1,
      ),
    [videosByPublishedAt],
  );
  const isInsightDynamicLoading =
    insightQuery.isLoading ||
    growthInsightQuery.isLoading ||
    pendingSkeletonPeriod === period;
  const isChartLoading = isInsightDynamicLoading;
  const chartHasError =
    hasError || insightQuery.isError || growthInsightQuery.isError;
  useEffect(() => {
    if (!chartHasError) {
      hasShownDashboardDataErrorToastRef.current = false;
      return;
    }

    if (hasShownDashboardDataErrorToastRef.current) return;
    hasShownDashboardDataErrorToastRef.current = true;
    toast({
      variant: "destructive",
      title: "지표 데이터 로드 실패",
      description: "대시보드 정적 영역은 유지합니다.",
    });
  }, [chartHasError, toast]);

  const periodCohortViewValue = videos.reduce(
    (sum, video) => sum + video.viewCount,
    0,
  );
  const periodCohortLikeValue = videos.reduce(
    (sum, video) => sum + video.likeCount,
    0,
  );
  const periodCohortCommentValue = videos.reduce(
    (sum, video) => sum + video.commentCount,
    0,
  );
  const periodViewDisplayValue = periodViewValue ?? periodCohortViewValue;
  const periodLikeDisplayValue = periodLikeValue ?? periodCohortLikeValue;
  const periodCommentDisplayValue =
    periodCommentValue ?? periodCohortCommentValue;
  const likeRate = getDashboardRatio(
    periodLikeDisplayValue,
    periodViewDisplayValue,
  );
  const commentRate = getDashboardRatio(
    periodCommentDisplayValue,
    periodViewDisplayValue,
  );
  const dashboardViewMetricLabel =
    hasPeriodGrowthComparison && viewChange != null
      ? `조회 증감 ${formatDashboardChangeLabel(viewChange)}`
      : hasPeriodGrowthComparison
        ? "조회 증감 계산 대기"
        : "현재값 기준";
  const cumulativeViewValue = growthVideos.reduce(
    (sum, video) => sum + video.viewCount,
    0,
  );
  const cumulativeLikeValue = growthVideos.reduce(
    (sum, video) => sum + video.likeCount,
    0,
  );
  const cumulativeCommentValue = growthVideos.reduce(
    (sum, video) => sum + video.commentCount,
    0,
  );
  const visibleVideoTotal = insightQuery.data?.totalVideos ?? stats.totalVideos;
  const dashboardUploadVideoBasisCount = videos.length;
  const impactChartVideoLimit = getAdminDashboardImpactChartLimit(
    videosByInsightScore.length,
  );
  const impactDisplayedVideoCount = Math.min(
    videosByInsightScore.length,
    impactChartVideoLimit,
  );
  const trendDisplayedPointCount = trendPoints.length;
  const impactMetricLabel =
    getDashboardCardView("impact") === "table"
      ? `${dashboardViewMetricLabel} · 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개`
      : impactDisplayedVideoCount < dashboardUploadVideoBasisCount
        ? `${dashboardViewMetricLabel} · 상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개`
        : `${dashboardViewMetricLabel} · 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개`;
  const trendMetricLabel = `${dashboardViewMetricLabel} · 전체 ${formatNumber(trendDisplayedPointCount)}개`;
  const selectedPeriodLabel =
    ADMIN_DASHBOARD_PERIOD_OPTIONS.find((option) => option.value === period)
      ?.label ?? "선택 기간";
  const periodMetricCaption =
    period === "ALL"
      ? "전체 · 현재 합계"
      : hasPeriodGrowthComparison
        ? `${selectedPeriodLabel} · 기간 순증`
        : `${selectedPeriodLabel} · 기간 영상 현재`;
  const periodRatioCaptionPrefix = hasPeriodGrowthComparison
    ? "조회 증가 대비"
    : "조회수 대비";
  const channelStats = youtubeChannelQuery.data;
  const subscriberSparklinePoints = useMemo(
    () =>
      buildAdminDashboardChannelGrowthSparklinePoints(
        channelStats?.previousSubscriberCount,
        channelStats?.subscriberCount,
      ),
    [channelStats?.previousSubscriberCount, channelStats?.subscriberCount],
  );
  const isSubscriberLoading =
    youtubeChannelQuery.isLoading || pendingSkeletonPeriod === period;
  const hasSubscriberCount = channelStats?.subscriberCount != null;
  const cumulativeVideoTotal = channelStats?.videoCount ?? stats.totalVideos;
  const hasSnapshotVideoCountComparison =
    period !== "ALL" &&
    typeof channelStats?.videoCount === "number" &&
    (typeof channelStats.previousVideoCount === "number" ||
      typeof channelStats.videoDelta === "number");
  const periodUploadVideoValue = hasSnapshotVideoCountComparison
    ? Math.max(0, channelStats?.videoDelta ?? 0)
    : visibleVideoTotal;
  const periodVideoCaption =
    period === "ALL"
      ? `전체 영상 · 현재 ${formatNumber(cumulativeVideoTotal)}`
      : hasSnapshotVideoCountComparison
        ? `${selectedPeriodLabel} · 채널 videoCount 순증 · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)} · 현재 ${formatNumber(cumulativeVideoTotal)}`
        : `${selectedPeriodLabel} 신규 업로드 · 현재 ${formatNumber(cumulativeVideoTotal)}`;
  const periodUploadVideoProgress =
    typeof periodUploadVideoValue === "number" && periodUploadVideoValue > 0
      ? Math.min(100, Math.max(12, periodUploadVideoValue * 6))
      : 0;
  const barRows = useMemo(
    () =>
      buildAdminDashboardBarRows(
        topContentVideosByInsightScore,
        topContentMetricMode,
        null,
        topContentMetricMode === "delta" ? periodUploadVideoValue : null,
      ),
    [
      periodUploadVideoValue,
      topContentVideosByInsightScore,
      topContentMetricMode,
    ],
  );
  const topContentComparisonCount = topContentVideosByInsightScore.length;
  const topContentCardMetric = hasPeriodGrowthComparison
    ? `업로드 영상 ${formatNumber(topContentComparisonCount)}개`
    : `선택 영상 ${formatNumber(topContentComparisonCount)}개`;
  const uploadCountCohortChange = calculateDashboardUploadCountChange(
    growthVideos,
    period,
  );
  const videoCountChange =
    period !== "ALL" &&
    typeof channelStats?.videoCount === "number" &&
    typeof channelStats.previousVideoCount === "number"
      ? calculateDashboardChange(
          channelStats.videoCount,
          channelStats.previousVideoCount,
        )
      : uploadCountCohortChange;
  const subscriberDelta =
    period !== "ALL" &&
    typeof channelStats?.subscriberDelta === "number" &&
    Number.isFinite(channelStats.subscriberDelta)
      ? channelStats.subscriberDelta
      : null;
  const subscriberChange =
    typeof subscriberDelta === "number" &&
    typeof channelStats?.previousSubscriberCount === "number"
      ? calculateDashboardChange(
          channelStats.subscriberCount ?? 0,
          channelStats.previousSubscriberCount,
        )
      : null;
  const subscriberValue = isSubscriberLoading
    ? "—"
    : formatNumber(channelStats?.subscriberCount);
  const subscriberCaption = isSubscriberLoading
    ? "채널 통계 불러오는 중"
    : channelStats?.unavailable?.code === "LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE"
      ? "로컬 채널 스냅샷 없음 · KPI 수집 후 표시"
    : !hasSubscriberCount
      ? "채널 통계 확인 필요"
      : subscriberDelta == null
        ? `현재 구독자 · YouTube Data API · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}`
        : `현재 구독자 · ${selectedPeriodLabel} 기간 순증 ${formatSignedNumber(subscriberDelta)} · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}`;
  const subscriberCardTitle = "현재 구독자";
  const viewCardTitle = hasPeriodGrowthComparison
    ? "기간 조회 증가"
    : "기간 조회 합계";
  const likeCardTitle = hasPeriodGrowthComparison
    ? "기간 좋아요 증가"
    : "기간 좋아요 합계";
  const commentCardTitle = hasPeriodGrowthComparison
    ? "기간 댓글 증가"
    : "기간 댓글 합계";
  const pendingTotal = stats.pendingTotal;
  const missingCoordinates =
    typeof stats.totalRestaurants === "number" &&
    typeof stats.withCoordinates === "number"
      ? Math.max(0, stats.totalRestaurants - stats.withCoordinates)
      : null;
  const operationalAssets = [
    {
      label: "영상 수",
      value: formatNumber(visibleVideoTotal),
      rawValue: visibleVideoTotal ?? 0,
    },
    {
      label: "맛집 데이터",
      value: formatNumber(stats.totalRestaurants),
      rawValue: stats.totalRestaurants ?? 0,
    },
    {
      label: "좌표 완료",
      value: formatNumber(stats.withCoordinates),
      rawValue: stats.withCoordinates ?? 0,
    },
    {
      label: "영상 연결",
      value: formatNumber(stats.totalVideos),
      rawValue: stats.totalVideos ?? 0,
    },
  ];
  const operationalLiabilities = [
    {
      label: "제보 대기",
      value: formatNumber(stats.pendingRestaurantSubmissions),
      rawValue: stats.pendingRestaurantSubmissions,
    },
    {
      label: "추천 대기",
      value: formatNumber(stats.pendingRecommendationRequests),
      rawValue: stats.pendingRecommendationRequests,
    },
    {
      label: "리뷰 대기",
      value: formatNumber(stats.pendingReviews),
      rawValue: stats.pendingReviews,
    },
    {
      label: "좌표 미완료",
      value: formatNumber(missingCoordinates),
      rawValue: missingCoordinates ?? 0,
    },
    {
      label: "비활성 배너",
      value: formatNumber(stats.inactiveBanners),
      rawValue: stats.inactiveBanners ?? 0,
    },
  ];
  const impactTableRows = useMemo(
    () =>
      videosByInsightScore.map((video) => ({
        id: video.id,
        title: video.title,
        qualityBadges: getAdminDashboardVideoQualityBadges(video),
        views: hasPeriodGrowthComparison
          ? getNonNegativeMetricDelta(getVideoViewDelta(video))
          : video.viewCount,
        engagement: hasPeriodGrowthComparison
          ? getNonNegativeMetricDelta(getVideoEngagementDelta(video))
          : getVideoEngagementTotal(video),
        engagementRate: getDashboardRatio(
          hasPeriodGrowthComparison
            ? getNonNegativeMetricDelta(getVideoEngagementDelta(video))
            : getVideoEngagementTotal(video),
          hasPeriodGrowthComparison
            ? getNonNegativeMetricDelta(getVideoViewDelta(video))
            : video.viewCount,
        ),
      })),
    [hasPeriodGrowthComparison, videosByInsightScore],
  );
  const trendTableRows = useMemo(
    () =>
      videosByPublishedAt.map((video) => {
        const views = hasPeriodGrowthComparison
          ? getNonNegativeMetricDelta(getVideoViewDelta(video))
          : video.viewCount;
        const engagement = hasPeriodGrowthComparison
          ? getNonNegativeMetricDelta(getVideoEngagementDelta(video))
          : getVideoEngagementTotal(video);

        return {
          label: formatDashboardDateLabel(video.publishedAt),
          qualityBadges: getAdminDashboardVideoQualityBadges(video),
          views,
          engagement,
          engagementRate: getDashboardRatio(engagement, views),
        };
      }),
    [hasPeriodGrowthComparison, videosByPublishedAt],
  );
  const topContentTableRows = useMemo(
    () =>
      barRows.map((row) => ({
        title: row.label,
        qualityBadges: row.qualityBadges,
        views: row.viewCount,
        likes: row.likeCount,
        comments: row.commentCount,
        viewBenchmarkLabel: row.viewBenchmarkLabel,
        viewBenchmark: row.viewBenchmark,
        viewBenchmarkTooltip: row.viewBenchmarkTooltip,
        viewBenchmarkTooltipLines: row.viewBenchmarkTooltipLines,
        viewMedianMultipleLabel: row.viewMedianMultipleLabel,
        likeBenchmark: formatDashboardAverageComparison(
          row.likeCount,
          row.likeAverage,
        ),
        commentBenchmark: formatDashboardAverageComparison(
          row.commentCount,
          row.commentAverage,
        ),
      })),
    [barRows],
  );
  const dashboardProgressiveInitialRows = isDashboardMobileViewport
    ? ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_INITIAL_ROWS
    : ADMIN_DASHBOARD_PROGRESSIVE_INITIAL_ROWS;
  const dashboardProgressiveBatchRows = isDashboardMobileViewport
    ? ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_BATCH_ROWS
    : ADMIN_DASHBOARD_PROGRESSIVE_BATCH_ROWS;
  const dashboardProgressiveDelayMs = isDashboardMobileViewport
    ? ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_DELAY_MS
    : ADMIN_DASHBOARD_PROGRESSIVE_DELAY_MS;
  const shouldDeferDashboardHeavyBodies =
    isDashboardMobileViewport &&
    !isDashboardOrderEditorOpen &&
    fullscreenWidgetId == null;
  const progressiveImpactTableRows = useAdminDashboardProgressiveItems(
    impactTableRows,
    dashboardProgressiveInitialRows,
    dashboardProgressiveBatchRows,
    dashboardProgressiveDelayMs,
  );
  const progressiveTrendPoints = useAdminDashboardProgressiveItems(
    trendPoints,
    dashboardProgressiveInitialRows,
    dashboardProgressiveBatchRows,
    dashboardProgressiveDelayMs,
  );
  const progressiveTrendTableRows = useAdminDashboardProgressiveItems(
    trendTableRows,
    dashboardProgressiveInitialRows,
    dashboardProgressiveBatchRows,
    dashboardProgressiveDelayMs,
  );
  const progressiveTopContentTableRows = useAdminDashboardProgressiveItems(
    topContentTableRows,
    dashboardProgressiveInitialRows,
    dashboardProgressiveBatchRows,
    dashboardProgressiveDelayMs,
  );
  const trendTableColumns = useMemo(() => {
    const columns: Array<
      AdminDashboardTableColumn<(typeof trendTableRows)[number]>
    > = [
      {
        key: "label",
        header: "게시일",
        cell: (row) => (
          <span className="inline-flex max-w-full items-center gap-1">
            <span className="truncate">{row.label}</span>
            <AdminDashboardQualityBadges badges={row.qualityBadges} />
          </span>
        ),
      },
    ];

    if (trendSeriesVisibility.views) {
      columns.push({
        key: "views",
        header: "조회수",
        align: "right",
        cell: (row) => (
          <span className="font-bold tabular-nums text-foreground">
            {formatNumber(row.views)}
          </span>
        ),
      });
    }

    if (trendSeriesVisibility.engagement) {
      columns.push({
        key: "engagement",
        header: "참여",
        align: "right",
        className: "w-[15%]",
        cell: (row) => formatNumber(row.engagement),
      });
    }

    if (trendSeriesVisibility.engagementRate) {
      columns.push({
        key: "engagementRate",
        header: "참여율",
        align: "right",
        className: "w-[15%]",
        cell: (row) => formatDashboardPercent(row.engagementRate),
      });
    }

    return columns;
  }, [trendSeriesVisibility]);
  const topContentTableColumns = useMemo(() => {
    const columns: Array<
      AdminDashboardTableColumn<(typeof topContentTableRows)[number]>
    > = [
      {
        key: "title",
        header: "영상 제목",
        className: "w-[34%] max-w-0",
        cell: (row) => (
          <span className="inline-flex max-w-full items-center gap-1" title={row.title}>
            <span className="block truncate font-bold">{row.title}</span>
            <AdminDashboardQualityBadges badges={row.qualityBadges} />
          </span>
        ),
      },
    ];

    if (topContentSeriesVisibility.views) {
      columns.push({
        key: "views",
        className: "w-[12%]",
        header: "조회수",
        align: "right",
        cell: (row) => (
          <span className="font-bold tabular-nums text-foreground">
            {formatNumber(row.views)}
          </span>
        ),
      });
    }

    if (topContentSeriesVisibility.likes) {
      columns.push({
        key: "likes",
        header: "좋아요",
        align: "right",
        className: "w-[12%]",
        cell: (row) => (
          <span className="font-bold tabular-nums text-foreground">
            {formatNumber(row.likes)}
          </span>
        ),
      });
    }

    if (topContentSeriesVisibility.comments) {
      columns.push({
        key: "comments",
        header: "댓글",
        align: "right",
        className: "w-[12%]",
        cell: (row) => (
          <span className="font-bold tabular-nums text-foreground">
            {formatNumber(row.comments)}
          </span>
        ),
      });
    }

    columns.push({
      key: "benchmark",
      header: "성과 기여",
      className: "w-[30%]",
      cell: (row) => (
        <AdminDashboardInlineTooltip
          label={`${row.title} 성과 기여`}
          lines={[
            ...row.viewBenchmarkTooltipLines,
            `좋아요 ${row.likeBenchmark}`,
            `댓글 ${row.commentBenchmark}`,
          ]}
          className="block truncate font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {row.viewBenchmark}
        </AdminDashboardInlineTooltip>
      ),
    });

    return columns;
  }, [topContentSeriesVisibility]);
  const topContentInsights = useMemo(
    () =>
      buildAdminDashboardContentInsights(
        topContentVideosByInsightScore,
        topContentMetricMode,
        insightQuery.data?.asOf,
        subscriberDelta,
        null,
      ),
    [
      insightQuery.data?.asOf,
      subscriberDelta,
      topContentVideosByInsightScore,
      topContentMetricMode,
    ],
  );
  const diagnosisTableRows = useMemo(
    () =>
      topContentInsights.map((insight, index) => ({
        id: `${insight.label}-${insight.title}-${index}`,
        signal: insight.label,
        title: insight.title,
        qualityBadges: insight.qualityBadges,
        description: insight.description,
      })),
    [topContentInsights],
  );
  const topContentContributionFormula = `계산식: ${
    hasPeriodGrowthComparison
      ? "기간 성과 기여 = 조회 증가 기여×60% + 좋아요 증가 기여×25% + 댓글 증가 기여×15%."
      : "성과 기여 = 조회 기여×60% + 좋아요 기여×25% + 댓글 기여×15%."
  }`;
  const pdfReportData = useMemo<
    Omit<AdminDashboardPdfReportData, "generatedAtLabel">
  >(() => {
    const metricInputs = [
      {
        label: subscriberCardTitle,
        value: subscriberValue,
        caption: subscriberCaption,
      },
      {
        label: viewCardTitle,
        value: isChartLoading ? "—" : formatNumber(periodViewDisplayValue),
        caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeViewValue)}`,
      },
      {
        label: likeCardTitle,
        value: isChartLoading ? "—" : formatNumber(periodLikeDisplayValue),
        caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`,
      },
      {
        label: commentCardTitle,
        value: isChartLoading ? "—" : formatNumber(periodCommentDisplayValue),
        caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`,
      },
      {
        label: "업로드 영상 수",
        value: isChartLoading ? "—" : formatNumber(periodUploadVideoValue),
        caption: periodVideoCaption,
      },
    ];
    const topReportRows = topContentTableRows.slice(0, 5);
    return {
      title: "쯔양 KPI 대시보드 보고서",
      periodLabel: selectedPeriodLabel,
      basisLabel: dashboardViewMetricLabel,
      summaryLabel: `${selectedPeriodLabel} 기준 핵심 KPI, 상위 콘텐츠, 성과 진단을 한 페이지 보고서로 정리했습니다.`,
      contributionFormula: topContentContributionFormula,
      metrics: metricInputs,
      topContents: topReportRows.map((row, index) => ({
        rank: `#${index + 1}`,
        title: row.title,
        views: formatNumber(row.views),
        likes: formatNumber(row.likes),
        comments: formatNumber(row.comments),
        contribution: row.viewBenchmark,
      })),
      insights: topContentInsights.map((insight) => ({
        label: insight.label,
        title: insight.title,
        description: insight.description,
        scoreLabel: insight.scoreLabel,
      })),
    };
  }, [
    commentCardTitle,
    cumulativeCommentValue,
    cumulativeLikeValue,
    cumulativeViewValue,
    dashboardViewMetricLabel,
    isChartLoading,
    likeCardTitle,
    periodCommentDisplayValue,
    periodLikeDisplayValue,
    periodMetricCaption,
    periodUploadVideoValue,
    periodVideoCaption,
    periodViewDisplayValue,
    selectedPeriodLabel,
    subscriberCaption,
    subscriberCardTitle,
    subscriberValue,
    topContentContributionFormula,
    topContentInsights,
    topContentTableRows,
    viewCardTitle,
  ]);
  const handleExportPdfReport = useCallback(() => {
    const opened = openAdminDashboardPdfReport({
      ...pdfReportData,
      generatedAtLabel: formatAdminDashboardReportGeneratedAt(),
    });

    if (!opened) {
      setDashboardOrderMessage(
        "PDF 보고서 창을 열지 못했습니다. 브라우저 팝업 허용 상태를 확인해 주세요.",
      );
    } else {
      setDashboardOrderMessage(
        "PDF 보고서 창을 열었습니다. 새 창에서 PDF로 저장/인쇄 버튼이나 브라우저 인쇄 대화상자를 확인해 주세요.",
      );
    }
  }, [pdfReportData]);
  const shouldShowMobileDashboardLoadingPrompt =
    isDashboardMobileViewport && (isLoading || isSubscriberLoading || isChartLoading);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:min-h-0 lg:overflow-visible"
      aria-label="관리자 대시보드 (KPI)"
      data-admin-dashboard-management="true"
      data-layout-recipe="command-surface"
      data-admin-dashboard-realtime-charts="true"
      data-admin-dashboard-channel-kpi="true"
    >
      <div className="mb-2 flex shrink-0 flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="hidden min-w-0 md:block">
          <h1 className="text-xl font-extrabold leading-tight tracking-[0.01em] text-foreground text-balance">
            Tzuyang KPI Dashboard
          </h1>
        </div>
        <div
          className="flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pb-1 scrollbar-hide [scrollbar-width:none] md:w-auto md:flex-wrap md:items-start md:justify-end md:overflow-visible md:pb-0 md:gap-1 [&::-webkit-scrollbar]:hidden"
          data-admin-dashboard-action-bar="true"
          data-admin-dashboard-action-order="order-reset-report-collection-period"
          data-allow-horizontal-scroll="true"
          data-horizontal-scroll-owner="admin-dashboard-action-bar"
        >
          <div
            className="order-1 flex shrink-0 items-center justify-end gap-1"
            data-admin-dashboard-action-group="order"
          >
            <Button
              type="button"
              variant={isDashboardOrderEditorOpen ? "default" : "outline"}
              size="sm"
              className="h-7 shrink-0 rounded-full px-2 text-[11px]"
              aria-label="KPI 카드 직접 드래그 순서 설정"
              aria-pressed={isDashboardOrderEditorOpen}
              disabled={isDashboardOrderLoading}
              data-admin-dashboard-widget-order-trigger="direct-drag"
              onClick={() => {
                setDraggedDashboardWidgetId(null);
                setIsDashboardOrderEditorOpen((current) => !current);
                setDashboardOrderMessage(
                  isDashboardOrderEditorOpen
                    ? "카드 순서 편집을 종료했습니다."
                    : "같은 레이아웃 영역 안에서 카드를 드래그하면 순서가 자동 저장됩니다.",
                );
              }}
            >
              카드 순서
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-full px-2 text-[11px]"
              disabled={
                isDashboardOrderLoading ||
                isDashboardOrderSaving ||
                isDashboardWidgetOrderDefault
              }
              data-admin-dashboard-widget-order-reset="true"
              aria-label="KPI 카드 순서를 처음 상태로 초기화"
              onClick={() => void resetDashboardWidgetOrder()}
            >
              초기화
            </Button>
          </div>
          <div
            className="order-2 flex shrink-0 items-center justify-end gap-1"
            data-admin-dashboard-action-group="report"
          >
            <AdminDashboardPdfReportButton onExport={handleExportPdfReport} />
            <AdminDashboardCollectionLogPopover
              open={isCollectionLogsOpen}
              logs={collectionLogsQuery.data}
              isLoading={collectionLogsQuery.isLoading}
              isFetching={collectionLogsQuery.isFetching}
              isError={collectionLogsQuery.isError}
              onOpenChange={setIsCollectionLogsOpen}
              onRefresh={() => void collectionLogsQuery.refetch()}
            />
          </div>
          <AdminDashboardPeriodSelector
            value={period}
            onChange={(nextPeriod) => {
              if (nextPeriod !== period) {
                setPendingSkeletonPeriod(nextPeriod);
                setPeriod(nextPeriod);
              }
            }}
          />
        </div>
      </div>
      {shouldShowMobileDashboardLoadingPrompt ? (
        <p
          className="mb-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[11px] font-semibold leading-5 text-muted-foreground md:hidden"
          data-admin-dashboard-mobile-loading-prompt="live"
        >
          KPI 데이터를 불러오는 중입니다. 모바일에서는 핵심 카드부터 순서대로 표시됩니다.
        </p>
      ) : null}

      {isDashboardOrderEditorOpen ? (
        <p
          className="mb-2 shrink-0 text-[11px] font-semibold text-muted-foreground"
          data-admin-dashboard-order-live-status="true"
        >
          {dashboardOrderMessage}
        </p>
      ) : null}


      {fullscreenWidgetId ? (
        <button
          type="button"
          className="fixed inset-0 z-[70] cursor-default bg-background/70 backdrop-blur-sm"
          aria-label="전체화면 카드 닫기"
          data-admin-dashboard-card-fullscreen-backdrop="true"
          onClick={() => setFullscreenWidgetId(null)}
        />
      ) : null}

      <div
        className="grid min-w-0 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-10 lg:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-visible"
        data-admin-dashboard-order-mode={
          isDashboardOrderEditorOpen ? "direct-drag" : "off"
        }
      >
        <AdminDashboardKpiCard
          widgetId="subscribers"
          title={subscriberCardTitle}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("subscribers"),
          )}
          style={getDashboardCardOrderStyle("subscribers")}
          reorderProps={getDashboardCardReorderProps("subscribers")}
          value={subscriberValue}
          caption={subscriberCaption}
          progress={hasSubscriberCount ? 100 : 0}
          tone="teal"
          emphasis="supporting"
          sparklineData={subscriberSparklinePoints}
          delta={formatDashboardChangeLabel(subscriberChange)}
          deltaLabel="기간 대비"
          isLoading={isSubscriberLoading}
          infoLines={[
            "설명: 채널 구독자 수를 보여주는 카드입니다.",
            "읽는 법: 큰 숫자는 현재 전체 구독자 수입니다. 기간 동안 늘어난 구독자는 우상단의 기간 대비 값과 설명 문구에서 확인합니다.",
            "계산식: 기간 구독자 증가 = API가 제공한 delta를 우선 사용하고, 없을 때만 현재 구독자 - 이전 구독자로 계산합니다.",
            `참고: 채널 delta 원천은 ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}입니다.`,
            "주의: 제목 옆 변화율은 이전 스냅샷 대비 증가 또는 감소 비율입니다.",
          ]}
        />
        <AdminDashboardKpiCard
          widgetId="views"
          title={viewCardTitle}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("views"),
          )}
          style={getDashboardCardOrderStyle("views")}
          reorderProps={getDashboardCardReorderProps("views")}
          value={isChartLoading ? "—" : formatNumber(periodViewDisplayValue)}
          caption={`${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeViewValue)}`}
          delta={formatDashboardChangeLabel(viewChange)}
          deltaLabel="기간 대비"
          progress={getDashboardChangeProgress(viewChange)}
          tone="sky"
          emphasis="primary"
          sparklineData={viewSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "설명: 선택 기간 영상들의 조회수 합계를 보여주는 카드입니다.",
            "읽는 법: 비교 스냅샷이 있으면 기간 동안 늘어난 조회수, 없으면 선택 기간 영상의 현재 조회수 합계입니다.",
            "계산식: 기간 조회 증가 = 각 영상의 (현재 조회수 - 이전 조회수) 합계.",
            "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
            `비교 커버리지: ${getAdminDashboardCoverageLabel(insightQuery.data?.meta?.comparisonCoverage)}.`,
            "참고: 제목 옆 기간 대비는 이전 스냅샷 대비 증감률입니다.",
            "주의: 아래 작은 선은 영상 게시일 순서에 따른 조회수 흐름입니다.",
          ]}
        />
        <AdminDashboardKpiCard
          widgetId="likes"
          title={likeCardTitle}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("likes"),
          )}
          style={getDashboardCardOrderStyle("likes")}
          reorderProps={getDashboardCardReorderProps("likes")}
          value={isChartLoading ? "—" : formatNumber(periodLikeDisplayValue)}
          caption={
            likeRate == null
              ? `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`
              : `${periodRatioCaptionPrefix} ${formatDashboardPercent(likeRate)} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`
          }
          delta={formatDashboardChangeLabel(likeChange)}
          deltaLabel="기간 대비"
          progress={getDashboardChangeProgress(likeChange)}
          tone="rose"
          emphasis="supporting"
          sparklineData={likeSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "설명: 선택 기간 영상들의 좋아요 합계를 보여주는 카드입니다.",
            "읽는 법: 비교 스냅샷이 있으면 기간 동안 늘어난 좋아요 수, 없으면 선택 기간 영상의 현재 좋아요 합계입니다.",
            "계산식: 기간 좋아요 증가 = 각 영상의 (현재 좋아요 - 이전 좋아요) 합계.",
            "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
            `비교 커버리지: ${getAdminDashboardCoverageLabel(insightQuery.data?.meta?.comparisonCoverage)}.`,
            "참고: 좋아요 비율은 조회수 중 좋아요로 반응한 비중입니다.",
            "주의: 조회 대비 비율은 조회수 중 좋아요로 반응한 비중을 뜻합니다.",
          ]}
        />
        <AdminDashboardKpiCard
          widgetId="comments"
          title={commentCardTitle}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("comments"),
          )}
          style={getDashboardCardOrderStyle("comments")}
          reorderProps={getDashboardCardReorderProps("comments")}
          value={isChartLoading ? "—" : formatNumber(periodCommentDisplayValue)}
          caption={
            commentRate == null
              ? `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`
              : `${periodRatioCaptionPrefix} ${formatDashboardPercent(commentRate)} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`
          }
          delta={formatDashboardChangeLabel(commentChange)}
          deltaLabel="기간 대비"
          progress={getDashboardChangeProgress(commentChange)}
          tone="amber"
          emphasis="supporting"
          sparklineData={commentSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "설명: 선택 기간 영상들의 댓글 합계를 보여주는 카드입니다.",
            "읽는 법: 비교 스냅샷이 있으면 기간 동안 늘어난 댓글 수, 없으면 선택 기간 영상의 현재 댓글 합계입니다.",
            "계산식: 기간 댓글 증가 = 각 영상의 (현재 댓글 - 이전 댓글) 합계.",
            "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
            `비교 커버리지: ${getAdminDashboardCoverageLabel(insightQuery.data?.meta?.comparisonCoverage)}.`,
            "참고: 댓글 비율은 조회수 중 댓글로 반응한 비중입니다.",
            "주의: 조회 대비 댓글 비율은 조회수 중 댓글로 반응한 비중을 뜻합니다.",
          ]}
        />
        <AdminDashboardKpiCard
          widgetId="videos"
          title="업로드 영상 수"
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("videos"),
          )}
          style={getDashboardCardOrderStyle("videos")}
          reorderProps={getDashboardCardReorderProps("videos")}
          value={isChartLoading ? "—" : formatNumber(periodUploadVideoValue)}
          caption={periodVideoCaption}
          delta={formatDashboardChangeLabel(videoCountChange)}
          deltaLabel="기간 대비"
          progress={periodUploadVideoProgress}
          tone="teal"
          emphasis="supporting"
          sparklineData={videoCountSparklinePoints}
          isLoading={isChartLoading}
          infoLines={[
            "설명: 선택 기간에 새로 올라온 영상 수를 보여주는 카드입니다.",
            "읽는 법: 채널 스냅샷이 있으면 videoCount 차이, 없으면 선택 기간 영상 목록 개수를 사용합니다.",
            "계산식: 업로드 영상 수 = API가 제공한 videoDelta를 우선 사용하고, 없을 때만 현재 channel videoCount - 이전 channel videoCount로 계산합니다.",
            `참고: 채널 delta 원천은 ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}입니다.`,
            "주의: 업로드 수는 조회수·좋아요·댓글 카드와 함께 봐야 성과를 판단할 수 있습니다.",
          ]}
        />

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-3",
            getDashboardReorderCardClassName("impact"),
            isDashboardWidgetFullscreen("impact") &&
              adminDashboardFullscreenCardClassName,
          )}
          style={getDashboardCardOrderStyle("impact")}
          data-admin-dashboard-widget-card="impact"
          data-admin-dashboard-card-fullscreen={
            isDashboardWidgetFullscreen("impact") ? "true" : undefined
          }
          {...getDashboardCardReorderProps("impact")}
        >
          <AdminDashboardCardTitle
            title="상위 영상 영향도"
            metric={impactMetricLabel}
            infoLines={[
              hasPeriodGrowthComparison
                ? "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회 증가가 크고, 위로 갈수록 좋아요와 댓글 증가가 큽니다."
                : "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회수가 크고, 위로 갈수록 좋아요와 댓글 합계가 큽니다.",
              impactDisplayedVideoCount < dashboardUploadVideoBasisCount
                ? `표시: 그래프는 상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개, 표는 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.`
                : `표시: 그래프와 표 모두 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.`,
              "읽는 법: 원이 클수록 조회수와 반응을 합친 영향도가 큰 영상입니다. 색은 순위 구분입니다.",
              "계산식: 참여 = 좋아요 + 댓글.",
              hasPeriodGrowthComparison
                ? "기간 비교 때는 현재값에서 이전값을 뺀 증가량으로 위치를 잡습니다."
                : "비교 스냅샷이 없을 때는 증감률 대신 현재 조회수와 현재 반응값으로 위치를 잡습니다.",
              "참고: 감소분은 성과 기여 계산에서 0으로 분리해 과대평가를 막습니다.",
              "주의: 색보다 위치와 원 크기를 먼저 확인하세요.",
            ]}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardImpactRankLegend />
                <AdminDashboardViewToggle
                  value={getDashboardCardView("impact")}
                  onChange={(view) => setDashboardCardView("impact", view)}
                  label="상위 영상 영향도"
                />
                {renderDashboardFullscreenButton("impact")}
              </div>
            }
          />
          <AdminDashboardDeferredBody
            key={`impact-${period}-${getDashboardCardView("impact")}-${shouldDeferDashboardHeavyBodies}`}
            enabled={shouldDeferDashboardHeavyBodies}
            resetKey={`impact-${period}-${getDashboardCardView("impact")}`}
            variant={
              getDashboardCardView("impact") === "table" ? "table" : "bubble"
            }
          >
            {isChartLoading ? (
              <AdminDashboardPanelBodySkeleton
                variant={
                  getDashboardCardView("impact") === "table"
                    ? "table"
                    : "bubble"
                }
              />
            ) : getDashboardCardView("impact") === "table" ? (
              <AdminDashboardScrollTable
                rows={progressiveImpactTableRows}
                totalRows={impactTableRows.length}
                emptyText="표시할 영상 영향도 데이터가 없습니다."
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "title",
                    header: "영상 제목",
                    className: "w-[34%] max-w-0",
                    cell: (row) => (
                      <span
                        className="inline-flex max-w-full items-center gap-1"
                        title={row.title}
                      >
                        <span className="block truncate font-bold">
                          {row.title}
                        </span>
                        <AdminDashboardQualityBadges badges={row.qualityBadges} />
                      </span>
                    ),
                  },
                  {
                    key: "views",
                    className: "w-[18%]",
                    header: hasPeriodGrowthComparison ? "조회 증가" : "조회수",
                    align: "right",
                    cell: (row) => (
                      <span className="font-bold tabular-nums text-foreground">
                        {formatNumber(row.views)}
                      </span>
                    ),
                  },
                  {
                    key: "engagement",
                    header: hasPeriodGrowthComparison ? "참여 증가" : "참여",
                    align: "right",
                    className: "w-[15%]",
                    cell: (row) => formatNumber(row.engagement),
                  },
                  {
                    key: "engagementRate",
                    header: "참여율",
                    align: "right",
                    className: "w-[15%]",
                    cell: (row) => formatDashboardPercent(row.engagementRate),
                  },
                ]}
              />
            ) : (
              <AdminDashboardBubbleChart
                key={`impact-${period}`}
                videos={videosByInsightScore}
                metricMode={topContentMetricMode}
                displayLimit={impactChartVideoLimit}
              />
            )}
          </AdminDashboardDeferredBody>
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-4",
            getDashboardReorderCardClassName("trend"),
            isDashboardWidgetFullscreen("trend") &&
              adminDashboardFullscreenCardClassName,
          )}
          style={getDashboardCardOrderStyle("trend")}
          data-admin-dashboard-widget-card="trend"
          data-admin-dashboard-card-fullscreen={
            isDashboardWidgetFullscreen("trend") ? "true" : undefined
          }
          {...getDashboardCardReorderProps("trend")}
        >
          <AdminDashboardCardTitle
            title="영상별 성과 분포"
            metric={trendMetricLabel}
            infoLines={[
              "설명: 선택 기간 업로드 영상을 게시일 순서로 놓고 조회수, 참여, 참여율을 비교합니다.",
              `표시: 그래프와 표 모두 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.`,
              "읽는 법: 조회·반응(좋아요+댓글)·반응률을 각각 100점 기준으로 맞춰 같은 눈금에서 비교합니다.",
              "참고: 참여는 좋아요와 댓글을 더한 값이고, 참여율은 조회수 대비 참여 비중입니다.",
              "계산식: 정규화 점수 = 해당 값 / 해당 지표 최고값 × 100.",
              hasPeriodGrowthComparison
                ? "비교 스냅샷이 있으면 조회 증감률을 제목에 함께 표시합니다."
                : "비교 스냅샷이 없어서 제목에는 현재값 기준이라고 표시합니다.",
              "주의: 실제 숫자보다 흐름과 튀는 항목을 찾는 용도입니다.",
            ]}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardSeriesToggle
                  label="영상별 성과 분포"
                  options={[
                    {
                      key: "views",
                      label: "조회수",
                      dotClassName: "bg-teal-500",
                    },
                    {
                      key: "engagement",
                      label: "참여",
                      dotClassName: "bg-muted-foreground/45",
                    },
                    {
                      key: "engagementRate",
                      label: "참여율",
                      dotClassName: "bg-amber-500",
                    },
                  ]}
                  visibility={trendSeriesVisibility}
                  onToggle={toggleTrendSeries}
                />
                <AdminDashboardViewToggle
                  value={getDashboardCardView("trend")}
                  onChange={(view) => setDashboardCardView("trend", view)}
                  label="영상별 성과 분포"
                />
                {renderDashboardFullscreenButton("trend")}
              </div>
            }
          />
          <AdminDashboardDeferredBody
            key={`trend-${period}-${getDashboardCardView("trend")}-${shouldDeferDashboardHeavyBodies}`}
            enabled={shouldDeferDashboardHeavyBodies}
            resetKey={`trend-${period}-${getDashboardCardView("trend")}`}
            variant={
              getDashboardCardView("trend") === "table" ? "table" : "line"
            }
          >
            {isChartLoading ? (
              <AdminDashboardPanelBodySkeleton
                variant={
                  getDashboardCardView("trend") === "table" ? "table" : "line"
                }
              />
            ) : getDashboardCardView("trend") === "table" ? (
              <AdminDashboardScrollTable
                rows={progressiveTrendTableRows}
                totalRows={trendTableRows.length}
                emptyText="표시할 영상별 성과 분포 데이터가 없습니다."
                getRowKey={(row, index) => `${row.label}-${index}`}
                columns={trendTableColumns}
              />
            ) : (
              <AdminDashboardMultiLineChart
                key={`trend-${period}`}
                points={progressiveTrendPoints}
                totalPointCount={trendPoints.length}
                seriesVisibility={trendSeriesVisibility}
              />
            )}
          </AdminDashboardDeferredBody>
        </div>

        <AdminDashboardOpsSummaryCard
          sections={[
            {
              title: "운영 자산",
              rows: operationalAssets,
              totalLabel: "합계",
              totalValue: formatNumber(
                (stats.totalRestaurants ?? 0) +
                  (stats.totalVideos ?? 0) +
                  (stats.activeBanners ?? 0),
              ),
            },
            {
              title: "검수 리스크",
              rows: operationalLiabilities,
              totalLabel: "합계",
              totalValue: formatNumber(
                pendingTotal === null
                  ? null
                  : pendingTotal +
                      (missingCoordinates ?? 0) +
                      (stats.inactiveBanners ?? 0),
              ),
            },
          ]}
          className={cn(
            "sm:col-span-2 lg:col-span-3",
            getDashboardReorderCardClassName("ops"),
          )}
          reorderProps={getDashboardCardReorderProps("ops")}
          style={getDashboardCardOrderStyle("ops")}
          view={getDashboardCardView("ops")}
          onViewChange={(view) => setDashboardCardView("ops", view)}
          isLoading={isLoading}
        />


        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[360px] flex-col overflow-hidden p-3 sm:min-h-[220px] sm:col-span-2 lg:col-span-5",
            getDashboardReorderCardClassName("topContent"),
          )}
          style={getDashboardCardOrderStyle("topContent")}
          data-admin-dashboard-widget-card="topContent"
          {...getDashboardCardReorderProps("topContent")}
        >
          <AdminDashboardCardTitle
            title="콘텐츠 성과 TOP 5"
            metric={topContentCardMetric}
            infoLines={[
              "설명: 그래프는 선택 기간 업로드 영상 중 상위 5개를 요약하고, 표는 전체 영상을 보여줍니다.",
              hasPeriodGrowthComparison
                ? "읽는 법: 막대는 선택 기간 업로드 영상의 조회·좋아요·댓글 증가량을 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다."
                : "읽는 법: 막대는 조회·좋아요·댓글 수를 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다.",
              "막대 기준: 각 색 조각은 그래프에 표시된 상위 5개 안에서 해당 영상이 차지하는 비중입니다.",
              topContentContributionFormula,
              hasPeriodGrowthComparison
                ? "용어: 조회·좋아요·댓글 증가 기여는 각각 선택 기간 업로드 영상 전체 증가 합계 중 이 영상이 차지한 비율입니다."
                : "용어: 조회·좋아요·댓글 기여는 각각 선택 기간 영상 전체 합계 중 이 영상이 차지한 비율입니다.",
              hasPeriodGrowthComparison
                ? "비교 대상: 선택 기간에 새로 올라온 업로드 영상입니다."
                : "예시: 조회 기여 10%, 좋아요 기여 6%, 댓글 기여 4%라면 가중치를 적용해 하나의 성과 기여로 봅니다.",
              hasPeriodGrowthComparison
                ? "처리: 이전 스냅샷이 없으면 현재 조회·좋아요·댓글을 증가분으로 봅니다."
                : "처리: 선택 기간 영상의 현재 조회·좋아요·댓글을 그대로 사용합니다.",
              hasPeriodGrowthComparison
                ? "전체값: 선택 기간 업로드 영상의 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다."
                : "전체값: 선택 기간 영상의 조회·좋아요·댓글 합계를 각각 분모로 사용합니다.",
              "참고: 감소분은 성과 기여 계산에서 0으로 분리해 과대평가를 막습니다.",
              "주의: 그래프는 빠른 요약이고, 표 보기는 선택 기간 전체 영상을 확인하는 용도입니다.",
            ]}
            action={
              <div className="flex min-w-fit flex-nowrap items-center justify-end gap-1">
                <AdminDashboardSeriesToggle
                  label="콘텐츠 성과 TOP 5"
                  options={[
                    {
                      key: "views",
                      label: "조회수",
                      dotClassName: "bg-teal-500",
                    },
                    {
                      key: "likes",
                      label: "좋아요",
                      dotClassName: "bg-muted-foreground/45",
                    },
                    {
                      key: "comments",
                      label: "댓글",
                      dotClassName: "bg-muted-foreground/30",
                    },
                  ]}
                  visibility={topContentSeriesVisibility}
                  onToggle={toggleTopContentSeries}
                />
                <AdminDashboardViewToggle
                  value={getDashboardCardView("topContent")}
                  onChange={(view) => setDashboardCardView("topContent", view)}
                  label="콘텐츠 성과 TOP 5"
                />
              </div>
            }
          />
          <AdminDashboardDeferredBody
            key={`topContent-${period}-${getDashboardCardView("topContent")}-${shouldDeferDashboardHeavyBodies}`}
            enabled={shouldDeferDashboardHeavyBodies}
            resetKey={`topContent-${period}-${getDashboardCardView("topContent")}`}
            variant={
              getDashboardCardView("topContent") === "table"
                ? "table"
                : "stacked"
            }
          >
            {isChartLoading ? (
              <AdminDashboardPanelBodySkeleton
                variant={
                  getDashboardCardView("topContent") === "table"
                    ? "table"
                    : "stacked"
                }
              />
            ) : getDashboardCardView("topContent") === "table" ? (
              <AdminDashboardScrollTable
                rows={progressiveTopContentTableRows}
                totalRows={topContentTableRows.length}
                emptyText="표시할 콘텐츠 성과 데이터가 없습니다."
                getRowKey={(row, index) => `${row.title}-${index}`}
                columns={topContentTableColumns}
              />
            ) : (
              <AdminDashboardGroupedBarChart
                rows={barRows}
                seriesVisibility={topContentSeriesVisibility}
              />
            )}
          </AdminDashboardDeferredBody>
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[360px] flex-col overflow-hidden p-2 sm:min-h-[220px] sm:col-span-2 lg:col-span-5",
            getDashboardReorderCardClassName("engagementRate"),
          )}
          style={getDashboardCardOrderStyle("engagementRate")}
          data-admin-dashboard-widget-card="engagementRate"
          {...getDashboardCardReorderProps("engagementRate")}
        >
          <AdminDashboardCardTitle
            title="성과 진단"
            metric={`진단 신호 ${formatNumber(topContentInsights.length)}개 · ${topContentCardMetric}`}
            infoLines={[
              "설명: 지금 확인할 만한 영상 성과 신호를 요약한 카드입니다.",
              "읽는 법: 성과 기여, 참여율, 초반 반응, 재상승 후보를 작은 카드로 분류합니다.",
              "참고: 성과 기여는 TOP 5와 같은 기준으로 조회·좋아요·댓글 기여를 함께 봅니다.",
              "참고: 참여율은 조회수 대비 좋아요와 댓글 반응 비중입니다.",
              "계산식: 신호 강도 = 카드별 규칙 점수를 0~100 범위로 표시한 값입니다.",
              "주의: 조회수만 보지 말고 기여도와 참여율을 함께 확인하세요.",
            ]}
            action={
              <div className="ml-auto flex min-w-fit shrink-0 flex-nowrap items-center gap-2">
                <AdminDashboardDiagnosisMeta
                  periodLabel={selectedPeriodLabel}
                />
                <AdminDashboardViewToggle
                  value={getDashboardCardView("engagementRate")}
                  onChange={(view) =>
                    setDashboardCardView("engagementRate", view)
                  }
                  label="성과 진단"
                />
              </div>
            }
          />
          <AdminDashboardDeferredBody
            key={`engagementRate-${period}-${getDashboardCardView("engagementRate")}-${shouldDeferDashboardHeavyBodies}`}
            enabled={shouldDeferDashboardHeavyBodies}
            resetKey={`engagementRate-${period}-${getDashboardCardView("engagementRate")}`}
            variant={
              getDashboardCardView("engagementRate") === "table"
                ? "table"
                : "diagnosis"
            }
          >
            {isChartLoading ? (
              <AdminDashboardPanelBodySkeleton
                variant={
                  getDashboardCardView("engagementRate") === "table"
                    ? "table"
                    : "diagnosis"
                }
              />
            ) : getDashboardCardView("engagementRate") === "table" ? (
              <AdminDashboardScrollTable
                rows={diagnosisTableRows}
                emptyText="표시할 성과 진단 데이터가 없습니다."
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "signal",
                    header: "신호",
                    className: "w-[22%]",
                    cell: (row) => (
                      <span className="block truncate font-bold text-muted-foreground">
                        {row.signal}
                      </span>
                    ),
                  },
                  {
                    key: "title",
                    header: "영상",
                    className: "w-[38%] max-w-0",
                    cell: (row) => (
                      <span
                        className="inline-flex max-w-full items-center gap-1"
                        title={row.title}
                      >
                        <span className="block truncate font-bold">
                          {row.title}
                        </span>
                        <AdminDashboardQualityBadges badges={row.qualityBadges} />
                      </span>
                    ),
                  },
                  {
                    key: "description",
                    header: "판단 근거",
                    className: "w-[40%] max-w-0",
                    cell: (row) => (
                      <span className="block truncate" title={row.description}>
                        {row.description}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <AdminDashboardDiagnosisBoard
                insights={topContentInsights}
                metricMode={topContentMetricMode}
                periodLabel={selectedPeriodLabel}
              />
            )}
          </AdminDashboardDeferredBody>
        </div>
      </div>
      <div className="mt-2 shrink-0" data-admin-system-status-slot="true">
        <AdminSystemStatusCenter isAdmin={isAdmin} />
      </div>
    </section>
  );
}

function AdminSidebar({
  activeModuleId,
  onSelectModule,
  isCollapsed,
  showLabels,
  onToggleCollapsed,
  showMobileHeader,
  canLoadPreferences,
  stats,
  accountDisplayName,
  accountEmail,
}: {
  activeModuleId: AdminModuleId;
  onSelectModule: (moduleId: AdminModuleId) => void;
  isCollapsed: boolean;
  showLabels: boolean;
  onToggleCollapsed: () => void;
  showMobileHeader: boolean;
  canLoadPreferences: boolean;
  stats: AdminOverviewStats;
  accountDisplayName: string;
  accountEmail: string;
}) {
  const [sidebarOrder, setSidebarOrder] = useState<AdminSidebarOrderPreference>(
    DEFAULT_ADMIN_SIDEBAR_ORDER,
  );
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isOrderLoading, setIsOrderLoading] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [sidebarOrderMessage, setSidebarOrderMessage] = useState(
    "메뉴 순서는 관리자 계정별로 저장됩니다.",
  );
  const [isSidebarOrderEditMode, setIsSidebarOrderEditMode] = useState(false);
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
  const orderedSidebarSections = useMemo(
    () => buildOrderedSidebarSections(sidebarOrder),
    [sidebarOrder],
  );
  const activeSidebarItem = orderedSidebarSections
    .flatMap((section) => section.items)
    .find((item) => item.id === activeModuleId);
  const activeSidebarLabel = activeSidebarItem?.title ?? "전체 현황";

  useEffect(() => {
    if (!canLoadPreferences) {
      setIsOrderLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadSidebarOrder() {
      setIsOrderLoading(true);
      try {
        const response = await fetch("/api/admin/preferences/sidebar-order", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) return;

        const payload = (await response.json()) as { order?: unknown };
        if (!controller.signal.aborted) {
          setSidebarOrder(normalizeAdminSidebarOrder(payload.order));
        }
      } catch {
        if (!controller.signal.aborted) {
          setSidebarOrderMessage(
            "저장된 메뉴 순서를 불러오지 못해 처음 상태로 표시합니다.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsOrderLoading(false);
        }
      }
    }

    void loadSidebarOrder();

    return () => {
      controller.abort();
    };
  }, [canLoadPreferences]);

  const persistSidebarOrder = useCallback(
    async (nextOrder: AdminSidebarOrderPreference, successMessage: string) => {
      if (!canLoadPreferences) return;

      const normalizedOrder = normalizeAdminSidebarOrder(nextOrder);
      setSidebarOrder(normalizedOrder);
      setIsOrderSaving(true);
      setSidebarOrderMessage("메뉴 순서를 저장하는 중입니다.");

      try {
        const response = await fetch("/api/admin/preferences/sidebar-order", {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ order: normalizedOrder }),
        });

        if (!response.ok) throw new Error("sidebar-order-save-failed");

        const payload = (await response.json()) as { order?: unknown };
        setSidebarOrder(normalizeAdminSidebarOrder(payload.order));
        setSidebarOrderMessage(successMessage);
      } catch {
        setSidebarOrderMessage(
          "저장하지 못했습니다. 화면에는 임시 순서가 반영되어 있습니다.",
        );
      } finally {
        setIsOrderSaving(false);
      }
    },
    [canLoadPreferences],
  );

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

  const [themePreference, setThemePreference] =
    useState<AdminThemePreference>("light");

  useEffect(() => {
    const initialTheme = normalizeAdminThemePreference(
      window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY),
    );
    setThemePreference(initialTheme);
    applyAdminThemePreference(initialTheme);
  }, []);

  useEffect(() => {
    if (themePreference !== "system") return;

    const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyAdminThemePreference("system");

    systemThemeQuery.addEventListener("change", syncSystemTheme);

    return () => {
      systemThemeQuery.removeEventListener("change", syncSystemTheme);
    };
  }, [themePreference]);

  const updateThemePreference = useCallback(
    (nextTheme: AdminThemePreference) => {
      setThemePreference(nextTheme);
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
      applyAdminThemePreference(nextTheme);
    },
    [],
  );

  const handleMenuNavigation = (moduleId: AdminModuleId) => {
    onSelectModule(moduleId);
    setIsAdminMenuOpen(false);
  };

  useEffect(() => {
    if (!showMobileHeader) {
      setIsAdminMenuOpen(false);
    }
  }, [showMobileHeader]);
  useEffect(() => {
    const element = mobileHeaderRef.current;
    if (!element) return;

    element.setAttribute(
      "data-admin-console-mobile-header-visible",
      showMobileHeader ? "true" : "false",
    );
    element.style.transform = showMobileHeader
      ? "translate3d(0, 0, 0)"
      : "translate3d(0, -120%, 0)";
    element.style.pointerEvents = showMobileHeader ? "" : "none";
  }, [showMobileHeader]);


  const renderMenuItem = (
    item: SidebarSection["items"][number],
    section: SidebarSection,
    mode: "dropdown" | "sidebar",
  ) => {
    const Icon = item.icon;
    const isActive = activeModuleId === item.id;
    const itemStatus = getItemStatus(item.id);
    const isDropdown = mode === "dropdown";
    const button = (
      <button
        type="button"
        aria-label={
          itemStatus ? `${item.title} ${itemStatus.label}` : item.title
        }
        aria-current={isActive ? "page" : undefined}
        aria-controls="admin-console-canvas"
        data-admin-console-menu-item-mode={isDropdown ? "mobile-dropdown" : "desktop-sidebar"}
        data-admin-console-menu-item-state={isActive ? "active" : "inactive"}
        className={cn(
          "group relative flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap border text-left transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
          isDropdown
            ? "min-h-9 w-full rounded-lg px-2 py-1.5 text-[13px]"
            : "min-h-9 w-full rounded-lg px-2 py-1 text-sm",
          !isDropdown &&
            isCollapsed &&
            "md:mx-auto md:h-8 md:min-h-8 md:w-8 md:justify-center md:gap-0 md:px-0",
          isActive
            ? "border-primary/20 bg-primary text-primary-foreground shadow-primary"
            : "border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground",
        )}
        onClick={() =>
          isDropdown ? handleMenuNavigation(item.id) : onSelectModule(item.id)
        }
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center border transition-colors motion-reduce:transition-none",
            isDropdown ? "h-6 w-6 rounded-md" : "h-6 w-6 rounded-md",
            isActive
              ? "border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
              : "border-border bg-background/80 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary",
          )}
          aria-hidden="true"
        >
          <Icon className={cn(isDropdown ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
            !isDropdown &&
              (!showLabels || isCollapsed) &&
              "md:hidden md:w-0 md:flex-none md:opacity-0",
          )}
        >
          <span className="block truncate font-semibold leading-5">
            {item.title}
          </span>
          {item.badge && (
            <span
              className={cn(
                "mt-0.5 block truncate text-[11px] font-semibold leading-4",
                getSidebarBadgeClassName(section.label, isActive),
              )}
              data-admin-sidebar-badge-tone={section.label}
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
              !isDropdown &&
                (!showLabels || isCollapsed) &&
                "md:absolute md:right-1 md:top-1 md:h-2 md:w-2 md:border-0 md:p-0 md:text-[0px]",
            )}
            aria-hidden="true"
          >
            {itemStatus.value}
          </span>
        )}
      </button>
    );

    if (mode === "sidebar" && isCollapsed) {
      return (
        <UiTooltipProvider key={item.id} delayDuration={120}>
          <UiTooltip>
            <UiTooltipTrigger asChild>{button}</UiTooltipTrigger>
            <UiTooltipContent
              side="right"
              align="center"
              className={adminDashboardTooltipPortalClassName}
              data-admin-sidebar-collapsed-tooltip="true"
            >
              <AdminDashboardTooltipLinesPanel
                lines={item.badge ? [item.title, item.badge] : [item.title]}
                dataAttribute="sidebar-collapsed"
                className="max-w-[14rem]"
              />
            </UiTooltipContent>
          </UiTooltip>
        </UiTooltipProvider>
      );
    }

    return <Fragment key={item.id}>{button}</Fragment>;
  };

  const renderOrderControls = (placement: "dropdown" | "sidebar") => (
    <div
      id="admin-sidebar-order-editor"
      className="rounded-2xl bg-background/85 p-2"
      aria-label="메뉴 순서 설정"
      data-admin-sidebar-order-editor={placement}
      data-admin-sidebar-order-edit-mode={isSidebarOrderEditMode ? "enabled" : "locked"}
      data-admin-sidebar-order-editor-density="compact"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-foreground">
            메뉴 순서
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={isSidebarOrderEditMode ? "default" : "outline"}
            size="sm"
            className="h-6 shrink-0 rounded-full px-2 text-[11px] font-bold"
            aria-pressed={isSidebarOrderEditMode}
            data-admin-sidebar-order-edit-toggle="true"
            onClick={() => {
              setIsSidebarOrderEditMode((current) => !current);
              setSidebarOrderMessage(
                isSidebarOrderEditMode
                  ? "메뉴 순서 편집을 잠갔습니다."
                  : "메뉴 순서 편집을 켰습니다. 화살표로 변경 후 자동 저장됩니다.",
              );
            }}
          >
            {isSidebarOrderEditMode ? "편집 잠금" : "편집 켜기"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 shrink-0 rounded-full px-2 text-[11px] font-bold"
            disabled={
              !isSidebarOrderEditMode ||
              !canLoadPreferences ||
              isOrderLoading ||
              isOrderSaving
            }
            data-admin-sidebar-order-loading={isOrderLoading ? "true" : "false"}
            onClick={() =>
              void persistSidebarOrder(
                DEFAULT_ADMIN_SIDEBAR_ORDER,
                "처음 상태로 되돌렸습니다.",
              )
            }
          >
            초기화
          </Button>
        </div>
      </div>

      {!isSidebarOrderEditMode && (
        <p
          className="mb-1.5 rounded-lg border border-dashed border-border bg-muted/25 px-2 py-1 text-[11px] leading-5 text-muted-foreground"
          data-admin-sidebar-order-edit-lock-message="true"
        >
          순서 편집을 켜야 이동 버튼이 활성화됩니다.
        </p>
      )}

      <div className="space-y-2">
        {orderedSidebarSections.map((section, sectionIndex) => (
          <div
            key={section.label}
            className="space-y-0.5 border-t border-border/55 pt-2 first:border-t-0 first:pt-0"
            data-admin-sidebar-order-section="compact"
          >
            <div className="flex h-5 items-center justify-between gap-1.5 px-1">
              <span className="truncate text-[11px] font-semibold text-muted-foreground">
                {section.label}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`${section.label} 섹션 앞으로`}
                  disabled={
                    !canLoadPreferences ||
                    !isSidebarOrderEditMode ||
                    isOrderLoading ||
                    sectionIndex === 0 ||
                    isOrderSaving
                  }
                  onClick={() =>
                    void persistSidebarOrder(
                      moveAdminSidebarSection(sidebarOrder, section.label, -1),
                      `${section.label} 섹션을 앞으로 옮겼습니다.`,
                    )
                  }
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`${section.label} 섹션 뒤로`}
                  disabled={
                    !canLoadPreferences ||
                    !isSidebarOrderEditMode ||
                    isOrderLoading ||
                    sectionIndex === orderedSidebarSections.length - 1 ||
                    isOrderSaving
                  }
                  onClick={() =>
                    void persistSidebarOrder(
                      moveAdminSidebarSection(sidebarOrder, section.label, 1),
                      `${section.label} 섹션을 뒤로 옮겼습니다.`,
                    )
                  }
                >
                  ↓
                </Button>
              </div>
            </div>

            <div className="space-y-0.5">
              {section.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-muted/55"
                  data-admin-sidebar-order-item="compact"
                >
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {item.title}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-background/80 hover:text-foreground"
                      aria-label={`${item.title} 메뉴 앞으로`}
                      disabled={
                        !canLoadPreferences ||
                        !isSidebarOrderEditMode ||
                        isOrderLoading ||
                        itemIndex === 0 ||
                        isOrderSaving
                      }
                      onClick={() =>
                        void persistSidebarOrder(
                          moveAdminSidebarItem(
                            sidebarOrder,
                            section.label,
                            item.id,
                            -1,
                          ),
                          `${item.title} 메뉴를 앞으로 옮겼습니다.`,
                        )
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-md border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:bg-background/80 hover:text-foreground"
                      aria-label={`${item.title} 메뉴 뒤로`}
                      disabled={
                        !canLoadPreferences ||
                        !isSidebarOrderEditMode ||
                        isOrderLoading ||
                        itemIndex === section.items.length - 1 ||
                        isOrderSaving
                      }
                      onClick={() =>
                        void persistSidebarOrder(
                          moveAdminSidebarItem(
                            sidebarOrder,
                            section.label,
                            item.id,
                            1,
                          ),
                          `${item.title} 메뉴를 뒤로 옮겼습니다.`,
                        )
                      }
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p
        className="mt-2 rounded-lg bg-muted/30 px-2 py-1 text-[11px] leading-5 text-muted-foreground"
        aria-live="polite"
      >
        {sidebarOrderMessage}
      </p>
    </div>
  );

  const renderThemeControls = (
    placement: "dropdown" | "sidebar",
    options: { compact?: boolean } = {},
  ) => {
    const isSidebarPlacement = placement === "sidebar";
    const isCompactSidebar =
      options.compact ?? (isSidebarPlacement && isCollapsed);
    const [currentTheme, currentThemeLabel, nextThemeLabel, ThemeIcon] =
      getAdminThemeOption(themePreference);
    const nextTheme = getNextAdminThemePreference(themePreference);
    const controlLabel = `${currentThemeLabel} 사용 중 · 클릭하면 ${getAdminThemeChangeLabel(nextThemeLabel)}`;

    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-9 rounded-full border border-border bg-card text-xs font-bold text-muted-foreground shadow-inner transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background dark:border-border/70 dark:bg-muted/35 dark:text-foreground dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:hover:bg-muted/55 data-[admin-sidebar-theme-current=dark]:border-border/70 data-[admin-sidebar-theme-current=dark]:bg-muted/35 data-[admin-sidebar-theme-current=dark]:text-foreground data-[admin-sidebar-theme-current=dark]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] data-[admin-sidebar-theme-current=dark]:hover:bg-muted/55",
          isCompactSidebar
            ? "w-9 justify-center p-0"
            : "w-full min-w-0 justify-start gap-2 px-3",
        )}
        aria-label={controlLabel}
        title={controlLabel}
        data-admin-sidebar-theme-toggle="true"
        data-admin-sidebar-theme-cycle="single-button"
        data-admin-sidebar-theme-current={currentTheme}
        data-admin-sidebar-preference-placement={placement}
        data-admin-sidebar-theme-layout={placement}
        onClick={() => updateThemePreference(nextTheme)}
      >
        <ThemeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className={cn("min-w-0 truncate", isCompactSidebar && "sr-only")}>
          {currentThemeLabel}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 text-[10px] font-semibold text-muted-foreground",
            isCompactSidebar && "sr-only",
          )}
          aria-hidden="true"
        >
          다음: {nextThemeLabel}
        </span>
      </Button>
    );
  };

  const renderAdminMenuContent = (contentId: string) => (
    <PopoverContent
      id={contentId}
      align="end"
      sideOffset={10}
      className="scrollbar-hide max-h-[min(720px,calc(100dvh-20px))] w-[min(23rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-xl border-border bg-card p-2 shadow-primary"
      style={{ maxHeight: "min(720px, calc(100dvh - 20px))" }}
      aria-label="관리자 콘솔 메뉴"
      data-admin-console-menu-dropdown="true"
    >
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/35 p-2">
        <Link
          href="/"
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background"
          aria-label="쯔동여지도 홈으로 이동"
          onClick={() => setIsAdminMenuOpen(false)}
        >
          <Image
            src="/logo.webp"
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            className="h-7 w-7 rounded-lg object-contain"
            priority
          />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-foreground">
            관리자 콘솔
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            현재 화면 · {activeSidebarLabel}
          </p>
        </div>
      </div>

      <nav className="grid gap-1.5" aria-label="관리자 통합 메뉴">
        {orderedSidebarSections.map((section) => (
          <div key={section.label} className="min-w-0 rounded-xl bg-background/45 p-1">
            <p className="px-1.5 pb-1 text-[10px] font-extrabold tracking-[0.08em] text-muted-foreground">
              {section.label}
            </p>
            {section.items.map((item) =>
              renderMenuItem(item, section, "dropdown"),
            )}
          </div>
        ))}
      </nav>

      <div className="mt-2">{renderThemeControls("dropdown")}</div>

      <div className="mt-2">{renderOrderControls("dropdown")}</div>
    </PopoverContent>
  );
  const sidebarAccountAvatarClassName =
    "relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary transition-colors group-hover/sidebar-account:bg-primary/15";
  const sidebarAccountAvatarIconClassName = "h-5 w-5 -translate-y-px";

  const renderSidebarAccountMenuContent = (contentId: string) => (
    <PopoverContent
      id={contentId}
      side="right"
      align="end"
      sideOffset={10}
      className="max-h-[min(760px,calc(100dvh-24px))] w-[min(24rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
      aria-label="계정 및 사이드바 설정"
      data-admin-sidebar-account-menu-content="true"
    >
      <div
        className="mb-3 flex items-center gap-2 rounded-2xl bg-muted/35 p-2"
        data-admin-sidebar-account-summary="true"
      >
        <span
          className={sidebarAccountAvatarClassName}
          aria-hidden="true"
          data-admin-sidebar-account-avatar="true"
        >
          <UserRound className={sidebarAccountAvatarIconClassName} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-foreground">
            {accountDisplayName}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {accountEmail}
          </p>
        </div>
      </div>

      <div className="space-y-2" data-admin-sidebar-account-theme-section="true">
        <p className="px-1 text-[11px] font-bold tracking-[0.08em] text-muted-foreground">
          표시 모드
        </p>
        {renderThemeControls("sidebar", { compact: false })}
      </div>

      <div
        className="mt-3 border-t border-border/60 pt-3"
        data-admin-sidebar-account-order-section="true"
      >
        {renderOrderControls("sidebar")}
      </div>
    </PopoverContent>
  );

  const renderSidebarAccountMenu = () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "group/sidebar-account transition-colors duration-150 focus-visible:ring-primary focus-visible:ring-offset-background",
            isCollapsed
              ? "grid h-9 w-9 place-items-center rounded-xl bg-transparent p-0 text-muted-foreground shadow-none hover:bg-background/80 hover:text-foreground dark:hover:bg-muted/55"
              : "h-11 w-full min-w-0 justify-start gap-2 rounded-2xl border border-border bg-background/95 px-1.5 py-1 text-foreground shadow-sm backdrop-blur-sm hover:bg-secondary/80 hover:text-accent-foreground dark:border-border/70 dark:bg-background/80",
          )}
          aria-label={`${accountDisplayName} 계정 및 사이드바 설정 열기`}
          data-admin-sidebar-account-trigger={isCollapsed ? "collapsed" : "expanded"}
          data-admin-sidebar-account-chrome="integrated"
        >
          <span
            className={sidebarAccountAvatarClassName}
            aria-hidden="true"
            data-admin-sidebar-account-avatar="true"
          >
            <UserRound className={sidebarAccountAvatarIconClassName} aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1 text-left", isCollapsed && "sr-only")}>
            <span className="block truncate text-xs font-extrabold text-foreground">
              {accountDisplayName}
            </span>
            <span className="block truncate text-[10px] font-semibold text-muted-foreground">
              계정·표시·메뉴 설정
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      {renderSidebarAccountMenuContent("admin-sidebar-account-menu")}
    </Popover>
  );

  return (
    <>
      <Popover open={isAdminMenuOpen} onOpenChange={setIsAdminMenuOpen}>
        <div
          ref={mobileHeaderRef}
          className={cn(
            "flex h-14 shrink-0 transform-gpu items-center gap-2 overflow-hidden border-b border-border bg-card/95 px-3 py-2 shadow-sm transition-[transform,border-color] duration-300 ease-out will-change-transform motion-reduce:transition-none md:hidden",
            !showMobileHeader && "pointer-events-none border-transparent",
          )}
          style={{
            transform: showMobileHeader
              ? "translate3d(0, 0, 0)"
              : "translate3d(0, -120%, 0)",
          }}
          data-admin-console-mobile-header="true"
          data-admin-console-mobile-header-visible={
            showMobileHeader ? "true" : "false"
          }
        >
          <Link
            href="/"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background text-foreground"
            aria-label="쯔동여지도 홈으로 이동"
          >
            <Image
              src="/logo.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-7 w-7 rounded-lg object-contain"
              priority
            />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-foreground">
              관리자 콘솔
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
              현재 화면 · {activeSidebarLabel}
            </p>
          </div>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 w-11 shrink-0 rounded-lg bg-transparent p-0 shadow-none hover:bg-muted/70 focus-visible:ring-primary focus-visible:ring-offset-background"
              aria-label="관리자 메뉴 열기"
              aria-expanded={isAdminMenuOpen}
              aria-controls="admin-console-menu-dropdown"
              data-admin-console-menu-trigger="hamburger"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </div>
        {renderAdminMenuContent("admin-console-menu-dropdown")}
      </Popover>

      <aside
        className={cn(
          "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden border-r border-border bg-gradient-to-b from-card via-card to-background/95 p-2 font-sans tracking-normal shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none md:flex",
          isCollapsed
            ? "md:w-[4.5rem] md:min-w-[4.5rem] md:max-w-[4.5rem] md:items-center md:px-1.5"
            : "md:min-w-[var(--admin-sidebar-expanded-width)] md:max-w-[var(--admin-sidebar-expanded-max-width)]",
        )}
        aria-label="관리자 콘솔 사이드바"
        data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}
        data-admin-sidebar-scroll="hidden-scrollbar"
        data-layout-primitives="fixed-sidenav-shell scroll-body-shell sidebar"
      >
        <div
          className={cn(
            "mb-1.5 flex min-h-9 items-center gap-2 border-b border-border/70 px-1 pb-1.5 transition-[border-color] duration-200 motion-reduce:transition-none",
            isCollapsed &&
              "md:h-[3.5625rem] md:min-h-[3.5625rem] md:w-[3.5625rem] md:items-center md:justify-center md:px-0 md:py-0",
          )}
          data-admin-sidebar-header="true"
        >
          <Link
            href="/"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-transparent text-foreground transition hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
              isCollapsed && "md:hidden",
            )}
            aria-label="쯔동여지도 홈으로 이동"
          >
            <Image
              src="/logo.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-7 w-7 rounded-lg object-contain"
              priority
            />
          </Link>
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
              (!showLabels || isCollapsed) && "md:hidden",
            )}
            data-admin-sidebar-header-copy="true"
          >
            <h2 className="truncate whitespace-nowrap text-sm font-bold tracking-normal text-foreground text-pretty">
              관리자 콘솔
            </h2>
            <p className="mt-0.5 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
              현재 화면 · {activeSidebarLabel}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "group relative ml-auto inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background dark:hover:bg-muted/55",
              isCollapsed && "md:m-0",
            )}
            aria-label={
              isCollapsed ? "관리자 사이드바 펼치기" : "관리자 사이드바 접기"
            }
            aria-expanded={!isCollapsed}
            aria-controls="admin-console-menu"
            data-admin-sidebar-collapse-toggle="true"
            data-admin-sidebar-collapse-logo-mode={
              isCollapsed ? "logo-hover-open-icon" : "icon"
            }
            data-admin-sidebar-collapse-visibility={
              isCollapsed ? "logo-hover" : "always-visible"
            }
            onClick={onToggleCollapsed}
          >
            {isCollapsed ? (
              <>
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none"
                  aria-hidden="true"
                  data-admin-sidebar-collapsed-logo="true"
                >
                  <Image
                    src="/logo.webp"
                    alt=""
                    width={28}
                    height={28}
                    sizes="28px"
                    className="h-7 w-7 rounded-lg object-contain"
                    priority
                  />
                </span>
                <PanelLeftOpen
                  className="relative z-10 h-5 w-5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                  aria-hidden="true"
                  data-admin-sidebar-collapsed-open-icon="true"
                />
              </>
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>
        </div>

        <div
          className={cn(
            "scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2",
            isCollapsed && "md:w-full",
          )}
          data-admin-sidebar-menu-scroll="hidden-scrollbar"
        >
          <nav
            id="admin-console-menu"
            aria-label="관리자 통합 메뉴"
            className={cn(
              "block space-y-3",
              isCollapsed && "md:flex md:w-full md:flex-col md:items-center",
            )}
            data-admin-sidebar-section-list="spacious"
          >
            {orderedSidebarSections.map((section) => (
              <div
                key={section.label}
                className={cn(
                  "block space-y-1.5",
                  isCollapsed &&
                    "md:flex md:w-full md:flex-col md:items-center",
                )}
              >
                <p
                  className={cn(
                    "px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none",
                    (!showLabels || isCollapsed) &&
                      "md:h-px md:px-0 md:opacity-0",
                  )}
                >
                  {section.label}
                </p>
                {section.items.map((item) =>
                  renderMenuItem(item, section, "sidebar"),
                )}
              </div>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            "shrink-0 pt-4",
            isCollapsed
              ? "flex w-full flex-col items-center gap-2 pb-1"
              : "space-y-3",
          )}
          data-admin-sidebar-footer-actions="true"
          aria-label="관리자 사이드바 설정"
        >
          {renderSidebarAccountMenu()}
        </div>
      </aside>
    </>
  );
}

function GuardedApplyCard() {
  return (
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
        <div className="flex flex-wrap items-center gap-2">
          {guardedSteps.map((step, index) => (
            <div key={step} className="flex items-center gap-2">
              <Badge
                variant={index === 0 ? "default" : "secondary"}
                className={cn(
                  index === 0 && "bg-primary text-primary-foreground",
                )}
              >
                {step}
              </Badge>
              {index < guardedSteps.length - 1 && (
                <span className="text-muted-foreground">→</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          제보 승인, 리뷰 반려, 맛집 삭제/복구, 배너 공개처럼 사용자에게 보이는
          변경은 적용 전에 한 번 더 확인하고, 적용 후에는 실제 상태를 다시 읽어
          관리자에게 보여주는 흐름을 기본값으로 둡니다.
        </p>
      </CardContent>
    </Card>
  );
}

function LlmSessionWorkspace() {
  return (
    <AdminEmbeddedModuleShell
      moduleId="llm"
      titleId="admin-llm-session-title"
      title="운영 보조"
      icon={Bot}
      summary="읽기 전용 · 제안만 제공 · 적용은 각 모듈에서"
      contentClassName="overflow-y-auto p-2 md:p-3"
    >
      <section aria-label="운영 보조 제안" className="space-y-3">
        <div className="grid gap-3 xl:grid-cols-3">
          {[
            [
              "현재 화면 요약",
              "선택한 모듈의 대기 건수, 실패 상태, 위험 액션 후보를 한 문단으로 요약합니다.",
            ],
            [
              "다음 검수 추천",
              "오래된 제보, 지오코딩 실패, 미승인 리뷰, 배너 공개 변경을 우선순위로 정리합니다.",
            ],
            [
              "위험 액션 체크리스트",
              "삭제·반려·공개 배너 변경 전 미리보기 → 확인 → 적용 → 재확인 → 감사 기록 순서를 확인합니다.",
            ],
          ].map(([title, description]) => (
            <Card key={title} className="border-border bg-card/95 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
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

function getAdminAuditActionLabel(action: string) {
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

function getAdminAuditStatusClassName(status: string) {
  switch (status) {
    case "applied":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "failed":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

function AuditPlaceholder() {
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
  const coverageBadgeLabel =
    isAuditAuthUnavailable
      ? "세션 확인 필요"
      : unavailable || auditEventsQuery.isError
        ? "읽기 확인 필요"
        : hasTruthfulCoverage
          ? `부분 감사 · ${events.length}개`
          : "범위 확인 필요";
  const adminAuditLoginHref = "/?auth=login&reason=admin&next=%2Fadmin%3Fmodule%3Daudit";

  return (
    <AdminEmbeddedModuleShell
      moduleId="audit"
      titleId="admin-audit-title"
      title="감사 로그"
      icon={ScrollText}
      summary={coverageBadgeLabel}
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
        </div>

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

type AdminMapOverlayTabId = "manual" | "trend-proposals" | "trend-runs";

const ADMIN_MAP_OVERLAY_TABS: Array<{
  id: AdminMapOverlayTabId;
  label: string;
  description: string;
}> = [
  {
    id: "manual",
    label: "수동 오버레이",
    description: "Preview → Confirm → Apply → Readback → Audit 수동 적용 흐름",
  },
  {
    id: "trend-proposals",
    label: "트렌드 제안",
    description: "승인 대기 트렌드/시즌 제안 검토와 원자적 승인",
  },
  {
    id: "trend-runs",
    label: "트렌드 실행",
    description: "백엔드 전용 실행 요청, 큐 상태, 취소/readback 확인",
  },
];

function AdminMapOverlayOperationsModule() {
  const [activeTab, setActiveTab] = useState<AdminMapOverlayTabId>("manual");
  const activeTabConfig =
    ADMIN_MAP_OVERLAY_TABS.find((tab) => tab.id === activeTab) ??
    ADMIN_MAP_OVERLAY_TABS[0];

  return (
    <AdminEmbeddedModuleShell
      moduleId="map-overlays"
      titleId="admin-map-overlays-title"
      title="지도 오버레이"
      icon={Layers3}
      summary={`${activeTabConfig.label} · readback/audit 확인 흐름`}
      contentClassName="overflow-y-auto p-2 md:p-3"
    >
      <section
        className="flex min-h-full min-w-0 flex-col gap-2 md:gap-3"
        aria-label="지도 오버레이 작업"
        data-admin-map-overlays-module="true"
        data-layout-primitives="panel-layout list-detail step-nav stack"
      >
        <div className="space-y-2 md:space-y-3">
          <Badge variant="outline" className="w-fit rounded-full">
            승인 데이터: admin_restaurant_map_overlays
          </Badge>
          <div
            role="tablist"
            aria-label="지도 오버레이 작업 탭"
            className="grid grid-cols-3 gap-1 rounded-xl bg-muted/35 p-1 md:gap-2 md:bg-transparent md:p-0"
            data-admin-map-overlays-tabs="manual trend-proposals trend-runs"
          >
            {ADMIN_MAP_OVERLAY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={cn(
                  "min-w-0 rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:rounded-xl md:p-3",
                  activeTab === tab.id
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border bg-background/70 text-muted-foreground hover:bg-muted/60",
                )}
                data-admin-map-overlays-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="block truncate text-xs font-extrabold md:text-sm">{tab.label}</span>
                <span className="mt-0.5 hidden text-xs leading-5 md:block">
                  {tab.description}
                </span>
              </button>
            ))}
          </div>

          <div
            className="min-w-0 rounded-xl bg-background/70 p-2 md:rounded-2xl md:border md:border-border/70 md:p-3"
            data-admin-map-overlays-active-tab={activeTab}
          >
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {activeTabConfig.label}
            </p>
            {activeTab === "manual" ? (
              <div className="mt-2 grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-2">
                <div className="rounded-lg bg-card/80 p-2 md:rounded-xl md:p-3">
                  <p className="font-bold text-foreground">수동 적용 계약</p>
                  <p className="mt-1">
                    `/api/admin/map-overlays/preview`에서 해시와 readback을
                    확인한 뒤 `/api/admin/map-overlays/apply`가 audit RPC로만
                    승인 데이터를 변경합니다.
                  </p>
                </div>
                <div className="rounded-lg bg-card/80 p-2 md:rounded-xl md:p-3">
                  <p className="font-bold text-foreground">운영 순서</p>
                  <p className="mt-1">
                    Preview → Confirm → Apply → Readback → Audit. 공개 홈 지도는
                    관리자 오버레이 API를 직접 호출하지 않습니다.
                  </p>
                </div>
              </div>
            ) : activeTab === "trend-proposals" ? (
              <div className="mt-3" data-admin-map-overlays-trend-proposals="true">
                <TrendProposalQueue />
              </div>
            ) : (
              <div
                className="mt-2 grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-3"
                data-admin-map-overlays-trend-runs="true"
              >
                <div className="rounded-lg bg-card/80 p-2 md:rounded-xl md:p-3">
                  <p className="font-bold text-foreground">요청 생성</p>
                  <p className="mt-1">
                    `/api/admin/trend-job-requests`는 관리자 요청만 큐에 등록하고
                    컬렉터/스코어러를 inline 실행하지 않습니다.
                  </p>
                </div>
                <div className="rounded-lg bg-card/80 p-2 md:rounded-xl md:p-3">
                  <p className="font-bold text-foreground">상태/취소</p>
                  <p className="mt-1">
                    상태 조회와 queued 취소는 owner-scoped readback으로 표시하며
                    worker claim 이후에는 취소를 성공처럼 꾸미지 않습니다.
                  </p>
                </div>
                <div className="rounded-lg bg-card/80 p-2 md:rounded-xl md:p-3">
                  <p className="font-bold text-foreground">백엔드 경계</p>
                  <p className="mt-1">
                    트렌드 수집/평가는 backend worker와 RPC finalization 경로에서만
                    진행됩니다.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </AdminEmbeddedModuleShell>
  );
}
function InlineModulePanel({
  module,
  initialStoryboardResult,
}: {
  module: ConsoleModule;
  initialStoryboardResult?: StoryboardInitialResult | null;
}) {
  if (module.id === "audit") {
    return <AuditPlaceholder />;
  }

  const moduleContent = (() => {
    switch (module.id) {
      case "restaurants":
        return (
          <AdminEvaluationModule
            key="restaurants"
            embedded
            initialView="evaluations"
          />
        );
      case "restaurant-refresh-history":
        return (
          <AdminRestaurantRefreshHistoryModule key="restaurant-refresh-history" />
        );
      case "submissions":
        return (
          <AdminEvaluationModule
            key="submissions"
            embedded
            initialView="submissions"
            initialSubmissionTab="new"
          />
        );
      case "reviews":
        return (
          <AdminEvaluationModule
            key="reviews"
            embedded
            initialView="submissions"
            initialSubmissionTab="reviews"
          />
        );
      case "map-overlays":
        return <AdminMapOverlayOperationsModule key="admin-map-overlays" />;
      case "banners":
        return <AdminBannerModule key="admin-banners" embedded />;
      case "storyboard":
        return (
          <AdminStoryboardGenerator
            key="admin-storyboard"
            initialStoryboardResult={initialStoryboardResult}
          />
        );
      case "youtube-thumbnail-generator":
        return (
          <AdminYoutubeThumbnailGenerator key="admin-youtube-thumbnail-generator" />
        );
      case "users":
        return <AdminUsersModule key="admin-users" />;
      case "insights":
        return <InsightsModule key="admin-insights" embedded />;
      default: {
        const exhaustiveModuleId: never = module.id;
        return exhaustiveModuleId;
      }
    }
  })();

  return (
    <section
      aria-label={`${module.title} 작업 화면`}
      className="flex min-h-full min-w-0 flex-col md:h-full md:min-h-0"
      data-admin-console-inline-module-frame="true"
      data-admin-console-inline-module-id={module.id}
    >
      <div
        className={cn(
          "min-h-[360px] flex-1 rounded-lg bg-background shadow-none md:min-h-0 md:rounded-xl md:border md:border-border md:shadow-sm",
          "overflow-visible md:overflow-hidden",
        )}
        data-admin-console-inline-module-panel="true"
      >
        {moduleContent}
      </div>
    </section>
  );
}

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
  | "audit-log";

type AdminConsoleCanvasSkeletonModuleId = AdminModuleId | "generic";

type AdminConsoleCanvasSkeletonConfig = {
  moduleId: AdminConsoleCanvasSkeletonModuleId;
  title: string;
  description: string;
  icon: typeof Store;
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

function getAdminConsoleModuleLoadingSkeleton(
  moduleId: AdminModuleId,
  title?: string,
) {
  if (moduleId === "overview") {
    return <AdminDashboardManagementSkeleton />;
  }

  if (moduleId === "storyboard") {
    return <AdminStoryboardModuleLoadingSkeleton />;
  }

  if (moduleId === "youtube-thumbnail-generator") {
    return <AdminYoutubeThumbnailModuleLoadingSkeleton />;
  }

  return <AdminConsoleCanvasSkeleton moduleId={moduleId} title={title} />;
}

function getAdminConsoleCanvasSkeletonConfig({
  moduleId,
  title,
}: {
  moduleId: AdminConsoleCanvasSkeletonModuleId;
  title?: string;
}): AdminConsoleCanvasSkeletonConfig {
  switch (moduleId) {
    case "restaurants":
      return {
        moduleId,
        title: title ?? "맛집 관리",
        description: "검수 테이블과 세부 액션 영역을 뷰포트 안에서 준비합니다.",
        icon: Store,
        variant: "evaluation-table",
      };
    case "submissions":
      return {
        moduleId,
        title: title ?? "제보 관리",
        description: "제보·수정 요청 목록과 판정 패널을 함께 준비합니다.",
        icon: ClipboardList,
        variant: "submission-queue",
      };
    case "reviews":
      return {
        moduleId,
        title: title ?? "리뷰 관리",
        description: "리뷰 검수 큐와 증빙 확인 패널을 함께 준비합니다.",
        icon: MessageSquareText,
        variant: "submission-queue",
      };
    case "restaurant-refresh-history":
      return {
        moduleId,
        title: title ?? "맛집 최신화",
        description: "최신화 후보 목록과 변경 이력 패널을 먼저 배치합니다.",
        icon: RefreshCw,
        variant: "refresh-history",
      };
    case "map-overlays":
      return {
        moduleId,
        title: title ?? "지도 오버레이",
        description: "수동 오버레이, 트렌드 제안, 트렌드 실행 탭을 준비합니다.",
        icon: Layers3,
        variant: "overlay-workspace",
      };
    case "banners":
      return {
        moduleId,
        title: title ?? "배너 관리",
        description: "배너 목록, 미디어 미리보기, 편집 폼을 한 화면에 준비합니다.",
        icon: ImageIcon,
        variant: "banner-editor",
      };
    case "users":
      return {
        moduleId,
        title: title ?? "사용자 관리",
        description: "계정 요약 카드와 사용자 표 구조를 먼저 고정합니다.",
        icon: UsersRound,
        variant: "user-table",
      };
    case "insights":
      return {
        moduleId,
        title: title ?? "핵심 인사이트",
        description: "지표 카드, 트리맵, 추세 차트를 뷰포트에 맞춰 준비합니다.",
        icon: BarChart2,
        variant: "insights-grid",
      };
    case "routes":
      return {
        moduleId,
        title: title ?? "맛집 동선 추천",
        description: "지도, 후보 목록, 동선 준비도 패널을 먼저 배치합니다.",
        icon: Route,
        variant: "route-map",
      };
    case "llm":
      return {
        moduleId,
        title: title ?? "운영 보조",
        description: "읽기 전용 요약 카드와 위험 액션 체크리스트를 준비합니다.",
        icon: Bot,
        variant: "llm-workspace",
      };
    case "audit":
      return {
        moduleId,
        title: title ?? "감사 로그",
        description: "결정 기록과 상태 재확인 타임라인 구조를 준비합니다.",
        icon: ScrollText,
        variant: "audit-log",
      };
    default:
      return {
        moduleId: "generic",
        title: title ?? "관리자 작업 화면",
        description: "사이드바 메뉴 화면의 구조를 먼저 준비합니다.",
        icon: Store,
        variant: "split-list-detail",
      };
  }
}

function AdminConsoleCanvasSkeleton({
  title,
  moduleId = "generic",
}: {
  title?: string;
  moduleId?: AdminConsoleCanvasSkeletonModuleId;
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
      <header
        className="flex shrink-0 flex-col gap-2 border-b border-border bg-card/95 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
        data-admin-sidebar-module-loading-header="true"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <HeaderIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-bold text-foreground">
              {config.title}
            </p>
            <p className="truncate text-xs font-semibold text-muted-foreground">
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

const EMPTY_SEARCH_PARAMS = new URLSearchParams();

export function AdminConsoleOverview({
  initialStoryboardResult = null,
}: {
  initialStoryboardResult?: StoryboardInitialResult | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
  const requestedModuleId = getAdminModuleIdFromSearchParams(searchParams);
  const { user, isLoading: authLoading, profileNickname } = useAuth();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasE2EAdminShellBypass, setHasE2EAdminShellBypass] = useState(() =>
    hasLocalE2EAdminShellBypass(),
  );
  const isShellBootstrapping = authLoading || !hasHydrated;
  const shouldRenderAdminShell =
    isShellBootstrapping || Boolean(user) || hasE2EAdminShellBypass;
  const canLoadAdminConsoleData =
    (Boolean(user) || hasE2EAdminShellBypass) && !isShellBootstrapping;
  const {
    stats,
    isLoading: statsLoading,
    hasError: statsHasError,
  } = useAdminOverviewStats(canLoadAdminConsoleData);
  const [activeModuleId, setActiveModuleId] =
    useState<AdminModuleId>(requestedModuleId);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [showSidebarLabels, setShowSidebarLabels] = useState(false);
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const [isAdminMobileViewport, setIsAdminMobileViewport] = useState(false);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeDescendantScrollTopRef = useRef(0);
  const previousMobileHeaderScrollTopRef = useRef(0);
  const lastAdminMobileChromeHideAtRef = useRef(0);
  const mobileChromeRevealTimeoutRef = useRef<number | null>(null);
  const mobileChromeHadDownScrollRef = useRef(false);
  const adminCanvasTouchStartYRef = useRef<number | null>(null);
  const previousRequestedModuleIdRef = useRef(requestedModuleId);
  const activeModule = consoleModules.find(
    (module) => module.id === activeModuleId,
  );
  const activeModuleLabel =
    activeModuleId === "overview"
      ? "대시보드 (KPI)"
      : activeModuleId === "routes"
        ? "맛집 동선 추천"
        : activeModuleId === "llm"
          ? "운영 보조"
          : activeModule?.title;
  const activeBrowserTitle = activeModuleLabel
    ? buildScopedBrowserTitle([activeModuleLabel, "관리자 콘솔"])
    : null;
  useDocumentTitle(activeBrowserTitle);
  const [loadedModuleIds, setLoadedModuleIds] = useState<
    ReadonlySet<AdminModuleId>
  >(createInitialAdminConsoleLoadedModuleIds);

  const userMetadataNickname =
    typeof user?.user_metadata?.nickname === "string"
      ? user.user_metadata.nickname.trim()
      : "";
  const adminAccountDisplayName =
    profileNickname ||
    userMetadataNickname ||
    user?.email?.split("@")[0] ||
    "관리자";
  const adminAccountEmail = user?.email ?? "관리자 세션";

  useEffect(() => {
    setHasHydrated(true);
    setHasE2EAdminShellBypass(hasLocalE2EAdminShellBypass());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY, "1");
    setIsSidebarCollapsed(true);
    setShowSidebarLabels(false);
  }, []);

  useEffect(() => {
    if (isSidebarCollapsed) {
      setShowSidebarLabels(false);
      return;
    }

    const revealLabelsTimer = window.setTimeout(() => {
      setShowSidebarLabels(true);
    }, SIDEBAR_LABEL_REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(revealLabelsTimer);
    };
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (loadedModuleIds.has(activeModuleId)) {
      return;
    }

    let isCancelled = false;

    void preloadAdminConsoleModule(activeModuleId)
      .catch((error) => {
        console.warn(`[admin-console] failed to preload ${activeModuleId} module chunk`);
      })
      .finally(() => {
        if (isCancelled) return;

        setLoadedModuleIds((currentModuleIds) => {
          if (currentModuleIds.has(activeModuleId)) return currentModuleIds;

          const nextModuleIds = new Set(currentModuleIds);
          nextModuleIds.add(activeModuleId);
          return nextModuleIds;
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeModuleId, loadedModuleIds]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateIsMobileViewport = () => {
      setIsAdminMobileViewport(mediaQuery.matches);
    };

    updateIsMobileViewport();
    mediaQuery.addEventListener("change", updateIsMobileViewport);

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobileViewport);
    };
  }, []);

  const selectModule = useCallback(
    (moduleId: AdminModuleId) => {
      const nextHref = buildCanonicalAdminModuleHref(moduleId);
      setActiveModuleId(moduleId);
      activeDescendantScrollTopRef.current = 0;
      previousMobileHeaderScrollTopRef.current = 0;
      setIsMobileHeaderVisible(true);

      router.replace(nextHref, {
        scroll: false,
      });

      window.requestAnimationFrame(() => {
        const currentHref = `${window.location.pathname}${window.location.search}`;
        if (currentHref !== nextHref) {
          window.history.replaceState(window.history.state, "", nextHref);
        }
        canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
        canvasRef.current?.focus({ preventScroll: true });
      });
    },
    [router],
  );

  const handleToggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((currentCollapsed) => {
      const nextCollapsed = !currentCollapsed;

      window.localStorage.setItem(
        ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY,
        nextCollapsed ? "1" : "session-expanded",
      );

      return nextCollapsed;
    });
  }, []);

  useEffect(() => {
    const stateWarning = getAdminModuleStateWarning(searchParams);
    const nextModuleId = requestedModuleId;
    const canonicalHref = buildCanonicalAdminHrefFromSearchParams(searchParams);
    const currentQuery = searchParams.toString();
    const currentHref = `/admin${currentQuery ? `?${currentQuery}` : ""}`;

    setActiveModuleId((current) =>
      current === nextModuleId ? current : nextModuleId,
    );

    if (previousRequestedModuleIdRef.current !== nextModuleId) {
      previousRequestedModuleIdRef.current = nextModuleId;
      activeDescendantScrollTopRef.current = 0;
      previousMobileHeaderScrollTopRef.current = 0;
      setIsMobileHeaderVisible(true);
    }

    if (stateWarning || currentHref !== canonicalHref) {
      router.replace(canonicalHref, { scroll: false });
    }
  }, [requestedModuleId, router, searchParams]);

  const getAdminConsoleScrollTop = useCallback(() => {
    if (typeof window === "undefined") return 0;

    const canvasScrollTop = canvasRef.current?.scrollTop ?? 0;
    const pageScrollTop = Math.max(
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    );

    return Math.max(
      canvasScrollTop,
      activeDescendantScrollTopRef.current,
      pageScrollTop,
    );
  }, []);

  const updateMobileHeaderVisibility = useCallback(() => {
    const currentScrollTop = getAdminConsoleScrollTop();

    setIsMobileHeaderVisible((current) => {
      const action = getMobileScrollNavVisibilityAction({
        previousScrollTop: previousMobileHeaderScrollTopRef.current,
        currentScrollTop,
        isHidden: !current,
        revealOnScrollUp: false,
      });

      previousMobileHeaderScrollTopRef.current = currentScrollTop;

      if (action === "hide") return false;
      if (action === "show") return true;

      return current;
    });
  }, [getAdminConsoleScrollTop]);

  const updateActiveDescendantScrollTop = useCallback((eventTarget: EventTarget | null) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement || !(eventTarget instanceof Element)) {
      activeDescendantScrollTopRef.current = 0;
      return;
    }

    if (eventTarget === canvasElement) {
      activeDescendantScrollTopRef.current = 0;
      return;
    }

    if (canvasElement.contains(eventTarget)) {
      activeDescendantScrollTopRef.current = eventTarget.scrollTop;
    }
  }, []);

  const adminBottomNavAutoHide = useMobileBottomNavAutoHide({
    scrollRef: canvasRef,
    source: "admin-console",
    disabled: !isAdminMobileViewport,
    revealOnScrollUp: false,
    getScrollTop: getAdminConsoleScrollTop,
  });

  const setAdminMobileChromeHidden = useCallback(
    (hidden: boolean) => {
      const isMobileViewportNow =
        isAdminMobileViewport ||
        window.matchMedia("(max-width: 767px)").matches;
      if (!isMobileViewportNow) return;
      if (mobileChromeRevealTimeoutRef.current !== null) {
        window.clearTimeout(mobileChromeRevealTimeoutRef.current);
        mobileChromeRevealTimeoutRef.current = null;
      }
      const nextHeaderVisible = !hidden;
      if (hidden) {
        lastAdminMobileChromeHideAtRef.current = Date.now();
        if (getAdminConsoleScrollTop() <= 12) {
          mobileChromeHadDownScrollRef.current = false;
        }
      } else {
        mobileChromeHadDownScrollRef.current = false;
      }
      setIsMobileHeaderVisible(nextHeaderVisible);
      const mobileHeaderElement = document.querySelector<HTMLElement>(
        '[data-admin-console-mobile-header="true"]',
      );
      const layoutElement = document.querySelector<HTMLElement>(
        '[data-admin-console-layout="sidebar-content"]',
      );
      layoutElement?.setAttribute(
        "data-admin-console-mobile-header-visible",
        nextHeaderVisible ? "true" : "false",
      );
      if (mobileHeaderElement) {
        mobileHeaderElement.setAttribute(
          "data-admin-console-mobile-header-visible",
          nextHeaderVisible ? "true" : "false",
        );
        mobileHeaderElement.style.transform = nextHeaderVisible
          ? "translate3d(0, 0, 0)"
          : "translate3d(0, -100%, 0)";
        mobileHeaderElement.style.pointerEvents = nextHeaderVisible ? "auto" : "none";
      }
      adminBottomNavAutoHide.setBottomNavHidden(hidden);
      document.documentElement.style.setProperty(
        "--mobile-sheet-hide-bottom-nav",
        hidden ? "1" : "0",
      );
      document.documentElement.dataset.mobileSheetHideBottomNav = hidden
        ? "true"
        : "false";
    },
    [adminBottomNavAutoHide, getAdminConsoleScrollTop, isAdminMobileViewport],
  );

  const handleAdminCanvasScroll = useCallback(() => {
    const currentScrollTop = getAdminConsoleScrollTop();
    const isMobileViewportNow =
      isAdminMobileViewport ||
      window.matchMedia("(max-width: 767px)").matches;

    if (isMobileViewportNow && currentScrollTop > 24) {
      if (mobileChromeHadDownScrollRef.current) {
        previousMobileHeaderScrollTopRef.current = currentScrollTop;
        setAdminMobileChromeHidden(true);
        return;
      }

      if (activeDescendantScrollTopRef.current > 0) {
        updateMobileHeaderVisibility();
        adminBottomNavAutoHide.onScroll();
        return;
      }

      previousMobileHeaderScrollTopRef.current = currentScrollTop;
      return;
    }

    if (isMobileViewportNow && currentScrollTop <= 12) {
      const millisecondsSinceHide =
        Date.now() - lastAdminMobileChromeHideAtRef.current;
      if (millisecondsSinceHide < 250) {
        if (
          mobileChromeHadDownScrollRef.current &&
          mobileChromeRevealTimeoutRef.current === null
        ) {
          mobileChromeRevealTimeoutRef.current = window.setTimeout(() => {
            mobileChromeRevealTimeoutRef.current = null;
            const nextScrollTop = getAdminConsoleScrollTop();
            const shouldRevealAtTop =
              nextScrollTop <= 12 &&
              (isAdminMobileViewport ||
                window.matchMedia("(max-width: 767px)").matches);
            if (shouldRevealAtTop) {
              previousMobileHeaderScrollTopRef.current = nextScrollTop;
              mobileChromeHadDownScrollRef.current = false;
              setAdminMobileChromeHidden(false);
            }
          }, 250 - millisecondsSinceHide);
        }
        return;
      }
      previousMobileHeaderScrollTopRef.current = currentScrollTop;
      mobileChromeHadDownScrollRef.current = false;
      setAdminMobileChromeHidden(false);
      return;
    }

    updateMobileHeaderVisibility();
    adminBottomNavAutoHide.onScroll();
  }, [
    adminBottomNavAutoHide,
    getAdminConsoleScrollTop,
    isAdminMobileViewport,
    setAdminMobileChromeHidden,
    updateMobileHeaderVisibility,
  ]);

  const handleAdminCanvasWheel = useCallback<WheelEventHandler<HTMLElement>>(
    (event) => {
      if (!isAdminMobileViewport && !window.matchMedia("(max-width: 767px)").matches) return;

      if (event.deltaY > 18) {
        mobileChromeHadDownScrollRef.current = true;
        setAdminMobileChromeHidden(true);
        return;
      }

      if (getAdminConsoleScrollTop() <= 12) {
        setAdminMobileChromeHidden(false);
      }
    },
    [
      getAdminConsoleScrollTop,
      isAdminMobileViewport,
      setAdminMobileChromeHidden,
    ],
  );
  const handleAdminWindowWheel = useCallback(
    (event: WheelEvent) => {
      if (!isAdminMobileViewport && !window.matchMedia("(max-width: 767px)").matches) return;

      if (event.deltaY > 18) {
        mobileChromeHadDownScrollRef.current = true;
        setAdminMobileChromeHidden(true);
        return;
      }

      if (getAdminConsoleScrollTop() <= 12) {
        setAdminMobileChromeHidden(false);
      }
    },
    [
      getAdminConsoleScrollTop,
      isAdminMobileViewport,
      setAdminMobileChromeHidden,
    ],
  );


  const handleAdminCanvasTouchStart = useCallback<
    TouchEventHandler<HTMLElement>
  >(
    (event) => {
      adminCanvasTouchStartYRef.current = event.touches[0]?.clientY ?? null;
      adminBottomNavAutoHide.onTouchStart(event);
    },
    [adminBottomNavAutoHide],
  );

  const handleAdminCanvasTouchMove = useCallback<
    TouchEventHandler<HTMLElement>
  >(
    (event) => {
      const startY = adminCanvasTouchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      let handledGestureIntent = false;

      const isMobileViewportNow =
        isAdminMobileViewport ||
        window.matchMedia("(max-width: 767px)").matches;

      if (isMobileViewportNow && startY !== null && currentY !== undefined) {
        const deltaY = currentY - startY;

        if (deltaY <= -24) {
          mobileChromeHadDownScrollRef.current = true;
          setAdminMobileChromeHidden(true);
          adminCanvasTouchStartYRef.current = currentY;
          handledGestureIntent = true;
        } else if (deltaY >= 24 && getAdminConsoleScrollTop() <= 12) {
          setAdminMobileChromeHidden(false);
          adminCanvasTouchStartYRef.current = currentY;
          handledGestureIntent = true;
        }
      }

      adminBottomNavAutoHide.onTouchMove(event);
      if (!handledGestureIntent) {
        window.requestAnimationFrame(updateMobileHeaderVisibility);
      }
    },
    [
      adminBottomNavAutoHide,
      getAdminConsoleScrollTop,
      isAdminMobileViewport,
      setAdminMobileChromeHidden,
      updateMobileHeaderVisibility,
    ],
  );

  const handleAdminCapturedScroll = useCallback(
    (event: Event) => {
      updateActiveDescendantScrollTop(event.target);
      handleAdminCanvasScroll();
    },
    [handleAdminCanvasScroll, updateActiveDescendantScrollTop],
  );

  useEffect(() => {
    const canvasElement = canvasRef.current;
    const handleScroll = () => handleAdminCanvasScroll();
    const handleCapturedScroll = (event: Event) =>
      handleAdminCapturedScroll(event);

    window.addEventListener("scroll", handleScroll, { passive: true });
    canvasElement?.addEventListener("scroll", handleCapturedScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", handleAdminWindowWheel, { passive: true });
    document.addEventListener("wheel", handleAdminWindowWheel, {
      capture: true,
      passive: true,
    });
    window.requestAnimationFrame(handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("wheel", handleAdminWindowWheel);
      document.removeEventListener("wheel", handleAdminWindowWheel, true);
      canvasElement?.removeEventListener("scroll", handleCapturedScroll, true);
      if (mobileChromeRevealTimeoutRef.current !== null) {
        window.clearTimeout(mobileChromeRevealTimeoutRef.current);
        mobileChromeRevealTimeoutRef.current = null;
      }
    };
  }, [handleAdminCanvasScroll, handleAdminCapturedScroll, handleAdminWindowWheel]);
  useEffect(() => {
    const mobileHeaderElement = document.querySelector<HTMLElement>(
      '[data-admin-console-mobile-header="true"]',
    );
    if (!mobileHeaderElement) return;

    mobileHeaderElement.setAttribute(
      "data-admin-console-mobile-header-visible",
      isMobileHeaderVisible ? "true" : "false",
    );
    mobileHeaderElement.style.transform = isMobileHeaderVisible
      ? "translate3d(0, 0, 0)"
      : "translate3d(0, -120%, 0)";
    mobileHeaderElement.style.pointerEvents = isMobileHeaderVisible ? "" : "none";
  }, [isMobileHeaderVisible]);

  if (!shouldRenderAdminShell) {
    return null;
  }

  const isAdminCanvasBootstrapping =
    isShellBootstrapping || !loadedModuleIds.has(activeModuleId);
  const overviewModuleSummary = statsLoading
    ? "KPI 데이터를 불러오는 중입니다."
    : statsHasError
      ? "일부 KPI를 확인하지 못했습니다."
      : `대기 ${formatNumber(stats.pendingTotal)}건 · 맛집 ${formatNumber(stats.totalRestaurants)}곳 · 영상 ${formatNumber(stats.totalVideos)}개`;

  return (
    <main
      className="h-[var(--full-height,100vh)] min-h-0 min-w-0 w-full overflow-hidden bg-background font-sans text-foreground tracking-normal"
      data-admin-console-shell="true"
      data-layout-primitives="fixed-sidenav-shell scroll-body-shell sidebar"
    >
      <a
        href="#admin-console-canvas"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-primary"
      >
        작업 화면으로 건너뛰기
      </a>
      <div
        id="overview"
        className={cn(
          "grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-1",
        )}
        data-admin-console-layout="sidebar-content"
        data-admin-console-sidebar-collapsed={
          isSidebarCollapsed ? "true" : "false"
        }
        data-admin-console-mobile-header-visible={
          isMobileHeaderVisible ? "true" : "false"
        }
      >
        <AdminSidebar
          activeModuleId={activeModuleId}
          onSelectModule={selectModule}
          isCollapsed={isSidebarCollapsed}
          showLabels={showSidebarLabels}
          onToggleCollapsed={handleToggleSidebarCollapsed}
          showMobileHeader={isMobileHeaderVisible}
          canLoadPreferences={canLoadAdminConsoleData}
          stats={stats}
          accountDisplayName={adminAccountDisplayName}
          accountEmail={adminAccountEmail}
        />

        <section
          id="admin-console-canvas"
          ref={canvasRef}
          tabIndex={-1}
          aria-label="관리자 콘솔 작업 화면"
          role="region"
          className={cn(
            "h-full min-h-0 min-w-0 overflow-x-hidden overscroll-contain scrollbar-hide border-y border-border bg-background p-2 font-sans tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset md:border-y-0 md:p-4",
            activeModuleId === "overview"
              ? "overflow-y-auto"
              : activeModuleId === "storyboard"
                ? "overflow-y-auto md:overflow-hidden"
                : "overflow-y-auto",
          )}
          style={{ paddingBottom: isAdminMobileViewport ? "calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+env(safe-area-inset-bottom)+0.5rem)" : "1rem" }}
          data-admin-console-content="true"
          data-admin-console-active-module={activeModuleId}
          data-scroll-owner="admin-canvas"
          data-admin-console-focus-order="skip-link sidebar canvas module-actions"
          onWheel={handleAdminCanvasWheel}
          onTouchStart={handleAdminCanvasTouchStart}
          onTouchMove={handleAdminCanvasTouchMove}
        >
          <p className="sr-only" aria-live="polite">
            {activeModuleLabel} 작업 화면으로 전환됨
          </p>
          {isAdminCanvasBootstrapping ? (
            getAdminConsoleModuleLoadingSkeleton(activeModuleId, activeModuleLabel)
          ) : activeModuleId === "overview" ? (
            <AdminEmbeddedModuleShell
              moduleId="overview"
              titleId="admin-overview-module-title"
              title="대시보드 (KPI)"
              icon={Activity}
              summary={overviewModuleSummary}
              contentClassName="overflow-y-auto"
            >
              <AdminDashboardManagementPanel
                stats={stats}
                isLoading={statsLoading}
                hasError={statsHasError}
                isAdmin={canLoadAdminConsoleData}
              />
            </AdminEmbeddedModuleShell>
          ) : activeModuleId === "routes" ? (
            <AdminEmbeddedModuleShell
              moduleId="routes"
              titleId="admin-routes-module-title"
              title="맛집 동선 추천"
              icon={Route}
              summary="지도 맛집과 실제 도로 동선을 함께 확인합니다."
              contentClassName="overflow-hidden"
            >
              <AdminRouteRecommendationModule
                stats={stats}
                isLoading={statsLoading}
                hasError={statsHasError}
                onSelectModule={selectModule}
              />
            </AdminEmbeddedModuleShell>
          ) : activeModuleId === "llm" ? (
            <LlmSessionWorkspace />
          ) : activeModule ? (
            <InlineModulePanel
              module={activeModule}
              initialStoryboardResult={initialStoryboardResult}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
