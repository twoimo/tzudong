"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { getNaverIndividualMarkerVisual } from "@/lib/naver-map-marker-visuals";
import {
  buildNaverClusterMarkerRenderPlan,
  getClusterVisualKey,
} from "@/lib/naver-map-cluster-visuals";
import {
  createClusterIndex,
  getClusterCategories,
  getClusters,
  isCluster,
  type ClusterProperties,
} from "@/lib/clustering";
import { cn } from "@/lib/utils";
import type {
  DashboardRestaurantItem,
  DashboardRestaurantsResponse,
  DashboardSummaryResponse,
} from "@/types/dashboard";

const ADMIN_OVERVIEW_MAP_PAGE_SIZE = 500;
const ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM = 13;
const ADMIN_OVERVIEW_CLUSTER_RADIUS = 56;

type AdminOverviewModuleId = "restaurants" | "submissions" | "reviews";

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
  setZoom?: (zoom: number, effect?: boolean) => void;
  getZoom?: () => number;
  getBounds?: () => AdminNaverBoundsLike | null;
};

type AdminNaverMarkerInstance = {
  setMap: (map: AdminNaverMapInstance | null) => void;
};

type AdminNaverMapsApi = {
  Map: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => AdminNaverMapInstance;
  LatLng: new (lat: number, lng: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Marker: new (options: Record<string, unknown>) => AdminNaverMarkerInstance;
  Event: {
    addListener: (
      target: unknown,
      eventName: string,
      listener: () => void,
    ) => unknown;
    removeListener?: (listener: unknown) => void;
  };
};

const adminNumberFormatter = new Intl.NumberFormat("ko-KR");

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? adminNumberFormatter.format(value)
    : "—";
}

function formatCount(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatNumber(value)}${unit}`
    : "—";
}

async function fetchAdminMapRestaurants(): Promise<DashboardRestaurantsResponse> {
  const params = new URLSearchParams({
    limit: String(ADMIN_OVERVIEW_MAP_PAGE_SIZE),
    onlyWithCoordinates: "true",
  });
  const response = await fetch(
    `/api/dashboard/restaurants?${params.toString()}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("dashboard-restaurants-failed");
  }

  return response.json() as Promise<DashboardRestaurantsResponse>;
}

function toAdminMapRestaurant(
  item: DashboardRestaurantItem,
): AdminMapRestaurant {
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

function hasAdminMapCoordinates(
  restaurant: AdminMapRestaurant,
): restaurant is AdminMapRestaurant & { lat: number; lng: number } {
  return (
    typeof restaurant.lat === "number" &&
    Number.isFinite(restaurant.lat) &&
    typeof restaurant.lng === "number" &&
    Number.isFinite(restaurant.lng)
  );
}

function getAdminMapCenter(
  restaurants: Array<AdminMapRestaurant & { lat: number; lng: number }>,
) {
  if (restaurants.length === 0) {
    const [lat, lng] = REGION_MAP_CONFIG["서울특별시"].center;
    return { lat, lng };
  }

  return {
    lat:
      restaurants.reduce((sum, restaurant) => sum + restaurant.lat, 0) /
      restaurants.length,
    lng:
      restaurants.reduce((sum, restaurant) => sum + restaurant.lng, 0) /
      restaurants.length,
  };
}

function getAdminNaverMaps(): AdminNaverMapsApi | null {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { naver?: { maps?: AdminNaverMapsApi } }).naver?.maps ??
    null
  );
}

function readAdminNaverCoordinate(
  value: AdminNaverLatLngLike | undefined,
  key: "lat" | "lng",
) {
  const coordinate = value?.[key];
  return typeof coordinate === "function" ? coordinate() : coordinate;
}

function getAdminMapBbox(
  map: AdminNaverMapInstance,
): [number, number, number, number] {
  const bounds = map.getBounds?.();
  const sw = bounds?.getSW?.();
  const ne = bounds?.getNE?.();
  const west = readAdminNaverCoordinate(sw, "lng");
  const south = readAdminNaverCoordinate(sw, "lat");
  const east = readAdminNaverCoordinate(ne, "lng");
  const north = readAdminNaverCoordinate(ne, "lat");

  if (
    [west, south, east, north].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return [west as number, south as number, east as number, north as number];
  }

  return [124, 33, 132, 39];
}

function adminRestaurantsToClusterFeatures(
  restaurants: Array<AdminMapRestaurant & { lat: number; lng: number }>,
) {
  return restaurants.map((restaurant) => ({
    type: "Feature" as const,
    properties: {
      restaurantId: restaurant.id,
      name: restaurant.name,
      category: restaurant.categories?.[0] ?? restaurant.category ?? "기타",
      categories:
        restaurant.categories ??
        (restaurant.category ? [restaurant.category] : []),
      address: restaurant.address,
    } satisfies ClusterProperties,
    geometry: {
      type: "Point" as const,
      coordinates: [restaurant.lng, restaurant.lat],
    },
  }));
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

function buildRouteCandidates(
  selectedRestaurant: AdminMapRestaurant | null,
  restaurants: AdminMapRestaurant[],
) {
  if (!selectedRestaurant) return restaurants.slice(0, 4);

  return restaurants
    .filter((restaurant) => restaurant.id !== selectedRestaurant.id)
    .map((restaurant) => ({
      restaurant,
      distanceKm: calculateDistanceKm(selectedRestaurant, restaurant),
      sameCategory: Boolean(
        selectedRestaurant.category &&
        restaurant.category === selectedRestaurant.category,
      ),
      sameVideo: Boolean(
        selectedRestaurant.videoId &&
        restaurant.videoId === selectedRestaurant.videoId,
      ),
    }))
    .sort((a, b) => {
      if (a.sameVideo !== b.sameVideo) return a.sameVideo ? -1 : 1;
      if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
      return (
        (a.distanceKm ?? Number.POSITIVE_INFINITY) -
        (b.distanceKm ?? Number.POSITIVE_INFINITY)
      );
    })
    .slice(0, 4)
    .map((item) => item.restaurant);
}

function getAdminYoutubeThumbnailUrl(
  videoId: string | null,
  quality: "maxresdefault" | "hqdefault" = "maxresdefault",
) {
  return videoId
    ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`
    : null;
}

function AdminYoutubeThumbnailImage({
  restaurantName,
  videoId,
}: {
  restaurantName: string;
  videoId: string;
}) {
  const [quality, setQuality] = useState<"maxresdefault" | "hqdefault">(
    "maxresdefault",
  );
  const thumbnailUrl = getAdminYoutubeThumbnailUrl(videoId, quality);

  if (!thumbnailUrl) return null;

  return (
    <Image
      src={thumbnailUrl}
      alt={`${restaurantName} 유튜브 썸네일`}
      fill
      sizes="(min-width: 1280px) 240px, (min-width: 640px) 50vw, 100vw"
      className="object-cover transition-opacity duration-200 group-hover:opacity-90 motion-reduce:transition-none"
      onError={() => setQuality("hqdefault")}
    />
  );
}

function AdminCreatorLayerControls({ tzuyangCount }: { tzuyangCount: number }) {
  return (
    <div
      className="grid gap-2"
      aria-label="유튜버별 지도 레이어"
      data-admin-creator-layer-controls="active-only"
    >
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-primary">쯔양</p>
          <Badge
            variant="outline"
            className="rounded-full border-primary/25 text-primary"
          >
            표시
          </Badge>
        </div>
        <p className="mt-1 text-xl font-bold tracking-[-0.04em] text-foreground">
          {formatCount(tzuyangCount, "곳")}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          현재 승인 맛집 좌표 기준
        </p>
      </div>
    </div>
  );
}

function AdminMapLoadingSkeleton() {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-card/35 backdrop-blur-[1px]"
      data-admin-map-loading-skeleton="true"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 네이버 지도 로딩"
    >
      <span className="sr-only">네이버 지도를 준비하고 있습니다.</span>
      <div className="absolute left-3 top-3 space-y-1.5" aria-hidden="true">
        <Skeleton className="h-7 w-24 rounded-full motion-reduce:animate-none" />
        <Skeleton className="h-2 w-16 rounded-full motion-reduce:animate-none" />
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
  const markerRefs = useRef<
    Array<{ marker: AdminNaverMarkerInstance; listener: unknown }>
  >([]);
  const idleListenerRef = useRef<unknown>(null);
  const viewportRefreshTimerRef = useRef<number | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const {
    isLoaded,
    loadError,
    isLoading: isNaverLoading,
    load: loadNaverMaps,
  } = useNaverMaps({ autoLoad: false, strategy: "lazyOnload" });

  const scheduleViewportRefresh = useCallback(() => {
    if (viewportRefreshTimerRef.current != null) return;

    viewportRefreshTimerRef.current = window.setTimeout(() => {
      viewportRefreshTimerRef.current = null;
      setViewportVersion((version) => version + 1);
    }, 180);
  }, []);

  const visibleRestaurants = useMemo(
    () => restaurants.filter(hasAdminMapCoordinates),
    [restaurants],
  );
  const restaurantById = useMemo(
    () =>
      new Map(
        visibleRestaurants.map((restaurant) => [restaurant.id, restaurant]),
      ),
    [visibleRestaurants],
  );
  const adminMapClusterIndex = useMemo(() => {
    const clusterIndex = createClusterIndex(
      null,
      {
        radius: ADMIN_OVERVIEW_CLUSTER_RADIUS,
        maxZoom: ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM,
        minPoints: 2,
      },
      false,
    );
    clusterIndex.load(adminRestaurantsToClusterFeatures(visibleRestaurants));
    return clusterIndex;
  }, [visibleRestaurants]);
  const mapCenter = useMemo(
    () => getAdminMapCenter(visibleRestaurants),
    [visibleRestaurants],
  );

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element || isLoaded || loadError) return;

    if (!("IntersectionObserver" in window)) {
      loadNaverMaps();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadNaverMaps();
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isLoaded, loadError, loadNaverMaps]);

  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current) return;
    const maps = getAdminNaverMaps();
    if (!maps) return;

    const center = new maps.LatLng(mapCenter.lat, mapCenter.lng);

    if (!mapRef.current) {
      mapRef.current = new maps.Map(mapContainerRef.current, {
        center,
        zoom:
          visibleRestaurants.length > 1
            ? REGION_MAP_CONFIG["서울특별시"].zoom
            : 14,
        minZoom: 6,
        maxZoom: 18,
        zoomControl: false,
        scaleControl: false,
        logoControl: true,
        mapDataControl: false,
      });

      idleListenerRef.current = maps.Event.addListener(
        mapRef.current,
        "idle",
        scheduleViewportRefresh,
      );
    } else {
      mapRef.current.setCenter?.(center);
      mapRef.current.setZoom?.(
        visibleRestaurants.length > 1
          ? REGION_MAP_CONFIG["서울특별시"].zoom
          : 14,
        false,
      );
    }

    scheduleViewportRefresh();
  }, [
    isLoaded,
    mapCenter.lat,
    mapCenter.lng,
    scheduleViewportRefresh,
    visibleRestaurants.length,
  ]);

  useEffect(() => {
    return () => {
      const maps = getAdminNaverMaps();
      if (idleListenerRef.current) {
        maps?.Event.removeListener?.(idleListenerRef.current);
        idleListenerRef.current = null;
      }
      if (viewportRefreshTimerRef.current != null) {
        window.clearTimeout(viewportRefreshTimerRef.current);
        viewportRefreshTimerRef.current = null;
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
    const clusters = getClusters(
      adminMapClusterIndex,
      getAdminMapBbox(map),
      currentZoom,
    );

    clusters.forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates;

      if (isCluster(feature)) {
        const clusterId = feature.properties.cluster_id!;
        const categories = getClusterCategories(
          adminMapClusterIndex,
          clusterId,
        );
        const markerCategories = categories.length > 0 ? categories : ["기타"];
        const renderPlan = buildNaverClusterMarkerRenderPlan({
          categories: markerCategories,
          count: feature.properties.point_count || 0,
          currentIndex:
            getClusterVisualKey(clusterId) % markerCategories.length,
          position: { lat, lng },
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
          const expansionZoom = Math.min(
            adminMapClusterIndex.getClusterExpansionZoom(clusterId),
            18,
          );
          map.setZoom?.(Math.max(currentZoom + 1, expansionZoom), false);
          map.setCenter?.(new maps.LatLng(lat, lng));
        });
        markerRefs.current.push({ marker, listener });
        return;
      }

      const restaurant = restaurantById.get(feature.properties.restaurantId);
      if (!restaurant) return;

      const isSelected = restaurant.id === selectedRestaurant?.id;
      const markerVisual = getNaverIndividualMarkerVisual(
        restaurant,
        isSelected,
      );
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
      const listener = maps.Event.addListener(marker, "click", () =>
        onSelectRestaurant(restaurant),
      );
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
  }, [
    isLoaded,
    adminMapClusterIndex,
    onSelectRestaurant,
    restaurantById,
    selectedRestaurant?.id,
    visibleRestaurants,
    viewportVersion,
  ]);

  useEffect(() => {
    if (
      !selectedRestaurant ||
      !hasAdminMapCoordinates(selectedRestaurant) ||
      !mapRef.current ||
      !isLoaded
    )
      return;
    const maps = getAdminNaverMaps();
    if (!maps) return;
    const center = new maps.LatLng(
      selectedRestaurant.lat,
      selectedRestaurant.lng,
    );
    mapRef.current.setCenter?.(center);
    if (
      (mapRef.current.getZoom?.() ?? 0) <
      ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1
    ) {
      mapRef.current.setZoom?.(ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1, false);
    }
  }, [isLoaded, selectedRestaurant]);

  const isMapPreparing = isLoading || isNaverLoading;

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-[24px] border border-border bg-muted/25">
      <div
        ref={mapContainerRef}
        className="h-full min-h-[360px] w-full"
        aria-label="네이버 지도 맛집 마커와 클러스터"
      />

      {isMapPreparing && <AdminMapLoadingSkeleton />}

      {loadError && !isMapPreparing && (
        <div className="absolute inset-0 grid place-items-center bg-card/85 p-4 text-center backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl border border-dashed border-border bg-card/95 p-4 shadow-sm">
            <p className="text-sm font-bold text-foreground">
              네이버 지도를 불러오지 못했습니다
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {loadError.message} 지도 키가 준비되면 홈과 같은 마커와 클러스터로
              자동 표시됩니다.
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
  onSelectModule: (moduleId: AdminOverviewModuleId) => void;
}) {
  const visibleRestaurants = useMemo(
    () => restaurants.filter(hasAdminMapCoordinates),
    [restaurants],
  );
  const shouldShowMapStatusOverlay =
    hasError || (!isLoading && visibleRestaurants.length === 0);
  return (
    <section
      aria-labelledby="admin-map-home-title"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="relative z-10 flex shrink-0 flex-col gap-2 border-b border-border bg-card/95 p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.12em] text-primary">
            관리자 지도 운영
          </p>
          <h2
            id="admin-map-home-title"
            className="mt-0.5 text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl"
          >
            쯔동여지도 홈 · 관리자 전용
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground sm:text-sm">
            홈에서 사용하는 네이버 지도와 마커 시각을 재사용해 좌표·검수·동선
            후보를 한 화면에서 이어 봅니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="rounded-full border-emerald-700/20 bg-emerald-50 text-emerald-800"
          >
            관리자 전용
          </Badge>
          <Badge
            variant="outline"
            className="rounded-full border-primary/25 bg-primary/5 text-primary"
          >
            마커 선택 가능
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <div
          className="relative h-full min-h-[360px]"
          data-admin-overview-map-canvas="true"
        >
          <AdminNaverMapSurface
            restaurants={visibleRestaurants}
            selectedRestaurant={selectedRestaurant}
            isLoading={isLoading}
            onSelectRestaurant={onSelectRestaurant}
          />

          {shouldShowMapStatusOverlay && (
            <div
              className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center sm:inset-x-auto sm:left-3 sm:justify-start"
              data-admin-map-status-overlay="non-blocking"
            >
              <div className="pointer-events-auto max-w-sm rounded-2xl border border-border bg-card/95 p-3 text-left shadow-lg backdrop-blur">
                <p className="text-sm font-bold text-foreground">
                  {hasError
                    ? "지도는 유지하고 실데이터만 재확인합니다"
                    : "표시할 좌표 맛집이 없습니다"}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {hasError
                    ? "요약 API가 실패하면 임의 수치를 만들지 않습니다. 네이버 지도 프레임은 유지한 채 맛집 관리에서 좌표 상태를 확인하세요."
                    : "운영 콘솔에서는 빈 실데이터 상태를 목업으로 대체하지 않습니다. 지도는 기본 위치로 유지하고 좌표가 있는 맛집만 표시합니다."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 rounded-xl"
                  onClick={() => onSelectModule("restaurants")}
                >
                  맛집 좌표 확인
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminMapInfoPanelSkeleton() {
  return (
    <aside
      className="flex min-h-0 flex-col gap-3 lg:h-full lg:overflow-hidden"
      data-admin-map-info-skeleton="true"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 지도 운영 정보 로딩"
    >
      <section className="shrink-0 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/70 p-2.5">
            <Skeleton className="h-3 w-20 rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-6 w-40 rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-3 h-4 w-full rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-4 w-4/5 rounded-full motion-reduce:animate-none" />
          </div>
          <div className="rounded-xl border border-border bg-background/70 p-2.5">
            <Skeleton className="aspect-video w-full rounded-lg motion-reduce:animate-none" />
          </div>
        </div>
      </section>
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-2.5">
        <Skeleton className="h-4 w-16 rounded-full motion-reduce:animate-none" />
        <Skeleton className="mt-2 h-7 w-20 rounded-full motion-reduce:animate-none" />
      </div>
      <section className="rounded-xl border border-border bg-card p-2.5 shadow-sm lg:min-h-0 lg:flex-1">
        <Skeleton className="h-5 w-24 rounded-full motion-reduce:animate-none" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-20 rounded-xl motion-reduce:animate-none"
            />
          ))}
        </div>
      </section>
    </aside>
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
  onSelectModule: (moduleId: AdminOverviewModuleId) => void;
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
  const selectedCoordinateText =
    selectedRestaurant?.lat == null || selectedRestaurant?.lng == null
      ? "좌표 확인 필요"
      : `${selectedRestaurant.lat.toFixed(5)}, ${selectedRestaurant.lng.toFixed(5)}`;

  if (isLoading && !selectedRestaurant) {
    return <AdminMapInfoPanelSkeleton />;
  }

  return (
    <aside className="flex min-h-0 flex-col gap-3 lg:h-full lg:overflow-hidden">
      <section
        className="shrink-0 rounded-xl border border-border bg-card p-2.5 shadow-sm"
        aria-labelledby="admin-map-selected-title"
      >
        {selectedRestaurant ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border bg-background/70 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold tracking-[0.12em] text-primary">
                      선택한 마커
                    </p>
                    <h2
                      id="admin-map-selected-title"
                      className="mt-0.5 truncate text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl"
                    >
                      {selectedRestaurant.name}
                    </h2>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 rounded-full",
                      hasError
                        ? "border-amber-700/30 text-amber-800"
                        : "border-emerald-700/20 text-emerald-800",
                    )}
                  >
                    {hasError ? "확인 필요" : "선택됨"}
                  </Badge>
                </div>

                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground sm:text-sm">
                  {selectedRestaurant.address ?? "주소 정보 확인 필요"}
                </p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className="max-w-full rounded-full border-primary/20 bg-primary/5 text-primary"
                  >
                    <span className="truncate">
                      {selectedRestaurant.category ?? "카테고리 확인"}
                    </span>
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full border-border bg-card text-muted-foreground"
                  >
                    {selectedRestaurant.status ?? "상태 확인"}
                  </Badge>
                </div>

                <dl className="mt-2 grid gap-1.5 text-xs">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-2 py-1.5">
                    <dt className="shrink-0 text-muted-foreground">좌표</dt>
                    <dd className="min-w-0 truncate font-mono text-[11px] font-bold text-foreground">
                      {selectedCoordinateText}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-2 py-1.5">
                    <dt className="shrink-0 text-muted-foreground">영상 ID</dt>
                    <dd className="min-w-0 truncate font-bold text-foreground">
                      {selectedRestaurant.videoId ?? "확인 필요"}
                    </dd>
                  </div>
                </dl>

                <div
                  className="mt-2 flex flex-wrap gap-1.5"
                  aria-label="선택 마커 작업"
                >
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-xs"
                    onClick={() => onSelectModule("restaurants")}
                  >
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
                    href={
                      selectedRestaurant.youtubeLink ?? selectedThumbnailUrl
                    }
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
                      <p className="min-w-0 truncate text-[11px] font-bold text-foreground">
                        연결 영상 썸네일
                      </p>
                      <span className="min-w-0 truncate font-mono text-[10px] font-semibold text-muted-foreground">
                        {selectedVideoId}
                      </span>
                    </div>
                  </a>
                ) : (
                  <div className="grid aspect-video place-items-center p-3 text-center">
                    <div>
                      <ImageIcon
                        className="mx-auto h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <p className="mt-2 text-xs font-bold text-foreground">
                        영상 연결 없음
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        YouTube 링크가 있으면 썸네일을 바로 보여줍니다.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.12em] text-primary">
                선택한 마커
              </p>
              <h2
                id="admin-map-selected-title"
                className="mt-0.5 truncate text-lg font-bold tracking-[-0.04em] text-foreground sm:text-xl"
              >
                마커를 선택하세요
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm">
                왼쪽 지도에서 마커를 누르면 맛집 상세, 영상 연결, 좌표 상태,
                동선 후보를 여기서 확인합니다.
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 rounded-full",
                hasError
                  ? "border-amber-700/30 text-amber-800"
                  : "border-emerald-700/20 text-emerald-800",
              )}
            >
              {hasError ? "확인 필요" : "대기"}
            </Badge>
          </div>
        )}
      </section>

      <AdminCreatorLayerControls tzuyangCount={restaurants.length} />

      <section
        className="rounded-xl border border-border bg-card p-2.5 shadow-sm lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        aria-labelledby="admin-map-info-title"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="admin-map-info-title"
            className="text-sm font-bold text-foreground"
          >
            운영 정보
          </h2>
          {isLoading && (
            <Skeleton
              className="h-5 w-20 rounded-full motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
          {[
            [
              "맛집",
              formatCount(stats.totalRestaurants, "곳"),
              coordinateRatio == null
                ? "좌표율 확인 필요"
                : `좌표율 ${coordinateRatio}%`,
            ],
            ["제보", formatCount(stats.pendingSubmissions, "건"), "승인 대기"],
            ["리뷰", formatCount(stats.pendingReviews, "건"), "미승인 큐"],
          ].map(([label, value, helper]) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                onSelectModule(
                  label === "맛집"
                    ? "restaurants"
                    : label === "제보"
                      ? "submissions"
                      : "reviews",
                )
              }
              className="rounded-xl border border-border bg-background/70 p-2.5 text-left transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
            </button>
          ))}
        </div>

        <Separator className="my-3" />

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-foreground">
              동선 추천 초안
            </h3>
            <Badge
              variant="outline"
              className="rounded-full border-primary/25 text-primary"
            >
              거리 기반 후보
            </Badge>
          </div>
          {routeCandidates.length > 0 ? (
            <ol className="mt-2 space-y-1.5">
              {routeCandidates.map((restaurant, index) => (
                <li
                  key={restaurant.id}
                  className="rounded-xl border border-border bg-background/70 p-2.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">
                        {restaurant.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {restaurant.address ?? "주소 미입력"} ·{" "}
                        {restaurant.category ?? "카테고리 확인"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
              추천 동선은 좌표가 있는 맛집이 2곳 이상 연결되면 표시합니다.
              데이터가 부족하면 임의 동선을 만들지 않습니다.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            실제 이동시간 API가 붙기 전까지는 선택 맛집과의 거리·같은 영상·같은
            카테고리 기반 후보만 표시합니다.
          </p>
        </div>

        <Separator className="my-3" />

        <div>
          <h3 className="text-sm font-bold text-foreground">최근 영상 연결</h3>
          <div className="mt-3 space-y-2">
            {latestVideos.length > 0 ? (
              latestVideos.map((video) => (
                <div
                  key={video.videoId}
                  className="rounded-xl border border-border bg-background/70 p-2.5"
                >
                  <p className="line-clamp-2 text-xs font-bold leading-5 text-foreground">
                    {video.title}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatShortDate(video.publishedAt)} ·{" "}
                    {formatCount(video.restaurantCount, "곳")}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
                최근 영상 요약은 승인 맛집과 연결된 데이터가 있을 때만
                표시합니다.
              </p>
            )}
          </div>
        </div>
      </section>
    </aside>
  );
}

export function AdminOverviewDashboard({
  stats,
  isLoading,
  hasError,
  onSelectModule,
}: {
  stats: AdminOverviewStats;
  isLoading: boolean;
  hasError: boolean;
  onSelectModule: (moduleId: AdminOverviewModuleId) => void;
}) {
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<
    string | null
  >(null);
  const mapRestaurantsQuery = useQuery({
    queryKey: ["admin-overview", "map-restaurants"],
    queryFn: fetchAdminMapRestaurants,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const realRestaurants = useMemo(
    () =>
      (mapRestaurantsQuery.data?.items ?? [])
        .map(toAdminMapRestaurant)
        .filter(hasAdminMapCoordinates),
    [mapRestaurantsQuery.data?.items],
  );
  const restaurants = realRestaurants;
  const selectedRestaurant =
    restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) ??
    restaurants[0] ??
    null;
  const isMapLoading = isLoading || mapRestaurantsQuery.isLoading;
  const hasMapError = hasError || mapRestaurantsQuery.isError;

  return (
    <div
      role="region"
      aria-label="관리자 지도 운영 개요 2분할"
      className="grid min-h-full grid-cols-1 gap-2 overflow-visible lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:overflow-hidden"
    >
      <div className="min-h-[390px] min-w-0 lg:min-h-0">
        <AdminMapOverviewCanvas
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          isLoading={isMapLoading}
          hasError={hasMapError}
          onSelectRestaurant={(restaurant) =>
            setSelectedRestaurantId(restaurant.id)
          }
          onSelectModule={onSelectModule}
        />
      </div>
      <div className="min-h-[420px] min-w-0 lg:min-h-0">
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
