"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import type Supercluster from "supercluster";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2,
  Bot,
  Clapperboard,
  ClipboardList,
  FileCheck2,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ScrollText,
  Sparkles,
  Store,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useAdBannersAdmin } from "@/hooks/use-ad-banners";
import { useAnnouncementsAdmin } from "@/hooks/use-announcements";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { getNaverIndividualMarkerVisual } from "@/lib/naver-map-marker-visuals";
import { clusterAnimationManager, injectClusterCSS, removeClusterCSS } from "@/lib/cluster-marker";
import { buildNaverClusterAnimationIconPlan } from "@/lib/naver-map-cluster-visuals";
import { createClusterIndex, getClusterCategories, getClusters, isCluster, type ClusterProperties } from "@/lib/clustering";
import { fetchSupabaseExactCount } from "@/lib/supabase-rest-client";
import { cn } from "@/lib/utils";
import type { DashboardRestaurantItem, DashboardRestaurantsResponse, DashboardSummaryResponse } from "@/types/dashboard";

type AdminModuleId = "overview" | "restaurants" | "submissions" | "reviews" | "storyboard" | "banners" | "announcements" | "users" | "insights" | "audit" | "llm";
type ConsoleModuleId = Exclude<AdminModuleId, "overview" | "llm">;

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
    description: "승인된 맛집, 삭제/복구, 지도 좌표 오류 후보를 한 흐름에서 점검합니다.",
    href: "/admin/evaluations",
    icon: Store,
    badge: "데이터 검수",
    actionLabel: "맛집 데이터 검수",
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
    priority: "urgent",
  },
  {
    id: "announcements",
    title: "공지사항",
    description: "관리자 콘솔과 홈 배너에 노출되는 공지를 작성·수정·노출 관리합니다.",
    href: "/admin?module=announcements",
    icon: Megaphone,
    badge: "사용자 고지",
    actionLabel: "공지사항 운영",
  },
  {
    id: "storyboard",
    title: "스토리보드 생성",
    description: "쯔양 유튜브 히트맵을 바탕으로 다음 영상 소재와 씬별 촬영안을 생성합니다.",
    href: "/admin?module=storyboard",
    icon: Clapperboard,
    badge: "영상 기획",
    actionLabel: "스토리보드 만들기",
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
  },
  {
    id: "users",
    title: "사용자 관리",
    description: "사용자 계정, 관리자 권한, 비활성 상태, 프로필 정보를 안전한 편집 흐름으로 관리합니다.",
    href: "/admin?module=users",
    icon: UsersRound,
    badge: "권한 관리",
    actionLabel: "사용자 계정 관리",
  },
  {
    id: "insights",
    title: "인사이트",
    description: "조회수/좋아요/댓글/영상 길이 기반 트리맵과 변화 추이를 확인합니다.",
    href: "/insights",
    icon: BarChart2,
    badge: "분석",
    actionLabel: "인사이트 보기",
  },
  {
    id: "audit",
    title: "감사 로그",
    description: "승인·반려·삭제·복구 이력을 상태 재확인과 함께 추적하는 영역입니다.",
    href: "/admin/evaluations",
    icon: ScrollText,
    badge: "준비 중",
    actionLabel: "감사 기준 보기",
  },
];

const guardedSteps = ["미리보기", "확인", "적용", "재확인", "감사 기록"];
const SIDEBAR_LABEL_REVEAL_DELAY_MS = 180;
const ADMIN_OVERVIEW_MAP_PAGE_SIZE = 500;
const ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM = 13;
const ADMIN_OVERVIEW_CLUSTER_RADIUS = 56;

type AdminMapRestaurant = {
  id: string;
  name: string;
  category: string | null;
  categories?: string[];
  address: string | null;
  lat: number | null;
  lng: number | null;
  youtubeLink: string | null;
  videoId: string | null;
  sourceType: string | null;
  status: string | null;
  isMock?: boolean;
};

type AdminNaverLatLngLike = {
  lat?: (() => number) | number;
  lng?: (() => number) | number;
};

type AdminNaverBoundsLike = {
  getSW?: () => AdminNaverLatLngLike;
  getNE?: () => AdminNaverLatLngLike;
};

type AdminNaverMapInstance = {
  setCenter?: (center: unknown) => void;
  setZoom?: (zoom: number) => void;
  getZoom?: () => number;
  getBounds?: () => AdminNaverBoundsLike | null;
  panTo?: (center: unknown) => void;
};

type AdminNaverMarkerInstance = {
  setMap: (map: AdminNaverMapInstance | null) => void;
};

type AdminNaverMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AdminNaverMapInstance;
  LatLng: new (lat: number, lng: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Marker: new (options: Record<string, unknown>) => AdminNaverMarkerInstance;
  Event: {
    addListener: (target: unknown, eventName: string, listener: () => void) => unknown;
    removeListener?: (listener: unknown) => void;
  };
};

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
      .filter((module) => ["announcements", "storyboard", "banners", "users", "insights", "audit"].includes(module.id))
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

type AdminSidebarOrderPreference = {
  sections: string[];
  items: Record<string, AdminModuleId[]>;
};

const DEFAULT_ADMIN_SIDEBAR_ORDER: AdminSidebarOrderPreference = {
  sections: sidebarSections.map((section) => section.label),
  items: Object.fromEntries(sidebarSections.map((section) => [section.label, section.items.map((item) => item.id)])),
};

const sidebarSectionLabelSet = new Set(sidebarSections.map((section) => section.label));
const sidebarItemIdSet = new Set(sidebarSections.flatMap((section) => section.items.map((item) => item.id)));

function normalizeAdminSidebarOrder(value: unknown): AdminSidebarOrderPreference {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preferredSections = Array.isArray(record.sections)
    ? record.sections.filter((section): section is string => typeof section === "string" && sidebarSectionLabelSet.has(section))
    : [];
  const sections = Array.from(new Set([
    ...preferredSections,
    ...DEFAULT_ADMIN_SIDEBAR_ORDER.sections,
  ]));
  const rawItems = record.items && typeof record.items === "object" && !Array.isArray(record.items)
    ? record.items as Record<string, unknown>
    : {};
  const usedItemIds = new Set<AdminModuleId>();
  const items = Object.fromEntries(DEFAULT_ADMIN_SIDEBAR_ORDER.sections.map((section) => {
    const preferredItems = Array.isArray(rawItems[section])
      ? rawItems[section].filter((item): item is AdminModuleId => {
        if (typeof item !== "string" || !sidebarItemIdSet.has(item as AdminModuleId) || usedItemIds.has(item as AdminModuleId)) {
          return false;
        }
        usedItemIds.add(item as AdminModuleId);
        return true;
      })
      : [];
    const defaultItems = DEFAULT_ADMIN_SIDEBAR_ORDER.items[section].filter((item) => !usedItemIds.has(item));
    defaultItems.forEach((item) => usedItemIds.add(item));
    return [section, [...preferredItems, ...defaultItems]];
  }));

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

function moveAdminSidebarSection(order: AdminSidebarOrderPreference, section: string, direction: -1 | 1): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const index = normalized.sections.indexOf(section);
  return {
    ...normalized,
    sections: index < 0 ? normalized.sections : moveItemInArray(normalized.sections, index, direction),
  };
}

function moveAdminSidebarItem(order: AdminSidebarOrderPreference, section: string, itemId: AdminModuleId, direction: -1 | 1): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const sectionItems = normalized.items[section] ?? [];
  const index = sectionItems.indexOf(itemId);

  return {
    ...normalized,
    items: {
      ...normalized.items,
      [section]: index < 0 ? sectionItems : moveItemInArray(sectionItems, index, direction),
    },
  };
}

function buildOrderedSidebarSections(order: AdminSidebarOrderPreference): SidebarSection[] {
  const normalized = normalizeAdminSidebarOrder(order);
  const sourceSections = new Map(sidebarSections.map((section) => [section.label, section]));

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

const adminModuleIds: AdminModuleId[] = sidebarSections.flatMap((section) => section.items.map((item) => item.id));

function isAdminModuleId(value: string | null): value is AdminModuleId {
  return Boolean(value && adminModuleIds.includes(value as AdminModuleId));
}

function getAdminModuleIdFromSearchParams(searchParams: Pick<URLSearchParams, "get">): AdminModuleId {
  const moduleId = searchParams.get("module");
  return isAdminModuleId(moduleId) ? moduleId : "overview";
}

const AdminRestaurantEvaluationModule = dynamic(() => import("@/app/admin/evaluations/page"), {
  ssr: false,
});

const AdminSubmissionEvaluationModule = dynamic(() => import("@/app/admin/evaluations/page"), {
  ssr: false,
});

const AdminReviewEvaluationModule = dynamic(() => import("@/app/admin/evaluations/page"), {
  ssr: false,
});

const AdminBannerModule = dynamic(() => import("@/app/admin/banners/page"), {
  ssr: false,
});

const AdminAnnouncementModule = dynamic(() => import("@/components/announcement/AnnouncementPanel"), {
  ssr: false,
});

const AdminUsersModule = dynamic(() => import("@/components/admin/AdminUsersPanel"), {
  ssr: false,
});

const AdminStoryboardGenerator = dynamic(() => import("@/components/admin/storyboard/AdminStoryboardGenerator").then((module) => module.AdminStoryboardGenerator), {
  ssr: false,
});

const InsightsModule = dynamic(() => import("@/app/insights/insights-client"), {
  ssr: false,
});

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
  totalAnnouncements: number | null;
  activeAnnouncements: number | null;
  bannerAnnouncements: number | null;
  inactiveAnnouncements: number | null;
  latestRestaurantUpdate: string | null;
  latestAnnouncementUpdate: string | null;
  dashboardVideos: DashboardSummaryResponse["videos"] | null;
};

function buildCanonicalAdminModuleHref(moduleId: AdminModuleId): string {
  const params = new URLSearchParams();

  if (moduleId !== "overview") {
    params.set("module", moduleId);
  }

  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ""}`;
}

function getAdminModuleStateWarning(searchParams: Pick<URLSearchParams, "get">): string | null {
  const requestedModule = searchParams.get("module");

  if (requestedModule && !isAdminModuleId(requestedModule)) {
    return "알 수 없는 관리자 화면 요청을 개요로 되돌렸습니다.";
  }

  return null;
}

const adminNumberFormatter = new Intl.NumberFormat("ko-KR");

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? adminNumberFormatter.format(value) : "—";
}

function formatCount(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value)}${unit}` : "—";
}

async function fetchAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [submissions, reviews] = await Promise.all([
    fetchSupabaseExactCount("restaurant_submissions", [["status", "in.(pending,partially_approved)"]]),
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

async function fetchAdminMapRestaurants(): Promise<DashboardRestaurantsResponse> {
  const params = new URLSearchParams({
    limit: String(ADMIN_OVERVIEW_MAP_PAGE_SIZE),
    onlyWithCoordinates: "true",
  });
  const response = await fetch(`/api/dashboard/restaurants?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("dashboard-restaurants-failed");
  }

  return response.json() as Promise<DashboardRestaurantsResponse>;
}

function toAdminMapRestaurant(item: DashboardRestaurantItem): AdminMapRestaurant {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    categories: item.category ? [item.category] : [],
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    youtubeLink: item.youtubeLink,
    videoId: item.videoId,
    sourceType: item.sourceType,
    status: item.status,
  };
}

function hasAdminMapCoordinates(restaurant: AdminMapRestaurant): restaurant is AdminMapRestaurant & { lat: number; lng: number } {
  return typeof restaurant.lat === "number" && Number.isFinite(restaurant.lat) && typeof restaurant.lng === "number" && Number.isFinite(restaurant.lng);
}

function getAdminMapCenter(restaurants: Array<AdminMapRestaurant & { lat: number; lng: number }>) {
  if (restaurants.length === 0) {
    const [lat, lng] = REGION_MAP_CONFIG["서울특별시"].center;
    return { lat, lng };
  }

  return {
    lat: restaurants.reduce((sum, restaurant) => sum + restaurant.lat, 0) / restaurants.length,
    lng: restaurants.reduce((sum, restaurant) => sum + restaurant.lng, 0) / restaurants.length,
  };
}

function getAdminNaverMaps(): AdminNaverMapsApi | null {
  if (typeof window === "undefined") return null;
  return ((window as Window & { naver?: { maps?: AdminNaverMapsApi } }).naver?.maps) ?? null;
}

function readAdminNaverCoordinate(value: AdminNaverLatLngLike | undefined, key: "lat" | "lng") {
  const coordinate = value?.[key];
  return typeof coordinate === "function" ? coordinate() : coordinate;
}

function getAdminMapBbox(map: AdminNaverMapInstance): [number, number, number, number] {
  const bounds = map.getBounds?.();
  const sw = bounds?.getSW?.();
  const ne = bounds?.getNE?.();
  const west = readAdminNaverCoordinate(sw, "lng");
  const south = readAdminNaverCoordinate(sw, "lat");
  const east = readAdminNaverCoordinate(ne, "lng");
  const north = readAdminNaverCoordinate(ne, "lat");

  if ([west, south, east, north].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return [west as number, south as number, east as number, north as number];
  }

  return [124, 33, 132, 39];
}

function adminRestaurantsToClusterFeatures(restaurants: Array<AdminMapRestaurant & { lat: number; lng: number }>) {
  return restaurants.map((restaurant) => ({
    type: "Feature" as const,
    properties: {
      restaurantId: restaurant.id,
      name: restaurant.name,
      category: restaurant.categories?.[0] ?? restaurant.category ?? "기타",
      categories: restaurant.categories ?? (restaurant.category ? [restaurant.category] : []),
      address: restaurant.address,
    } satisfies ClusterProperties,
    geometry: {
      type: "Point" as const,
      coordinates: [restaurant.lng, restaurant.lat],
    },
  }));
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
  const announcementsQuery = useAnnouncementsAdmin();
  const announcements = announcementsQuery.data ?? [];

  return {
    stats: {
      pendingSubmissions: pendingCountsQuery.data?.submissions ?? null,
      pendingReviews: pendingCountsQuery.data?.reviews ?? null,
      totalRestaurants: dashboardSummaryQuery.data?.totals.restaurants ?? null,
      totalVideos: dashboardSummaryQuery.data?.totals.videos ?? null,
      withCoordinates: dashboardSummaryQuery.data?.totals.withCoordinates ?? null,
      activeBanners: bannersQuery.isSuccess ? banners.filter((banner) => banner.is_active).length : null,
      inactiveBanners: bannersQuery.isSuccess ? banners.filter((banner) => !banner.is_active).length : null,
      totalAnnouncements: announcementsQuery.isSuccess ? announcements.length : null,
      activeAnnouncements: announcementsQuery.isSuccess ? announcements.filter((announcement) => announcement.isActive).length : null,
      bannerAnnouncements: announcementsQuery.isSuccess ? announcements.filter((announcement) => announcement.isActive && announcement.showOnBanner).length : null,
      inactiveAnnouncements: announcementsQuery.isSuccess ? announcements.filter((announcement) => !announcement.isActive).length : null,
      latestRestaurantUpdate: dashboardSummaryQuery.data?.asOf ?? null,
      latestAnnouncementUpdate: announcementsQuery.isSuccess
        ? announcements.reduce<string | null>((latest, announcement) => {
          if (!latest) return announcement.updatedAt;
          return new Date(announcement.updatedAt).getTime() > new Date(latest).getTime() ? announcement.updatedAt : latest;
        }, null)
        : null,
      dashboardVideos: dashboardSummaryQuery.data?.videos ?? null,
    },
    isLoading: pendingCountsQuery.isLoading || dashboardSummaryQuery.isLoading || bannersQuery.isLoading || announcementsQuery.isLoading,
    hasError: pendingCountsQuery.isError || dashboardSummaryQuery.isError || bannersQuery.isError || announcementsQuery.isError,
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
  const [sidebarOrder, setSidebarOrder] = useState<AdminSidebarOrderPreference>(DEFAULT_ADMIN_SIDEBAR_ORDER);
  const [isOrderEditorOpen, setIsOrderEditorOpen] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [sidebarOrderMessage, setSidebarOrderMessage] = useState("사이드바 순서는 관리자 계정별로 저장됩니다.");
  const orderedSidebarSections = useMemo(() => buildOrderedSidebarSections(sidebarOrder), [sidebarOrder]);
  const activeSidebarItem = orderedSidebarSections
    .flatMap((section) => section.items)
    .find((item) => item.id === activeModuleId);
  const ActiveSidebarIcon = activeSidebarItem?.icon ?? Sparkles;
  const activeSidebarLabel = activeSidebarItem?.title ?? "전체 현황";

  useEffect(() => {
    let isMounted = true;

    async function loadSidebarOrder() {
      try {
        const response = await fetch("/api/admin/preferences/sidebar-order", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!response.ok) return;

        const payload = await response.json() as { order?: unknown };
        if (isMounted) {
          setSidebarOrder(normalizeAdminSidebarOrder(payload.order));
        }
      } catch {
        if (isMounted) {
          setSidebarOrderMessage("저장된 메뉴 순서를 불러오지 못해 처음 상태로 표시합니다.");
        }
      }
    }

    void loadSidebarOrder();

    return () => {
      isMounted = false;
    };
  }, []);

  const persistSidebarOrder = useCallback(async (nextOrder: AdminSidebarOrderPreference, successMessage: string) => {
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

      const payload = await response.json() as { order?: unknown };
      setSidebarOrder(normalizeAdminSidebarOrder(payload.order));
      setSidebarOrderMessage(successMessage);
    } catch {
      setSidebarOrderMessage("저장하지 못했습니다. 화면에는 임시 순서가 반영되어 있습니다.");
    } finally {
      setIsOrderSaving(false);
    }
  }, []);

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

    if (moduleId === "announcements" && stats.activeAnnouncements != null) {
      return {
        value: formatNumber(stats.activeAnnouncements),
        label: `활성 ${formatCount(stats.activeAnnouncements, "건")}`,
        urgent: false,
      };
    }

    return null;
  };

  return (
    <aside
      className={cn(
        "sticky top-0 z-30 flex w-full shrink-0 flex-col overflow-x-hidden border-y border-border bg-gradient-to-b from-card via-card to-background/95 p-2 shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none lg:top-0 lg:h-[calc(100dvh-var(--app-header-height,56px))] lg:w-48 lg:overflow-y-auto lg:border-y-0 lg:border-r lg:p-1.5",
        isCollapsed && "lg:w-14 lg:items-center lg:px-1.5",
      )}
      aria-label="관리자 콘솔 사이드바"
    >
      <div
        className={cn(
          "mb-2 flex min-h-10 items-center gap-2 border-b border-border/70 px-1 pb-2 transition-[border-color] duration-200 motion-reduce:transition-none lg:mb-1.5 lg:min-h-9 lg:pb-1.5",
          isCollapsed && "lg:min-h-9 lg:w-full lg:items-center lg:justify-center lg:border-b-0 lg:px-0 lg:pb-1",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/5 text-primary",
            isCollapsed && "lg:hidden",
          )}
          aria-hidden="true"
        >
          <ActiveSidebarIcon className="h-4 w-4" />
        </span>
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
            (!showLabels || isCollapsed) && "lg:sr-only",
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
            "ml-auto hidden h-8 w-8 rounded-xl border border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background lg:inline-flex",
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

      <nav id="admin-console-menu" aria-label="관리자 통합 메뉴" className={cn("flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:block lg:min-h-0 lg:flex-1 lg:space-y-1.5 lg:overflow-x-visible lg:pb-0", isCollapsed && "lg:flex lg:w-full lg:flex-col lg:items-center")}>
        {orderedSidebarSections.map((section) => (
          <div key={section.label} className={cn("flex shrink-0 gap-2 lg:block lg:space-y-1", isCollapsed && "lg:flex lg:w-full lg:flex-col lg:items-center")}>
            <p
              className={cn(
                "sr-only px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none lg:not-sr-only",
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
                    "group relative flex min-h-11 min-w-[8.25rem] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border px-3 py-2 text-left text-sm transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none lg:min-h-9 lg:min-w-0 lg:w-full lg:shrink lg:rounded-lg lg:px-2 lg:py-1",
                    isCollapsed && "lg:mx-auto lg:h-9 lg:min-h-9 lg:w-9 lg:justify-center lg:gap-0 lg:px-0",
                    isActive
                      ? "border-primary/20 bg-primary text-primary-foreground shadow-primary"
                      : "border-transparent text-muted-foreground hover:border-primary/15 hover:bg-background/80 hover:text-foreground",
                  )}
                  onClick={() => onSelectModule(item.id)}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none lg:h-6 lg:w-6 lg:rounded-md",
                      isActive
                        ? "border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
                        : "border-border bg-background/80 text-muted-foreground group-hover:border-primary/20 group-hover:text-primary",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
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
                        (!showLabels || isCollapsed) && "lg:absolute lg:right-1 lg:top-1 lg:h-2 lg:w-2 lg:border-0 lg:p-0 lg:text-[0px]",
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

      <Popover open={isOrderEditorOpen} onOpenChange={setIsOrderEditorOpen}>
        <div className={cn("mt-2 shrink-0 pt-0 lg:mt-auto lg:pt-2", isCollapsed && "lg:flex lg:w-full lg:justify-center")}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "min-h-10 rounded-xl border border-border/80 bg-background/75 px-3 text-xs font-bold text-muted-foreground shadow-sm touch-manipulation hover:border-primary/20 hover:bg-background hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background lg:min-h-8 lg:px-2",
                isCollapsed ? "lg:h-9 lg:w-9 lg:px-0" : "w-full justify-start gap-2",
              )}
              aria-label="사이드바 메뉴 순서 설정"
              aria-expanded={isOrderEditorOpen}
              aria-controls="admin-sidebar-order-editor"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className={cn("truncate", isCollapsed && "lg:sr-only")}>순서</span>
              {!isCollapsed && <span className="ml-auto text-[10px] font-semibold text-muted-foreground/80">설정</span>}
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
              <p className="truncate text-xs font-bold text-foreground">메뉴 순서</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">필요할 때만 열어 빠르게 조정합니다.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-lg px-2 text-[11px] font-bold"
              disabled={isOrderSaving}
              onClick={() => void persistSidebarOrder(DEFAULT_ADMIN_SIDEBAR_ORDER, "처음 상태로 되돌렸습니다.")}
            >
              초기화
            </Button>
          </div>

          <div className="space-y-1.5">
            {orderedSidebarSections.map((section, sectionIndex) => (
              <div key={section.label} className="rounded-xl border border-border bg-background/70 p-1.5">
                <div className="mb-1 flex items-center justify-between gap-1.5">
                  <span className="truncate text-[11px] font-bold text-muted-foreground">{section.label}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 rounded-md p-0 text-[11px]"
                      aria-label={`${section.label} 섹션 앞으로`}
                      disabled={sectionIndex === 0 || isOrderSaving}
                      onClick={() => void persistSidebarOrder(moveAdminSidebarSection(sidebarOrder, section.label, -1), `${section.label} 섹션을 앞으로 옮겼습니다.`)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 rounded-md p-0 text-[11px]"
                      aria-label={`${section.label} 섹션 뒤로`}
                      disabled={sectionIndex === orderedSidebarSections.length - 1 || isOrderSaving}
                      onClick={() => void persistSidebarOrder(moveAdminSidebarSection(sidebarOrder, section.label, 1), `${section.label} 섹션을 뒤로 옮겼습니다.`)}
                    >
                      ↓
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  {section.items.map((item, itemIndex) => (
                    <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg bg-muted/35 px-2 py-1">
                      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{item.title}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 w-6 rounded-md p-0 text-[11px]"
                          aria-label={`${item.title} 메뉴 앞으로`}
                          disabled={itemIndex === 0 || isOrderSaving}
                          onClick={() => void persistSidebarOrder(moveAdminSidebarItem(sidebarOrder, section.label, item.id, -1), `${item.title} 메뉴를 앞으로 옮겼습니다.`)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 w-6 rounded-md p-0 text-[11px]"
                          aria-label={`${item.title} 메뉴 뒤로`}
                          disabled={itemIndex === section.items.length - 1 || isOrderSaving}
                          onClick={() => void persistSidebarOrder(moveAdminSidebarItem(sidebarOrder, section.label, item.id, 1), `${item.title} 메뉴를 뒤로 옮겼습니다.`)}
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

          <p className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground" aria-live="polite">
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

function formatShortDate(value: string | null) {
  if (!value) return "게시일 확인 필요";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "게시일 확인 필요";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function calculateDistanceKm(a: AdminMapRestaurant, b: AdminMapRestaurant) {
  if (!hasAdminMapCoordinates(a) || !hasAdminMapCoordinates(b)) return null;

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function buildRouteCandidates(selectedRestaurant: AdminMapRestaurant | null, restaurants: AdminMapRestaurant[]) {
  if (!selectedRestaurant) return restaurants.slice(0, 4);

  return restaurants
    .filter((restaurant) => restaurant.id !== selectedRestaurant.id)
    .map((restaurant) => ({
      restaurant,
      distanceKm: calculateDistanceKm(selectedRestaurant, restaurant),
      sameCategory: Boolean(selectedRestaurant.category && restaurant.category === selectedRestaurant.category),
      sameVideo: Boolean(selectedRestaurant.videoId && restaurant.videoId === selectedRestaurant.videoId),
    }))
    .sort((a, b) => {
      if (a.sameVideo !== b.sameVideo) return a.sameVideo ? -1 : 1;
      if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
      return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
    })
    .slice(0, 4)
    .map((item) => item.restaurant);
}

function getAdminYoutubeThumbnailUrl(videoId: string | null, quality: "maxresdefault" | "hqdefault" = "maxresdefault") {
  return videoId ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg` : null;
}

function AdminYoutubeThumbnailImage({
  restaurantName,
  videoId,
}: {
  restaurantName: string;
  videoId: string;
}) {
  const [quality, setQuality] = useState<"maxresdefault" | "hqdefault">("maxresdefault");
  const thumbnailUrl = getAdminYoutubeThumbnailUrl(videoId, quality);

  if (!thumbnailUrl) return null;

  return (
    <Image
      src={thumbnailUrl}
      alt={`${restaurantName} 유튜브 썸네일`}
      fill
      sizes="(min-width: 1280px) 240px, (min-width: 640px) 50vw, 100vw"
      className="object-cover transition duration-200 group-hover:scale-[1.02]"
      onError={() => setQuality("hqdefault")}
    />
  );
}

function AdminCreatorLayerControls({
  tzuyangCount,
}: {
  tzuyangCount: number;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3" aria-label="유튜버별 지도 레이어">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-primary">쯔양</p>
          <Badge variant="outline" className="rounded-full border-primary/25 text-primary">표시</Badge>
        </div>
        <p className="mt-1 text-xl font-bold tracking-[-0.04em] text-foreground">{formatCount(tzuyangCount, "곳")}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">현재 승인 맛집 좌표 기준</p>
      </div>
      {["향후 유튜버 A", "향후 유튜버 B"].map((label) => (
        <div key={label} className="rounded-2xl border border-dashed border-border bg-muted/25 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-muted-foreground">{label}</p>
            <Badge variant="outline" className="rounded-full border-border text-muted-foreground">숨김</Badge>
          </div>
          <p className="mt-1 text-xl font-bold tracking-[-0.04em] text-muted-foreground">준비</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">채널별 레이어 확장 슬롯</p>
        </div>
      ))}
    </div>
  );
}


function AdminMapLoadingSkeleton() {
  return (
    <div
      className="absolute inset-0 bg-card/35"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 네이버 지도 로딩"
    >
      <span className="sr-only">네이버 지도를 준비하고 있습니다.</span>
      <div className="absolute left-3 top-3 rounded-full border border-border bg-card/85 px-3 py-1.5 text-[11px] font-bold text-muted-foreground shadow-sm backdrop-blur-sm" aria-hidden="true">
        지도 준비 중
      </div>
    </div>
  );
}


function AdminNaverMapSurface({
  restaurants,
  selectedRestaurant,
  isLoading,
  onSelectRestaurant,
}: {
  restaurants: AdminMapRestaurant[];
  selectedRestaurant: AdminMapRestaurant | null;
  isLoading: boolean;
  onSelectRestaurant: (restaurant: AdminMapRestaurant) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AdminNaverMapInstance | null>(null);
  const markerRefs = useRef<Array<{ marker: AdminNaverMarkerInstance; listener: unknown }>>([]);
  const idleListenerRef = useRef<unknown>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const { isLoaded, loadError, isLoading: isNaverLoading } = useNaverMaps({ autoLoad: true, strategy: "afterInteractive" });
  const visibleRestaurants = useMemo(
    () => restaurants.filter(hasAdminMapCoordinates),
    [restaurants],
  );
  const restaurantById = useMemo(
    () => new Map(visibleRestaurants.map((restaurant) => [restaurant.id, restaurant])),
    [visibleRestaurants],
  );
  const mapCenter = useMemo(() => getAdminMapCenter(visibleRestaurants), [visibleRestaurants]);

  useEffect(() => {
    injectClusterCSS();
    clusterAnimationManager.start(1400);

    const cleanupAnimationListener = clusterAnimationManager.addListener(() => {
      setViewportVersion((version) => version + 1);
    });

    return () => {
      cleanupAnimationListener();
      removeClusterCSS();
      clusterAnimationManager.clear();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current) return;
    const maps = getAdminNaverMaps();
    if (!maps) return;

    const center = new maps.LatLng(mapCenter.lat, mapCenter.lng);

    if (!mapRef.current) {
      mapRef.current = new maps.Map(mapContainerRef.current, {
        center,
        zoom: visibleRestaurants.length > 1 ? REGION_MAP_CONFIG["서울특별시"].zoom : 14,
        minZoom: 6,
        maxZoom: 18,
        zoomControl: false,
        scaleControl: false,
        logoControl: true,
        mapDataControl: false,
      });

      idleListenerRef.current = maps.Event.addListener(mapRef.current, "idle", () => {
        setViewportVersion((version) => version + 1);
      });
    } else {
      mapRef.current.setCenter?.(center);
      mapRef.current.setZoom?.(visibleRestaurants.length > 1 ? REGION_MAP_CONFIG["서울특별시"].zoom : 14);
    }

    setViewportVersion((version) => version + 1);
  }, [isLoaded, mapCenter.lat, mapCenter.lng, visibleRestaurants.length]);

  useEffect(() => {
    return () => {
      const maps = getAdminNaverMaps();
      if (idleListenerRef.current) {
        maps?.Event.removeListener?.(idleListenerRef.current);
        idleListenerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const maps = getAdminNaverMaps();
    if (!maps) return;

    markerRefs.current.forEach(({ marker, listener }) => {
      maps.Event.removeListener?.(listener);
      marker.setMap(null);
    });
    markerRefs.current = [];

    if (visibleRestaurants.length === 0) return;

    const map = mapRef.current;
    const currentZoom = map.getZoom?.() ?? REGION_MAP_CONFIG["서울특별시"].zoom;
    const clusterIndex = createClusterIndex(null, {
      radius: ADMIN_OVERVIEW_CLUSTER_RADIUS,
      maxZoom: ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM,
      minPoints: 2,
    }, false);
    clusterIndex.load(adminRestaurantsToClusterFeatures(visibleRestaurants));
    const clusters = getClusters(clusterIndex, getAdminMapBbox(map), currentZoom);

    clusters.forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates;

      if (isCluster(feature)) {
        const clusterId = feature.properties.cluster_id!;
        const categories = getClusterCategories(clusterIndex, clusterId);
        const renderPlan = buildNaverClusterAnimationIconPlan({
          categories: categories.length > 0 ? categories : ["기타"],
          count: feature.properties.point_count || 0,
          getCurrentIndex: (hash, categoryCount) => {
            clusterAnimationManager.register(hash);
            return clusterAnimationManager.getCurrentIndex(hash, categoryCount);
          },
          position: { lat, lng },
          uniqueKey: clusterId,
        });
        const marker = new maps.Marker({
          map,
          position: new maps.LatLng(lat, lng),
          title: `${feature.properties.point_count || 0}개 맛집`,
          zIndex: 220,
          icon: {
            content: renderPlan.content,
            anchor: new maps.Point(renderPlan.anchor.x, renderPlan.anchor.y),
          },
        });
        const listener = maps.Event.addListener(marker, "click", () => {
          const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(clusterId), 18);
          map.setZoom?.(Math.max(currentZoom + 1, expansionZoom));
          map.panTo?.(new maps.LatLng(lat, lng));
        });
        markerRefs.current.push({ marker, listener });
        return;
      }

      const restaurant = restaurantById.get(feature.properties.restaurantId);
      if (!restaurant) return;

      const isSelected = restaurant.id === selectedRestaurant?.id;
      const markerVisual = getNaverIndividualMarkerVisual(restaurant, isSelected);
      const marker = new maps.Marker({
        map,
        position: new maps.LatLng(restaurant.lat, restaurant.lng),
        title: restaurant.name,
        zIndex: markerVisual.zIndex,
        icon: {
          content: markerVisual.content,
          anchor: new maps.Point(markerVisual.anchor.x, markerVisual.anchor.y),
        },
      });
      const listener = maps.Event.addListener(marker, "click", () => onSelectRestaurant(restaurant));
      markerRefs.current.push({ marker, listener });
    });

    return () => {
      const currentMaps = getAdminNaverMaps();
      markerRefs.current.forEach(({ marker, listener }) => {
        currentMaps?.Event.removeListener?.(listener);
        marker.setMap(null);
      });
      markerRefs.current = [];
    };
  }, [isLoaded, onSelectRestaurant, restaurantById, selectedRestaurant?.id, visibleRestaurants, viewportVersion]);

  useEffect(() => {
    if (!selectedRestaurant || !hasAdminMapCoordinates(selectedRestaurant) || !mapRef.current || !isLoaded) return;
    const maps = getAdminNaverMaps();
    if (!maps) return;
    const center = new maps.LatLng(selectedRestaurant.lat, selectedRestaurant.lng);
    mapRef.current.panTo?.(center);
    if ((mapRef.current.getZoom?.() ?? 0) < ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1) {
      mapRef.current.setZoom?.(ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1);
    }
  }, [isLoaded, selectedRestaurant]);

  const isMapPreparing = isLoading || isNaverLoading;

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-[24px] border border-border bg-muted/25">
      <div ref={mapContainerRef} className="h-full min-h-[360px] w-full" aria-label="네이버 지도 맛집 마커와 클러스터" />

      {isMapPreparing && <AdminMapLoadingSkeleton />}

      {loadError && !isMapPreparing && (
        <div className="absolute inset-0 grid place-items-center bg-card/85 p-4 text-center backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl border border-dashed border-border bg-card/95 p-4 shadow-sm">
            <p className="text-sm font-bold text-foreground">네이버 지도를 불러오지 못했습니다</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {loadError.message} 지도 키가 준비되면 홈과 같은 마커와 클러스터로 자동 표시됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminMapOverviewCanvas({
  restaurants,
  selectedRestaurant,
  isLoading,
  hasError,
  onSelectRestaurant,
  onSelectModule,
}: {
  restaurants: AdminMapRestaurant[];
  selectedRestaurant: AdminMapRestaurant | null;
  isLoading: boolean;
  hasError: boolean;
  onSelectRestaurant: (restaurant: AdminMapRestaurant) => void;
  onSelectModule: (moduleId: AdminModuleId) => void;
}) {
  const visibleRestaurants = useMemo(
    () => restaurants.filter(hasAdminMapCoordinates),
    [restaurants],
  );
  return (
    <section
      aria-labelledby="admin-map-home-title"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="relative z-10 flex shrink-0 flex-col gap-2 border-b border-border bg-card/95 p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.12em] text-primary">관리자 지도 운영</p>
          <h2 id="admin-map-home-title" className="mt-0.5 text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl">
            쯔동여지도 홈 · 관리자 전용
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground sm:text-sm">
            홈에서 사용하는 네이버 지도와 마커 시각을 재사용해 좌표·검수·동선 후보를 한 화면에서 이어 봅니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-full border-emerald-700/20 bg-emerald-50 text-emerald-800">
            관리자 전용
          </Badge>
          <Badge variant="outline" className="rounded-full border-primary/25 bg-primary/5 text-primary">
            마커 선택 가능
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        {hasError ? (
          <div className="grid h-full min-h-[360px] place-items-center text-center">
            <div className="max-w-sm rounded-2xl border border-dashed border-border bg-card/95 p-4 shadow-sm">
              <p className="text-sm font-bold text-foreground">실데이터를 확인하지 못했습니다</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                요약 API가 실패하면 임의 수치를 만들지 않습니다. 맛집 관리 화면에서 좌표 상태를 먼저 확인하세요.
              </p>
              <Button type="button" size="sm" className="mt-4 rounded-xl" onClick={() => onSelectModule("restaurants")}>
                맛집 좌표 확인
              </Button>
            </div>
          </div>
        ) : !isLoading && visibleRestaurants.length === 0 ? (
          <div className="grid h-full min-h-[360px] place-items-center text-center">
            <div className="max-w-sm rounded-2xl border border-dashed border-border bg-card/95 p-4 shadow-sm">
              <p className="text-sm font-bold text-foreground">표시할 좌표 맛집이 없습니다</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                운영 콘솔에서는 빈 실데이터 상태를 목업으로 대체하지 않습니다. 맛집 관리에서 좌표가 있는 맛집을 먼저 확인하세요.
              </p>
              <Button type="button" size="sm" className="mt-4 rounded-xl" onClick={() => onSelectModule("restaurants")}>
                맛집 좌표 확인
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative h-full min-h-[360px]">
            <AdminNaverMapSurface
              restaurants={visibleRestaurants}
              selectedRestaurant={selectedRestaurant}
              isLoading={isLoading}
              onSelectRestaurant={onSelectRestaurant}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function AdminMapInfoPanel({
  stats,
  restaurants,
  selectedRestaurant,
  isLoading,
  hasError,
  onSelectModule,
}: {
  stats: AdminOverviewStats;
  restaurants: AdminMapRestaurant[];
  selectedRestaurant: AdminMapRestaurant | null;
  isLoading: boolean;
  hasError: boolean;
  onSelectModule: (moduleId: AdminModuleId) => void;
}) {
  const routeCandidates = buildRouteCandidates(selectedRestaurant, restaurants);
  const latestVideos = [...(stats.dashboardVideos ?? [])]
    .sort((a, b) => {
      const aMs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bMs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bMs - aMs;
    })
    .slice(0, 3);
  const coordinateRatio =
    stats.totalRestaurants && stats.withCoordinates != null
      ? Math.round((stats.withCoordinates / stats.totalRestaurants) * 100)
      : null;
  const selectedVideoId = selectedRestaurant?.videoId ?? null;
  const selectedThumbnailUrl = getAdminYoutubeThumbnailUrl(selectedVideoId);
  const selectedCoordinateText = selectedRestaurant?.lat == null || selectedRestaurant?.lng == null
    ? "좌표 확인 필요"
    : `${selectedRestaurant.lat.toFixed(5)}, ${selectedRestaurant.lng.toFixed(5)}`;

  return (
    <aside className="flex min-h-0 flex-col gap-3 lg:h-full lg:overflow-hidden">
      <section className="shrink-0 rounded-xl border border-border bg-card p-2.5 shadow-sm" aria-labelledby="admin-map-selected-title">
        {selectedRestaurant ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border bg-background/70 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold tracking-[0.12em] text-primary">선택한 마커</p>
                    <h2 id="admin-map-selected-title" className="mt-0.5 truncate text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl">
                      {selectedRestaurant.name}
                    </h2>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0 rounded-full", hasError ? "border-amber-700/30 text-amber-800" : "border-emerald-700/20 text-emerald-800")}>
                    {hasError ? "확인 필요" : "선택됨"}
                  </Badge>
                </div>

                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground sm:text-sm">
                  {selectedRestaurant.address ?? "주소 정보 확인 필요"}
                </p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="max-w-full rounded-full border-primary/20 bg-primary/5 text-primary">
                    <span className="truncate">{selectedRestaurant.category ?? "카테고리 확인"}</span>
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-border bg-card text-muted-foreground">
                    {selectedRestaurant.status ?? "상태 확인"}
                  </Badge>
                </div>

                <dl className="mt-2 grid gap-1.5 text-xs">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-2 py-1.5">
                    <dt className="shrink-0 text-muted-foreground">좌표</dt>
                    <dd className="min-w-0 truncate font-mono text-[11px] font-bold text-foreground">{selectedCoordinateText}</dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-2 py-1.5">
                    <dt className="shrink-0 text-muted-foreground">영상 ID</dt>
                    <dd className="min-w-0 truncate font-bold text-foreground">{selectedRestaurant.videoId ?? "확인 필요"}</dd>
                  </div>
                </dl>

                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="선택 마커 작업">
                  <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => onSelectModule("restaurants")}>
                    맛집 검수
                  </Button>
                  {selectedRestaurant.youtubeLink && (
                    <a
                      href={selectedRestaurant.youtubeLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      연결 영상 열기
                    </a>
                  )}
                </div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-background/70">
                {selectedVideoId && selectedThumbnailUrl ? (
                  <a
                    href={selectedRestaurant.youtubeLink ?? selectedThumbnailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label={`${selectedRestaurant.name} 원본 YouTube 영상 새 탭에서 열기`}
                  >
                    <div className="relative aspect-video overflow-hidden bg-muted">
                      <AdminYoutubeThumbnailImage
                        key={selectedVideoId}
                        restaurantName={selectedRestaurant.name}
                        videoId={selectedVideoId}
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-bold text-primary shadow-sm backdrop-blur">
                        YouTube
                      </span>
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
                        원본 열기
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                      <p className="min-w-0 truncate text-[11px] font-bold text-foreground">연결 영상 썸네일</p>
                      <span className="min-w-0 truncate font-mono text-[10px] font-semibold text-muted-foreground">{selectedVideoId}</span>
                    </div>
                  </a>
                ) : (
                  <div className="grid aspect-video place-items-center p-3 text-center">
                    <div>
                      <ImageIcon className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      <p className="mt-2 text-xs font-bold text-foreground">영상 연결 없음</p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">YouTube 링크가 있으면 썸네일을 바로 보여줍니다.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.12em] text-primary">선택한 마커</p>
              <h2 id="admin-map-selected-title" className="mt-0.5 truncate text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl">
                마커를 선택하세요
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm">
                왼쪽 지도에서 마커를 누르면 맛집 상세, 영상 연결, 좌표 상태, 동선 후보를 여기서 확인합니다.
              </p>
            </div>
            <Badge variant="outline" className={cn("shrink-0 rounded-full", hasError ? "border-amber-700/30 text-amber-800" : "border-emerald-700/20 text-emerald-800")}>
              {hasError ? "확인 필요" : "대기"}
            </Badge>
          </div>
        )}
      </section>

      <AdminCreatorLayerControls tzuyangCount={restaurants.length} />

      <section className="rounded-xl border border-border bg-card p-2.5 shadow-sm lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-labelledby="admin-map-info-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="admin-map-info-title" className="text-sm font-bold text-foreground">
            운영 정보
          </h2>
          {isLoading && <Skeleton className="h-5 w-20 rounded-full" aria-hidden="true" />}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
          {[
            ["맛집", formatCount(stats.totalRestaurants, "곳"), coordinateRatio == null ? "좌표율 확인 필요" : `좌표율 ${coordinateRatio}%`],
            ["제보", formatCount(stats.pendingSubmissions, "건"), "승인 대기"],
            ["리뷰", formatCount(stats.pendingReviews, "건"), "미승인 큐"],
          ].map(([label, value, helper]) => (
            <button
              key={label}
              type="button"
              onClick={() => onSelectModule(label === "맛집" ? "restaurants" : label === "제보" ? "submissions" : "reviews")}
              className="rounded-xl border border-border bg-background/70 p-2.5 text-left transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <p className="text-xs font-semibold text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
            </button>
          ))}
        </div>

        <Separator className="my-3" />

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-foreground">동선 추천 초안</h3>
            <Badge variant="outline" className="rounded-full border-primary/25 text-primary">거리 기반 후보</Badge>
          </div>
          {routeCandidates.length > 0 ? (
            <ol className="mt-2 space-y-1.5">
              {routeCandidates.map((restaurant, index) => (
                <li key={restaurant.id} className="rounded-xl border border-border bg-background/70 p-2.5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{restaurant.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {restaurant.address ?? "주소 미입력"} · {restaurant.category ?? "카테고리 확인"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
              추천 동선은 좌표가 있는 맛집이 2곳 이상 연결되면 표시합니다. 데이터가 부족하면 임의 동선을 만들지 않습니다.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            실제 이동시간 API가 붙기 전까지는 선택 맛집과의 거리·같은 영상·같은 카테고리 기반 후보만 표시합니다.
          </p>
        </div>

        <Separator className="my-3" />

        <div>
          <h3 className="text-sm font-bold text-foreground">최근 영상 연결</h3>
          <div className="mt-3 space-y-2">
            {latestVideos.length > 0 ? latestVideos.map((video) => (
              <div key={video.videoId} className="rounded-xl border border-border bg-background/70 p-2.5">
                <p className="line-clamp-2 text-xs font-bold leading-5 text-foreground">{video.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatShortDate(video.publishedAt)} · {formatCount(video.restaurantCount, "곳")}
                </p>
              </div>
            )) : (
              <p className="rounded-2xl border border-dashed border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
                최근 영상 요약은 승인 맛집과 연결된 데이터가 있을 때만 표시합니다.
              </p>
            )}
          </div>
        </div>
      </section>
    </aside>
  );
}

function AdminOverviewDashboard({
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
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const mapRestaurantsQuery = useQuery({
    queryKey: ["admin-overview", "map-restaurants"],
    queryFn: fetchAdminMapRestaurants,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const realRestaurants = useMemo(
    () => (mapRestaurantsQuery.data?.items ?? []).map(toAdminMapRestaurant).filter(hasAdminMapCoordinates),
    [mapRestaurantsQuery.data?.items],
  );
  const restaurants = realRestaurants;
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) ?? restaurants[0] ?? null;
  const isMapLoading = isLoading || mapRestaurantsQuery.isLoading;
  const hasMapError = hasError || mapRestaurantsQuery.isError;

  return (
    <div
      role="region"
      aria-label="관리자 지도 운영 개요 2분할"
      className="grid min-h-full grid-cols-1 gap-2 overflow-visible xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:overflow-hidden"
    >
      <div className="min-h-[390px] min-w-0 xl:min-h-0">
        <AdminMapOverviewCanvas
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          isLoading={isMapLoading}
          hasError={hasMapError}
          onSelectRestaurant={(restaurant) => setSelectedRestaurantId(restaurant.id)}
          onSelectModule={onSelectModule}
        />
      </div>
      <div className="min-h-[420px] min-w-0 xl:min-h-0">
        <AdminMapInfoPanel
          stats={stats}
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          isLoading={isMapLoading}
          hasError={hasMapError}
          onSelectModule={onSelectModule}
        />
      </div>
    </div>
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
    <section aria-labelledby="admin-llm-session-title" className="space-y-3">
      <div className="rounded-2xl border border-primary/15 bg-card/95 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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

      <div className="grid gap-3 xl:grid-cols-3">
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
    <Card className="min-h-[480px] border-border bg-card/95 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">준비 중</p>
            <CardTitle className="mt-1 text-2xl tracking-[-0.04em]">감사 로그</CardTitle>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              승인·반려·삭제·복구 이력을 한 화면에서 확인하는 영역입니다. 사용자 권한 변경 감사는 저장되며, 전체 운영 감사 읽기 화면은
              감사 원천이 확정되기 전까지 안전 적용 원칙과 상태 재확인 체크리스트만 표시합니다.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-primary/30 text-primary">
일부 소스 연결 필요
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {[
          ["결정 기록", "관리자가 어떤 결정을 했는지 승인/반려/삭제/복구 단위로 저장합니다."],
          ["안전 적용", "위험 변경은 미리보기 → 확인 → 적용 순서를 거칩니다."],
          ["상태 재확인", "적용 후 실제 데이터 상태를 다시 읽어 최종 상태를 확인합니다."],
          ["재수집 연결", "필요 시 재수집/재평가 큐로 넘길 수 있게 연결합니다."],
        ].map(([title, description]) => (
          <div key={title} className="rounded-2xl border border-border bg-muted/25 p-3">
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
        return <AdminRestaurantEvaluationModule key="restaurants" embedded initialView="evaluations" />;
      case "submissions":
        return <AdminSubmissionEvaluationModule key="submissions" embedded initialView="submissions" initialSubmissionTab="new" />;
      case "reviews":
        return <AdminReviewEvaluationModule key="reviews" embedded initialView="submissions" initialSubmissionTab="reviews" />;
      case "banners":
        return <AdminBannerModule key="admin-banners" embedded />;
      case "announcements":
        return (
          <AnnouncementWorkspace>
            <AdminAnnouncementModule
              key="admin-announcements"
              isOpen
              isAdmin
              adminActionsMode="inline"
              hideCloseButton
              onClose={() => undefined}
            />
          </AnnouncementWorkspace>
        );
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
    <section aria-label={`${module.title} 작업 화면`} className="flex min-h-full flex-col lg:h-full lg:min-h-0">
      <div
        className={cn(
          "min-h-[420px] flex-1 rounded-xl border border-border bg-background shadow-sm lg:min-h-0",
          "overflow-visible lg:overflow-hidden",
        )}
      >
        {moduleContent}
      </div>
    </section>
  );
}

function AnnouncementWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}

export function AdminConsoleOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const { stats, isLoading: statsLoading, hasError: statsHasError } = useAdminOverviewStats(isAdmin);
  const [activeModuleId, setActiveModuleId] = useState<AdminModuleId>("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSidebarLabels, setShowSidebarLabels] = useState(true);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeModule = consoleModules.find((module) => module.id === activeModuleId);

  const selectModule = useCallback((moduleId: AdminModuleId) => {
    setActiveModuleId(moduleId);

    router.replace(buildCanonicalAdminModuleHref(moduleId), {
      scroll: false,
    });

    window.requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      canvasRef.current?.focus({ preventScroll: true });
    });
  }, [router]);

  useEffect(() => {
    const stateWarning = getAdminModuleStateWarning(searchParams);
    const nextModuleId = getAdminModuleIdFromSearchParams(searchParams);
    const canonicalHref = buildCanonicalAdminModuleHref(nextModuleId);
    const currentQuery = searchParams.toString();
    const currentHref = `/admin${currentQuery ? `?${currentQuery}` : ""}`;

    setActiveModuleId((current) => (current === nextModuleId ? current : nextModuleId));

    if (stateWarning || currentHref !== canonicalHref) {
      router.replace(canonicalHref, { scroll: false });
    }
  }, [router, searchParams]);

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

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user || !isAdmin) {
      router.replace("/");
    }
  }, [authLoading, user, isAdmin, router]);

  const handleToggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((current) => {
      if (!current) {
        setShowSidebarLabels(false);
        return true;
      }

      return false;
    });
  };

  if (authLoading) {
    return null;
  }

  if (!user || !isAdmin) {
    return null;
  }

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
          className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain border-y border-border bg-background p-2 sm:p-2 lg:border-y-0 lg:p-2 xl:p-2"
        >
          <p className="sr-only" aria-live="polite">
            {activeModuleLabel} 작업 화면으로 전환됨
          </p>
          {activeModuleId === "overview" ? (
            <AdminOverviewDashboard
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
