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
  Image as ImageIcon,
  MessageSquareText,
  Info,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Sun,
  Settings2,
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
import { fetchSupabaseExactCount } from "@/lib/supabase-rest-client";
import { cn } from "@/lib/utils";
import type { DashboardSummaryResponse } from "@/types/dashboard";
import type {
  InsightTreemapPeriod,
  InsightTreemapResponse,
  InsightTreemapVideoRow,
} from "@/lib/public-insights/treemap";

type AdminModuleId =
  | "overview"
  | "routes"
  | "restaurants"
  | "submissions"
  | "reviews"
  | "storyboard"
  | "banners"
  | "users"
  | "insights"
  | "audit"
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
];

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

function getNextAdminThemePreference(
  currentTheme: AdminThemePreference,
): AdminThemePreference {
  if (currentTheme === "light") return "dark";
  if (currentTheme === "dark") return "system";

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
        ["restaurants", "submissions", "reviews"].includes(module.id),
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
    items: [
      {
        id: "routes",
        title: "맛집 동선 추천",
        description: "지도에서 맛집 후보와 실제 도로 동선을 관리합니다.",
        icon: Route,
        badge: "지도 동선",
      },
      ...consoleModules
        .filter((module) =>
          ["storyboard", "banners", "users", "insights"].includes(module.id),
        )
        .map(({ id, title, description, icon, badge }) => ({
          id,
          title,
          description,
          icon,
          badge,
        })),
    ],
  },
  {
    label: "실험실",
    items: [
      ...consoleModules
        .filter((module) => ["audit"].includes(module.id))
        .map(({ id, title, description, icon, badge }) => ({
          id,
          title,
          description,
          icon,
          badge,
        })),
      {
        id: "llm",
        title: "운영 보조",
        description: "위험 액션 전 읽기 전용 운영 보조를 확인합니다.",
        icon: Bot,
        badge: "실험 중",
      },
    ],
  },
];

type AdminSidebarOrderPreference = {
  sections: string[];
  items: Record<string, AdminModuleId[]>;
};

type AdminDashboardWidgetId =
  | "subscribers"
  | "views"
  | "likes"
  | "comments"
  | "videos"
  | "impact"
  | "trend"
  | "ops"
  | "topContent"
  | "engagementRate";

type AdminDashboardTableWidgetId = Extract<
  AdminDashboardWidgetId,
  "impact" | "trend" | "ops" | "topContent" | "engagementRate"
>;

type AdminDashboardCardView = "chart" | "table";

type AdminDashboardTrendSeriesKey = "views" | "engagement" | "engagementRate";
type AdminDashboardTopContentSeriesKey = "views" | "likes" | "comments";

type AdminDashboardSeriesVisibility<Key extends string> = Record<Key, boolean>;

type AdminDashboardCardReorderProps = {
  draggable: boolean;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onDragEnd: DragEventHandler<HTMLDivElement>;
  "aria-grabbed": boolean;
  "data-admin-dashboard-direct-reorder-card": AdminDashboardWidgetId;
};

const DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER: AdminDashboardWidgetId[] = [
  "subscribers",
  "views",
  "likes",
  "comments",
  "videos",
  "impact",
  "trend",
  "ops",
  "topContent",
  "engagementRate",
];

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

const adminDashboardWidgetIdSet = new Set<AdminDashboardWidgetId>(
  DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
);

function normalizeAdminDashboardWidgetOrder(
  value: unknown,
): AdminDashboardWidgetId[] {
  const preferredOrder = Array.isArray(value)
    ? value.filter(
        (item): item is AdminDashboardWidgetId =>
          typeof item === "string" &&
          adminDashboardWidgetIdSet.has(item as AdminDashboardWidgetId),
      )
    : [];

  return Array.from(
    new Set([...preferredOrder, ...DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER]),
  );
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

const DEFAULT_ADMIN_SIDEBAR_ORDER: AdminSidebarOrderPreference = {
  sections: sidebarSections.map((section) => section.label),
  items: Object.fromEntries(
    sidebarSections.map((section) => [
      section.label,
      section.items.map((item) => item.id),
    ]),
  ),
};

const sidebarSectionLabelSet = new Set(
  sidebarSections.map((section) => section.label),
);
const sidebarItemIdSet = new Set(
  sidebarSections.flatMap((section) => section.items.map((item) => item.id)),
);

function normalizeAdminSidebarOrder(
  value: unknown,
): AdminSidebarOrderPreference {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const preferredSections = Array.isArray(record.sections)
    ? record.sections.filter(
        (section): section is string =>
          typeof section === "string" && sidebarSectionLabelSet.has(section),
      )
    : [];
  const sections = Array.from(
    new Set([...preferredSections, ...DEFAULT_ADMIN_SIDEBAR_ORDER.sections]),
  );
  const rawItems =
    record.items &&
    typeof record.items === "object" &&
    !Array.isArray(record.items)
      ? (record.items as Record<string, unknown>)
      : {};
  const usedItemIds = new Set<AdminModuleId>();
  const items = Object.fromEntries(
    DEFAULT_ADMIN_SIDEBAR_ORDER.sections.map((section) => {
      const sectionItemIds = new Set(
        DEFAULT_ADMIN_SIDEBAR_ORDER.items[section],
      );
      const preferredItems = Array.isArray(rawItems[section])
        ? rawItems[section].filter((item): item is AdminModuleId => {
            if (
              typeof item !== "string" ||
              !sidebarItemIdSet.has(item as AdminModuleId) ||
              !sectionItemIds.has(item as AdminModuleId) ||
              usedItemIds.has(item as AdminModuleId)
            ) {
              return false;
            }
            usedItemIds.add(item as AdminModuleId);
            return true;
          })
        : [];
      const defaultItems = DEFAULT_ADMIN_SIDEBAR_ORDER.items[section].filter(
        (item) => !usedItemIds.has(item),
      );
      defaultItems.forEach((item) => usedItemIds.add(item));
      return [section, [...preferredItems, ...defaultItems]];
    }),
  );

  return { sections, items };
}

function moveItemInArray<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
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
  comparisonFetchedAt?: string | null;
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

async function fetchAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [submissions, reviews] = await Promise.all([
    fetchSupabaseExactCount("restaurant_submissions", [
      ["status", "in.(pending,partially_approved)"],
    ]),
    fetchSupabaseExactCount("reviews", [["is_verified", "eq.false"]]),
  ]);

  return { submissions, reviews };
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
  viewBenchmarkLabel: string;
  meta: string;
};

const ADMIN_DASHBOARD_PERIOD_OPTIONS: Array<{
  value: Exclude<AdminDashboardPeriod, "ALL">;
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
];

const ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT = 12;
const ADMIN_DASHBOARD_TREND_POINT_LIMIT = 9;
const ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT = 7;
const ADMIN_DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;

const adminCompactNumberFormatter = new Intl.NumberFormat("ko-KR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const adminDashboardDateFormatter = new Intl.DateTimeFormat("ko-KR", {
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

function formatDashboardDateTime(value: string | null | undefined) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? adminDashboardDateTimeFormatter.format(date)
    : "시간 없음";
}

function getVideoEngagementTotal(video: InsightTreemapVideoRow) {
  return video.likeCount + video.commentCount;
}

function getPreviousVideoEngagementTotal(video: InsightTreemapVideoRow) {
  return (video.previousLikeCount ?? 0) + (video.previousCommentCount ?? 0);
}

function getVideoMetricDelta(
  video: InsightTreemapVideoRow,
  getCurrentValue: (video: InsightTreemapVideoRow) => number,
  getPreviousValue: (
    video: InsightTreemapVideoRow,
  ) => number | null | undefined,
) {
  const previousValue = getPreviousValue(video);

  if (typeof previousValue !== "number" || !Number.isFinite(previousValue)) {
    return null;
  }

  return getCurrentValue(video) - previousValue;
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
        (sum, video) => sum + getCurrentValue(video),
        0,
      );
      const previousTotal = videos.reduce((sum, video) => {
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

  return fallbackResponse.json() as Promise<InsightTreemapResponse>;
}

function buildAdminDashboardTrendPoints(
  videosByPublishedAt: InsightTreemapVideoRow[],
): AdminDashboardTrendPoint[] {
  return sampleAdminDashboardPeriodPoints(
    videosByPublishedAt,
    ADMIN_DASHBOARD_TREND_POINT_LIMIT,
  ).map((video) => ({
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

  return sampleAdminDashboardPeriodPoints(
    videosByPublishedAt,
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
  const metricPrefix = metricMode === "delta" ? "증가" : "";
  const viewBenchmarkLabel = metricMode === "delta" ? "조회 증가" : "조회";

  return metricRows.slice(0, 6).map((row) => ({
    label: row.video.title,
    value: row.viewCount,
    likeCount: row.likeCount,
    viewCount: row.viewCount,
    commentCount: row.commentCount,
    viewAverage,
    likeAverage,
    commentAverage,
    viewBenchmarkLabel,
    meta: `조회${metricPrefix} ${formatCompactNumber(row.viewCount)} · ${formatDashboardAverageComparison(
      row.viewCount,
      viewAverage,
    )} · 좋아요${metricPrefix} ${formatCompactNumber(
      row.likeCount,
    )} · 댓글${metricPrefix} ${formatCompactNumber(row.commentCount)}`,
  }));
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
  const strongestView = [...metricRows].sort(
    (a, b) =>
      (getDashboardAverageDeltaPercent(b.viewValue, viewAverage) ?? -Infinity) -
      (getDashboardAverageDeltaPercent(a.viewValue, viewAverage) ?? -Infinity),
  )[0];
  const strongestViewScore = strongestView
    ? getDashboardInsightSignalScore(strongestView.viewValue, viewAverage)
    : 0;
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

  if (strongestView) {
    const scoreLabel = formatDashboardAverageComparison(
      strongestView.viewValue,
      viewAverage,
    );

    insights.push({
      label: "평균 대비",
      title: strongestView.video.title,
      description: `조회 ${metricNoun} ${scoreLabel} · ${formatCompactNumber(strongestView.viewValue)}`,
      tone: "emerald",
      score: getDashboardInsightSignalScore(
        strongestView.viewValue,
        viewAverage,
      ),
      scoreLabel,
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

  if (reboundCandidate && reboundCandidate !== strongestView) {
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
    strongestView
  ) {
    insights.push({
      label: "구독자 기여 후보",
      title: strongestView.video.title,
      description: `구독자 ${formatSignedNumber(
        subscriberDelta,
      )} 기간의 조회 ${metricNoun} 1위 후보`,
      tone: "emerald",
      score: Math.max(8, Math.min(100, strongestViewScore)),
      scoreLabel: `구독자 ${formatSignedNumber(subscriberDelta)}`,
    });
  }

  return insights.slice(0, 4);
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
  "min-h-0 overflow-hidden border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.06)]";

const adminDashboardChartMargin = { top: 10, right: 10, bottom: 2, left: 0 };
const adminDashboardScatterChartMargin = {
  top: 10,
  right: 12,
  bottom: 2,
  left: 0,
};
const adminDashboardVisualizationShellClassName =
  "min-h-0 flex-1 overflow-visible rounded-xl p-1 sm:p-1.5";
const adminDashboardChartViewportClassName =
  "relative h-full min-h-0 w-full overflow-visible [&_.recharts-surface]:overflow-visible [&_.recharts-wrapper]:overflow-visible";
const adminDashboardTooltipStyle = {
  border: "1px solid hsl(var(--border))",
  borderRadius: "12px",
  background: "hsl(var(--background))",
  boxShadow: "0 10px 30px rgba(15,23,42,0.12)",
  color: "hsl(var(--foreground))",
  fontSize: "12px",
};
const adminDashboardGridColor = "hsl(var(--border) / 0.55)";
const adminDashboardAxisColor = "hsl(var(--muted-foreground))";
const adminDashboardControlGroupClassName =
  "inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/25 p-0.5";
const adminDashboardControlButtonClassName =
  "inline-flex h-6 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-extrabold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function formatRechartsTooltipValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? formatCompactNumber(value)
    : String(value ?? "—");
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
            aria-label={label}
            data-admin-dashboard-metric-tooltip="true"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </UiTooltipTrigger>
        <UiTooltipContent
          side="top"
          align="start"
          className="max-w-[18rem] space-y-1.5 text-xs leading-5"
        >
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
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

function AdminDashboardDiagnosisMeta({ periodLabel }: { periodLabel: string }) {
  return (
    <div
      className="hidden min-w-0 max-w-[28rem] items-center justify-end gap-1.5 text-[11px] font-bold leading-none text-muted-foreground lg:flex"
      aria-label={`성과 진단 기준 ${periodLabel}, 비교 채널 평균, 목적 다음 액션`}
      data-admin-dashboard-diagnosis-meta="header-inline"
    >
      <span className="min-w-0 truncate">
        기준 <b className="font-black text-foreground">{periodLabel}</b>
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">
        비교 <b className="font-black text-foreground">채널 평균</b>
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">
        목적 <b className="font-black text-foreground">다음 액션</b>
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
  options: Array<{ key: Key; label: string; dotClassName: string }>;
  visibility: AdminDashboardSeriesVisibility<Key>;
  onToggle: (key: Key) => void;
}) {
  const visibleCount = options.filter(
    (option) => visibility[option.key],
  ).length;

  return (
    <div
      className={cn(
        "inline-flex h-7 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-full border border-transparent bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      aria-label={`${label} 지표 숨김/보임`}
      data-admin-dashboard-series-toggle="true"
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
            title={
              isLastVisible
                ? "최소 1개 지표는 표시해야 합니다."
                : `${option.label} ${isVisible ? "숨기기" : "보이기"}`
            }
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
}: {
  rows: Row[];
  columns: Array<AdminDashboardTableColumn<Row>>;
  getRowKey: (row: Row, index: number) => string;
  emptyText: string;
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

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-border/70 bg-background"
      data-admin-dashboard-table-view="true"
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
  variant?: "chart" | "table" | "ops";
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
    <div className="mb-2 grid shrink-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-xs font-extrabold leading-none text-foreground">
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
        {action}
      </div>
      <div className="h-px bg-border/70" aria-hidden="true" />
    </div>
  );
}

function AdminDashboardKpiCard({
  title,
  value,
  caption,
  progress,
  delta,
  dataScopeLabel,
  deltaLabel = "기간 대비",
  className,
  style,
  reorderProps,
  tone = "teal",
  sparklineData = [],
  infoLines = [],
  isLoading = false,
}: {
  title: string;
  value: string;
  caption?: string;
  progress: number;
  delta?: string;
  dataScopeLabel?: string;
  deltaLabel?: string;
  className?: string;
  style?: CSSProperties;
  reorderProps?: AdminDashboardCardReorderProps;
  tone?: "teal" | "blue" | "amber" | "rose" | "neutral";
  sparklineData?: AdminDashboardSparklinePoint[];
  infoLines?: string[];
  isLoading?: boolean;
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
        "grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-visible p-3.5",
        className,
      )}
      data-admin-dashboard-kpi-card="recharts-sparkline"
      style={style}
      {...reorderProps}
    >
      <div className="grid gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-xs font-extrabold tracking-[0.04em] text-muted-foreground">
              {title}
            </p>
            {dataScopeLabel ? (
              <span
                className="shrink-0 rounded-full bg-muted/55 px-1.5 py-0.5 text-[10px] font-black leading-none text-muted-foreground"
                data-admin-dashboard-kpi-data-scope="true"
              >
                {dataScopeLabel}
              </span>
            ) : null}
            {infoLines.length > 0 ? (
              <AdminDashboardInfoTooltip
                label={`${title} 지표 설명`}
                lines={infoLines}
              />
            ) : null}
          </div>
          {isLoading ? (
            <Skeleton
              className="h-5 w-20 shrink-0 rounded-full motion-reduce:animate-none"
              data-admin-dashboard-dynamic-skeleton="delta"
              aria-hidden="true"
            />
          ) : delta !== undefined ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/45 px-2 py-0.5 text-[11px] font-black leading-none tabular-nums dark:bg-muted/35",
                toneClass.text,
              )}
              data-admin-dashboard-kpi-delta="timeframe"
              title={`${title} ${deltaLabel}: ${delta}`}
            >
              <span className="font-extrabold text-muted-foreground">
                {deltaLabel}
              </span>
              {delta}
            </span>
          ) : null}
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
                    formatter={(tooltipValue) => [
                      formatRechartsTooltipValue(tooltipValue),
                      title,
                    ]}
                    labelFormatter={(label) => String(label ?? "기간")}
                    contentStyle={adminDashboardTooltipStyle}
                    wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
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
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div
            className={cn("h-full rounded-full", toneClass.bar)}
            style={{ width: `${safeProgress}%` }}
          />
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
      style={style}
      {...reorderProps}
    >
      <AdminDashboardCardTitle
        title="운영·검수 요약"
        metric={`검수 리스크 ${formatNumber(riskTotal)}`}
        infoLines={[
          "X축 막대는 같은 섹션 안에서 가장 큰 항목 대비 상대 비중입니다.",
          "운영 자산은 영상/맛집/좌표/연결 현황, 검수 리스크는 대기/누락/비활성 항목입니다.",
        ]}
        action={
          onViewChange ? (
            <AdminDashboardViewToggle
              value={view}
              onChange={onViewChange}
              label="운영·검수 요약"
            />
          ) : null
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
}: {
  points: AdminDashboardTrendPoint[];
  seriesVisibility: AdminDashboardSeriesVisibility<AdminDashboardTrendSeriesKey>;
}) {
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
      aria-label="채널 유동성 분석: 조회수, 참여, 참여율 정규화 추이"
      data-admin-dashboard-line-chart="recharts"
    >
      <p className="sr-only">
        조회수, 참여, 참여율을 최근 영상 순서로 정규화해 비교합니다. 사용자가 각
        지표를 숨김/보임 처리할 수 있습니다.
      </p>
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
            formatter={(value) => [
              `${formatRechartsTooltipValue(value)}점`,
              "",
            ]}
            contentStyle={adminDashboardTooltipStyle}
            cursor={{ stroke: adminDashboardGridColor }}
          />
          {seriesVisibility.views ? (
            <Line
              type="monotone"
              dataKey="조회수"
              stroke="#5aa6d8"
              strokeWidth={2.4}
              dot={{ r: 2.4 }}
              activeDot={{ r: 4 }}
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
              dot={{ r: 2.4 }}
              activeDot={{ r: 4 }}
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
              dot={{ r: 2.6 }}
              activeDot={{ r: 4.2 }}
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
  );
}

function AdminDashboardBubbleChart({
  videos,
  metricMode = "current",
}: {
  videos: InsightTreemapVideoRow[];
  metricMode?: "current" | "delta";
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
    .slice(0, ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT);
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
        "min-h-[230px] flex-1",
      )}
      role="img"
      aria-label={`성과 분산 분석: 조회수와 참여 규모 상위 ${ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT}개 버블 차트`}
      data-admin-dashboard-bubble-chart="recharts"
    >
      <p className="sr-only">
        상위 영상 영향도 첫 항목은 {topVideo.title}이며 조회수는{" "}
        {formatNumber(chartData[0]?.조회수 ?? 0)}, 참여는{" "}
        {formatNumber(chartData[0]?.참여 ?? 0)}입니다. 동그라미 색상은 성과
        차이가 아니라 순위 구분용이며 위치와 크기가 의미값입니다.
      </p>
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
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                | (typeof chartData)[number]
                | undefined;

              if (!active || !row) return null;

              return (
                <div
                  className="max-w-[280px] rounded-xl border border-border bg-background px-3 py-2 text-xs shadow-lg"
                  data-admin-dashboard-bubble-tooltip="video-title"
                >
                  <p className="line-clamp-2 font-extrabold leading-5 text-foreground">
                    {row.title}
                  </p>
                  <div className="mt-2 grid gap-1 text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>조회수</span>
                      <span className="font-bold tabular-nums text-foreground">
                        {formatNumber(row.조회수)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>참여</span>
                      <span className="font-bold tabular-nums text-foreground">
                        {formatNumber(row.참여)}
                      </span>
                    </div>
                  </div>
                </div>
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
  );
}

function AdminDashboardGroupedBarChart({
  rows,
  seriesVisibility,
}: {
  rows: AdminDashboardBarRow[];
  seriesVisibility: AdminDashboardSeriesVisibility<AdminDashboardTopContentSeriesKey>;
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
      accentClass: "text-sky-700 dark:text-sky-300",
    },
    {
      seriesKey: "likes",
      key: "likeCount",
      label: "좋아요",
      accentClass: "text-rose-700 dark:text-rose-300",
    },
    {
      seriesKey: "comments",
      key: "commentCount",
      label: "댓글",
      accentClass: "text-amber-700 dark:text-amber-300",
    },
  ] as const satisfies ReadonlyArray<{
    seriesKey: AdminDashboardTopContentSeriesKey;
    key: keyof Pick<
      AdminDashboardBarRow,
      "viewCount" | "likeCount" | "commentCount"
    >;
    label: string;
    accentClass: string;
  }>;
  const visibleMetricRows = metricRows.filter(
    (metric) => seriesVisibility[metric.seriesKey],
  );

  return (
    <div
      className={cn(
        adminDashboardVisualizationShellClassName,
        "grid content-start gap-2",
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
      <div className="grid gap-2">
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
              className="grid gap-1.5"
              data-admin-dashboard-top-content-metric={metric.label}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-[11px] font-black text-muted-foreground",
                    metric.accentClass,
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
                className="flex h-8 min-w-0 overflow-x-auto overflow-y-visible rounded-xl bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-hidden="true"
              >
                {visibleRows.map((row, index) => {
                  const value = row[metric.key];
                  const percent = total > 0 ? (value / total) * 100 : 0;

                  return (
                    <span
                      key={`${metric.key}-${row.label}`}
                      className={cn(
                        "flex min-w-[8%] items-center justify-center px-0.5 text-[10px] font-black leading-none tabular-nums",
                        rankColors[index]?.barClass ??
                          "bg-muted-foreground text-background",
                      )}
                      style={{ width: `${Math.max(8, percent)}%` }}
                      title={`${row.label} · ${metric.label} ${formatNumber(value)} (${formatDashboardPercent(percent)}) · ${formatDashboardAverageComparison(value, average)}`}
                    >
                      {percent.toFixed(0)}%
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ol className="grid gap-1.5 sm:grid-cols-5">
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
            <p
              className={cn(
                "mt-0.5 truncate text-[10px] font-black tabular-nums",
                getDashboardAverageDeltaPercent(
                  row.viewCount,
                  row.viewAverage,
                ) == null
                  ? "text-muted-foreground"
                  : (getDashboardAverageDeltaPercent(
                        row.viewCount,
                        row.viewAverage,
                      ) ?? 0) >= 0
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-rose-700 dark:text-rose-300",
              )}
              title={`${row.viewBenchmarkLabel} 전체 평균 ${formatNumber(Math.round(row.viewAverage))}`}
            >
              {row.viewBenchmarkLabel}{" "}
              {formatDashboardAverageComparison(row.viewCount, row.viewAverage)}
            </p>
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
      {insights.map((insight) => (
        <div
          key={`${insight.label}-${insight.title}`}
          className={cn(
            "min-w-0 rounded-xl border px-2.5 py-2",
            toneClass[insight.tone],
          )}
          title={`${insight.label}: ${insight.title} · ${insight.description}`}
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
      ))}
    </div>
  );
}

function AdminDashboardDiagnosisBoard({
  insights,
  metricMode,
  periodLabel,
}: {
  insights: AdminDashboardContentInsight[];
  metricMode: "current" | "delta";
  periodLabel: string;
}) {
  const modeLabel =
    metricMode === "delta" ? "기간 순증 평균 대비" : "기간 영상 현재 평균 대비";
  const signalBarClass = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  } satisfies Record<AdminDashboardContentInsight["tone"], string>;

  if (insights.length === 0) {
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
      className="grid min-h-0 flex-1 auto-rows-fr content-stretch gap-1"
      role="img"
      aria-label="평균 대비 영상 성과 진단"
      data-admin-dashboard-diagnosis-board="actionable-insights"
    >
      <p className="sr-only">
        {periodLabel} 기준으로 조회 성장, 참여율, 초반 반응, 롱테일 후보를 채널
        평균과 비교해 우선 점검할 영상을 표시합니다.
      </p>
      <div className="grid h-full min-h-0 auto-rows-fr gap-1 sm:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.label}-${insight.title}`}
            className="flex min-h-0 min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5"
            title={`${insight.label}: ${insight.title} · ${insight.description}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-black text-primary">
                {insight.label}
              </span>
              <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                {modeLabel}
              </span>
            </div>
            <p className="mt-1.5 truncate text-sm font-extrabold text-foreground">
              {insight.title}
            </p>
            <p className="mt-1 truncate text-[11px] font-semibold text-muted-foreground">
              {insight.description}
            </p>
            <div
              className="mt-1.5 grid gap-1"
              data-admin-dashboard-diagnosis-visual="signal-bar"
            >
              <div className="h-1.5 overflow-hidden rounded-full bg-background/80">
                <div
                  className={cn("h-full rounded-full", signalBarClass[insight.tone])}
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
        ))}
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
            formatter={(value) => [`${Number(value).toFixed(2)}%`, "참여율"]}
            contentStyle={adminDashboardTooltipStyle}
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
  const snapshot = logs?.snapshot;
  const isWorkflowHealthy = latestRun
    ? latestRun.status !== "completed" || latestRun.conclusion === "success"
    : logs?.workflow.available;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-7 w-7 rounded-full p-0 text-muted-foreground hover:text-foreground",
            isError && "border-destructive/30 text-destructive",
          )}
          aria-label="GitHub Actions KPI 데이터 수집 로그 열기"
          title="데이터 수집 로그"
          data-admin-dashboard-kpi-collection-log-trigger="true"
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">데이터 수집 로그</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(92vw,28rem)] overflow-hidden rounded-2xl border-border/80 p-0 shadow-xl"
        data-admin-dashboard-kpi-collection-log-panel="true"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-background px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-foreground">
              데이터 수집 로그
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">
              {logs?.workflow.repository ?? "twoimo/tzudong"} ·{" "}
              {logs?.workflow.workflowId ?? "youtube-kpi-snapshot.yml"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 rounded-full px-2 text-[11px]"
            disabled={isFetching}
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")}
              aria-hidden="true"
            />
            새로고침
          </Button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
          ) : null}

          {!isLoading ? (
            <>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-extrabold text-foreground">
                    최신 스냅샷
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px]",
                      snapshot?.available
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300",
                    )}
                  >
                    {snapshot?.available ? "저장됨" : "대기"}
                  </Badge>
                </div>
                {snapshot?.available ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-6">
                    <div>
                      <span className="block text-muted-foreground">
                        수집 시각
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatDashboardDateTime(snapshot.fetchedAt)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">
                        영상 스냅샷
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatNumber(snapshot.videoSnapshotCount)}개
                      </span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">
                        구독자
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatNumber(snapshot.subscriberCount)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">
                        조회수
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatCompactNumber(snapshot.viewCount)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">
                        구독자 증감
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatSignedNumber(snapshot.subscriberDelta)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">
                        조회 증감
                      </span>
                      <span className="mt-0.5 block font-bold text-foreground">
                        {formatSignedNumber(snapshot.viewDelta)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    아직 저장된 KPI 스냅샷이 없거나 마이그레이션 적용 전입니다.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-extrabold text-foreground">
                    GitHub Actions 실행
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px]",
                      isWorkflowHealthy
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-destructive/20 bg-destructive/10 text-destructive",
                    )}
                  >
                    {latestRun
                      ? getCollectionLogStatusLabel(
                          latestRun.status,
                          latestRun.conclusion,
                        )
                      : logs?.workflow.available
                        ? "실행 없음"
                        : "확인 필요"}
                  </Badge>
                </div>

                {!logs?.workflow.available ? (
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    GitHub Actions 로그를 불러오지 못했습니다. 서버 환경의
                    저장소/토큰 설정을 확인하세요
                    {logs?.workflow.error ? ` (${logs.workflow.error})` : ""}.
                  </p>
                ) : null}

                {logs?.workflow.runs.length ? (
                  <div className="mt-2 space-y-2">
                    {logs.workflow.runs.map((run) => (
                      <div
                        key={run.id ?? `${run.runNumber}-${run.createdAt}`}
                        className="rounded-xl border border-border/70 px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-foreground">
                              #{run.runNumber ?? "—"} {run.title}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {formatDashboardDateTime(
                                run.startedAt ?? run.createdAt,
                              )}{" "}
                              · {run.event ?? "schedule"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px]",
                                getCollectionLogStatusClassName(
                                  run.status,
                                  run.conclusion,
                                ),
                              )}
                            >
                              {run.status !== "completed" ? (
                                <Activity
                                  className="mr-1 h-3 w-3"
                                  aria-hidden="true"
                                />
                              ) : run.conclusion === "success" ? (
                                <CheckCircle2
                                  className="mr-1 h-3 w-3"
                                  aria-hidden="true"
                                />
                              ) : (
                                <XCircle
                                  className="mr-1 h-3 w-3"
                                  aria-hidden="true"
                                />
                              )}
                              {getCollectionLogStatusLabel(
                                run.status,
                                run.conclusion,
                              )}
                            </Badge>
                            {run.htmlUrl ? (
                              <a
                                href={run.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      </div>
                    ))}
                  </div>
                ) : logs?.workflow.available ? (
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    아직 실행 기록이 없습니다.
                  </p>
                ) : null}
              </div>

              {logs?.workflow.latestJobs.length ? (
                <div className="rounded-2xl border border-border/70 bg-background p-3">
                  <p className="text-xs font-extrabold text-foreground">
                    최신 실행 Job
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {logs.workflow.latestJobs.map((job) => (
                      <div
                        key={job.id ?? job.name}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="min-w-0 truncate font-semibold text-foreground">
                          {job.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 font-bold",
                            getCollectionLogStatusClassName(
                              job.status,
                              job.conclusion,
                            ),
                          )}
                        >
                          {getCollectionLogStatusLabel(
                            job.status,
                            job.conclusion,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="text-[10px] leading-4 text-muted-foreground">
                GitHub 실행 로그는 Actions REST API의 workflow runs/jobs를 읽고,
                저장 성공 여부는 Supabase 최신 스냅샷으로 교차 확인합니다.
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
  const orderedDashboardWidgetIds = useMemo(
    () => normalizeAdminDashboardWidgetOrder(dashboardWidgetOrder),
    [dashboardWidgetOrder],
  );
  const insightQuery = useQuery({
    queryKey: ["admin-dashboard-management", "insights", "cohort", period],
    queryFn: () => fetchAdminDashboardInsightSummary(period, "cohort"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
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
  });
  const youtubeChannelQuery = useQuery({
    queryKey: ["admin-dashboard-management", "youtube-channel", period],
    queryFn: () => fetchAdminYouTubeChannelStats(period),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
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
        setDashboardWidgetOrder(
          normalizeAdminDashboardWidgetOrder(payload.order),
        );
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
  const moveDraggedDashboardWidget = useCallback(
    (
      targetWidgetId: AdminDashboardWidgetId,
      sourceWidgetId = draggedDashboardWidgetId,
    ) => {
      if (!sourceWidgetId || sourceWidgetId === targetWidgetId) {
        setDraggedDashboardWidgetId(null);
        return;
      }

      if (
        getAdminDashboardWidgetLayoutGroup(sourceWidgetId) !==
        getAdminDashboardWidgetLayoutGroup(targetWidgetId)
      ) {
        setDashboardOrderMessage(
          "같은 레이아웃 영역 안에서만 순서를 바꿀 수 있습니다. KPI 보드 형태는 유지했습니다.",
        );
        setDraggedDashboardWidgetId(null);
        return;
      }

      const currentOrder =
        normalizeAdminDashboardWidgetOrder(dashboardWidgetOrder);
      const nextOrder = currentOrder.filter(
        (widgetId) => widgetId !== sourceWidgetId,
      );
      const targetIndex = nextOrder.indexOf(targetWidgetId);
      nextOrder.splice(
        targetIndex < 0 ? nextOrder.length : targetIndex,
        0,
        sourceWidgetId,
      );

      void persistDashboardWidgetOrder(
        nextOrder,
        `${ADMIN_DASHBOARD_WIDGET_LABELS[sourceWidgetId]} 카드 순서를 같은 영역 안에서 자동 저장했습니다.`,
      );
      setDraggedDashboardWidgetId(null);
    },
    [
      dashboardWidgetOrder,
      draggedDashboardWidgetId,
      persistDashboardWidgetOrder,
    ],
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
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", widgetId);
        setDraggedDashboardWidgetId(widgetId);
      },
      onDragOver: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event) => {
        if (!isDashboardOrderEditorOpen || isDashboardOrderSaving) return;
        event.preventDefault();
        const rawWidgetId = event.dataTransfer.getData("text/plain");
        const sourceWidgetId = adminDashboardWidgetIdSet.has(
          rawWidgetId as AdminDashboardWidgetId,
        )
          ? (rawWidgetId as AdminDashboardWidgetId)
          : draggedDashboardWidgetId;
        moveDraggedDashboardWidget(widgetId, sourceWidgetId);
      },
      onDragEnd: () => setDraggedDashboardWidgetId(null),
    }),
    [
      draggedDashboardWidgetId,
      isDashboardOrderEditorOpen,
      isDashboardOrderSaving,
      moveDraggedDashboardWidget,
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

    return [...growthVideos].sort(
      (a, b) =>
        getNonNegativeMetricDelta(getVideoViewDelta(b)) -
        getNonNegativeMetricDelta(getVideoViewDelta(a)),
    );
  }, [growthVideos, hasPeriodGrowthComparison, videosByViews]);
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
  const engagementChange = calculateDashboardPeriodMetricChange(
    growthVideos,
    period,
    getVideoEngagementTotal,
    getPreviousVideoEngagementTotal,
  );
  const videoCountChange = calculateDashboardMetricChange(videos, () => 1);
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
  const barRows = useMemo(
    () =>
      buildAdminDashboardBarRows(videosByInsightScore, topContentMetricMode),
    [topContentMetricMode, videosByInsightScore],
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
  const selectedPeriodLabel =
    ADMIN_DASHBOARD_PERIOD_OPTIONS.find((option) => option.value === period)
      ?.label ?? "선택 기간";
  const periodMetricScopeLabel = hasPeriodGrowthComparison
    ? "기간 순증"
    : "기간 영상 현재";
  const periodMetricCaption = hasPeriodGrowthComparison
    ? `${selectedPeriodLabel} · 기간 순증`
    : `${selectedPeriodLabel} · 기간 영상 현재`;
  const periodRatioCaptionPrefix = hasPeriodGrowthComparison
    ? "조회 증가 대비"
    : "조회수 대비";
  const periodVideoCaption = `${selectedPeriodLabel} 신규 업로드`;
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
  const subscriberDelta =
    period !== "ALL" &&
    typeof channelStats?.subscriberCount === "number" &&
    typeof channelStats.previousSubscriberCount === "number"
      ? channelStats.subscriberCount - channelStats.previousSubscriberCount
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
    : subscriberDelta == null
      ? formatNumber(channelStats?.subscriberCount)
      : formatSignedNumber(subscriberDelta);
  const subscriberScopeLabel =
    subscriberDelta == null ? "현재 누적" : "기간 순증";
  const subscriberCaption = isSubscriberLoading
    ? "채널 통계 불러오는 중"
    : !hasSubscriberCount
      ? "채널 통계 확인 필요"
      : subscriberDelta == null
        ? "현재 구독자 · YouTube Data API · 비교 스냅샷 대기"
        : `${selectedPeriodLabel} · 기간 순증 · 현재 누적 ${formatNumber(channelStats?.subscriberCount)}`;
  const subscriberCardTitle =
    subscriberDelta == null ? "현재 구독자" : "기간 구독자 증가";
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
      videosByInsightScore
        .slice(0, ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT)
        .map((video) => ({
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
      trendPoints.map((point) => ({
        label: point.label,
        views: point.secondaryValue,
        engagement: point.value,
        engagementRate: getDashboardRatio(point.value, point.secondaryValue),
      })),
    [trendPoints],
  );
  const topContentTableRows = useMemo(
    () =>
      barRows.slice(0, 5).map((row) => ({
        title: row.label,
        views: row.viewCount,
        likes: row.likeCount,
        comments: row.commentCount,
        viewBenchmarkLabel: row.viewBenchmarkLabel,
        viewBenchmark: formatDashboardAverageComparison(
          row.viewCount,
          row.viewAverage,
        ),
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
        cell: (row) => formatNumber(row.views),
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
        cell: (row) => formatNumber(row.views),
      });
    }

    if (topContentSeriesVisibility.likes) {
      columns.push({
        key: "likes",
        header: "좋아요",
        align: "right",
        className: "w-[12%]",
        cell: (row) => formatNumber(row.likes),
      });
    }

    if (topContentSeriesVisibility.comments) {
      columns.push({
        key: "comments",
        header: "댓글",
        align: "right",
        className: "w-[12%]",
        cell: (row) => formatNumber(row.comments),
      });
    }

    columns.push({
      key: "benchmark",
      header: "평균 대비",
      className: "w-[30%]",
      cell: (row) => (
        <span
          className="block truncate font-extrabold"
          title={`${row.viewBenchmarkLabel} ${row.viewBenchmark} · 좋아요 ${row.likeBenchmark} · 댓글 ${row.commentBenchmark}`}
        >
          {row.viewBenchmarkLabel} {row.viewBenchmark}
        </span>
      ),
    });

    return columns;
  }, [topContentSeriesVisibility]);
  const topContentInsights = useMemo(
    () =>
      buildAdminDashboardContentInsights(
        videosByInsightScore,
        topContentMetricMode,
        insightQuery.data?.asOf,
        subscriberDelta,
      ),
    [
      insightQuery.data?.asOf,
      subscriberDelta,
      topContentMetricMode,
      videosByInsightScore,
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
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-0 font-sans text-foreground lg:overflow-hidden"
      aria-label="관리자 대시보드 (KPI)"
      data-admin-dashboard-management="true"
      data-admin-dashboard-realtime-charts="true"
      data-admin-dashboard-channel-kpi="true"
    >
      <div className="mb-2 flex shrink-0 flex-col gap-0 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-[0.01em] text-foreground text-balance">
            Tzuyang KPI Dashboard
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-start justify-end gap-1">
          <AdminDashboardCollectionLogPopover
            open={isCollectionLogsOpen}
            logs={collectionLogsQuery.data}
            isLoading={collectionLogsQuery.isLoading}
            isFetching={collectionLogsQuery.isFetching}
            isError={collectionLogsQuery.isError}
            onOpenChange={setIsCollectionLogsOpen}
            onRefresh={() => void collectionLogsQuery.refetch()}
          />
          <Button
            type="button"
            variant={isDashboardOrderEditorOpen ? "default" : "outline"}
            size="sm"
            className="h-7 rounded-full px-2 text-[11px]"
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
          {isDashboardOrderEditorOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
              disabled={isDashboardOrderLoading || isDashboardOrderSaving}
              data-admin-dashboard-widget-order-reset="true"
              onClick={() =>
                void persistDashboardWidgetOrder(
                  DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
                  "처음 카드 순서로 되돌렸습니다.",
                )
              }
            >
              초기화
            </Button>
          ) : null}

          <div
            className="flex flex-wrap justify-end gap-1"
            aria-label="대시보드 타임프레임"
          >
            {ADMIN_DASHBOARD_PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={period === option.value ? "default" : "outline"}
                size="sm"
                className="h-7 rounded-full px-2 text-[11px]"
                aria-pressed={period === option.value}
                onClick={() => {
                  if (option.value !== period) {
                    setPendingSkeletonPeriod(option.value);
                    setPeriod(option.value);
                  }
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
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

      <div
        className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-visible sm:grid-cols-2 lg:grid-cols-10 lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]"
        data-admin-dashboard-order-mode={
          isDashboardOrderEditorOpen ? "direct-drag" : "off"
        }
      >
        <AdminDashboardKpiCard
          title={subscriberCardTitle}
          dataScopeLabel={subscriberScopeLabel}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("subscribers"),
          )}
          style={{ order: getDashboardWidgetOrder("subscribers") }}
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
            "선택 기간 동안 늘어난 YouTube 채널 statistics.subscriberCount 순증입니다.",
            "비교 스냅샷이 없으면 주값은 현재 누적 구독자 수로 표시하고 현재 누적 배지를 붙입니다.",
            "기간 순증과 현재 누적은 카드 제목 옆 배지와 보조 문구로 구분합니다.",
          ]}
        />
        <AdminDashboardKpiCard
          title={viewCardTitle}
          dataScopeLabel={periodMetricScopeLabel}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("views"),
          )}
          style={{ order: getDashboardWidgetOrder("views") }}
          reorderProps={getDashboardCardReorderProps("views")}
          value={isChartLoading ? "—" : formatNumber(periodViewDisplayValue)}
          caption={`${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeViewValue)}`}
          delta={formatDashboardChangeLabel(viewChange)}
          progress={getDashboardChangeProgress(viewChange)}
          tone="blue"
          sparklineData={viewSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "선택 기간 동안 채널 전체 영상에서 늘어난 viewCount 순증입니다.",
            "비교 스냅샷이 없으면 선택 기간 업로드 영상들의 현재 조회수 합계로 표시합니다.",
            "미니 차트 X축은 영상 게시일 순서, Y축은 배지에 표시된 데이터 범위 기준 값입니다.",
          ]}
        />
        <AdminDashboardKpiCard
          title={likeCardTitle}
          dataScopeLabel={periodMetricScopeLabel}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("likes"),
          )}
          style={{ order: getDashboardWidgetOrder("likes") }}
          reorderProps={getDashboardCardReorderProps("likes")}
          value={isChartLoading ? "—" : formatNumber(periodLikeDisplayValue)}
          caption={
            likeRate == null
              ? `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`
              : `${periodRatioCaptionPrefix} ${formatDashboardPercent(likeRate)} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`
          }
          delta={formatDashboardChangeLabel(likeChange)}
          progress={getDashboardChangeProgress(likeChange)}
          tone="rose"
          sparklineData={likeSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "선택 기간 동안 채널 전체 영상에서 늘어난 likeCount 순증입니다.",
            "비교 스냅샷이 없으면 선택 기간 업로드 영상들의 현재 좋아요 합계로 표시합니다.",
            "미니 차트 X축은 영상 게시일 순서, Y축은 배지에 표시된 데이터 범위 기준 값입니다.",
          ]}
        />
        <AdminDashboardKpiCard
          title={commentCardTitle}
          dataScopeLabel={periodMetricScopeLabel}
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("comments"),
          )}
          style={{ order: getDashboardWidgetOrder("comments") }}
          reorderProps={getDashboardCardReorderProps("comments")}
          value={isChartLoading ? "—" : formatNumber(periodCommentDisplayValue)}
          caption={
            commentRate == null
              ? `${periodMetricCaption} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`
              : `${periodRatioCaptionPrefix} ${formatDashboardPercent(commentRate)} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`
          }
          delta={formatDashboardChangeLabel(commentChange)}
          progress={getDashboardChangeProgress(commentChange)}
          tone="amber"
          sparklineData={commentSparklineDisplayPoints}
          isLoading={isChartLoading}
          infoLines={[
            "선택 기간 동안 채널 전체 영상에서 늘어난 commentCount 순증입니다.",
            "비교 스냅샷이 없으면 선택 기간 업로드 영상들의 현재 댓글 합계로 표시합니다.",
            "미니 차트 X축은 영상 게시일 순서, Y축은 배지에 표시된 데이터 범위 기준 값입니다.",
          ]}
        />
        <AdminDashboardKpiCard
          title="업로드 영상 수"
          dataScopeLabel="기간 업로드"
          className={cn(
            "lg:col-span-2",
            getDashboardReorderCardClassName("videos"),
          )}
          style={{ order: getDashboardWidgetOrder("videos") }}
          reorderProps={getDashboardCardReorderProps("videos")}
          value={isChartLoading ? "—" : formatNumber(visibleVideoTotal)}
          caption={`${periodVideoCaption} · 현재 ${formatNumber(cumulativeVideoTotal)}`}
          delta={formatDashboardChangeLabel(videoCountChange)}
          progress={getDashboardChangeProgress(videoCountChange)}
          tone="teal"
          sparklineData={videoCountSparklinePoints}
          isLoading={isChartLoading}
          infoLines={[
            "선택 타임프레임에 새로 업로드된 영상 개수입니다.",
            "미니 차트 X축은 최근 영상 게시일 순서, Y축은 누적 영상 순번입니다.",
            "우측 증감은 선택 기간의 최신 절반과 이전 절반 영상 수를 비교합니다.",
          ]}
        />

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-visible p-3 sm:col-span-2 lg:col-span-3",
            getDashboardReorderCardClassName("impact"),
          )}
          style={{ order: getDashboardWidgetOrder("impact") }}
          {...getDashboardCardReorderProps("impact")}
        >
          <AdminDashboardCardTitle
            title="상위 영상 영향도"
            metric={`조회 증감 ${formatDashboardChangeLabel(viewChange)}`}
            infoLines={[
              hasPeriodGrowthComparison
                ? "X축은 선택 기간 조회수 증가, Y축은 참여 증가입니다."
                : "X축은 영상별 조회수, Y축은 참여 수입니다.",
              "참여는 좋아요 수 + 댓글 수이며, 원 크기도 참여 규모를 의미합니다.",
              "동그라미 색상은 성과 차이가 아니라 순위 구분용입니다.",
            ]}
            action={
              <div className="flex flex-wrap items-center justify-end gap-1">
                <AdminDashboardImpactRankLegend />
                <AdminDashboardViewToggle
                  value={getDashboardCardView("impact")}
                  onChange={(view) => setDashboardCardView("impact", view)}
                  label="상위 영상 영향도"
                />
              </div>
            }
          />
          {isChartLoading ? (
            <AdminDashboardPanelBodySkeleton
              variant={
                getDashboardCardView("impact") === "table" ? "table" : "chart"
              }
            />
          ) : getDashboardCardView("impact") === "table" ? (
            <AdminDashboardScrollTable
              rows={impactTableRows}
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
                  cell: (row) => formatNumber(row.views),
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
            />
          )}
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[280px] flex-col overflow-visible p-3 sm:col-span-2 lg:col-span-4",
            getDashboardReorderCardClassName("trend"),
          )}
          style={{ order: getDashboardWidgetOrder("trend") }}
          {...getDashboardCardReorderProps("trend")}
        >
          <AdminDashboardCardTitle
            title="조회·참여 추이"
            metric={`조회 증감 ${formatDashboardChangeLabel(viewChange)}`}
            infoLines={[
              "X축은 최근 영상 게시일 순서입니다.",
              "Y축은 조회수, 참여, 참여율을 각각 0~100점으로 정규화한 상대 점수입니다.",
              "참여는 좋아요+댓글, 참여율은 (좋아요+댓글)/조회수*100입니다.",
            ]}
            action={
              <div className="flex flex-wrap items-center justify-end gap-1">
                <AdminDashboardSeriesToggle
                  label="조회·참여 추이"
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
                  label="조회·참여 추이"
                />
              </div>
            }
          />
          {isChartLoading ? (
            <AdminDashboardPanelBodySkeleton
              variant={
                getDashboardCardView("trend") === "table" ? "table" : "chart"
              }
            />
          ) : getDashboardCardView("trend") === "table" ? (
            <AdminDashboardScrollTable
              rows={trendTableRows}
              emptyText="표시할 조회·참여 추이 데이터가 없습니다."
              getRowKey={(row, index) => `${row.label}-${index}`}
              columns={trendTableColumns}
            />
          ) : (
            <AdminDashboardMultiLineChart
              key={`trend-${period}`}
              points={trendPoints}
              seriesVisibility={trendSeriesVisibility}
            />
          )}
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
          style={{ order: getDashboardWidgetOrder("ops") }}
          view={getDashboardCardView("ops")}
          onViewChange={(view) => setDashboardCardView("ops", view)}
          isLoading={isLoading}
        />

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[220px] flex-col overflow-visible p-3 sm:col-span-2 lg:col-span-5",
            getDashboardReorderCardClassName("topContent"),
          )}
          style={{ order: getDashboardWidgetOrder("topContent") }}
          {...getDashboardCardReorderProps("topContent")}
        >
          <AdminDashboardCardTitle
            title="콘텐츠 성과 TOP 5"
            metric={`조회 증감 ${formatDashboardChangeLabel(viewChange)}`}
            infoLines={[
              hasPeriodGrowthComparison
                ? "X축은 선택 기간 조회수 증가 상위 영상 5개의 유튜브 제목이며, 긴 제목은 말줄임 처리합니다."
                : "X축은 조회수 상위 영상 5개의 유튜브 제목이며, 긴 제목은 말줄임 처리합니다.",
              hasPeriodGrowthComparison
                ? "Y축은 조회수·좋아요·댓글 증가량이며, 최근 성장 기여도가 높은 순서로 정렬합니다."
                : "Y축은 조회수·좋아요·댓글 수이며, 조회수가 높은 순서로 정렬합니다.",
              "각 영상은 선택 기간 전체 영상 평균 대비 이상/이하를 함께 표시합니다.",
            ]}
            action={
              <div className="flex flex-wrap items-center justify-end gap-1">
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
                      dotClassName: "bg-amber-500",
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
          {isChartLoading ? (
            <AdminDashboardPanelBodySkeleton
              variant={
                getDashboardCardView("topContent") === "table"
                  ? "table"
                  : "chart"
              }
            />
          ) : getDashboardCardView("topContent") === "table" ? (
            <AdminDashboardScrollTable
              rows={topContentTableRows}
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
        </div>

        <div
          className={cn(
            adminDashboardCardClass,
            "flex min-h-[220px] flex-col overflow-visible p-2 sm:col-span-2 lg:col-span-5",
            getDashboardReorderCardClassName("engagementRate"),
          )}
          style={{ order: getDashboardWidgetOrder("engagementRate") }}
          {...getDashboardCardReorderProps("engagementRate")}
        >
          <AdminDashboardCardTitle
            title="성과 진단"
            metric={`진단 신호 ${formatNumber(topContentInsights.length)}개 · 참여 ${formatDashboardChangeLabel(engagementChange)}`}
            infoLines={[
              "선택 기간의 조회 증가, 참여율, 일평균 조회 속도를 채널 평균과 비교해 실행 가능한 신호만 추립니다.",
              "평균 대비는 선택 기간 영상 또는 기간 순증 데이터의 평균을 기준으로 산정합니다.",
              "초반 반응 점검은 업로드 14일 이내 영상의 일평균 조회 속도가 평균보다 낮은 경우 우선 노출합니다.",
            ]}
            action={
              <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
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
          {isChartLoading ? (
            <AdminDashboardPanelBodySkeleton
              variant={
                getDashboardCardView("engagementRate") === "table"
                  ? "table"
                  : "chart"
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
  onToggleCollapsed,
  canLoadPreferences,
  stats,
}: {
  activeModuleId: AdminModuleId;
  onSelectModule: (moduleId: AdminModuleId) => void;
  isCollapsed: boolean;
  showLabels: boolean;
  onToggleCollapsed: () => void;
  canLoadPreferences: boolean;
  stats: AdminOverviewStats;
}) {
  const [sidebarOrder, setSidebarOrder] = useState<AdminSidebarOrderPreference>(
    DEFAULT_ADMIN_SIDEBAR_ORDER,
  );
  const [isOrderEditorOpen, setIsOrderEditorOpen] = useState(false);
  const [isOrderLoading, setIsOrderLoading] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [sidebarOrderMessage, setSidebarOrderMessage] = useState(
    "사이드바 순서는 관리자 계정별로 저장됩니다.",
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

  const toggleThemePreference = () => {
    setThemePreference((currentTheme) => {
      const nextTheme = getNextAdminThemePreference(currentTheme);
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
      applyAdminThemePreference(nextTheme);
      return nextTheme;
    });
  };

  const themeToggleLabel =
    themePreference === "light"
      ? "다크모드로 전환"
      : themePreference === "dark"
        ? "시스템 모드로 전환"
        : "라이트모드로 전환";
  const themeToggleText =
    themePreference === "light"
      ? "다크"
      : themePreference === "dark"
        ? "시스템"
        : "라이트";
  const isDarkThemePreference = themePreference === "dark";

  return (
    <aside
      className={cn(
        "relative z-30 flex max-h-[42dvh] w-full shrink-0 flex-col overflow-x-hidden border-y border-border bg-gradient-to-b from-card via-card to-background/95 p-2 shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none md:h-full md:max-h-none md:min-h-0 md:w-full md:overflow-y-auto md:border-y-0 md:border-r md:p-2",
        isCollapsed && "md:items-center md:px-1.5",
      )}
      aria-label="관리자 콘솔 사이드바"
      data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}
    >
      <div
        className={cn(
          "mb-2 flex min-h-10 items-center gap-2 border-b border-border/70 px-1 pb-2 transition-[border-color] duration-200 motion-reduce:transition-none md:mb-1.5 md:min-h-9 md:pb-1.5",
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
            src="/logo.png"
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
          <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
            현재 화면 · {activeSidebarLabel}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "ml-auto hidden h-8 w-8 rounded-xl border border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background md:inline-flex",
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

      <nav
        id="admin-console-menu"
        aria-label="관리자 통합 메뉴"
        className={cn(
          "flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:block md:min-h-0 md:flex-1 md:space-y-1.5 md:overflow-x-visible md:pb-0",
          isCollapsed && "md:flex md:w-full md:flex-col md:items-center",
        )}
      >
        {orderedSidebarSections.map((section) => (
          <div
            key={section.label}
            className={cn(
              "flex shrink-0 gap-2 md:block md:space-y-1",
              isCollapsed && "md:flex md:w-full md:flex-col md:items-center",
            )}
          >
            <p
              className={cn(
                "sr-only px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none md:not-sr-only",
                (!showLabels || isCollapsed) && "md:h-px md:px-0 md:opacity-0",
              )}
            >
              {section.label}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeModuleId === item.id;
              const itemStatus = getItemStatus(item.id);
              const menuButton = (
                <button
                  type="button"
                  title={item.title}
                  aria-label={
                    itemStatus
                      ? `${item.title} ${itemStatus.label}`
                      : item.title
                  }
                  aria-current={isActive ? "page" : undefined}
                  aria-controls="admin-console-canvas"
                  className={cn(
                    "group relative flex min-h-11 min-w-[8.25rem] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border px-3 py-2 text-left text-sm transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none md:min-h-9 md:min-w-0 md:w-full md:shrink md:rounded-lg md:px-2 md:py-1",
                    isCollapsed &&
                      "md:mx-auto md:h-9 md:min-h-9 md:w-9 md:justify-center md:gap-0 md:px-0",
                    isActive
                      ? "border-primary/20 bg-primary text-primary-foreground shadow-primary"
                      : "border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground",
                  )}
                  onClick={() => onSelectModule(item.id)}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none md:h-6 md:w-6 md:rounded-md",
                      isActive
                        ? "border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
                        : "border-border bg-background/80 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4 md:h-3.5 md:w-3.5" />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
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

              if (isCollapsed) {
                return (
                  <UiTooltipProvider key={item.id} delayDuration={120}>
                    <UiTooltip>
                      <UiTooltipTrigger asChild>{menuButton}</UiTooltipTrigger>
                      <UiTooltipContent
                        side="right"
                        align="center"
                        className="max-w-[14rem] text-xs"
                        data-admin-sidebar-collapsed-tooltip="true"
                      >
                        <p className="font-bold">{item.title}</p>
                        {item.badge ? (
                          <p className="text-muted-foreground">{item.badge}</p>
                        ) : null}
                      </UiTooltipContent>
                    </UiTooltip>
                  </UiTooltipProvider>
                );
              }

              return <Fragment key={item.id}>{menuButton}</Fragment>;
            })}
          </div>
        ))}
      </nav>

      <Popover open={isOrderEditorOpen} onOpenChange={setIsOrderEditorOpen}>
        <div
          className={cn(
            "mt-2 flex shrink-0 gap-1.5 pt-0 md:mt-auto md:pt-2",
            isCollapsed && "md:w-full md:flex-col md:items-center",
          )}
          data-admin-sidebar-footer-actions="true"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "min-h-10 rounded-xl border border-border/80 bg-background/75 px-3 text-xs font-bold text-muted-foreground shadow-sm touch-manipulation hover:border-primary/20 hover:bg-background hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background md:min-h-8 md:px-2",
              isCollapsed
                ? "md:h-9 md:w-9 md:px-0"
                : "w-auto shrink-0 justify-center gap-1.5",
            )}
            aria-label={themeToggleLabel}
            aria-pressed={themePreference !== "light"}
            onClick={toggleThemePreference}
            data-admin-sidebar-theme-toggle="true"
          >
            {isDarkThemePreference ? (
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
            ) : themePreference === "system" ? (
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className={cn("truncate", isCollapsed && "md:sr-only")}>
              {themeToggleText}
            </span>
          </Button>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "min-h-10 rounded-xl border border-border/80 bg-background/75 px-3 text-xs font-bold text-muted-foreground shadow-sm touch-manipulation hover:border-primary/20 hover:bg-background hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background md:min-h-8 md:px-2",
                isCollapsed
                  ? "md:h-9 md:w-9 md:px-0"
                  : "min-w-0 flex-1 justify-start gap-2",
              )}
              aria-label="사이드바 메뉴 순서 설정"
              aria-expanded={isOrderEditorOpen}
              aria-controls="admin-sidebar-order-editor"
              disabled={!canLoadPreferences || isOrderLoading}
              data-admin-sidebar-order-loading={
                isOrderLoading ? "true" : "false"
              }
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className={cn("truncate", isCollapsed && "md:sr-only")}>
                순서
              </span>
              {!isCollapsed && isOrderLoading ? (
                <Skeleton
                  className="ml-auto h-3 w-8 rounded-full motion-reduce:animate-none"
                  data-admin-sidebar-order-loading="true"
                  aria-hidden="true"
                />
              ) : !isCollapsed ? (
                <span className="ml-auto text-[10px] font-semibold text-muted-foreground/80">
                  설정
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </div>

        <PopoverContent
          id="admin-sidebar-order-editor"
          side="right"
          align="end"
          sideOffset={10}
          className="max-h-[min(620px,calc(100dvh-24px))] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
          aria-label="사이드바 순서 설정"
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-foreground">
                메뉴 순서
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                필요할 때만 열어 빠르게 조정합니다.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-lg px-2 text-[11px] font-bold"
              disabled={!canLoadPreferences || isOrderLoading || isOrderSaving}
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
                className="rounded-xl border border-border bg-background/70 p-1.5"
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
                          moveAdminSidebarSection(
                            sidebarOrder,
                            section.label,
                            -1,
                          ),
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
                          moveAdminSidebarSection(
                            sidebarOrder,
                            section.label,
                            1,
                          ),
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
        </PopoverContent>
      </Popover>
    </aside>
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

function InlineModulePanel({ module }: { module: ConsoleModule }) {
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
        return <AdminStoryboardGenerator key="admin-storyboard" />;
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

export function AdminConsoleOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const shouldRenderAdminShell = authLoading || Boolean(user);
  const canLoadAdminConsoleData = Boolean(user) && !authLoading;
  const {
    stats,
    isLoading: statsLoading,
    hasError: statsHasError,
  } = useAdminOverviewStats(canLoadAdminConsoleData);
  const [activeModuleId, setActiveModuleId] =
    useState<AdminModuleId>("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSidebarLabels, setShowSidebarLabels] = useState(true);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeModule = consoleModules.find(
    (module) => module.id === activeModuleId,
  );

  const selectModule = useCallback(
    (moduleId: AdminModuleId) => {
      setActiveModuleId(moduleId);

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
    const nextModuleId = getAdminModuleIdFromSearchParams(searchParams);
    const canonicalHref = buildCanonicalAdminModuleHref(nextModuleId);
    const currentQuery = searchParams.toString();
    const currentHref = `/admin${currentQuery ? `?${currentQuery}` : ""}`;

    setActiveModuleId((current) =>
      current === nextModuleId ? current : nextModuleId,
    );

    if (stateWarning || currentHref !== canonicalHref) {
      router.replace(canonicalHref, { scroll: false });
    }
  }, [router, searchParams]);

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
      >
        <AdminSidebar
          activeModuleId={activeModuleId}
          onSelectModule={selectModule}
          isCollapsed={isSidebarCollapsed}
          showLabels={showSidebarLabels}
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
            "h-full min-h-0 min-w-0 overscroll-contain border-y border-border bg-background p-2 sm:p-3 md:border-y-0 md:p-4",
            activeModuleId === "overview"
              ? "overflow-y-auto lg:overflow-hidden"
              : "overflow-y-auto",
          )}
          data-admin-console-content="true"
        >
          <p className="sr-only" aria-live="polite">
            {activeModuleLabel} 작업 화면으로 전환됨
          </p>
          {authLoading ? (
            <AdminConsoleCanvasSkeleton />
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
            <InlineModulePanel module={activeModule} />
          ) : null}
        </section>
      </div>
    </main>
  );
}
