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
  Clapperboard,
  ClipboardList,
  ExternalLink,
  FileDown,
  Image as ImageIcon,
  MessageSquareText,
  Info,
  Menu,
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
  Store,
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
import { cn } from "@/lib/utils";
import type { DashboardSummaryResponse } from "@/types/dashboard";
import type {
  InsightTreemapPeriod,
  InsightTreemapResponse,
  InsightTreemapVideoRow,
} from "@/lib/public-insights/treemap";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";

type AdminModuleId =
  | "overview"
  | "routes"
  | "restaurants"
  | "restaurant-refresh-history"
  | "submissions"
  | "reviews"
  | "storyboard"
  | "banners"
  | "users"
  | "insights"
  | "audit"
  | "youtube-thumbnail-generator"
  | "llm";
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
    href: "/admin/evaluations",
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
    href: "/admin/evaluations?view=submissions",
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
    href: "/admin/evaluations?view=submissions&tab=reviews",
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
    id: "banners",
    title: "배너 관리",
    description:
      "사이드바/모바일 팝업 배너의 노출 위치, 우선순위, 미디어 상태를 관리합니다.",
    href: "/admin/banners",
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
    href: "/insights",
    icon: BarChart2,
    badge: "분석",
    actionLabel: "핵심 인사이트 보기",
  },
  {
    id: "audit",
    title: "감사 로그",
    description:
      "승인·반려·삭제·복구 이력을 상태 재확인과 함께 추적하는 영역입니다.",
    href: "/admin/evaluations",
    icon: ScrollText,
    badge: "준비 중",
    actionLabel: "감사 기준 보기",
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

function getSidebarConsoleItems(moduleIds: ConsoleModuleId[]): SidebarSection["items"] {
  return moduleIds.flatMap((moduleId) => {
    const consoleModule = consoleModuleById.get(moduleId);
    if (!consoleModule) return [];

    const { id, title, description, icon, badge } = consoleModule;
    return [{ id, title, description, icon, badge }];
  });
}

const guardedSteps = ["미리보기", "확인", "적용", "재확인", "감사 기록"];
const SIDEBAR_LABEL_REVEAL_DELAY_MS = 180;
const ADMIN_THEME_STORAGE_KEY = "tzudong-admin-theme";
const ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY = "tzudong-admin-sidebar-collapsed";

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
        ["restaurants", "restaurant-refresh-history", "submissions", "reviews"].includes(module.id),
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
    items: getSidebarConsoleItems(["users", "banners", "insights"]),
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

function updateAdminDashboardOrderWithViewTransition(updateCallback: () => void) {
  if (typeof document === "undefined") {
    updateCallback();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    updateCallback();
    return;
  }

  const startViewTransition = (
    document as AdminDashboardViewTransitionDocument
  ).startViewTransition;

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

const adminModuleIds: AdminModuleId[] = sidebarSections.flatMap((section) =>
  section.items.map((item) => item.id),
);

function isAdminModuleId(value: string | null): value is AdminModuleId {
  return Boolean(value && adminModuleIds.includes(value as AdminModuleId));
}

function getAdminModuleIdFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): AdminModuleId {
  const moduleId = searchParams.get("module");
  return isAdminModuleId(moduleId) ? moduleId : "overview";
}

const AdminEvaluationModule = dynamic(
  () => import("@/app/admin/evaluations/page"),
  {
    ssr: false,
  },
);

const AdminBannerModule = dynamic(() => import("@/app/admin/banners/page"), {
  ssr: false,
});

const AdminRestaurantRefreshHistoryModule = dynamic(
  () =>
    import("@/components/admin/AdminRestaurantRefreshHistoryPanel").then(
      (module) => module.AdminRestaurantRefreshHistoryPanel,
    ),
  {
    ssr: false,
    loading: () => <AdminConsoleCanvasSkeleton />,
  },
);

const AdminUsersModule = dynamic(
  () => import("@/components/admin/AdminUsersPanel"),
  {
    ssr: false,
  },
);

const AdminStoryboardGenerator = dynamic(
  () =>
    import("@/components/admin/storyboard/AdminStoryboardGenerator").then(
      (module) => module.AdminStoryboardGenerator,
    ),
  {
    ssr: false,
    loading: () => <AdminStoryboardModuleLoadingSkeleton />,
  },
);

const AdminYoutubeThumbnailGenerator = dynamic(
  () =>
    import("@/components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator").then(
      (module) => module.AdminYoutubeThumbnailGenerator,
    ),
  {
    ssr: false,
    loading: () => <AdminYoutubeThumbnailModuleLoadingSkeleton />,
  },
);

const InsightsModule = dynamic(() => import("@/app/insights/insights-client"), {
  ssr: false,
});

const AdminRouteRecommendationModule = dynamic(
  () =>
    import("@/components/admin/AdminOverviewDashboard").then(
      (module) => module.AdminOverviewDashboard,
    ),
  {
    ssr: false,
    loading: () => <AdminConsoleCanvasSkeleton />,
  },
);

type AdminPendingCounts = {
  submissions: number;
  reviews: number;
};

type AdminOverviewStats = {
  pendingSubmissions: number | null;
  pendingReviews: number | null;
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
  fetchedAt: string;
  previousSubscriberCount?: number | null;
  previousViewCount?: number | null;
  previousVideoCount?: number | null;
  subscriberDelta?: number | null;
  viewDelta?: number | null;
  videoDelta?: number | null;
  comparisonFetchedAt?: string | null;
  deltaSource?:
    | "snapshot-delta"
    | "derived-live-comparison"
    | "derived-snapshot-comparison"
    | "unavailable";
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

function buildCanonicalAdminModuleHref(moduleId: AdminModuleId): string {
  const params = new URLSearchParams();

  if (moduleId !== "overview") {
    params.set("module", moduleId);
  }

  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ""}`;
}

function getAdminModuleStateWarning(
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  const requestedModule = searchParams.get("module");

  if (requestedModule && !isAdminModuleId(requestedModule)) {
    return "알 수 없는 관리자 화면 요청을 대시보드 (KPI)로 되돌렸습니다.";
  }

  return null;
}

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = "tzudong:e2e-admin-shell-bypass";

function isLocalE2EAdminShellBypassHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hasLocalE2EAdminShellBypass() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  if (!isLocalE2EAdminShellBypassHost(window.location.hostname)) return false;

  try {
    return window.localStorage.getItem(E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY) === "1";
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
  visualPercent: number;
};

type AdminDashboardPdfReportContentRow = {
  rank: string;
  title: string;
  views: string;
  likes: string;
  comments: string;
  contribution: string;
  barPercent: number;
};

type AdminDashboardPdfReportInsightRow = {
  label: string;
  title: string;
  description: string;
  scoreLabel: string;
  score: number;
};

type AdminDashboardPdfReportData = {
  title: string;
  logoUrl: string;
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
  const metricCards = report.metrics
    .map(
      (metric) => `
        <section class="metric-card">
          <p class="metric-label">${escapeAdminDashboardReportHtml(metric.label)}</p>
          <strong>${escapeAdminDashboardReportHtml(metric.value)}</strong>
          <span>${escapeAdminDashboardReportHtml(metric.caption)}</span>
          <div class="mini-bar" aria-label="보고서용 상대 막대"><i style="width:${clampDashboardPercent(metric.visualPercent)}%"></i></div>
        </section>`,
    )
    .join("");
  const topBars = report.topContents.length
    ? report.topContents
        .map(
          (row) => `
            <div class="bar-row">
              <div class="bar-meta">
                <strong>${escapeAdminDashboardReportHtml(row.rank)} ${escapeAdminDashboardReportHtml(row.title)}</strong>
                <span>${escapeAdminDashboardReportHtml(row.views)} · ${escapeAdminDashboardReportHtml(row.contribution)}</span>
              </div>
              <div class="bar-track"><i style="width:${clampDashboardPercent(row.barPercent)}%"></i></div>
            </div>`,
        )
        .join("")
    : `<p class="empty">표시할 상위 콘텐츠 시각화가 없습니다.</p>`;
  const topRows = report.topContents.length
    ? report.topContents
        .map(
          (row) => `
            <tr>
              <td class="rank">${escapeAdminDashboardReportHtml(row.rank)}</td>
              <td>${escapeAdminDashboardReportHtml(row.title)}</td>
              <td class="num">${escapeAdminDashboardReportHtml(row.views)}</td>
              <td class="num">${escapeAdminDashboardReportHtml(row.likes)}</td>
              <td class="num">${escapeAdminDashboardReportHtml(row.comments)}</td>
              <td>${escapeAdminDashboardReportHtml(row.contribution)}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="empty">표시할 상위 콘텐츠가 없습니다.</td></tr>`;
  const insightCards = report.insights.length
    ? report.insights
        .map(
          (insight) => `
            <article class="insight-card">
              <p class="chip">${escapeAdminDashboardReportHtml(insight.label)}</p>
              <h3>${escapeAdminDashboardReportHtml(insight.title)}</h3>
              <p>${escapeAdminDashboardReportHtml(insight.description)}</p>
              <span>${escapeAdminDashboardReportHtml(insight.scoreLabel)}</span>
              <div class="diagnosis-meter"><i style="width:${clampDashboardPercent(insight.score)}%"></i></div>
            </article>`,
        )
        .join("")
    : `<p class="empty">표시할 성과 진단이 없습니다.</p>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeAdminDashboardReportHtml(report.title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f4ef; color: #211b16; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; }
    main { max-width: 960px; margin: 0 auto; padding: 28px; background: #fffdf9; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #211b16; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    h3 { margin: 8px 0 6px; font-size: 13px; line-height: 1.35; }
    .meta { text-align: right; font-size: 12px; color: #6c6259; }
    .meta strong { display: block; color: #211b16; font-size: 14px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand img { width: 42px; height: 42px; border-radius: 14px; object-fit: contain; border: 1px solid #e4ddd2; background: #fff; }
    .summary { margin: 18px 0; padding: 12px 14px; border: 1px solid #ded7cd; border-radius: 16px; background: #faf7f1; color: #5b5148; font-size: 13px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .metric-card, .insight-card { border: 1px solid #e4ddd2; border-radius: 16px; background: white; padding: 12px; break-inside: avoid; }
    .metric-label { margin: 0 0 8px; font-size: 11px; color: #766b60; font-weight: 800; }
    .metric-card strong { display: block; font-size: 20px; letter-spacing: -0.03em; }
    .metric-card span, .insight-card span { color: #7a7066; font-size: 11px; font-weight: 700; }
    .mini-bar, .bar-track, .diagnosis-meter { height: 7px; overflow: hidden; border-radius: 999px; background: #eee8df; }
    .mini-bar { margin-top: 10px; }
    .mini-bar i, .bar-track i, .diagnosis-meter i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #0ea5e9, #14b8a6); }
    .report-visual { display: grid; gap: 8px; margin: 12px 0 14px; padding: 12px; border: 1px solid #e4ddd2; border-radius: 16px; background: #fff; }
    .bar-row { display: grid; grid-template-columns: minmax(0, 1fr) 42%; gap: 12px; align-items: center; break-inside: avoid; }
    .bar-meta { min-width: 0; }
    .bar-meta strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .bar-meta span { color: #766b60; font-size: 11px; font-weight: 700; }
    .bar-track { height: 10px; }
    .diagnosis-meter { margin-top: 10px; height: 8px; }
    .diagnosis-meter i { background: linear-gradient(90deg, #f59e0b, #10b981); }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; font-size: 12px; }
    th, td { border-bottom: 1px solid #ebe5dc; padding: 9px 8px; text-align: left; vertical-align: top; }
    th { background: #f3eee6; color: #5c5248; font-size: 11px; }
    .rank { width: 42px; font-weight: 900; color: #0f766e; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .section { margin-top: 22px; break-inside: avoid; }
    .insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .chip { display: inline-block; margin: 0; border-radius: 999px; background: #eef8f6; color: #0f766e; padding: 3px 8px; font-size: 10px; font-weight: 900; }
    .insight-card p:not(.chip) { margin: 0 0 8px; color: #5f564d; font-size: 12px; }
    .formula { margin-top: 14px; color: #6f665d; font-size: 11px; }
    .empty { color: #8a8178; text-align: center; padding: 18px; }
    .print-action { margin-top: 18px; text-align: right; }
    .print-action button { border: 0; border-radius: 999px; background: #211b16; color: white; padding: 9px 14px; font-weight: 800; cursor: pointer; }
    @media print { body { background: white; } main { max-width: none; padding: 0; } .print-action { display: none; } }
    @media (max-width: 820px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .insights { grid-template-columns: 1fr; } header { flex-direction: column; } .meta { text-align: left; } }  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="brand">
          <img src="${escapeAdminDashboardReportHtml(report.logoUrl)}" alt="Tzudong 로고" />
          <h1>${escapeAdminDashboardReportHtml(report.title)}</h1>
        </div>
        <p class="summary">${escapeAdminDashboardReportHtml(report.summaryLabel)}</p>
      </div>
      <div class="meta">
        <strong>${escapeAdminDashboardReportHtml(report.periodLabel)}</strong>
        <span>${escapeAdminDashboardReportHtml(report.generatedAtLabel)}</span><br />
        <span>${escapeAdminDashboardReportHtml(report.basisLabel)}</span>
      </div>
    </header>
    <section class="metrics" aria-label="핵심 KPI">${metricCards}</section>
    <section class="section">
      <h2>콘텐츠 성과 TOP 5</h2>
      <div class="report-visual" aria-label="콘텐츠 성과 TOP 5 조회수 상대 막대">${topBars}</div>
      <table>
        <thead>
          <tr><th>순위</th><th>영상</th><th>조회</th><th>좋아요</th><th>댓글</th><th>성과 기여</th></tr>
        </thead>
        <tbody>${topRows}</tbody>
      </table>
      <p class="formula">${escapeAdminDashboardReportHtml(report.contributionFormula)}</p>
    </section>
    <section class="section">
      <h2>성과 진단</h2>
      <div class="insights">${insightCards}</div>
    </section>
    <div class="print-action"><button type="button" onclick="window.print()">PDF로 저장/인쇄</button></div>  </main>
</body>
</html>`;
}

function openAdminDashboardPdfReport(report: AdminDashboardPdfReportData) {
  if (typeof window === "undefined") return false;

  const reportWindow = window.open("", "_blank", "width=960,height=1200");
  if (!reportWindow) return false;

  try {
    const reportWithAbsoluteLogo = {
      ...report,
      logoUrl: new URL(report.logoUrl, window.location.origin).href,
    };

    reportWindow.document.open();
    reportWindow.document.write(
      buildAdminDashboardPdfReportHtml(reportWithAbsoluteLogo),
    );
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => {
      reportWindow.focus();
      reportWindow.print();
    }, 250);
    return true;
  } catch {
    reportWindow.close();
    return false;
  }
}

async function fetchAdminPendingCounts(): Promise<AdminPendingCounts> {
  const response = await fetch("/api/admin/pending-counts", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("admin-pending-counts-failed");
  }

  return response.json() as Promise<AdminPendingCounts>;
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

function useAdminOverviewStats(isAdmin: boolean): {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
} {
  const pendingCountsQuery = useQuery({
    queryKey: ["admin-overview", "pending-counts"],
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
  return {
    stats: {
      pendingSubmissions: pendingCountsQuery.data?.submissions ?? null,
      pendingReviews: pendingCountsQuery.data?.reviews ?? null,
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
  meta: string;
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

  const fallbackPayload = (await fallbackResponse.json()) as InsightTreemapResponse;

  return {
    ...fallbackPayload,
    meta: {
      ...fallbackPayload.meta,
      dataSource: "public-treemap-fallback",
      fallbackSource: "public-insights-treemap",
      fallbackReasonCode: `admin-youtube-kpis-${liveResponse.status}`,
    },
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
  tone: "emerald" | "sky" | "amber" | "rose";
  score: number;
  scoreLabel: string;
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
      tone: "emerald",
      score: Math.max(8, Math.min(100, strongestContributionScore * 2)),
      scoreLabel: `${scoreLabel} · 평균 참고 ${averageComparison}`,
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
      tone: "sky",
      score: getDashboardInsightSignalScore(
        strongestEngagement.engagementRate,
        engagementRateAverage,
      ),
      scoreLabel,
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
      tone: "rose",
      score: getDashboardInsightSignalScore(
        recentUnderperformer.viewsPerDay,
        dailyViewAverage,
      ),
      scoreLabel,
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
      tone: "amber",
      score: getDashboardInsightSignalScore(
        reboundCandidate.viewValue,
        viewAverage,
      ),
      scoreLabel,
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
      tone: "emerald",
      score: Math.max(8, Math.min(100, strongestContributionScore)),
      scoreLabel: `구독자 ${formatSignedNumber(subscriberDelta)}`,
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
      tone: "sky",
      score: getDashboardInsightSignalScore(
        newestCandidate.viewsPerDay,
        dailyViewAverage,
      ),
      scoreLabel,
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
const adminDashboardControlGroupClassName =
  "inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/25 p-0.5";
const adminDashboardControlButtonClassName =
  "inline-flex h-6 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-extrabold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const adminDashboardFullscreenCardClassName =
  "fixed inset-2 z-[80] h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] overflow-auto rounded-3xl border-primary/35 bg-card p-4 shadow-2xl sm:inset-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]";

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
  children,
}: {
  label: string;
  lines: string[];
  className?: string;
  style?: CSSProperties;
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
        "h-7 w-7 shrink-0 border border-border bg-background p-0 text-muted-foreground shadow-sm hover:text-foreground",
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
    "bg-sky-300",
    "bg-cyan-300",
    "bg-teal-300",
    "bg-emerald-200",
    "bg-green-200",
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
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-border/70 bg-background"
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
          ["left-[9%] top-[58%] h-10 w-10", "bg-sky-100 dark:bg-sky-950/45"],
          ["left-[25%] top-[38%] h-14 w-14", "bg-teal-100 dark:bg-teal-950/45"],
          ["left-[43%] top-[52%] h-11 w-11", "bg-emerald-100 dark:bg-emerald-950/45"],
          ["left-[62%] top-[30%] h-16 w-16", "bg-cyan-100 dark:bg-cyan-950/45"],
          ["left-[78%] top-[62%] h-9 w-9", "bg-blue-100 dark:bg-blue-950/45"],
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
      className="flex min-h-full min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:h-full lg:min-h-0 lg:overflow-hidden"
      aria-label="관리자 대시보드 (KPI) 로딩 중"
      data-admin-dashboard-management-skeleton="true"
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
          className="flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] md:w-auto md:flex-wrap md:items-start md:justify-end md:overflow-visible md:pb-0 md:gap-1 [&::-webkit-scrollbar]:hidden"
          data-admin-dashboard-action-bar="true"
          data-admin-dashboard-action-order="order-reset-report-collection-period"
          data-allow-horizontal-scroll="true"
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

      <div className="grid min-h-0 min-w-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:grid-cols-10 lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]">
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
                    { key: "views", label: "조회수", dotClassName: "bg-sky-500" },
                    { key: "engagement", label: "참여", dotClassName: "bg-teal-500" },
                    { key: "engagementRate", label: "참여율", dotClassName: "bg-amber-500" },
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
            "flex h-full min-h-[280px] flex-col p-3 text-xs sm:col-span-2 lg:col-span-3",
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
                    { key: "views", label: "조회수", dotClassName: "bg-sky-500" },
                    { key: "likes", label: "좋아요", dotClassName: "bg-rose-500" },
                    { key: "comments", label: "댓글", dotClassName: "bg-orange-500" },
                  ]}
                  visibility={DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY}
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
  tone?: "teal" | "blue" | "amber" | "rose" | "neutral";
  sparklineData?: AdminDashboardSparklinePoint[];
  infoLines?: string[];
  isLoading?: boolean;
  isFullscreen?: boolean;
  fullscreenAction?: ReactNode;
}) {
  const safeProgress = clampDashboardPercent(progress);
  const toneClass = {
    teal: {
      bar: "bg-teal-500 dark:bg-teal-400",
      text: "text-teal-700 dark:text-teal-300",
      stroke: "#14b8a6",
    },
    blue: {
      bar: "bg-sky-500 dark:bg-sky-400",
      text: "text-sky-700 dark:text-sky-300",
      stroke: "#38a5db",
    },
    amber: {
      bar: "bg-amber-500 dark:bg-amber-400",
      text: "text-amber-700 dark:text-amber-300",
      stroke: "#f59e0b",
    },
    rose: {
      bar: "bg-rose-500 dark:bg-rose-400",
      text: "text-rose-700 dark:text-rose-300",
      stroke: "#f43f5e",
    },
    neutral: {
      bar: "bg-muted-foreground",
      text: "text-muted-foreground",
      stroke: "#94a3b8",
    },
  }[tone];
  const chartData = sparklineData.filter((point) =>
    Number.isFinite(point.value),
  );

  return (
    <div
      className={cn(
        adminDashboardCardClass,
        "relative z-0 grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-visible p-3 sm:p-3.5 hover:z-20 focus-within:z-20",
        className,
        isFullscreen && adminDashboardFullscreenCardClassName,
      )}
      data-admin-dashboard-kpi-card="recharts-sparkline"
      data-admin-dashboard-widget-card={widgetId}
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
            <p className="truncate text-[clamp(1.42rem,1.75vw,2.1rem)] font-black leading-none tracking-[-0.055em] text-foreground">
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
                    content={<AdminDashboardKpiSparklineTooltip title={title} />}
                    wrapperStyle={adminDashboardTooltipWrapperStyle}
                    cursor={{
                      stroke: toneClass.stroke,
                      strokeOpacity: 0.32,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={toneClass.stroke}
                    strokeWidth={2}
                    fill={toneClass.stroke}
                    fillOpacity={0.28}
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
    rows: Array<{ label: string; value: string; rawValue: number }>;
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
        ? sum + section.rows.reduce((rowSum, row) => rowSum + row.rawValue, 0)
        : sum,
    0,
  );

  return (
    <div
      className={cn(
        adminDashboardCardClass,
        "flex h-full min-h-[280px] flex-col p-3 text-xs",
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
          "계산식: 검수 리스크 합계 = 제보 대기 + 리뷰 대기 + 좌표 미완료 + 비활성 배너.",
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
              ...section.rows.map((row) => row.rawValue),
            );
            const barTone =
              sectionIndex === 0
                ? "bg-teal-500 dark:bg-teal-400"
                : "bg-rose-500 dark:bg-rose-400";
            const labelTone =
              sectionIndex === 0
                ? "text-teal-700 dark:text-teal-300"
                : "text-rose-700 dark:text-rose-300";

            return (
              <div
                key={section.title}
                className="grid min-h-0 gap-2"
              >
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
                      (row.rawValue / maxRawValue) * 100,
                    );

                    return (
                      <div
                        key={`${section.title}-${row.label}`}
                        className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2"
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
                        <span className="shrink-0 text-right text-[13px] font-extrabold tabular-nums text-foreground">
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
        조회수, 참여, 참여율을 선택 기간 영상의 게시일 순서로 정규화해 비교합니다.
        현재 {formatNumber(points.length)}개를 표시하고 전체 대상은{" "}
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
              stroke="#5aa6d8"
              strokeWidth={2.4}
              dot={isDenseChart ? false : { r: 2.4 }}
              activeDot={{ r: isDenseChart ? 3 : 4 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="조회수최고"
                position="top"
                fill="#2563eb"
                fontSize={10}
                fontWeight={800}
              />
              <LabelList
                dataKey="조회수최저"
                position="bottom"
                fill="#2563eb"
                fontSize={10}
                fontWeight={800}
              />
            </Line>
          ) : null}
          {seriesVisibility.engagement ? (
            <Line
              type="monotone"
              dataKey="참여"
              stroke="#57c6ca"
              strokeWidth={2.4}
              dot={isDenseChart ? false : { r: 2.4 }}
              activeDot={{ r: isDenseChart ? 3 : 4 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="참여최고"
                position="top"
                fill="#0f766e"
                fontSize={10}
                fontWeight={800}
              />
              <LabelList
                dataKey="참여최저"
                position="bottom"
                fill="#0f766e"
                fontSize={10}
                fontWeight={800}
              />
            </Line>
          ) : null}
          {seriesVisibility.engagementRate ? (
            <Line
              type="monotone"
              dataKey="참여율"
              stroke="#f59e0b"
              strokeWidth={2.8}
              dot={isDenseChart ? false : { r: 2.6 }}
              activeDot={{ r: isDenseChart ? 3 : 4.2 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="참여율최고"
                position="top"
                fill="#b45309"
                fontSize={10}
                fontWeight={900}
              />
              <LabelList
                dataKey="참여율최저"
                position="bottom"
                fill="#b45309"
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
  const colors = ["#93c5fd", "#7dd3fc", "#67e8f9", "#99f6e4", "#a7f3d0"];

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
                        color: "#5aa6d8",
                      },
                      {
                        label: "참여",
                        value: formatNumber(row.참여),
                        note: "좋아요+댓글",
                        color: "#57c6ca",
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
              fill="#b91c1c"
              fontSize={10}
              fontWeight={900}
            />
            <LabelList
              dataKey="조회수최저"
              position="bottom"
              fill="#0f766e"
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
      barClass: "bg-sky-500 text-white dark:bg-sky-500 dark:text-white",
      dotClass: "bg-sky-500 dark:bg-sky-400",
    },
    {
      barClass: "bg-teal-500 text-white dark:bg-teal-500 dark:text-white",
      dotClass: "bg-teal-500 dark:bg-teal-400",
    },
    {
      barClass: "bg-rose-500 text-white dark:bg-rose-500 dark:text-white",
      dotClass: "bg-rose-500 dark:bg-rose-400",
    },
    {
      barClass: "bg-amber-600 text-white dark:bg-amber-500 dark:text-white",
      dotClass: "bg-amber-500 dark:bg-amber-400",
    },
    {
      barClass: "bg-violet-500 text-white dark:bg-violet-500 dark:text-white",
      dotClass: "bg-violet-500 dark:bg-violet-400",
    },
  ] as const;
  const metricRows = [
    {
      seriesKey: "views",
      key: "viewCount",
      label: "조회수",
      labelClass:
        "border-sky-500/25 bg-sky-50 text-foreground dark:border-sky-400/30 dark:bg-sky-950/35",
    },
    {
      seriesKey: "likes",
      key: "likeCount",
      label: "좋아요",
      labelClass:
        "border-rose-500/25 bg-rose-50 text-foreground dark:border-rose-400/30 dark:bg-rose-950/35",
    },
    {
      seriesKey: "comments",
      key: "commentCount",
      label: "댓글",
      labelClass:
        "border-orange-500/25 bg-orange-50 text-foreground dark:border-orange-400/30 dark:bg-orange-950/35",
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
        "grid h-full grid-rows-[minmax(0,1fr)_auto] gap-2 pb-0",
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
          "grid min-h-0 content-evenly gap-2",
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
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black leading-none",
                    metric.labelClass,
                  )}
                >
                  {metric.label}
                </span>
                <span className="text-[11px] font-black tabular-nums text-muted-foreground">
                  합계 {formatCompactNumber(total)} · 전체 평균{" "}
                  {formatCompactNumber(average)}
                </span>
              </div>
              <div
                className={cn(
                  "flex min-w-0 overflow-x-auto overflow-y-visible rounded-xl bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  isFullscreen ? "h-12 sm:h-14" : "h-9",
                )}
                aria-hidden="true"
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
                        "flex min-w-[8%] items-center justify-center px-0.5 text-[10px] font-black leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        rankColors[index]?.barClass ??
                          "bg-muted-foreground text-background",
                      )}
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
      <ol className={cn("grid gap-1 sm:grid-cols-5", isFullscreen && "gap-3")}>
        {visibleRows.map((row, index) => (
          <li key={row.label} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  rankColors[index]?.dotClass ?? "bg-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="text-[11px] font-black tabular-nums text-muted-foreground">
                #{index + 1}
              </span>
            </div>
            <p
              className="mt-0.5 truncate text-[11px] font-extrabold text-foreground"
              title={row.label}
            >
              {row.label}
            </p>
            <AdminDashboardInlineTooltip
              label={`${row.label} 성과 기여`}
              lines={row.viewBenchmarkTooltipLines}
              className="mt-0.5 block truncate text-[10px] font-black tabular-nums text-emerald-700 outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-emerald-300"
            >
              {row.viewBenchmark}
            </AdminDashboardInlineTooltip>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AdminDashboardContentInsightStrip({
  insights,
}: {
  insights: AdminDashboardContentInsight[];
}) {
  if (insights.length === 0) return null;

  const toneClass = {
    emerald:
      "border-emerald-500/25 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200",
    sky: "border-sky-500/25 bg-sky-50/70 text-sky-800 dark:bg-sky-950/25 dark:text-sky-200",
    amber:
      "border-amber-500/25 bg-amber-50/70 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
    rose: "border-rose-500/25 bg-rose-50/70 text-rose-800 dark:bg-rose-950/25 dark:text-rose-200",
  } satisfies Record<AdminDashboardContentInsight["tone"], string>;

  return (
    <div
      className="mb-2 grid shrink-0 gap-1.5 sm:grid-cols-2 xl:grid-cols-4"
      data-admin-dashboard-content-insights="average-benchmark"
    >
      {insights.map((insight) => {
        const tooltipLines = [
          `${insight.label}: ${insight.title}`,
          insight.description,
          `신호 강도: ${insight.scoreLabel}`,
        ];

        return (
          <UiTooltipProvider
            key={`${insight.label}-${insight.title}`}
            delayDuration={120}
          >
            <UiTooltip>
              <UiTooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className={cn(
                    "min-w-0 rounded-xl border px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    toneClass[insight.tone],
                  )}
                  aria-label={tooltipLines.join(" ")}
                  data-admin-dashboard-diagnosis-tooltip-trigger="true"
                >
                  <p className="truncate text-[10px] font-black leading-none opacity-75">
                    {insight.label}
                  </p>
                  <p className="mt-1 truncate text-[11px] font-extrabold leading-none">
                    {insight.title}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-bold leading-none opacity-85">
                    {insight.description}
                  </p>
                </div>
              </UiTooltipTrigger>
              <UiTooltipContent
                side="top"
                align="start"
                className={adminDashboardTooltipPortalClassName}
                data-admin-dashboard-diagnosis-tooltip="standard"
              >
                <AdminDashboardTooltipLinesPanel
                  lines={tooltipLines}
                  dataAttribute="diagnosis-summary"
                />
              </UiTooltipContent>
            </UiTooltip>
          </UiTooltipProvider>
        );
      })}
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
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
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
        "grid min-h-0 flex-1 content-stretch gap-1",
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
      <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-1">
        {visibleInsights.map((insight) => {
          const tooltipLines = [
            `${insight.label}: ${insight.title}`,
            insight.description,
            `신호 강도: ${insight.scoreLabel}`,
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
                    "flex min-h-0 min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5",
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
                    <p
                      tabIndex={0}
                      className="mt-1.5 truncate rounded-sm text-sm font-extrabold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={tooltipLines.join(" ")}
                      data-admin-dashboard-diagnosis-tooltip-trigger="title"
                    >
                      {insight.title}
                    </p>
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
              <stop offset="5%" stopColor="#57c6b8" stopOpacity={0.42} />
              <stop offset="95%" stopColor="#57c6b8" stopOpacity={0.08} />
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
                      color: "#0f766e",
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
            stroke="#0f766e"
            strokeWidth={2.6}
            fill="url(#adminDashboardEngagementArea)"
            dot={{ r: 2.4 }}
            activeDot={{ r: 4.2 }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="참여율최고"
              position="top"
              fill="#0f766e"
              fontSize={10}
              fontWeight={900}
            />
            <LabelList
              dataKey="참여율최저"
              position="bottom"
              fill="#0f766e"
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
          <div className="grid grid-cols-3 gap-1" aria-label="대시보드 타임프레임">
            {ADMIN_DASHBOARD_PERIOD_OPTIONS.map((option) => {
              const isSelected = option.value === value;

              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-xl px-2 text-[11px] font-bold"
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
  const latestJobs = logs?.workflow.latestJobs.slice(0, 3) ?? [];
  const snapshot = logs?.snapshot;
  const hasSavedSnapshot = Boolean(snapshot?.available);
  const isWorkflowHealthy = latestRun
    ? latestRun.status !== "completed" || latestRun.conclusion === "success"
    : logs?.workflow.available;
  const collectionStatusLabel = hasSavedSnapshot ? "수집 정상" : "저장 확인 필요";
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
              Supabase 저장 기준 · {logs?.workflow.workflowId ?? "youtube-kpi-snapshot.yml"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 rounded-full px-2 text-[11px] font-bold"
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
                      <span className="block text-muted-foreground">구독자</span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatNumber(snapshot?.subscriberCount)}
                      </span>
                    </div>
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">총 조회수</span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatCompactNumber(snapshot?.viewCount)}
                      </span>
                    </div>
                    <div className="rounded-xl bg-background/70 px-2 py-1.5">
                      <span className="block text-muted-foreground">조회 증감</span>
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
                      className={cn("rounded-full px-2 py-0.5 text-[10px]", workflowStatusClassName)}
                    >
                      {workflowStatusLabel}
                    </Badge>
                    {latestRun?.htmlUrl ? (
                      <a
                        href={latestRun.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label="GitHub Actions 실행 로그 새 탭에서 열기"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>

                {!logs?.workflow.available ? (
                  <p className="mt-2 rounded-xl bg-muted/40 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                    서버 환경 변수에 GitHub 읽기 토큰이 없거나 권한이 부족합니다.
                    GITHUB_ACTIONS_TOKEN 또는 GH_TOKEN을 설정하면 실행 로그도
                    표시됩니다.
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
                        {job.name}: {
                          getCollectionLogStatusLabel(job.status, job.conclusion)
                        }
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <p className="text-[10px] leading-4 text-muted-foreground">
                판정 기준: 최신 스냅샷이 저장되어 있으면 대시보드 데이터
                수집은 정상으로 봅니다.
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
}: {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
}) {
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
  const [draggedDashboardWidgetId, setDraggedDashboardWidgetId] =
    useState<AdminDashboardWidgetId | null>(null);
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

      if (startOrder && areAdminDashboardWidgetOrdersEqual(startOrder, nextOrder)) {
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
  const pendingTotal =
    (stats.pendingSubmissions ?? 0) + (stats.pendingReviews ?? 0);
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
      value: formatNumber(stats.pendingSubmissions),
      rawValue: stats.pendingSubmissions ?? 0,
    },
    {
      label: "리뷰 대기",
      value: formatNumber(stats.pendingReviews),
      rawValue: stats.pendingReviews ?? 0,
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
        cell: (row) => row.label,
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
          <span className="block truncate font-bold" title={row.title}>
            {row.title}
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
  >(
    () => {
      const metricInputs = [
        {
          label: subscriberCardTitle,
          value: subscriberValue,
          caption: subscriberCaption,
          rawValue:
            typeof subscriberDelta === "number"
              ? Math.abs(subscriberDelta)
              : (channelStats?.subscriberCount ?? 0),
        },
        {
          label: viewCardTitle,
          value: isChartLoading ? "—" : formatNumber(periodViewDisplayValue),
          caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeViewValue)}`,
          rawValue: periodViewDisplayValue,
        },
        {
          label: likeCardTitle,
          value: isChartLoading ? "—" : formatNumber(periodLikeDisplayValue),
          caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`,
          rawValue: periodLikeDisplayValue,
        },
        {
          label: commentCardTitle,
          value: isChartLoading ? "—" : formatNumber(periodCommentDisplayValue),
          caption: `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`,
          rawValue: periodCommentDisplayValue,
        },
        {
          label: "업로드 영상 수",
          value: isChartLoading ? "—" : formatNumber(periodUploadVideoValue),
          caption: periodVideoCaption,
          rawValue: periodUploadVideoValue,
        },
      ];
      const metricMaxValue = Math.max(
        1,
        ...metricInputs.map((metric) =>
          typeof metric.rawValue === "number" && Number.isFinite(metric.rawValue)
            ? Math.abs(metric.rawValue)
            : 0,
        ),
      );
      const topReportRows = topContentTableRows.slice(0, 5);
      const topReportMaxViews = Math.max(
        1,
        ...topReportRows.map((row) =>
          typeof row.views === "number" && Number.isFinite(row.views)
            ? row.views
            : 0,
        ),
      );
      return {
        title: "Tzuyang KPI Dashboard Report",
        logoUrl: "/logo.webp",
        periodLabel: selectedPeriodLabel,
        basisLabel: dashboardViewMetricLabel,
        summaryLabel: `${selectedPeriodLabel} 기준 핵심 KPI, 상위 콘텐츠, 성과 진단을 한 페이지 보고서로 정리했습니다.`,
        contributionFormula: topContentContributionFormula,
        metrics: metricInputs.map((metric) => ({
          label: metric.label,
          value: metric.value,
          caption: metric.caption,
          visualPercent:
            typeof metric.rawValue === "number" &&
            Number.isFinite(metric.rawValue)
              ? (Math.abs(metric.rawValue) / metricMaxValue) * 100
              : 0,
        })),
        topContents: topReportRows.map((row, index) => ({
          rank: `#${index + 1}`,
          title: row.title,
          views: formatNumber(row.views),
          likes: formatNumber(row.likes),
          comments: formatNumber(row.comments),
          contribution: row.viewBenchmark,
          barPercent:
            typeof row.views === "number" && Number.isFinite(row.views)
              ? (row.views / topReportMaxViews) * 100
              : 0,
        })),
        insights: topContentInsights.map((insight) => ({
          label: insight.label,
          title: insight.title,
          description: insight.description,
          scoreLabel: insight.scoreLabel,
          score: insight.score,
        })),
      };
    },
    [
      channelStats?.subscriberCount,
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
      subscriberDelta,
      subscriberValue,
      topContentContributionFormula,
      topContentInsights,
      topContentTableRows,
      viewCardTitle,
    ],
  );
  const handleExportPdfReport = useCallback(() => {
    const opened = openAdminDashboardPdfReport({
      ...pdfReportData,
      generatedAtLabel: formatAdminDashboardReportGeneratedAt(),
    });

    if (!opened) {
      setDashboardOrderMessage(
        "PDF 보고서 창을 열지 못했습니다. 브라우저 팝업 허용 상태를 확인해 주세요.",
      );
    }
  }, [pdfReportData]);
  return (
    <section
      className="flex min-h-full min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:h-full lg:min-h-0 lg:overflow-hidden"
      aria-label="관리자 대시보드 (KPI)"
      data-admin-dashboard-management="true"
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
          className="flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] md:w-auto md:flex-wrap md:items-start md:justify-end md:overflow-visible md:pb-0 md:gap-1 [&::-webkit-scrollbar]:hidden"
          data-admin-dashboard-action-bar="true"
          data-admin-dashboard-action-order="order-reset-report-collection-period"
          data-allow-horizontal-scroll="true"
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

      {isDashboardOrderEditorOpen ? (
        <p
          className="mb-2 shrink-0 text-[11px] font-semibold text-muted-foreground"
          data-admin-dashboard-order-live-status="true"
        >
          {dashboardOrderMessage}
        </p>
      ) : null}

      {chartHasError ? (
        <div className="mb-0 shrink-0 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
          지표 데이터를 불러오지 못했습니다. 대시보드 정적 영역은 유지합니다.
        </div>
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
        className="grid min-h-0 min-w-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:grid-cols-10 lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]"
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
          tone={hasSubscriberCount ? "teal" : "neutral"}
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
          tone="blue"
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
                        className="block truncate font-bold"
                        title={row.title}
                      >
                        {row.title}
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
                      dotClassName: "bg-sky-500",
                    },
                    {
                      key: "engagement",
                      label: "참여",
                      dotClassName: "bg-teal-500",
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
                pendingTotal +
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
            "flex min-h-[220px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-5",
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
                      dotClassName: "bg-sky-500",
                    },
                    {
                      key: "likes",
                      label: "좋아요",
                      dotClassName: "bg-rose-500",
                    },
                    {
                      key: "comments",
                      label: "댓글",
                      dotClassName: "bg-orange-500",
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
            "flex min-h-[220px] flex-col overflow-hidden p-2 sm:col-span-2 lg:col-span-5",
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
                        className="block truncate font-bold"
                        title={row.title}
                      >
                        {row.title}
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
    </section>
  );
}

function AdminSidebar({
  activeModuleId,
  onSelectModule,
  isCollapsed,
  showLabels,
  showMobileHeader,
  onToggleCollapsed,
  canLoadPreferences,
  stats,
}: {
  activeModuleId: AdminModuleId;
  onSelectModule: (moduleId: AdminModuleId) => void;
  isCollapsed: boolean;
  showLabels: boolean;
  showMobileHeader: boolean;
  onToggleCollapsed: () => void;
  canLoadPreferences: boolean;
  stats: AdminOverviewStats;
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

  const updateThemePreference = useCallback((nextTheme: AdminThemePreference) => {
    setThemePreference(nextTheme);
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
    applyAdminThemePreference(nextTheme);
  }, []);

  const handleMenuNavigation = (moduleId: AdminModuleId) => {
    onSelectModule(moduleId);
    setIsAdminMenuOpen(false);
  };

  useEffect(() => {
    if (!showMobileHeader) {
      setIsAdminMenuOpen(false);
    }
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
        aria-label={itemStatus ? `${item.title} ${itemStatus.label}` : item.title}
        aria-current={isActive ? "page" : undefined}
        aria-controls="admin-console-canvas"
        className={cn(
          "group relative flex items-center gap-2 overflow-hidden whitespace-nowrap border text-left transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
          isDropdown
            ? "min-h-10 w-full rounded-xl px-2.5 py-1.5 text-sm"
            : "min-h-9 w-full rounded-lg px-2 py-1 text-sm",
          !isDropdown &&
            isCollapsed &&
            "md:mx-auto md:h-9 md:min-h-9 md:w-9 md:justify-center md:gap-0 md:px-0",
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
            isDropdown ? "h-7 w-7 rounded-lg" : "h-6 w-6 rounded-md",
            isActive
              ? "border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
              : "border-border bg-background/80 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary",
          )}
          aria-hidden="true"
        >
          <Icon className={cn(isDropdown ? "h-4 w-4" : "h-3.5 w-3.5")} />
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
      className="rounded-2xl border border-border bg-background/70 p-2"
      aria-label="메뉴 순서 설정"
      data-admin-sidebar-order-editor={placement}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-foreground">메뉴 순서</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            섹션과 메뉴를 바로 위아래로 옮깁니다.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 rounded-lg px-2 text-[11px] font-bold"
          disabled={!canLoadPreferences || isOrderLoading || isOrderSaving}
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

      <div className="space-y-1.5">
        {orderedSidebarSections.map((section, sectionIndex) => (
          <div
            key={section.label}
            className="rounded-xl border border-border bg-card/80 p-1.5"
          >
            <div className="mb-1 flex items-center justify-between gap-1.5">
              <span className="truncate text-[11px] font-bold text-muted-foreground">
                {section.label}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 rounded-md p-0 text-[11px]"
                  aria-label={`${section.label} 섹션 앞으로`}
                  disabled={
                    !canLoadPreferences ||
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
                  className="h-6 w-6 rounded-md p-0 text-[11px]"
                  aria-label={`${section.label} 섹션 뒤로`}
                  disabled={
                    !canLoadPreferences ||
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

            <div className="space-y-1">
              {section.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg bg-muted/35 px-2 py-1"
                >
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {item.title}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 w-6 rounded-md p-0 text-[11px]"
                      aria-label={`${item.title} 메뉴 앞으로`}
                      disabled={
                        !canLoadPreferences ||
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
                      variant="outline"
                      size="sm"
                      className="h-6 w-6 rounded-md p-0 text-[11px]"
                      aria-label={`${item.title} 메뉴 뒤로`}
                      disabled={
                        !canLoadPreferences ||
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
        className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground"
        aria-live="polite"
      >
        {sidebarOrderMessage}
      </p>
    </div>
  );

  const renderThemeControls = (placement: "dropdown" | "sidebar") => {
    const isSidebarPlacement = placement === "sidebar";
    const isCompactSidebar = isSidebarPlacement && isCollapsed;

    return (
      <div
        className={cn(
          "border border-border bg-white p-1 shadow-inner dark:bg-card",
          isCompactSidebar
            ? "inline-flex w-9 flex-col items-center gap-1 self-center rounded-2xl"
            : "grid w-full grid-cols-3 gap-1 rounded-full",
        )}
        aria-label="화면 모드 선택"
        data-admin-sidebar-theme-toggle="true"
        data-admin-sidebar-preference-placement={placement}
        data-admin-sidebar-theme-layout={placement}
      >
        {([
          ["light", "화이트 모드", Sun],
          ["dark", "다크모드", Moon],
          ["system", "시스템 설정", Monitor],
        ] as const).map(([theme, label, Icon]) => (
          <Button
            key={theme}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 rounded-full border border-transparent p-0 text-muted-foreground shadow-none transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background",
              isCompactSidebar ? "w-8" : "w-full min-w-0",
              themePreference === theme &&
                "bg-primary text-primary-foreground shadow-primary hover:bg-primary hover:text-primary-foreground",
            )}
            aria-label={`${label}으로 변경`}
            aria-pressed={themePreference === theme}
            onClick={() => updateThemePreference(theme)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </Button>
        ))}
      </div>
    );
  };

  const renderAdminMenuContent = (contentId: string) => (
    <PopoverContent
      id={contentId}
      align="end"
      sideOffset={10}
      className="max-h-[min(760px,calc(100dvh-24px))] w-[min(25rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
      aria-label="관리자 콘솔 메뉴"
      data-admin-console-menu-dropdown="true"
    >
      <div className="mb-2 flex items-center gap-2 rounded-2xl bg-muted/35 p-2">
            <Link
              href="/"
              className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background"
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

          <nav className="space-y-2" aria-label="관리자 통합 메뉴">
            {orderedSidebarSections.map((section) => (
              <div key={section.label} className="space-y-1">
                <p className="px-1 text-[11px] font-bold tracking-[0.08em] text-muted-foreground">
                  {section.label}
                </p>
                {section.items.map((item) => renderMenuItem(item, section, "dropdown"))}
              </div>
            ))}
          </nav>

          <div className="mt-2">{renderThemeControls("dropdown")}</div>

      <div className="mt-2">{renderOrderControls("dropdown")}</div>
    </PopoverContent>
  );

  return (
    <>
      <Popover open={isAdminMenuOpen} onOpenChange={setIsAdminMenuOpen}>
        <div
          className={cn(
            "flex h-14 shrink-0 transform-gpu items-center gap-2 overflow-hidden border-b border-border bg-card/95 px-3 py-2 shadow-sm transition-[transform,border-color] duration-300 ease-out will-change-transform motion-reduce:transition-none md:hidden",
            !showMobileHeader &&
              "pointer-events-none border-transparent",
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
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background text-foreground"
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
              className="h-10 w-10 shrink-0 rounded-lg bg-transparent p-0 shadow-none hover:bg-muted/70 focus-visible:ring-primary focus-visible:ring-offset-background"
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
          "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden border-r border-border bg-gradient-to-b from-card via-card to-background/95 p-2 shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none md:flex",
          isCollapsed
            ? "md:w-[4.5rem] md:min-w-[4.5rem] md:max-w-[4.5rem] md:items-center md:px-1.5"
            : "md:min-w-[14.25rem] md:max-w-[var(--admin-sidebar-expanded-max-width)]",
        )}
        aria-label="관리자 콘솔 사이드바"
        data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}
        data-admin-sidebar-scroll="hidden-scrollbar"
      >
        <div
          className={cn(
            "mb-1.5 flex min-h-9 items-center gap-2 border-b border-border/70 px-1 pb-1.5 transition-[border-color] duration-200 motion-reduce:transition-none",
            isCollapsed &&
              "md:min-h-9 md:w-full md:items-center md:justify-center md:border-b-0 md:px-0 md:pb-1",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-transparent text-foreground transition hover:border-border hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
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
              (!showLabels || isCollapsed) && "md:sr-only",
            )}
          >
            <h2 className="truncate whitespace-nowrap text-sm font-bold tracking-[-0.03em] text-foreground text-pretty">
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
              "ml-auto inline-flex h-8 w-8 shrink-0 rounded-xl border border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background",
              isCollapsed && "md:m-0",
            )}
            aria-pressed={isCollapsed}
            aria-expanded={!isCollapsed}
            aria-controls="admin-console-menu"
            aria-label={
              isCollapsed ? "관리자 사이드바 펼치기" : "관리자 사이드바 접기"
            }
            onClick={onToggleCollapsed}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
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
                  isCollapsed && "md:flex md:w-full md:flex-col md:items-center",
                )}
              >
                <p
                  className={cn(
                    "px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none",
                    (!showLabels || isCollapsed) && "md:h-px md:px-0 md:opacity-0",
                  )}
                >
                  {section.label}
                </p>
                {section.items.map((item) => renderMenuItem(item, section, "sidebar"))}
              </div>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-dashed border-border/70 pt-4",
            isCollapsed
              ? "flex w-full flex-col items-center gap-2.5"
              : "space-y-3",
          )}
          data-admin-sidebar-footer-actions="true"
          data-admin-sidebar-footer-separator="spacious"
          aria-label="관리자 사이드바 설정"
        >
          {isCollapsed ? (
            <>
              {renderThemeControls("sidebar")}

              <Popover>
                <UiTooltipProvider delayDuration={120}>
                  <UiTooltip>
                    <UiTooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 rounded-lg border border-border bg-background/70 p-0 text-muted-foreground hover:text-foreground"
                          aria-label="메뉴 순서 설정 열기"
                          data-admin-sidebar-order-trigger="collapsed"
                        >
                          <Menu className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </PopoverTrigger>
                    </UiTooltipTrigger>
                    <UiTooltipContent
                      side="right"
                      align="center"
                      className={adminDashboardTooltipPortalClassName}
                      data-admin-sidebar-collapsed-tooltip="true"
                    >
                      <AdminDashboardTooltipLinesPanel
                        lines={["메뉴 순서", "섹션과 메뉴 위치 변경"]}
                        dataAttribute="sidebar-collapsed"
                        className="max-w-[14rem]"
                      />
                    </UiTooltipContent>
                  </UiTooltip>
                </UiTooltipProvider>
                <PopoverContent
                  side="right"
                  align="end"
                  sideOffset={10}
                  className="max-h-[min(760px,calc(100dvh-24px))] w-[min(24rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
                  aria-label="메뉴 순서 설정"
                >
                  {renderOrderControls("sidebar")}
                </PopoverContent>
              </Popover>
            </>
          ) : (
            <>
              {renderThemeControls("sidebar")}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full justify-start rounded-xl px-3 text-xs font-bold"
                    aria-label="메뉴 순서 설정 열기"
                    data-admin-sidebar-order-trigger="expanded"
                  >
                    <Menu className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    메뉴 순서 설정
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="end"
                  sideOffset={10}
                  className="max-h-[min(760px,calc(100dvh-24px))] w-[min(24rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
                  aria-label="메뉴 순서 설정"
                >
                  {renderOrderControls("sidebar")}
                </PopoverContent>
              </Popover>
            </>
          )}
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
    <section aria-labelledby="admin-llm-session-title" className="space-y-3">
      <div className="rounded-2xl border border-primary/15 bg-card/95 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">읽기 전용 보조</p>
            <h2
              id="admin-llm-session-title"
              className="mt-1 text-2xl font-bold tracking-[-0.04em] text-foreground md:text-3xl"
            >
              자동 운영 보조
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              선택한 운영 모듈의 상황을 요약하고 다음 검수 순서를 제안하는 읽기
              전용 보조 화면입니다. 실제 승인·삭제·공개 변경은 관리자 확인과
              상태 재확인 이후에만 진행됩니다.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-primary/30 text-primary"
          >
            읽기 전용
          </Badge>
        </div>
      </div>

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
  );
}

function AuditPlaceholder() {
  return (
    <Card className="min-h-[480px] border-border bg-card/95 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">준비 중</p>
            <CardTitle className="mt-1 text-2xl tracking-[-0.04em]">
              감사 로그
            </CardTitle>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              승인·반려·삭제·복구 이력을 한 화면에서 확인하는 영역입니다. 사용자
              권한 변경 감사는 저장되며, 전체 운영 감사 읽기 화면은 감사 원천이
              확정되기 전까지 안전 적용 원칙과 상태 재확인 체크리스트만
              표시합니다.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-primary/30 text-primary"
          >
            일부 소스 연결 필요
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {[
          [
            "결정 기록",
            "관리자가 어떤 결정을 했는지 승인/반려/삭제/복구 단위로 저장합니다.",
          ],
          ["안전 적용", "위험 변경은 미리보기 → 확인 → 적용 순서를 거칩니다."],
          [
            "상태 재확인",
            "적용 후 실제 데이터 상태를 다시 읽어 최종 상태를 확인합니다.",
          ],
          [
            "재수집 연결",
            "필요 시 재수집/재평가 큐로 넘길 수 있게 연결합니다.",
          ],
        ].map(([title, description]) => (
          <div
            key={title}
            className="rounded-2xl border border-border bg-muted/25 p-3"
          >
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
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
        return <AdminRestaurantRefreshHistoryModule key="restaurant-refresh-history" />;
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
        return <AdminYoutubeThumbnailGenerator key="admin-youtube-thumbnail-generator" />;
      case "users":
        return <AdminUsersModule key="admin-users" />;
      case "insights":
        return <InsightsModule key="admin-insights" />;
      default: {
        const exhaustiveModuleId: never = module.id;
        return exhaustiveModuleId;
      }
    }
  })();

  return (
    <section
      aria-label={`${module.title} 작업 화면`}
      className="flex min-h-full flex-col md:h-full md:min-h-0"
    >
      <div
        className={cn(
          "min-h-[420px] flex-1 rounded-xl border border-border bg-background shadow-sm md:min-h-0",
          "overflow-visible md:overflow-hidden",
        )}
      >
        {moduleContent}
      </div>
    </section>
  );
}

function AdminConsoleCanvasSkeleton() {
  return (
    <div
      className="grid min-h-full grid-cols-1 gap-2 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]"
      data-admin-console-content-loading="true"
      role="status"
      aria-busy="true"
      aria-label="관리자 콘솔 작업 화면 로딩 중"
    >
      <div className="min-h-[390px] rounded-xl border border-border bg-card p-3 lg:min-h-0">
        <Skeleton className="h-full min-h-[220px] rounded-lg motion-reduce:animate-none" />
      </div>
      <div className="min-h-[420px] rounded-xl border border-border bg-card p-3 lg:min-h-0">
        <div className="space-y-3">
          <Skeleton className="h-8 w-40 rounded-lg motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full rounded-xl motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

function AdminStoryboardModuleLoadingSkeleton() {
  const loadingCutNos = [1, 2, 3, 4] as const;

  return (
    <section
      className="flex h-full min-h-[640px] min-w-0 flex-col overflow-hidden bg-background p-3 md:min-h-0"
      data-storyboard-module-loading="true"
      data-storyboard-module-loading-layout="page-shell"
      role="status"
      aria-busy="true"
      aria-label="스토리보드 생성 화면 로딩 중"
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:grid-rows-1">
        <Card
          className="order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-background shadow-none"
          aria-label="스토리보드 캔버스 준비 영역"
          data-storyboard-module-loading-canvas="true"
        >
          <CardHeader className="flex shrink-0 flex-row items-center gap-2 p-2 pb-1">
            <div
              className="h-8 w-28 rounded-full bg-muted/70"
              aria-hidden="true"
              data-storyboard-module-loading-toolbar="true"
            />
            <div className="ml-auto flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pb-1">
              <div className="h-8 w-24 shrink-0 rounded-md border border-border/70 bg-background" />
              <div className="h-8 w-20 shrink-0 rounded-md border border-border/70 bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md bg-muted/70" />
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-3 pt-1">
            <div
              className="grid h-full min-h-[420px] grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2"
              data-storyboard-module-loading-frame-grid="true"
              aria-hidden="true"
            >
              {loadingCutNos.map((cutNo) => (
                <div
                  key={`storyboard-loading-cut-${cutNo}`}
                  className="relative min-h-[190px] overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 via-slate-200/85 to-slate-400/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:from-slate-800/72 dark:via-slate-700/58 dark:to-slate-600/52"
                  data-storyboard-module-loading-cut={String(cutNo)}
                >
                  <span className="absolute left-3 top-3 z-10 h-5 w-14 rounded-full bg-slate-700/70" />
                  <span className="absolute right-3 top-3 z-10 h-6 w-12 rounded-full bg-white/80" />
                  <span
                    className="absolute inset-0 bg-gradient-to-br from-white/58 via-slate-200/28 to-slate-500/24"
                    aria-hidden="true"
                    data-storyboard-module-loading-glass="true"
                  />
                  <span
                    className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent blur-sm [animation:storyboard-glass-shimmer_1.35s_ease-in-out_infinite]"
                    aria-hidden="true"
                    data-storyboard-module-loading-shimmer="true"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card
          className="order-2 flex min-h-[360px] flex-col overflow-hidden border border-border/70 bg-background shadow-none xl:min-h-0"
          aria-label="스토리보드 도우미 준비 영역"
          data-storyboard-module-loading-chat-shell="static"
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="h-4 w-28 rounded-full bg-muted/80" />
              </div>
              <div className="h-6 w-14 shrink-0 rounded-full border border-border/70 bg-background" />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-3 pt-0">
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background/95 to-muted/30 shadow-sm"
              data-storyboard-module-loading-chat="true"
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3">
                <div className="max-w-[86%] space-y-2 rounded-2xl rounded-bl-md bg-background px-3 py-3 shadow-sm ring-1 ring-border/60">
                  <div className="h-3 w-44 max-w-full rounded-full bg-muted-foreground/14" />
                  <div className="h-3 w-64 max-w-full rounded-full bg-muted-foreground/12" />
                </div>
                <div className="ml-auto max-w-[72%] rounded-2xl rounded-br-md bg-muted/70 px-3 py-3">
                  <div className="h-3 w-52 max-w-full rounded-full bg-muted-foreground/16" />
                </div>
                <div className="max-w-[82%] space-y-2 rounded-2xl rounded-bl-md border border-border/60 bg-muted/45 px-3 py-3">
                  <div className="h-3 w-48 max-w-full rounded-full bg-muted-foreground/16" />
                  <div className="h-3 w-32 max-w-full rounded-full bg-muted-foreground/12" />
                </div>
              </div>
              <div
                className="shrink-0 border-t border-border/70 bg-background/80 p-2.5"
                data-storyboard-module-loading-composer="true"
              >
                <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-2">
                  <div className="h-3 flex-1 rounded-full bg-muted-foreground/12" />
                  <div className="h-9 w-9 shrink-0 rounded-full bg-muted/80" />
                </div>
              </div>
            </div>
            <span className="sr-only">
              스토리보드 캔버스와 도우미 영역을 준비하고 있습니다.
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
      className="flex h-full min-h-[640px] min-w-0 flex-col overflow-hidden bg-background p-3 md:min-h-0"
      data-thumbnail-module-loading="true"
      data-thumbnail-module-loading-layout="page-shell"
      data-thumbnail-module-loading-parity="storyboard-shell"
      role="status"
      aria-busy="true"
      aria-label="유튜브 썸네일 생성 화면 로딩 중"
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:grid-rows-1">
        <Card
          className="order-2 flex min-h-0 flex-col overflow-hidden border border-border/70 bg-background shadow-none"
          aria-label="유튜브 썸네일 도우미 준비 영역"
          data-thumbnail-module-loading-chat-shell="static"
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
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
          <CardContent className="flex min-h-0 flex-1 flex-col p-3 pt-0">
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background/95 to-muted/35 shadow-sm"
              data-thumbnail-module-loading-chat="true"
              data-thumbnail-module-loading-chat-tone="neutral-storyboard"
            >
              <div
                className="min-h-0 flex-1 space-y-3 overflow-hidden p-3"
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
                className="shrink-0 border-t border-border/70 bg-background/80 p-2.5"
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
          className="order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="유튜브 썸네일 캔버스 로딩"
          data-thumbnail-module-loading-canvas="true"
        >
          <CardHeader className="flex shrink-0 flex-row items-center gap-2 p-2 pb-1">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0 whitespace-nowrap font-semibold">
                캔버스 편집 / PNG 내보내기
              </span>
            </CardTitle>
            <div className="ml-auto flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pb-1">
              <div className="h-8 w-24 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-20 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md border border-input bg-background" />
              <div className="h-8 w-24 shrink-0 rounded-md bg-muted/80" />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 pt-0">
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
                  className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent blur-sm [animation:storyboard-glass-shimmer_1.45s_ease-in-out_infinite]"
                  aria-hidden="true"
                  data-thumbnail-module-loading-shimmer="true"
                />
              </div>
            </div>
            <div
              className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6"
              data-thumbnail-module-loading-toolbar="true"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <div
                  key={`thumbnail-module-loading-tool-${index + 1}`}
                  className="h-8 rounded-lg border border-border/60 bg-background/80"
                />
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


export function AdminConsoleOverview({
  initialStoryboardResult = null,
}: {
  initialStoryboardResult?: StoryboardInitialResult | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedModuleId = getAdminModuleIdFromSearchParams(searchParams);
  const { user, isLoading: authLoading } = useAuth();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasE2EAdminShellBypass, setHasE2EAdminShellBypass] = useState(() =>
    hasLocalE2EAdminShellBypass(),
  );
  const isShellBootstrapping = authLoading || !hasHydrated;
  const shouldRenderAdminShell =
    isShellBootstrapping || Boolean(user) || hasE2EAdminShellBypass;
  const canLoadAdminConsoleData = Boolean(user) && !isShellBootstrapping;
  const {
    stats,
    isLoading: statsLoading,
    hasError: statsHasError,
  } = useAdminOverviewStats(canLoadAdminConsoleData);
  const [activeModuleId, setActiveModuleId] =
    useState<AdminModuleId>(requestedModuleId);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSidebarLabels, setShowSidebarLabels] = useState(true);
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const [isAdminMobileViewport, setIsAdminMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const canvasRef = useRef<HTMLElement | null>(null);
  const previousMobileHeaderScrollTopRef = useRef(0);
  const adminCanvasTouchStartYRef = useRef<number | null>(null);
  const previousRequestedModuleIdRef = useRef(requestedModuleId);
  const activeModule = consoleModules.find(
    (module) => module.id === activeModuleId,
  );

  useEffect(() => {
    setHasHydrated(true);
    setHasE2EAdminShellBypass(hasLocalE2EAdminShellBypass());
  }, []);

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
      setActiveModuleId(moduleId);
      setIsMobileHeaderVisible(true);

      router.replace(buildCanonicalAdminModuleHref(moduleId), {
        scroll: false,
      });

      window.requestAnimationFrame(() => {
        canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
        canvasRef.current?.focus({ preventScroll: true });
      });
    },
    [router],
  );

  useEffect(() => {
    const stateWarning = getAdminModuleStateWarning(searchParams);
    const nextModuleId = requestedModuleId;
    const canonicalHref = buildCanonicalAdminModuleHref(nextModuleId);
    const currentQuery = searchParams.toString();
    const currentHref = `/admin${currentQuery ? `?${currentQuery}` : ""}`;

    setActiveModuleId((current) =>
      current === nextModuleId ? current : nextModuleId,
    );

    if (previousRequestedModuleIdRef.current !== nextModuleId) {
      previousRequestedModuleIdRef.current = nextModuleId;
      setIsMobileHeaderVisible(true);
    }

    if (stateWarning || currentHref !== canonicalHref) {
      router.replace(canonicalHref, { scroll: false });
    }
  }, [requestedModuleId, router, searchParams]);

  useEffect(() => {
    const isStoredSidebarCollapsed =
      window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY) ===
      "true";
    setIsSidebarCollapsed(isStoredSidebarCollapsed);
    setShowSidebarLabels(!isStoredSidebarCollapsed);
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
      const nextSidebarCollapsed = !current;
      window.localStorage.setItem(
        ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY,
        String(nextSidebarCollapsed),
      );

      if (nextSidebarCollapsed) {
        setShowSidebarLabels(false);
      }

      return nextSidebarCollapsed;
    });
  };

  const getAdminConsoleScrollTop = useCallback(() => {
    if (typeof window === "undefined") return 0;

    const canvasScrollTop = canvasRef.current?.scrollTop ?? 0;
    const pageScrollTop = Math.max(
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    );

    return Math.max(canvasScrollTop, pageScrollTop);
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

  const adminBottomNavAutoHide = useMobileBottomNavAutoHide({
    scrollRef: canvasRef,
    source: "admin-console",
    disabled: !isAdminMobileViewport,
    revealOnScrollUp: false,
    getScrollTop: getAdminConsoleScrollTop,
  });

  const setAdminMobileChromeHidden = useCallback(
    (hidden: boolean) => {
      if (!isAdminMobileViewport) return;

      setIsMobileHeaderVisible(!hidden);
      adminBottomNavAutoHide.setBottomNavHidden(hidden);
    },
    [adminBottomNavAutoHide, isAdminMobileViewport],
  );

  const handleAdminCanvasScroll = useCallback(() => {
    updateMobileHeaderVisibility();
    adminBottomNavAutoHide.onScroll();
  }, [adminBottomNavAutoHide, updateMobileHeaderVisibility]);

  const handleAdminCanvasWheel = useCallback<WheelEventHandler<HTMLElement>>(
    (event) => {
      if (!isAdminMobileViewport) return;

      if (event.deltaY > 18) {
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

  const handleAdminCanvasTouchStart =
    useCallback<TouchEventHandler<HTMLElement>>(
      (event) => {
        adminCanvasTouchStartYRef.current = event.touches[0]?.clientY ?? null;
        adminBottomNavAutoHide.onTouchStart(event);
      },
      [adminBottomNavAutoHide],
    );

  const handleAdminCanvasTouchMove = useCallback<TouchEventHandler<HTMLElement>>(
    (event) => {
      const startY = adminCanvasTouchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      let handledGestureIntent = false;

      if (
        isAdminMobileViewport &&
        startY !== null &&
        currentY !== undefined
      ) {
        const deltaY = currentY - startY;

        if (deltaY <= -24) {
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

  useEffect(() => {
    const canvasElement = canvasRef.current;
    const handleScroll = () => handleAdminCanvasScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    canvasElement?.addEventListener("scroll", handleScroll, { passive: true });
    window.requestAnimationFrame(handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      canvasElement?.removeEventListener("scroll", handleScroll);
    };
  }, [handleAdminCanvasScroll]);

  if (!shouldRenderAdminShell) {
    return null;
  }

  const activeModuleLabel =
    activeModuleId === "overview"
      ? "대시보드 (KPI)"
      : activeModuleId === "routes"
        ? "맛집 동선 추천"
        : activeModuleId === "llm"
          ? "운영 보조"
          : activeModule?.title;

  return (
    <main
      className="h-[var(--full-height,100vh)] min-h-0 w-full overflow-hidden bg-background text-foreground"
      data-admin-console-shell="true"
    >
      <a
        href="#admin-console-canvas"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-primary"
      >
        작업 화면으로 건너뛰기
      </a>
      <div
        id="overview"
        className={cn("grid h-full min-h-0 w-full gap-0 overflow-hidden")}
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
          showMobileHeader={isMobileHeaderVisible}
          onToggleCollapsed={handleToggleSidebarCollapsed}
          canLoadPreferences={canLoadAdminConsoleData}
          stats={stats}
        />

        <section
          id="admin-console-canvas"
          ref={canvasRef}
          tabIndex={-1}
          aria-label="관리자 콘솔 작업 화면"
          className={cn(
            "h-full min-h-0 min-w-0 overflow-x-hidden overscroll-contain border-y border-border bg-background p-2 md:border-y-0 md:p-4",
            activeModuleId === "overview"
              ? "overflow-y-auto lg:overflow-hidden"
              : "overflow-y-auto",
          )}
          data-admin-console-content="true"
          onScroll={handleAdminCanvasScroll}
          onWheel={handleAdminCanvasWheel}
          onTouchStart={handleAdminCanvasTouchStart}
          onTouchMove={handleAdminCanvasTouchMove}
        >
          <p className="sr-only" aria-live="polite">
            {activeModuleLabel} 작업 화면으로 전환됨
          </p>
          {isShellBootstrapping ? (
            activeModuleId === "overview" ? (
              <AdminDashboardManagementSkeleton />
            ) : activeModuleId === "youtube-thumbnail-generator" ? (
              <AdminYoutubeThumbnailModuleLoadingSkeleton />
            ) : activeModuleId === "storyboard" ? (
              <AdminStoryboardModuleLoadingSkeleton />
            ) : (
              <AdminConsoleCanvasSkeleton />
            )
          ) : activeModuleId === "overview" ? (
            <AdminDashboardManagementPanel
              stats={stats}
              isLoading={statsLoading}
              hasError={statsHasError}
            />
          ) : activeModuleId === "routes" ? (
            <AdminRouteRecommendationModule
              stats={stats}
              isLoading={statsLoading}
              hasError={statsHasError}
              onSelectModule={selectModule}
            />
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
