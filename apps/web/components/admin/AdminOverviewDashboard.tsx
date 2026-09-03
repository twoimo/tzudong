"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  ADMIN_ROUTE_MODE_OPTIONS,
  assessAdminRouteReadiness,
  buildAdminRoutePlan,
  buildAdminRouteExportPackage,
  buildAdminRoutePlainTextExport,
  hasAdminRouteCoordinates,
  type AdminRouteMode,
  type AdminRoutePlan,
  type AdminRouteCandidateReadback,
  type AdminRouteDirectionsReadback,
} from "@/lib/admin-route-planner";
import { RISKY_WORK_STEPS } from "@/lib/admin/risky-work-procedure";
import {
  type AdminMapOverlaysResponse,
  type AdminRestaurantMapOverlay,
} from "@/lib/admin-map-overlays";
import { TrendProposalQueue } from "@/components/admin/TrendProposalQueue";
import type {
  DashboardRestaurantItem,
  DashboardRestaurantsResponse,
  DashboardSummaryResponse,
} from "@/types/dashboard";
import type { AdminProviderReadiness } from "@/types/admin-system-status";

const ADMIN_OVERVIEW_MAP_PAGE_SIZE = 500;
const ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM = 13;
const ADMIN_OVERVIEW_CLUSTER_RADIUS = 56;
const ADMIN_DIRECTIONS_MAX_POINTS = 7;
const ADMIN_ROUTE_STOP_LIMIT_OPTIONS = [3, 5, 7] as const;

const ADMIN_ROUTE_PLANNER_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  mode: AdminRouteMode;
  stopLimit: (typeof ADMIN_ROUTE_STOP_LIMIT_OPTIONS)[number];
}> = [
  {
    id: "efficient-driving",
    label: "차량 효율",
    description: "실제 도로 경로 우선 · 촬영 이동 시간을 줄입니다.",
    mode: "driving",
    stopLimit: 7,
  },
  {
    id: "walkable-shooting",
    label: "도보 촬영",
    description: "가까운 구간 중심 · 현장 B-roll을 많이 확보합니다.",
    mode: "walking",
    stopLimit: 5,
  },
  {
    id: "compact-mixed",
    label: "혼합 압축",
    description: "차량 이동과 도보 컷을 섞어 반나절 답사안으로 압축합니다.",
    mode: "mixed",
    stopLimit: 5,
  },
];

type AdminOverviewModuleId = "restaurants" | "submissions" | "reviews";

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

type AdminDirectionsPoint = {
  lat: number;
  lng: number;
};

type AdminDirectionsSummary = {
  distance?: number;
  duration?: number;
};

type AdminDirectionsRoute = {
  provider: "naver-directions5" | "local-heuristic";
  path: AdminDirectionsPoint[];
  summary: AdminDirectionsSummary | null;
  fallbackReasonCode?: string | null;
  message?: string | null;
  readiness?: AdminProviderReadiness;
  providerCache?: "hit" | "miss" | "bypass";
  directionsReadback?: AdminRouteDirectionsReadback;
};

type AdminRouteCandidatesResponse = {
  ok: true;
  items: AdminMapRestaurant[];
  candidateReadback: AdminRouteCandidateReadback;
  asOf: string;
};

type AdminRouteViewportBbox = [number, number, number, number];
type AdminDirectionsRouteError = Error & {
  readiness?: AdminProviderReadiness;
  responseMessage?: string | null;
  directionsReadback?: AdminRouteDirectionsReadback;
};

function createAdminDirectionsRouteError(
  fallbackMessage: string,
  readiness?: AdminProviderReadiness,
  directionsReadback?: AdminRouteDirectionsReadback,
): AdminDirectionsRouteError {
  const error = new Error("admin-directions-route-failed") as AdminDirectionsRouteError;
  error.readiness = readiness;
  error.responseMessage = fallbackMessage;
  error.directionsReadback = directionsReadback;
  return error;
}

function formatAdminDirectionsReadinessMessage(
  message: string | null | undefined,
  readiness: AdminProviderReadiness | null | undefined,
) {
  const parts = [
    message,
    readiness?.reasonCode ? `reason=${readiness.reasonCode}` : null,
    readiness?.remediation,
  ].filter(Boolean);
  return parts.join(" · ");
}

type AdminDirectionsStatus = "idle" | "loading" | "ready" | "fallback";

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

type AdminNaverOverlayInstance = {
  setMap: (map: AdminNaverMapInstance | null) => void;
};

type AdminNaverMarkerInstance = AdminNaverOverlayInstance;

type AdminNaverMapsApi = {
  Map: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => AdminNaverMapInstance;
  LatLng: new (lat: number, lng: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Marker: new (options: Record<string, unknown>) => AdminNaverMarkerInstance;
  Polyline?: new (
    options: Record<string, unknown>,
  ) => AdminNaverOverlayInstance;
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

function formatRouteDistance(distanceMeters: number | undefined) {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
    return null;
  }

  if (distanceMeters < 1000) {
    return `${adminNumberFormatter.format(Math.round(distanceMeters))}m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function formatRouteDuration(durationMs: number | undefined) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return null;
  }

  const minutes = Math.max(1, Math.round(durationMs / 1000 / 60));
  return `약 ${adminNumberFormatter.format(minutes)}분`;
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

async function fetchAdminMapOverlays(): Promise<AdminMapOverlaysResponse> {
  const response = await fetch("/api/admin/map-overlays?types=trend,seasonal", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("admin-map-overlays-failed");
  }

  return response.json() as Promise<AdminMapOverlaysResponse>;
}

async function fetchAdminRouteCandidates(
  anchorRestaurantId: string,
  limit: number,
  bbox?: AdminRouteViewportBbox | null,
): Promise<AdminRouteCandidatesResponse> {
  const params = new URLSearchParams({
    anchorRestaurantId,
    limit: String(limit),
  });
  if (bbox) params.set("bbox", bbox.join(","));
  const response = await fetch(`/api/admin/routes/candidates?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) throw new Error("admin-route-candidates-failed");
  return response.json() as Promise<AdminRouteCandidatesResponse>;
}

async function fetchAdminDirectionsRoute(
  points: AdminDirectionsPoint[],
  mode: AdminRouteMode,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/admin/routes/directions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ points, option: "trafast", mode }),
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => null) as AdminDirectionsRoute | null;

  if (!response.ok) {
    throw createAdminDirectionsRouteError(
      payload?.message ?? "네이버 Directions 응답을 사용할 수 없어 직선거리 기반 후보를 표시합니다.",
      payload?.readiness,
      payload?.directionsReadback,
    );
  }

  if (!payload) throw createAdminDirectionsRouteError("네이버 Directions 응답을 해석하지 못했습니다.");
  return payload;
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
  return hasAdminRouteCoordinates(restaurant);
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

function getAdminYoutubeThumbnailUrl(
  videoId: string | null,
  quality: "maxresdefault" | "hqdefault" = "maxresdefault",
) {
  return videoId
    ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`
    : null;
}

function getAdminYoutubeWatchUrl(videoId: string | null) {
  return videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
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
      sizes="(min-width: 1280px) 520px, (min-width: 640px) 100vw, 100vw"
      className="object-contain transition-opacity duration-200 group-hover:opacity-90 motion-reduce:transition-none"
      onError={() => setQuality("hqdefault")}
    />
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
  routeRestaurants,
  overlays,
  directionsPath,
  isLoading,
  onSelectRestaurant,
  onViewportBboxChange,
}: {
  restaurants: AdminMapRestaurant[];
  selectedRestaurant: AdminMapRestaurant | null;
  routeRestaurants: AdminMapRestaurant[];
  directionsPath: AdminDirectionsPoint[];
  overlays: AdminRestaurantMapOverlay[];
  isLoading: boolean;
  onSelectRestaurant: (restaurant: AdminMapRestaurant) => void;
  onViewportBboxChange?: (bbox: AdminRouteViewportBbox) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AdminNaverMapInstance | null>(null);
  const markerRefs = useRef<
    Array<{ marker: AdminNaverMarkerInstance; listener: unknown }>
  >([]);
  const routeOverlayRefs = useRef<AdminNaverOverlayInstance[]>([]);
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
  const overlayKindsByRestaurantId = useMemo(() => {
    const next = new Map<string, Array<AdminRestaurantMapOverlay["overlayType"]>>();
    overlays.forEach((overlay) => {
      const existing = next.get(overlay.restaurantId) ?? [];
      if (!existing.includes(overlay.overlayType)) {
        existing.push(overlay.overlayType);
      }
      next.set(overlay.restaurantId, existing);
    });
    return next;
  }, [overlays]);

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
  const routePathRestaurants = useMemo<
    Array<AdminMapRestaurant & { lat: number; lng: number }>
  >(() => {
    if (!selectedRestaurant || !hasAdminMapCoordinates(selectedRestaurant)) {
      return [];
    }

    const seen = new Set([selectedRestaurant.id]);
    const candidates = routeRestaurants.filter(
      (
        restaurant,
      ): restaurant is AdminMapRestaurant & { lat: number; lng: number } => {
        if (!hasAdminMapCoordinates(restaurant) || seen.has(restaurant.id)) {
          return false;
        }
        seen.add(restaurant.id);
        return true;
      },
    );

    return [selectedRestaurant, ...candidates];
  }, [routeRestaurants, selectedRestaurant]);
  const visualRoutePath = useMemo(
    () =>
      directionsPath.length >= 2
        ? directionsPath
        : routePathRestaurants.map(({ lat, lng }) => ({ lat, lng })),
    [directionsPath, routePathRestaurants],
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
    if (!mapRef.current || !onViewportBboxChange) return;
    onViewportBboxChange(getAdminMapBbox(mapRef.current));
  }, [onViewportBboxChange, viewportVersion]);

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
      routeOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
      routeOverlayRefs.current = [];
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
        overlayKindsByRestaurantId.get(restaurant.id) ?? [],
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
    overlayKindsByRestaurantId,
    restaurantById,
    selectedRestaurant?.id,
    visibleRestaurants,
    viewportVersion,
  ]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const maps = getAdminNaverMaps();
    const map = mapRef.current;
    if (!maps) return;

    routeOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
    routeOverlayRefs.current = [];

    if (routePathRestaurants.length < 2 || visualRoutePath.length < 2) return;

    const path = visualRoutePath.map(
      (point) => new maps.LatLng(point.lat, point.lng),
    );

    if (maps.Polyline) {
      routeOverlayRefs.current.push(
        new maps.Polyline({
          map,
          path,
          strokeColor: "#dc2626",
          strokeOpacity: directionsPath.length >= 2 ? 0.92 : 0.68,
          strokeWeight: directionsPath.length >= 2 ? 5 : 4,
          strokeStyle: "solid",
          zIndex: 260,
        }),
      );
    }

    routePathRestaurants.forEach((restaurant, index) => {
      const isStart = index === 0;
      const marker = new maps.Marker({
        map,
        position: new maps.LatLng(restaurant.lat, restaurant.lng),
        title: `${index + 1}. ${restaurant.name}`,
        zIndex: isStart ? 285 : 275,
        icon: {
          content: `<div style="display:flex;height:26px;width:26px;align-items:center;justify-content:center;border-radius:9999px;border:2px solid #fff;background:${isStart ? "#dc2626" : "#111827"};color:#fff;font-size:12px;font-weight:800;box-shadow:0 8px 18px rgba(0,0,0,.28);">${index + 1}</div>`,
          anchor: new maps.Point(13, 13),
        },
      });
      routeOverlayRefs.current.push(marker);
    });

    return () => {
      routeOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
      routeOverlayRefs.current = [];
    };
  }, [directionsPath.length, isLoaded, routePathRestaurants, visualRoutePath]);

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
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-[24px] bg-muted/25">
      <div
        ref={mapContainerRef}
        className="h-full min-h-[360px] w-full"
        aria-label="네이버 지도 맛집 마커와 클러스터"
      />

      {isMapPreparing && <AdminMapLoadingSkeleton />}

      {loadError && !isMapPreparing && (
        <div className="absolute inset-0 grid place-items-center bg-card/85 p-4 text-center backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl bg-card/95 p-4 shadow-sm">
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
  routeCandidates,
  directionsRoute,
  overlays,
  showAdminMapOverlays,
  isOverlayLoading,
  hasOverlayError,
  isLoading,
  hasError,
  onSelectRestaurant,
  onSelectModule,
  onToggleAdminMapOverlays,
  onViewportBboxChange,
}: {
  restaurants: AdminMapRestaurant[];
  selectedRestaurant: AdminMapRestaurant | null;
  routeCandidates: AdminMapRestaurant[];
  directionsRoute: AdminDirectionsRoute | null;
  overlays: AdminRestaurantMapOverlay[];
  showAdminMapOverlays: boolean;
  isOverlayLoading: boolean;
  hasOverlayError: boolean;
  isLoading: boolean;
  hasError: boolean;
  onSelectRestaurant: (restaurant: AdminMapRestaurant) => void;
  onSelectModule: (moduleId: AdminOverviewModuleId) => void;
  onToggleAdminMapOverlays: () => void;
  onViewportBboxChange?: (bbox: AdminRouteViewportBbox) => void;
}) {
  const visibleRestaurants = useMemo(
    () => restaurants.filter(hasAdminMapCoordinates),
    [restaurants],
  );
  const shouldShowMapStatusOverlay =
    hasError || (!isLoading && visibleRestaurants.length === 0);
  return (
    <section
      aria-label="관리자 지도 운영"
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-card/80 shadow-sm md:rounded-2xl"
    >
      <div className="min-h-0 flex-1 overflow-hidden p-1.5 sm:p-3">
        <div
          className="relative h-full min-h-[320px] md:min-h-[360px]"
          data-admin-overview-map-canvas="true"
        >
          <AdminNaverMapSurface
            restaurants={visibleRestaurants}
            selectedRestaurant={selectedRestaurant}
            routeRestaurants={routeCandidates}
            overlays={showAdminMapOverlays ? overlays : []}
            directionsPath={directionsRoute?.path ?? []}
            isLoading={isLoading}
            onSelectRestaurant={onSelectRestaurant}
            onViewportBboxChange={onViewportBboxChange}
          />

          <div className="absolute left-2 right-2 top-2 z-20 flex flex-wrap items-center gap-1.5 sm:left-3 sm:right-auto sm:top-3 sm:gap-2">
            <Button
              type="button"
              size="sm"
              variant={showAdminMapOverlays ? "default" : "secondary"}
              className="h-8 rounded-full px-2.5 text-xs shadow-lg backdrop-blur sm:h-9 sm:text-sm"
              aria-pressed={showAdminMapOverlays}
              data-admin-map-overlay-toggle="true"
              onClick={onToggleAdminMapOverlays}
            >
              <Layers3 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              관리자 오버레이
              {showAdminMapOverlays && overlays.length > 0 ? (
                <Badge variant="secondary" className="ml-1 rounded-full px-1.5">
                  {overlays.length}
                </Badge>
              ) : null}
            </Button>
            {showAdminMapOverlays && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur sm:px-2.5 sm:py-1 sm:text-[11px]",
                  hasOverlayError
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border/70 bg-card/90 text-muted-foreground"
                )}
                data-admin-map-overlay-status="true"
              >
                {hasOverlayError
                  ? "오버레이를 불러오지 못했습니다"
                  : isOverlayLoading
                    ? "오버레이 확인 중"
                    : overlays.length > 0
                      ? "트렌드·제철 표시 중"
                      : "등록된 활성 오버레이 없음"}
              </span>
            )}
          </div>

          {shouldShowMapStatusOverlay && (
            <div
              className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center sm:inset-x-auto sm:left-3 sm:justify-start"
              data-admin-map-status-overlay="non-blocking"
            >
              <div className="pointer-events-auto max-w-sm rounded-2xl bg-card/95 p-3 text-left shadow-lg backdrop-blur">
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
      className="flex min-h-0 min-w-0 flex-col gap-2 lg:h-full lg:overflow-hidden"
      data-admin-map-info-skeleton="true"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 지도 동선 추천 로딩"
    >
      <section className="shrink-0 rounded-xl bg-card/80 p-2 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-background/70 p-2">
            <Skeleton className="h-3 w-20 rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-6 w-40 rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-3 h-4 w-full rounded-full motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-4 w-4/5 rounded-full motion-reduce:animate-none" />
          </div>
          <div className="rounded-xl bg-background/70 p-2">
            <Skeleton className="aspect-video w-full rounded-lg motion-reduce:animate-none" />
          </div>
        </div>
      </section>
      <section className="rounded-xl bg-card/80 p-2.5 shadow-sm lg:min-h-0 lg:flex-1">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-28 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-20 rounded-full motion-reduce:animate-none" />
        </div>
        <div className="mt-3 space-y-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-[4.75rem] rounded-xl motion-reduce:animate-none"
            />
          ))}
        </div>
      </section>
    </aside>
  );
}

function AdminMapInfoPanel({
  selectedRestaurant,
  routePlan,
  routeMode,
  directionsRoute,
  routeCandidateReadback,
  directionsStatus,
  directionsFallbackMessage,
  isLoading,
  hasError,
  coordinateRestaurantCount,
  routeStopLimit,
  onRouteModeChange,
  onRouteStopLimitChange,
}: {
  selectedRestaurant: AdminMapRestaurant | null;
  routePlan: AdminRoutePlan;
  routeMode: AdminRouteMode;
  directionsRoute: AdminDirectionsRoute | null;
  routeCandidateReadback: AdminRouteCandidateReadback;
  directionsStatus: AdminDirectionsStatus;
  directionsFallbackMessage: string | null;
  isLoading: boolean;
  hasError: boolean;
  coordinateRestaurantCount: number;
  routeStopLimit: number;
  onRouteModeChange: (mode: AdminRouteMode) => void;
  onRouteStopLimitChange: (limit: number) => void;
}) {
  const selectedVideoId = selectedRestaurant?.videoId ?? null;
  const selectedThumbnailUrl = getAdminYoutubeThumbnailUrl(selectedVideoId);
  const selectedYoutubeUrl = getAdminYoutubeWatchUrl(selectedVideoId);
  const selectedCoordinateText =
    selectedRestaurant?.lat == null || selectedRestaurant?.lng == null
      ? "좌표 확인 필요"
      : `${selectedRestaurant.lat.toFixed(5)}, ${selectedRestaurant.lng.toFixed(5)}`;
  const routeDistanceText = formatRouteDistance(
    directionsRoute?.summary?.distance,
  );
  const routeDurationText = formatRouteDuration(
    directionsRoute?.summary?.duration,
  );
  const routeStops = routePlan.stops;
  const routeAhpAssessment = assessAdminRouteReadiness({
    mode: routeMode,
    hasRoadRoute: directionsStatus === "ready",
    routePlan,
  });
  const routeModeOption = ADMIN_ROUTE_MODE_OPTIONS.find(
    (option) => option.id === routeMode,
  );
  const routeStatusLabel =
    directionsStatus === "ready"
      ? "실제 도로 경로"
      : directionsStatus === "loading"
        ? "경로 계산 중"
        : directionsStatus === "fallback" && directionsFallbackMessage
          ? "Directions 사용 불가"
          : routeMode === "driving"
            ? "거리 기반 후보"
            : "촬영 초안";
  const routeSummaryText =
    directionsStatus === "ready" &&
    [routeDistanceText, routeDurationText].filter(Boolean).length > 0
      ? [routeDistanceText, routeDurationText].filter(Boolean).join(" · ")
      : routeStops.length >= 2
        ? `${routePlan.summary.totalDistanceKm.toFixed(1)}km · 약 ${adminNumberFormatter.format(routePlan.summary.estimatedMinutes)}분 · ${routeStops.length}곳`
        : "";
  const routeDirectionsReadback = useMemo<AdminRouteDirectionsReadback>(
    () =>
      directionsRoute?.directionsReadback ?? {
        provider: directionsStatus === "ready" ? "naver-directions5" : "local-heuristic",
        providerCache: directionsRoute?.providerCache ?? "bypass",
        fallbackReasonCode: directionsRoute?.fallbackReasonCode ?? null,
      },
    [
      directionsRoute?.directionsReadback,
      directionsRoute?.fallbackReasonCode,
      directionsRoute?.providerCache,
      directionsStatus,
    ],
  );
  const routeExportPackage = useMemo(
    () =>
      buildAdminRouteExportPackage({
        routePlan,
        candidateReadback: routeCandidateReadback,
        directionsReadback: routeDirectionsReadback,
      }),
    [routeCandidateReadback, routeDirectionsReadback, routePlan],
  );
  const routePlainTextExport = useMemo(
    () => buildAdminRoutePlainTextExport(routeExportPackage),
    [routeExportPackage],
  );
  const routeJsonExport = useMemo(
    () => JSON.stringify(routeExportPackage, null, 2),
    [routeExportPackage],
  );

  if (isLoading && !selectedRestaurant) {
    return <AdminMapInfoPanelSkeleton />;
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <section
        className="shrink-0 rounded-lg bg-card/80 p-2 shadow-sm md:rounded-xl"
        aria-labelledby="admin-map-selected-title"
      >
        {selectedRestaurant ? (
          <div className="overflow-hidden rounded-lg bg-background/70 md:rounded-xl">
            <a
              href={selectedYoutubeUrl ?? undefined}
              target={selectedYoutubeUrl ? "_blank" : undefined}
              rel={selectedYoutubeUrl ? "noopener noreferrer" : undefined}
              aria-label={
                selectedYoutubeUrl
                  ? `${selectedRestaurant.name} 원본 YouTube 영상 새 탭에서 열기`
                  : `${selectedRestaurant.name} 영상 연결 없음`
              }
              className={cn(
                "group relative block aspect-video overflow-hidden bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                !selectedYoutubeUrl && "pointer-events-none",
              )}
            >
              {selectedVideoId && selectedThumbnailUrl ? (
                <AdminYoutubeThumbnailImage
                  key={selectedVideoId}
                  restaurantName={selectedRestaurant.name}
                  videoId={selectedVideoId}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center p-4 text-center">
                  <div>
                    <ImageIcon
                      className="mx-auto h-6 w-6 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-xs font-bold text-foreground">
                      영상 연결 없음
                    </p>
                  </div>
                </div>
              )}

              <Badge
                variant="outline"
                className={cn(
                  "absolute right-2.5 top-2.5 rounded-full border-white/30 bg-white/15 text-white shadow-sm backdrop-blur",
                  hasError && "border-amber-200/50 text-amber-100",
                )}
              >
                {hasError ? "확인 필요" : "선택됨"}
              </Badge>

              <div className="absolute inset-x-0 bottom-0 bg-black/75 p-2.5 text-white">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-[0.14em] text-white/75">
                    선택한 마커
                  </p>
                  <h2
                    id="admin-map-selected-title"
                    className="mt-0.5 break-words text-xl font-bold tracking-[-0.04em] [overflow-wrap:anywhere]"
                  >
                    {selectedRestaurant.name}
                  </h2>
                </div>

                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-white/80">
                  {selectedRestaurant.address ?? "주소 정보 확인 필요"}
                </p>

                <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-semibold">
                  <span className="max-w-full break-words rounded-full bg-white/15 px-2 py-0.5 text-white backdrop-blur [overflow-wrap:anywhere]">
                    {selectedRestaurant.category ?? "카테고리 확인"}
                  </span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-white/85 backdrop-blur">
                    {selectedRestaurant.status ?? "상태 확인"}
                  </span>
                  <span className="rounded-full bg-black/35 px-2 py-0.5 font-mono text-white/85 backdrop-blur">
                    {selectedCoordinateText}
                  </span>
                  <span className="max-w-full break-all rounded-full bg-black/35 px-2 py-0.5 font-mono text-white/85 backdrop-blur">
                    {selectedRestaurant.videoId ?? "영상 ID 확인"}
                  </span>
                </div>
              </div>
            </a>
          </div>
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
                촬영 동선 후보를 여기서 확인합니다.
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

      <section
        className="scrollbar-hide min-w-0 rounded-lg bg-card/80 p-2 shadow-sm md:rounded-xl lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:scroll-pb-3"
        aria-label="동선 추천 초안"
        data-layout-primitives="panel-layout list-detail step-nav cluster frame"
        data-scroll-owner="route-control-pane"
        data-admin-route-planner="true"
        data-admin-route-recommendation-panel="enhanced"
        data-admin-route-candidate-readback="server-readback"
        data-admin-route-export="tzudong-json-v1"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground">
            촬영 동선
          </p>
          {isLoading ? (
            <Skeleton
              className="h-5 w-20 rounded-full motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Badge
              variant="outline"
              className="rounded-full border-primary/25 text-primary"
            >
              {routeStatusLabel}
            </Badge>
          )}
        </div>

        <div
          className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-background/70 p-1"
          data-admin-route-mode-controls="driving-walking-mixed"
          aria-label="동선 이동수단 선택"
        >
          {ADMIN_ROUTE_MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                routeMode === option.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-pressed={routeMode === option.id}
              onClick={() => onRouteModeChange(option.id)}
            >
              {option.shortLabel}
            </button>
          ))}
        </div>

        <div
          className="mt-1.5 grid gap-1.5"
          data-admin-route-planner-presets="true"
        >
          {ADMIN_ROUTE_PLANNER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={cn(
                "rounded-xl bg-background/70 p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                routeMode === preset.mode && routeStopLimit === preset.stopLimit
                  ? "bg-primary/5 shadow-sm ring-1 ring-primary/20"
                  : "hover:bg-muted/60",
              )}
              onClick={() => {
                onRouteModeChange(preset.mode);
                onRouteStopLimitChange(preset.stopLimit);
              }}
            >
              <span className="block text-xs font-bold text-foreground">
                {preset.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {preset.description}
              </span>
            </button>
          ))}
        </div>

        <div
          className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-background/70 p-1"
          data-admin-route-stop-limit-controls="true"
          aria-label="동선 방문 지점 수 선택"
        >
          {ADMIN_ROUTE_STOP_LIMIT_OPTIONS.map((limit) => (
            <button
              key={limit}
              type="button"
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                routeStopLimit === limit
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-pressed={routeStopLimit === limit}
              onClick={() => onRouteStopLimitChange(limit)}
            >
              {limit}곳
            </button>
          ))}
        </div>

        {routeSummaryText && (
          <p className="mt-2 text-xs font-semibold text-primary">
            {routeSummaryText}
          </p>
        )}

        <div
          className="mt-1.5 rounded-xl bg-primary/5 p-1.5"
          data-admin-route-readiness-panel="local-heuristic"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold tracking-[0.12em] text-primary">
              동선 준비도
            </p>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full",
                routeAhpAssessment.score >= 98
                  ? "border-emerald-700/25 text-emerald-800"
                  : "border-amber-700/25 text-amber-800",
              )}
            >
              {routeAhpAssessment.score.toFixed(1)}점 후보
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            로컬 후보 품질, 도로 경로 확보, 좌표 데이터 충분성 기준의
            준비도입니다.
            {routeModeOption
              ? ` 현재 모드: ${routeModeOption.description}`
              : null}
          </p>
          {routeAhpAssessment.blockers.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-muted-foreground">
              {routeAhpAssessment.blockers.map((blocker) => (
                <li key={blocker}>• {blocker}</li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-xl bg-background/70 p-1.5 text-[11px] text-muted-foreground"
          data-admin-route-quality-panel="true"
        >
          <div>
            <p className="font-bold text-foreground">좌표 맛집</p>
            <p>{adminNumberFormatter.format(coordinateRestaurantCount)}곳</p>
          </div>
          <div>
            <p className="font-bold text-foreground">추천 지점</p>
            <p>{routeStops.length}/{routeStopLimit}곳</p>
          </div>
          <div>
            <p className="font-bold text-foreground">이동수단</p>
            <p>{routeModeOption?.label ?? routeMode}</p>
          </div>
          <div>
            <p className="font-bold text-foreground">도로 경로</p>
            <p>{directionsStatus === "ready" ? "확보" : "로컬 후보"}</p>
          </div>
          <div>
            <p className="font-bold text-foreground">후보 출처</p>
            <p>{routeCandidateReadback.candidateSource}</p>
          </div>
          <div>
            <p className="font-bold text-foreground">후보 readback</p>
            <p>
              {routeCandidateReadback.candidateReturned}/
              {routeCandidateReadback.candidateTotal}
              {routeCandidateReadback.truncated ? " · truncated" : ""}
            </p>
          </div>
        </div>

        {directionsStatus === "fallback" && directionsFallbackMessage ? (
          <div
            className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/80 p-2 text-[11px] leading-4 text-amber-900"
            data-admin-directions-unavailable="true"
            role="status"
          >
            <p className="font-bold">도로 경로 대신 로컬 후보를 표시합니다.</p>
            <p className="mt-0.5">{directionsFallbackMessage}</p>
          </div>
        ) : null}

        {routePlan.warnings.length > 0 ? (
          <div
            className="mt-1.5 rounded-xl bg-amber-50 p-1.5 text-[11px] leading-4 text-amber-900"
            data-admin-route-warning-list="true"
          >
            <p className="font-bold">동선 주의사항</p>
            <ul className="mt-1 space-y-0.5">
              {routePlan.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          {routeStops.length > 1 ? (
            <ol
              className="mt-1.5 space-y-1"
              data-admin-route-stop-list="ordered-shooting-plan"
            >
              {routeStops.map((restaurant, index) => (
                <li
                  key={restaurant.id}
                  className="rounded-xl bg-background/70 p-2"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-bold text-foreground [overflow-wrap:anywhere]">
                        {restaurant.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                        {restaurant.address ?? "주소 미입력"} ·{" "}
                        {restaurant.category ?? "카테고리 확인"}
                      </p>
                      {index > 0 && routePlan.legs[index - 1] && (
                        <p className="mt-0.5 text-[11px] font-semibold text-primary">
                          이전 지점에서{" "}
                          {routePlan.legs[index - 1].distanceKm.toFixed(1)}km ·
                          약{" "}
                          {adminNumberFormatter.format(
                            routePlan.legs[index - 1].estimatedMinutes,
                          )}
                          분
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 rounded-2xl bg-muted/25 p-2.5 text-xs leading-5 text-muted-foreground">
              추천 동선은 좌표가 있는 맛집이 2곳 이상 연결되면 표시합니다.
              데이터가 부족하면 임의 동선을 만들지 않습니다.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {directionsStatus === "ready"
              ? "네이버 Directions 5 기준 실제 도로 주행 경로를 지도에 표시합니다."
              : routeMode === "driving"
                ? "도로 경로 계산 전이나 실패 시에는 같은 영상·카테고리·직선거리 기반 후보를 먼저 표시합니다."
                : "네이버 Directions 5는 자동차만 지원하므로 도보·혼합은 근거리 촬영 초안으로 표시합니다."}
          </p>
          <div
            className="mt-2 rounded-xl bg-background/70 p-2 text-[11px] leading-4 text-muted-foreground"
            data-admin-route-export="tzudong-json-v1"
            data-admin-route-provider-cache={routeDirectionsReadback.providerCache}
            data-admin-route-candidate-source={routeCandidateReadback.candidateSource}
          >
            <p className="font-bold text-foreground">Tzudong JSON/plain-text 내보내기</p>
            <p className="mt-0.5">
              후보 readback과 Directions providerCache를 포함해 재현 가능한 동선
              패키지로 복사할 수 있습니다.
            </p>
            <pre className="mt-1 break-words whitespace-pre-wrap rounded-lg bg-muted/30 p-1.5 [overflow-wrap:anywhere]">
              {routePlainTextExport}
            </pre>
            <script
              type="application/json"
              data-admin-route-export-json="true"
              dangerouslySetInnerHTML={{ __html: routeJsonExport.replace(/</g, "\\u003c") }}
            />
          </div>
          <div className="mt-2 border-t border-border/70 pt-2">
            <TrendProposalQueue />
          </div>
        </div>
      </section>
    </aside>
  );
}

export function AdminOverviewDashboard({
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
  const [directionsRoute, setDirectionsRoute] =
    useState<AdminDirectionsRoute | null>(null);
  const [directionsStatus, setDirectionsStatus] =
    useState<AdminDirectionsStatus>("idle");
  const [directionsFallbackMessage, setDirectionsFallbackMessage] = useState<string | null>(null);
  const [showAdminMapOverlays, setShowAdminMapOverlays] = useState(false);
  const [routeMode, setRouteMode] = useState<AdminRouteMode>("driving");
  const [routeStopLimit, setRouteStopLimit] = useState<number>(
    ADMIN_DIRECTIONS_MAX_POINTS,
  );
  const [routeViewportBbox, setRouteViewportBbox] =
    useState<AdminRouteViewportBbox | null>(null);
  const handleRouteViewportBboxChange = useCallback((bbox: AdminRouteViewportBbox) => {
    const normalized = bbox.map((value) => Number(value.toFixed(6))) as AdminRouteViewportBbox;
    setRouteViewportBbox((current) =>
      current && current.every((value, index) => value === normalized[index])
        ? current
        : normalized,
    );
  }, []);
  const [debouncedRouteViewportBbox, setDebouncedRouteViewportBbox] =
    useState<AdminRouteViewportBbox | null>(null);

  useEffect(() => {
    if (!routeViewportBbox) {
      setDebouncedRouteViewportBbox(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedRouteViewportBbox(routeViewportBbox);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [routeViewportBbox]);
  const mapRestaurantsQuery = useQuery({
    queryKey: ["admin-overview", "map-restaurants"],
    queryFn: fetchAdminMapRestaurants,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const adminMapOverlaysQuery = useQuery({
    queryKey: ["admin-overview", "map-overlays"],
    queryFn: fetchAdminMapOverlays,
    enabled: showAdminMapOverlays,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });


  const realRestaurants = useMemo(
    () =>
      (mapRestaurantsQuery.data?.items ?? [])
        .map(toAdminMapRestaurant)
        .filter(hasAdminMapCoordinates),
    [mapRestaurantsQuery.data?.items],
  );
  const adminMapOverlays = showAdminMapOverlays
    ? adminMapOverlaysQuery.data?.overlays ?? []
    : [];

  const selectedRestaurant =
    realRestaurants.find(
      (restaurant) => restaurant.id === selectedRestaurantId,
    ) ??
    realRestaurants[0] ??
    null;
  const routeCandidatesQuery = useQuery({
    queryKey: [
      "admin-overview",
      "route-candidates",
      selectedRestaurant?.id,
      routeStopLimit,
      debouncedRouteViewportBbox?.join(",") ?? "waiting-bbox",
    ],
    queryFn: () =>
      fetchAdminRouteCandidates(selectedRestaurant!.id, routeStopLimit, debouncedRouteViewportBbox),
    enabled: Boolean(selectedRestaurant?.id && debouncedRouteViewportBbox),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const routeSourceRestaurants = useMemo(
    () =>
      (routeCandidatesQuery.data?.items ?? realRestaurants)
        .map((restaurant): AdminMapRestaurant => ({
          ...restaurant,
          categories: restaurant.categories ?? (restaurant.category ? [restaurant.category] : []),
          youtubeLink: restaurant.youtubeLink ?? null,
          videoId: restaurant.videoId ?? null,
          sourceType: restaurant.sourceType ?? null,
          status: restaurant.status ?? null,
          isMock: restaurant.isMock ?? false,
        }))
        .filter(hasAdminMapCoordinates),
    [realRestaurants, routeCandidatesQuery.data?.items],
  );
  const routeCandidateReadback: AdminRouteCandidateReadback =
    routeCandidatesQuery.data?.candidateReadback ?? {
      candidateTotal: realRestaurants.length,
      candidateReturned: Math.min(realRestaurants.length, routeStopLimit),
      candidateLimit: routeStopLimit,
      truncated: realRestaurants.length > routeStopLimit,
      candidateSource: "k-nearest",
      excludedNoCoordinateCount: 0,
      selectedAnchorIncluded: Boolean(selectedRestaurant),
      exclusions: [],
    };
  const routePlan = useMemo(
    () =>
      buildAdminRoutePlan({
        selectedRestaurant,
        restaurants: routeSourceRestaurants,
        mode: routeMode,
        maxStops: routeStopLimit,
      }),
    [routeMode, routeSourceRestaurants, routeStopLimit, selectedRestaurant],
  );
  const restaurantById = useMemo(
    () =>
      new Map<string, AdminMapRestaurant & { lat: number; lng: number }>(
        routeSourceRestaurants.map((restaurant) => [restaurant.id, restaurant]),
      ),
    [routeSourceRestaurants],
  );
  const routeStops = useMemo<
    Array<AdminMapRestaurant & { lat: number; lng: number }>
  >(
    () =>
      routePlan.stops.flatMap((restaurant) => {
        const matchedRestaurant = restaurantById.get(restaurant.id);
        return matchedRestaurant ? [matchedRestaurant] : [];
      }),
    [restaurantById, routePlan.stops],
  );
  const routeCandidates = routeStops.slice(1);
  const routeRequestPoints = useMemo<AdminDirectionsPoint[]>(() => {
    if (!selectedRestaurant || !hasAdminMapCoordinates(selectedRestaurant)) {
      return [];
    }

    return routeStops
      .slice(0, ADMIN_DIRECTIONS_MAX_POINTS)
      .map(({ lat, lng }) => ({ lat, lng }));
  }, [routeStops, selectedRestaurant]);
  const routeRequestKey = useMemo(
    () =>
      routeRequestPoints
        .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
        .join("|"),
    [routeRequestPoints],
  );
  const isMapLoading = isLoading || mapRestaurantsQuery.isLoading;
  const hasMapError = hasError || mapRestaurantsQuery.isError;

  useEffect(() => {
    if (routeMode !== "driving" || routeRequestPoints.length < 2) {
      setDirectionsRoute(null);
      setDirectionsStatus("idle");
      setDirectionsFallbackMessage(null);
      return;
    }

    const controller = new AbortController();
    setDirectionsStatus("loading");
    setDirectionsFallbackMessage(null);

    const timer = window.setTimeout(() => {
      fetchAdminDirectionsRoute(routeRequestPoints, routeMode, controller.signal)
        .then((route) => {
          if (controller.signal.aborted) return;
          const hasRoadRoute =
            route.provider === "naver-directions5" && route.path.length >= 2;
          setDirectionsRoute(route);
          setDirectionsStatus(hasRoadRoute ? "ready" : "fallback");
          setDirectionsFallbackMessage(
            hasRoadRoute
              ? null
              : formatAdminDirectionsReadinessMessage(
                  route.message ?? "네이버 Directions 응답을 사용할 수 없어 직선거리 기반 후보를 표시합니다.",
                  route.readiness,
                ),
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          const routeError = error as AdminDirectionsRouteError;
          console.warn("[Admin Directions] Falling back to route candidates", {
            reasonCode: routeError.readiness?.reasonCode ?? "admin-directions-route-failed",
          });
          setDirectionsRoute(
            routeError.directionsReadback
              ? {
                  provider: "local-heuristic",
                  path: [],
                  summary: null,
                  fallbackReasonCode: routeError.directionsReadback.fallbackReasonCode ?? null,
                  message: routeError.responseMessage,
                  readiness: routeError.readiness,
                  providerCache: routeError.directionsReadback.providerCache,
                  directionsReadback: routeError.directionsReadback,
                }
              : null,
          );
          setDirectionsStatus("fallback");
          setDirectionsFallbackMessage(
            formatAdminDirectionsReadinessMessage(
              routeError.responseMessage ?? "네이버 Directions 요청 실패로 직선거리 기반 후보를 표시합니다.",
              routeError.readiness,
            ),
          );
        });
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [routeMode, routeRequestKey, routeRequestPoints]);

  return (
    <div
      role="region"
      aria-label="관리자 지도 운영 개요 2분할"
      className="grid h-full min-h-0 min-w-0 grid-cols-1 gap-2 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:overflow-hidden"
      data-layout-primitives="panel-layout list-detail frame cluster"
      data-scroll-owner="admin-overview-canvas"
      data-admin-overview-layout="two-pane"
      data-admin-risky-work-steps={RISKY_WORK_STEPS.join(" ")}
    >
      <div
        className="h-[340px] min-w-0 sm:h-[390px] overflow-visible lg:h-full lg:min-h-0"
        data-admin-map-pane="true"
        data-scroll-owner="map-canvas-none"
      >
        <AdminMapOverviewCanvas
          restaurants={realRestaurants}
          selectedRestaurant={selectedRestaurant}
          routeCandidates={routeCandidates}
          directionsRoute={directionsRoute}
          overlays={adminMapOverlays}
          showAdminMapOverlays={showAdminMapOverlays}
          isOverlayLoading={adminMapOverlaysQuery.isFetching}
          hasOverlayError={adminMapOverlaysQuery.isError}
          isLoading={isMapLoading}
          hasError={hasMapError}
          onSelectRestaurant={(restaurant) =>
            setSelectedRestaurantId(restaurant.id)
          }
          onSelectModule={onSelectModule}
          onToggleAdminMapOverlays={() =>
            setShowAdminMapOverlays((current) => !current)
          }
          onViewportBboxChange={handleRouteViewportBboxChange}
        />
      </div>
      <div
        className="min-h-0 min-w-0 lg:h-full"
        data-admin-info-pane="true"
        data-scroll-owner="admin-overview-info-pane"
      >
        <AdminMapInfoPanel
          selectedRestaurant={selectedRestaurant}
          routePlan={routePlan}
          routeMode={routeMode}
          directionsRoute={directionsRoute}
          routeCandidateReadback={routeCandidateReadback}
          directionsFallbackMessage={directionsFallbackMessage}
            directionsStatus={directionsStatus}
            isLoading={isMapLoading}
            hasError={hasMapError}
            coordinateRestaurantCount={realRestaurants.length}
            routeStopLimit={routeStopLimit}
            onRouteModeChange={setRouteMode}
            onRouteStopLimitChange={setRouteStopLimit}
          />
      </div>
    </div>
  );
}
