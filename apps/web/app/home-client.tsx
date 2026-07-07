"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Maximize2, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContextBase";
import { useLayout } from "@/contexts/LayoutContext";
import { useHomeViewportMode } from "@/hooks/useHomeViewportMode";
import { toast } from "@/lib/no-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { requestAuthUi } from "@/lib/auth-ui-events";
import { buildBrowserTitle } from "@/lib/seo";
import {
  DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT,
  shouldExpandDesktopLeftPanelForRoute,
} from "@/lib/desktop-left-panel-entry";
import {
  DEFAULT_HOME_MAP_USER_PREFERENCES,
  HOME_MAP_USER_PREFERENCES_EVENT,
  readLastHomeMapUserPreferences,
  readHomeMapUserPreferences,
  type HomeMapLayoutMode,
  type HomeMapPanelSide,
  type HomeMapUserPreferencesEvent,
} from "@/lib/home-map-user-preferences";
import type { Restaurant } from "@/types/restaurant";
import {
  resolveDeviceOrientationHeading,
  resolveGeolocationHeading,
  resolveDeviceLocationStateUpdatePlan,
  type DeviceMapLocation,
} from "@/lib/device-location-map";
import type { HomeMapContextualRestaurantsPayload } from "@/lib/home-map-contextual-restaurants";
import {
  buildHomeDetailState,
  buildHomeDetailUrl,
  resolveHomeDetailRestaurantParam,
  buildHomeListState,
  createHomeRestoreKey,
  dispatchHomeRestoreEvent,
  isHomeDetailHistoryState,
  isHomeListHistoryState,
  readHomeRestoreSnapshot,
  writeHomeRestoreSnapshot,
  type HomeMapMode,
  type HomeRestoreCompactRestaurant,
  type HomeRestoreSnapshotV1,
} from "@/lib/home-detail-route-state";

function HomeMapContainerPendingShell() {
  return (
    <section
      aria-hidden="true"
      className="relative flex-1 overflow-hidden bg-background"
    />
  );
}

function HomeMapUserMenuPendingShell() {
  return (
    <div aria-hidden="true" data-desktop-map-user-menu-pending="true">
      <span
        data-desktop-map-fullscreen-toggle="true"
        className="fixed right-20 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/95 p-0 text-foreground shadow-lg backdrop-blur-sm"
      >
        <Maximize2 className="h-4 w-4" />
      </span>
      <span
        data-desktop-map-user-menu="true"
        className="fixed right-6 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm"
      >
        <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary">
          <UserRound className="h-4 w-4" />
        </span>
      </span>
    </div>
  );
}

// [OPTIMIZATION] 동적 임포트
const HomeControlPanel = dynamic(
  () => import("../components/home/home-control-panel"),
  {
    ssr: false,
    loading: () => null,
  },
);

const HomeMapContainer = dynamic(
  () => import("../components/home/home-map-container"),
  {
    ssr: false,
    loading: () => <HomeMapContainerPendingShell />,
  },
);
const SubmissionFloatingButton = dynamic(
  () => import("../components/home/SubmissionFloatingButton"),
  { ssr: false },
);
const HomeMapUserMenu = dynamic(
  () => import("../components/home/HomeMapUserMenu"),
  { ssr: false, loading: () => <HomeMapUserMenuPendingShell /> },
);

const HomeClientSidePanels = dynamic(() => import("./home-client-sidepanels"), {
  ssr: false,
});
const HomeClientEffects = dynamic(() => import("./home-client-effects"), {
  ssr: false,
});
import { useHomeState } from "./hooks/useHomeState";
import { useHomeHandlers } from "./hooks/useHomeHandlers";
import { useRestaurantPopupListener } from "./hooks/useRestaurantPopupListener";

import type { Announcement } from "@/types/announcement";

type HomeStartupIntent = "search" | "bookmark" | "notification" | "user";
const HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT =
  "home:desktop-detail-return-capture";

const requestDesktopDetailReturnCapture = () => {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT));
};

const HOME_INITIAL_SHELL_INTENT_KEY = "tzudong:home-initial-intent";
const DEVICE_LOCATION_ENABLE_TOAST = "위치 서비스(GPS) 기능을 켜주세요.";

function clearAnnouncementPanelUrl() {
  if (typeof window === "undefined") return;

  const currentUrl = new URL(window.location.href);
  if (
    currentUrl.pathname !== "/" ||
    currentUrl.searchParams.get("panel") !== "announcement"
  ) {
    return;
  }

  currentUrl.searchParams.delete("panel");
  currentUrl.searchParams.delete("announcementId");
  const nextSearch = currentUrl.searchParams.toString();
  const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${currentUrl.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

const isHomeStartupIntent = (
  value: string | null,
): value is HomeStartupIntent =>
  value === "search" ||
  value === "bookmark" ||
  value === "notification" ||
  value === "user";

type HomeDetailOpenOptions = {
  source?: "user" | "url";
  searchFocusRestaurant?: Restaurant | null;
  mapMode?: HomeMapMode;
  restoreKey?: string | null;
};

export default function HomeClient() {
  const { isAdmin, user } = useAuth();
  const { isSidebarOpen } = useLayout();
  const viewportMode = useHomeViewportMode();
  const isViewportResolved = viewportMode !== "pending";
  const isDesktop = viewportMode === "desktop";
  const isMobileOrTablet = viewportMode === "mobileOrTablet";
  const [mapMode, setMapMode] = useState<"domestic" | "overseas">("domestic");
  const [activePanel, setActivePanel] = useState<"map" | "detail" | "control">(
    "map",
  );
  const [mapFocusZoom, setMapFocusZoom] = useState<number | null>(null); // [New] 지도 줌 레벨 제어
  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

  // 통합 패널 상태 관리
  // 'detail'은 맛집 상세 패널(state.isPanelOpen으로 관리), 나머지는 activeRightPanel로 관리
  type PanelType = "mypage" | "adminReviews" | "announcement" | null;
  const [activeRightPanel, setActiveRightPanel] = useState<PanelType>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] =
    useState<Announcement | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(
    () => DEFAULT_HOME_MAP_USER_PREFERENCES.desktopPanelDefault === "collapsed",
  );
  const [desktopMapLayout, setDesktopMapLayout] = useState<HomeMapLayoutMode>(
    DEFAULT_HOME_MAP_USER_PREFERENCES.desktopMapLayout,
  );
  const [desktopPanelSide, setDesktopPanelSide] = useState<HomeMapPanelSide>(
    DEFAULT_HOME_MAP_USER_PREFERENCES.desktopPanelSide,
  );
  const [isAnnouncementSheetOpen, setIsAnnouncementSheetOpen] = useState(false);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [contextualRestaurantsPayload, setContextualRestaurantsPayload] =
    useState<HomeMapContextualRestaurantsPayload | null>(null);
  const [deviceLocation, setDeviceLocation] =
    useState<DeviceMapLocation | null>(null);
  const [initialMobileOverlayIntent, setInitialMobileOverlayIntent] =
    useState<HomeStartupIntent | null>(null);
  const [isDeviceLocationPending, setIsDeviceLocationPending] = useState(false);
  const [isDeviceHeadingMode, setIsDeviceHeadingMode] = useState(false);
  const deviceLocationFocusRequestIdRef = useRef(0);
  const deviceLocationWatchIdRef = useRef<number | null>(null);
  const deviceOrientationCleanupRef = useRef<(() => void) | null>(null);
  const openPanelRef = useRef<(panel: PanelType) => void>(() => {});
  const openDetailPanelRef = useRef<
    (restaurant: Restaurant, focusZoom?: number, options?: HomeDetailOpenOptions) => void
  >(() => {});
  useEffect(() => {
    if (mapMode !== "domestic" || isMapFullscreen) {
      setContextualRestaurantsPayload(null);
    }
  }, [isMapFullscreen, mapMode]);

  useEffect(() => {
    const preferences = readLastHomeMapUserPreferences();
    setIsPanelCollapsed(preferences.desktopPanelDefault === "collapsed");
    setDesktopMapLayout(preferences.desktopMapLayout);
    setDesktopPanelSide(preferences.desktopPanelSide);
  }, []);

  // [Fix] 마운트 시점 기록 - 라우트 변경 후 돌아왔을 때 지도 강제 리마운트
  const [mapMountKey] = useState(() => Date.now());

  const state = useHomeState(mapMode);
  const {
    clearRestaurantDetailSelection,
    closeRestaurantDetailPanel,
    openRestaurantDetailSelection,
    releaseSearchSelectionOwnership,
    setFilters,
    setSelectedCategories,
    setSelectedCountry,
    setSelectedRegion,
    syncRestaurantDetailSelection,
  } = state;
  const visibleDetailRestaurant = state.isPanelOpen
    ? (state.panelRestaurant ?? state.selectedRestaurant)
    : null;
  const visibleDetailTitle = visibleDetailRestaurant
    ? buildBrowserTitle(visibleDetailRestaurant.name)
    : null;
  useDocumentTitle(visibleDetailTitle);
  const toCompactRestaurant = useCallback(
    (restaurant: Restaurant | null): HomeRestoreCompactRestaurant | null => {
      if (!restaurant) return null;

      return {
        id: restaurant.id,
        name: restaurant.name,
        lat: restaurant.lat,
        lng: restaurant.lng,
        road_address: restaurant.road_address,
        jibun_address: restaurant.jibun_address,
        categories: restaurant.categories,
      };
    },
    [],
  );

  // 패널 열기 (상호 배타적) - 마이페이지, 제보관리, 리뷰관리용
  // [OPTIMIZATION] useCallback으로 메모이제이션하여 불필요한 리렌더링 방지
  const openPanel = useCallback(
    (panel: PanelType) => {
      setIsMapFullscreen(false);
      // 맛집 상세 패널 닫기
      clearRestaurantDetailSelection();
      if (panel === "announcement" && isMobileOrTablet) {
        setActiveRightPanel(null);
        setIsAnnouncementSheetOpen(true);
        setIsPanelCollapsed(false);
        return;
      }

      setIsAnnouncementSheetOpen(false);
      setActiveRightPanel(panel);
      setIsPanelCollapsed(false); // 새 패널 열릴 때 펼쳐진 상태로
    },
    [clearRestaurantDetailSelection, isMobileOrTablet],
  );
  useEffect(() => {
    openPanelRef.current = openPanel;
  }, [openPanel]);

  // 모든 패널 닫기
  // [OPTIMIZATION] useCallback으로 메모이제이션
  const closeAllPanels = useCallback(() => {
    setIsMapFullscreen(false);
    clearRestaurantDetailSelection();
    setActiveRightPanel(null);
    setIsAnnouncementSheetOpen(false);
    setSelectedAnnouncement(null);
    setIsPanelCollapsed(false);
    clearAnnouncementPanelUrl();
  }, [clearRestaurantDetailSelection]);

  const returnToRestaurantListPanel = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      isHomeDetailHistoryState(window.history.state)
    ) {
      const { snapshot } = readHomeRestoreSnapshot(window.history.state.restoreKey);
      if (snapshot) {
        window.history.back();
        return;
      }
    }

    closeRestaurantDetailPanel();
    setActiveRightPanel(null);
    setIsAnnouncementSheetOpen(false);
    setSelectedAnnouncement(null);
    clearAnnouncementPanelUrl();
  }, [closeRestaurantDetailPanel]);

  const createHomeRestoreSnapshot = useCallback(
    (): HomeRestoreSnapshotV1 => ({
      version: 1,
      createdAt: Date.now(),
      mapMode,
      selectedRestaurantId: state.selectedRestaurant?.id ?? null,
      panelRestaurantId: state.panelRestaurant?.id ?? null,
      searchedRestaurantId: state.searchedRestaurant?.id ?? null,
      searchedRestaurant: toCompactRestaurant(state.searchedRestaurant),
      filters: {
        categories: state.filters.categories,
        featuredTheme: state.filters.featuredTheme,
      },
      selectedRegion: state.selectedRegion,
      selectedCountry: state.selectedCountry,
      activePanel,
      activeRightPanel,
      isPanelCollapsed,
      isAnnouncementSheetOpen,
      contextualRestaurantIds:
        contextualRestaurantsPayload?.restaurants.map((restaurant) => restaurant.id) ?? [],
    }),
    [
      activePanel,
      activeRightPanel,
      contextualRestaurantsPayload,
      isAnnouncementSheetOpen,
      isPanelCollapsed,
      mapMode,
      state.filters.categories,
      state.filters.featuredTheme,
      state.panelRestaurant,
      state.searchedRestaurant,
      state.selectedCountry,
      state.selectedRegion,
      state.selectedRestaurant,
      toCompactRestaurant,
    ],
  );

  const applyHomeRestoreSnapshot = useCallback(
    (restoreKey: string) => {
      const { snapshot, reason } = readHomeRestoreSnapshot(restoreKey);
      if (!snapshot) {
        dispatchHomeRestoreEvent("home.restore.failed", {
          restoreKey,
          reason: reason ?? "missing",
        });
        syncRestaurantDetailSelection(null, {
          isPanelOpen: false,
          searchFocusRestaurant: null,
        });
        return;
      }

      setMapMode(snapshot.mapMode);
      setFilters((previous) => ({
        ...previous,
        categories: snapshot.filters.categories,
        featuredTheme: snapshot.filters.featuredTheme,
      }));
      setSelectedCategories(snapshot.filters.categories);
      setSelectedRegion(snapshot.selectedRegion);
      setSelectedCountry(snapshot.selectedCountry);
      const restoredSearchRestaurant = snapshot.searchedRestaurant
        ? (snapshot.searchedRestaurant as Restaurant)
        : null;
      syncRestaurantDetailSelection(null, {
        isPanelOpen: false,
        searchFocusRestaurant: restoredSearchRestaurant,
      });
      setActivePanel(snapshot.activePanel);
      setActiveRightPanel(snapshot.activeRightPanel);
      setIsAnnouncementSheetOpen(snapshot.isAnnouncementSheetOpen);
      setIsPanelCollapsed(snapshot.isPanelCollapsed);
      setSelectedAnnouncement(null);
      dispatchHomeRestoreEvent("home.restore.succeeded", { restoreKey });
    },
    [
      setFilters,
      setSelectedCategories,
      setSelectedCountry,
      setSelectedRegion,
      syncRestaurantDetailSelection,
    ],
  );

  useEffect(() => {
    const handleHomeOverlayPanelOpened = () => {
      closeAllPanels();
    };

    window.addEventListener(
      "homeOverlayPanelOpened",
      handleHomeOverlayPanelOpened,
    );
    return () => {
      window.removeEventListener(
        "homeOverlayPanelOpened",
        handleHomeOverlayPanelOpened,
      );
    };
  }, [closeAllPanels]);

  useEffect(() => {
    if (!user?.id || !isDesktop) return;

    const preferences = readHomeMapUserPreferences(user.id);
    setIsPanelCollapsed(preferences.desktopPanelDefault === "collapsed");
    setDesktopMapLayout(preferences.desktopMapLayout);
    setDesktopPanelSide(preferences.desktopPanelSide);
  }, [isDesktop, user?.id]);

  useEffect(() => {
    if (!user?.id || !isDesktop) return;

    const handlePreferencesChanged = (event: Event) => {
      const customEvent = event as HomeMapUserPreferencesEvent;
      if (customEvent.detail?.userId !== user.id) return;

      if (!customEvent.detail.preservePanelCollapse) {
        setIsPanelCollapsed(
          customEvent.detail.preferences.desktopPanelDefault === "collapsed",
        );
      }
      setDesktopMapLayout(customEvent.detail.preferences.desktopMapLayout);
      setDesktopPanelSide(customEvent.detail.preferences.desktopPanelSide);
    };

    window.addEventListener(
      HOME_MAP_USER_PREFERENCES_EVENT,
      handlePreferencesChanged,
    );
    return () => {
      window.removeEventListener(
        HOME_MAP_USER_PREFERENCES_EVENT,
        handlePreferencesChanged,
      );
    };
  }, [isDesktop, user?.id]);

  // 패널 접기/펼치기
  // [OPTIMIZATION] useCallback으로 메모이제이션
  const togglePanelCollapse = useCallback(() => {
    setIsPanelCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleExpandLeftPanelForPageEntry = (event: Event) => {
      const href =
        event instanceof CustomEvent && typeof event.detail?.href === "string"
          ? event.detail.href
          : "";

      if (!shouldExpandDesktopLeftPanelForRoute(href)) return;

      setIsMapFullscreen(false);
      setIsPanelCollapsed(false);
    };

    window.addEventListener(
      DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT,
      handleExpandLeftPanelForPageEntry,
    );
    return () => {
      window.removeEventListener(
        DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT,
        handleExpandLeftPanelForPageEntry,
      );
    };
  }, []);

  // 맛집 상세 패널이 열릴 때 다른 패널 닫기
  useEffect(() => {
    if (state.isPanelOpen) {
      // 맛집 상세 패널이 열리면 다른 패널들 모두 닫기
      setActiveRightPanel(null);
      setIsAnnouncementSheetOpen(false);
      setIsPanelCollapsed(false);
    }
  }, [state.isPanelOpen]);

  // 이벤트 핸들러 커스텀 훅
  const handlers = useHomeHandlers({
    setFilters: state.setFilters,
    setSelectedCategories: state.setSelectedCategories,
    setAdminRestaurantToEdit: state.setAdminRestaurantToEdit,
    setIsAdminEditModalOpen: state.setIsAdminEditModalOpen,
    setRestaurantToEdit: state.setRestaurantToEdit,
    setEditFormData: state.setEditFormData,
    setIsEditModalOpen: state.setIsEditModalOpen,
    setSelectedRegion: state.setSelectedRegion,
    setSelectedCountry: state.setSelectedCountry,
    setMoveToRestaurant: state.setMoveToRestaurant,
    syncRestaurantDetailSelection: state.syncRestaurantDetailSelection,
    openRestaurantDetailSelection: state.openRestaurantDetailSelection,
    clearRestaurantDetailSelection: state.clearRestaurantDetailSelection,
  });

  // 맛집 상세 패널 열기 (다른 패널 닫기 포함)
  // [OPTIMIZATION] useCallback으로 메모이제이션
  const openDetailPanel = useCallback(
    (restaurant: Restaurant, focusZoom?: number, options?: HomeDetailOpenOptions) => {
      if (options?.source === "url" && typeof window !== "undefined") {
        const currentRestaurantId = resolveHomeDetailRestaurantParam(
          new URLSearchParams(window.location.search),
        );
        if (currentRestaurantId !== restaurant.id) {
          return;
        }
      }
      if (options?.source !== "url" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("home:detail-user-opened", {
            detail: { restaurantId: restaurant.id },
          }),
        );
      }
      requestDesktopDetailReturnCapture();
      setIsMapFullscreen(false);

      setActiveRightPanel(null);
      setIsPanelCollapsed(false);
      openRestaurantDetailSelection(restaurant, {
        searchFocusRestaurant: options?.searchFocusRestaurant ?? null,
      });

      if (focusZoom) {
        setMapFocusZoom(focusZoom);
      } else {
        setMapFocusZoom(null);
      }

      const detailMapMode = options?.mapMode ?? mapMode;
      if (typeof window !== "undefined") {
        const restoreKey =
          isHomeDetailHistoryState(window.history.state) &&
          window.history.state.restaurantId === restaurant.id
            ? window.history.state.restoreKey
            : options?.restoreKey?.trim() || createHomeRestoreKey();
        const detailState = buildHomeDetailState({
          restaurantId: restaurant.id,
          mapMode: detailMapMode,
          restoreKey,
        });
        const detailUrl = buildHomeDetailUrl({
          restaurantId: restaurant.id,
          mapMode: detailMapMode,
          restoreKey,
          focusZoom,
        });

        if (options?.source === "url") {
          window.history.replaceState(detailState, "", detailUrl);
        } else {
          const snapshot = createHomeRestoreSnapshot();
          const wroteSnapshot = writeHomeRestoreSnapshot(restoreKey, snapshot);
          if (!wroteSnapshot) {
            dispatchHomeRestoreEvent("home.restore.failed", {
              restoreKey,
              reason: "snapshot-write-failed",
            });
          }
          window.history.replaceState(
            buildHomeListState({
              restaurantId: restaurant.id,
              mapMode: detailMapMode,
              restoreKey,
            }),
            "",
            window.location.href,
          );
          window.history.pushState(detailState, "", detailUrl);
        }
      }
    },
    [createHomeRestoreSnapshot, mapMode, openRestaurantDetailSelection],
  );
  useEffect(() => {
    openDetailPanelRef.current = openDetailPanel;
  }, [openDetailPanel]);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      if (isHomeListHistoryState(event.state)) {
        applyHomeRestoreSnapshot(event.state.restoreKey);
        return;
      }

      if (isHomeDetailHistoryState(event.state)) {
        setMapMode(event.state.mapMode);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyHomeRestoreSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const intent = window.sessionStorage.getItem(
        HOME_INITIAL_SHELL_INTENT_KEY,
      );
      window.sessionStorage.removeItem(HOME_INITIAL_SHELL_INTENT_KEY);

      if (!isHomeStartupIntent(intent)) return;

      setInitialMobileOverlayIntent(intent);
      if (intent === "search") {
        setActivePanel("control");
      }
    } catch (_) {
      // Session storage may be unavailable in restrictive browser modes; fall back to normal home load.
    }
  }, []);

  const handleRestaurantSelectionSync = useCallback(
    (restaurant: Restaurant | null) => {
      if (!restaurant) {
        setIsMapFullscreen(false);
        clearRestaurantDetailSelection();
        return;
      }

      requestDesktopDetailReturnCapture();
      setIsMapFullscreen(false);
      openRestaurantDetailSelection(restaurant);
    },
    [clearRestaurantDetailSelection, openRestaurantDetailSelection],
  );

  const handleControlRestaurantSelect = useCallback(
    (restaurant: Restaurant) => {
      openDetailPanel(restaurant);
    },
    [openDetailPanel],
  );

  const handleControlRestaurantSearch = useCallback(
    (restaurant: Restaurant) => {
      openDetailPanel(restaurant, undefined, { searchFocusRestaurant: restaurant });
    },
    [openDetailPanel],
  );

  // 팝업 이벤트 리스너
  useRestaurantPopupListener({
    mapMode,
    moveToRestaurant: state.moveToRestaurant,
    setSelectedRegion: state.setSelectedRegion,
    setSelectedRestaurant: state.setSelectedRestaurant,
    setSearchedRestaurant: state.setSearchedRestaurant,
    openDetailPanel, // 팝업 클릭 시 상세 패널 열기
  });

  // [OPTIMIZATION] useMemo로 메모이제이션
  const onAdminEditRestaurant = useMemo(
    () => (isAdmin ? handlers.handleAdminEditRestaurant : undefined),
    [isAdmin, handlers.handleAdminEditRestaurant],
  );

  // [OPTIMIZATION] useCallback으로 메모이제이션
  const handleSubmissionButtonClick = useCallback(() => {
    if (!user) {
      toast.info("로그인하면 맛집 제보를 바로 이어서 할 수 있어요");
      requestAuthUi({
        source: "home-submission-button",
        route: "/",
        reason: "submit-restaurant",
      });
      return;
    }
    setIsSubmissionModalOpen(true);
  }, [user]);

  const applyDevicePosition = useCallback(
    (
      position: GeolocationPosition,
      mode: "position" | "heading",
      options: { shouldFocus: boolean },
    ) => {
      const nextHeading = resolveGeolocationHeading(position.coords.heading);
      const nextFocusRequestId = options.shouldFocus
        ? deviceLocationFocusRequestIdRef.current + 1
        : deviceLocationFocusRequestIdRef.current;

      if (options.shouldFocus) {
        deviceLocationFocusRequestIdRef.current = nextFocusRequestId;
      }

      setDeviceLocation((previous) => {
        const nextLocation: DeviceMapLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          heading: nextHeading ?? previous?.heading ?? null,
          mode,
          focusRequestId: nextFocusRequestId,
          updatedAt: Date.now(),
        };

        return resolveDeviceLocationStateUpdatePlan({
          previous,
          next: nextLocation,
        }).nextLocation;
      });
    },
    [],
  );

  const stopDeviceHeadingWatchers = useCallback(() => {
    if (
      deviceLocationWatchIdRef.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(deviceLocationWatchIdRef.current);
      deviceLocationWatchIdRef.current = null;
    }

    deviceOrientationCleanupRef.current?.();
    deviceOrientationCleanupRef.current = null;
  }, []);

  const startDeviceOrientationTracking = useCallback(async () => {
    if (typeof window === "undefined") return false;

    const OrientationEvent = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<PermissionState>;
        })
      | undefined;

    if (!OrientationEvent) {
      toast.info(
        "이 브라우저는 방향 센서를 지원하지 않아 현재 위치만 표시해요",
      );
      return false;
    }

    try {
      if (typeof OrientationEvent.requestPermission === "function") {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== "granted") {
          toast.info("방향 권한이 허용되지 않아 현재 위치만 표시해요");
          return false;
        }
      }
    } catch {
      toast.info("방향 권한을 확인하지 못해 현재 위치만 표시해요");
      return false;
    }

    if (deviceOrientationCleanupRef.current) return true;

    const handleOrientation = (
      event: DeviceOrientationEvent & { webkitCompassHeading?: number | null },
    ) => {
      const heading = resolveDeviceOrientationHeading(event);
      if (heading === null) return;

      setDeviceLocation((previous) => {
        if (!previous) return previous;

        const nextLocation: DeviceMapLocation = {
          ...previous,
          heading,
          mode: "heading",
          updatedAt: Date.now(),
        };

        return resolveDeviceLocationStateUpdatePlan({
          previous,
          next: nextLocation,
        }).nextLocation;
      });
    };

    window.addEventListener("deviceorientationabsolute", handleOrientation);
    window.addEventListener("deviceorientation", handleOrientation);
    deviceOrientationCleanupRef.current = () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        handleOrientation,
      );
      window.removeEventListener("deviceorientation", handleOrientation);
    };

    return true;
  }, []);

  const startDeviceLocationWatch = useCallback(
    (mode: "position" | "heading") => {
      if (
        typeof navigator === "undefined" ||
        !navigator.geolocation ||
        deviceLocationWatchIdRef.current !== null
      )
        return;

      deviceLocationWatchIdRef.current = navigator.geolocation.watchPosition(
        (position) =>
          applyDevicePosition(position, mode, { shouldFocus: false }),
        () => {
          // watchPosition은 보조 갱신용이므로 실패해도 첫 위치 표시를 유지한다.
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    },
    [applyDevicePosition],
  );

  const handleDeviceLocationClick = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(DEVICE_LOCATION_ENABLE_TOAST);
      return;
    }

    const nextMode: "position" | "heading" = deviceLocation
      ? "heading"
      : "position";
    setIsDeviceLocationPending(true);

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 3000,
            timeout: 12000,
          });
        },
      );

      if (nextMode === "heading") {
        setIsDeviceHeadingMode(true);
        await startDeviceOrientationTracking();
        startDeviceLocationWatch("heading");
        toast.success("현재 위치와 방향 표시를 켰어요");
      } else {
        stopDeviceHeadingWatchers();
        setIsDeviceHeadingMode(false);
        toast.success("현재 위치를 지도에 표시했어요");
      }

      applyDevicePosition(position, nextMode, { shouldFocus: true });
    } catch {
      toast.error(DEVICE_LOCATION_ENABLE_TOAST);
    } finally {
      setIsDeviceLocationPending(false);
    }
  }, [
    applyDevicePosition,
    deviceLocation,
    startDeviceLocationWatch,
    startDeviceOrientationTracking,
    stopDeviceHeadingWatchers,
  ]);

  useEffect(
    () => () => {
      stopDeviceHeadingWatchers();
    },
    [stopDeviceHeadingWatchers],
  );

  const shouldRenderSidePanels = Boolean(
    isAnnouncementSheetOpen ||
    isSubmissionModalOpen ||
    state.isEditModalOpen ||
    state.isAdminEditModalOpen ||
    state.isReviewModalOpen,
  );

  const handleTopShellUserIconClick = useCallback(() => {
    if (typeof window === "undefined") return;

    if (!user) {
      toast.info("로그인 후 프로필을 확인할 수 있어요");
      requestAuthUi({
        source: "mobile-top-shell",
        route: "/",
        reason: "open-profile",
      });
      return;
    }

    window.dispatchEvent(
      new CustomEvent("home:mobile-profile-request", {
        detail: {
          source: "mobile-top-shell",
          route: "/",
          userId: user.id,
          ts: Date.now(),
        },
      }),
    );
  }, [user]);

  return (
    <>
      <HomeClientEffects
        activeRightPanel={activeRightPanel}
        clearRestaurantDetailSelection={clearRestaurantDetailSelection}
        isAdmin={isAdmin}
        isLoggedIn={!!user}
        isAnnouncementSheetOpen={isAnnouncementSheetOpen}
        mapMode={mapMode}
        closeAllPanels={closeAllPanels}
        openDetailPanelRef={openDetailPanelRef}
        openPanelRef={openPanelRef}
        selectedAnnouncement={selectedAnnouncement}
        setMapMode={setMapMode}
        setSelectedAnnouncement={setSelectedAnnouncement}
      />

      <HomeMapContainer
        key={mapMountKey}
        mapMode={mapMode}
        mapFocusZoom={mapFocusZoom} // [New] 줌 레벨 전달
        filters={state.filters}
        selectedRegion={state.selectedRegion}
        selectedCountry={state.selectedCountry}
        searchedRestaurant={state.searchedRestaurant}
        selectedRestaurant={state.selectedRestaurant}
        refreshTrigger={state.refreshTrigger}
        panelRestaurant={state.panelRestaurant}
        isPanelOpen={state.isPanelOpen && !isPanelCollapsed}
        onAdminEditRestaurant={onAdminEditRestaurant}
        onRequestEditRestaurant={handlers.handleRequestEditRestaurant}
        onRestaurantSelect={handleRestaurantSelectionSync}
        onMapReady={handlers.handleMapReady}
        onMarkerClick={openDetailPanel}
        onPanelClose={closeAllPanels}
        onDetailPanelBack={returnToRestaurantListPanel}
        onReviewModalOpen={() => state.setIsReviewModalOpen(true)}
        onTogglePanelCollapse={togglePanelCollapse}
        activePanel={activePanel}
        onPanelClick={setActivePanel}
        externalPanelOpen={true}
        isPanelCollapsed={isPanelCollapsed}
        desktopMapLayout={desktopMapLayout}
        desktopPanelSide={desktopPanelSide}
        isMapFullscreen={isMapFullscreen}
        onMapFullscreenChange={setIsMapFullscreen}
        deviceLocation={deviceLocation}
        onReleaseSearchSelectionOwnership={releaseSearchSelectionOwnership}
        onContextualRestaurantsChange={setContextualRestaurantsPayload}
        renderDesktopDetailPanel={!isDesktop}
      />

      {isViewportResolved && !(isMobileOrTablet && isMapFullscreen) && (
        <HomeControlPanel
          mapMode={mapMode}
          selectedRegion={state.selectedRegion}
          selectedCountry={state.selectedCountry}
          selectedCategories={state.filters.categories}
          filters={state.filters}
          onRegionChange={handlers.handleRegionChange}
          onCountryChange={handlers.handleCountryChange}
          onCategoryChange={handlers.handleCategoryChange}
          onThemeChange={handlers.handleThemeChange}
          onRestaurantSelect={handleControlRestaurantSelect}
          onRestaurantSearch={handleControlRestaurantSearch}
          onSearchExecute={handlers.switchToSingleMap}
          activePanel={activePanel}
          onPanelClick={setActivePanel}
          panelRestaurant={state.panelRestaurant}
          isPanelOpen={state.isPanelOpen && !isPanelCollapsed}
          contextualRestaurantsPayload={contextualRestaurantsPayload}
          isMapFullscreen={isMapFullscreen}
          onPanelClose={closeAllPanels}
          onDetailPanelBack={returnToRestaurantListPanel}
          onReviewModalOpen={() => state.setIsReviewModalOpen(true)}
          onAdminEditRestaurant={onAdminEditRestaurant}
          onRequestEditRestaurant={handlers.handleRequestEditRestaurant}
          isAdmin={isAdmin}
          onModeChange={(mode) => {
            setIsMapFullscreen(false);
            clearRestaurantDetailSelection();
            setMapMode(mode);
          }}
          user={user}
          onSubmissionClick={handleSubmissionButtonClick}
          onTopShellUserIconClick={handleTopShellUserIconClick}
          onDeviceLocationClick={handleDeviceLocationClick}
          deviceLocation={deviceLocation}
          isDeviceLocationPending={isDeviceLocationPending}
          isDeviceHeadingMode={isDeviceHeadingMode}
          isPanelCollapsed={isPanelCollapsed}
          onTogglePanelCollapse={togglePanelCollapse}
          onSetPanelCollapsed={setIsPanelCollapsed}
          desktopPanelSide={desktopPanelSide}
          initialIntent={initialMobileOverlayIntent}
          activeRightPanel={activeRightPanel}
          selectedAnnouncement={selectedAnnouncement}
        />
      )}

      {isDesktop && (
        <>
          <HomeMapUserMenu
            desktopPanelSide={desktopPanelSide}
            isPanelCollapsed={isPanelCollapsed}
          />
          <SubmissionFloatingButton
            onClick={handleSubmissionButtonClick}
            isSidebarOpen={isSidebarOpen}
            onDeviceLocationClick={handleDeviceLocationClick}
            deviceLocation={deviceLocation}
            isDeviceLocationPending={isDeviceLocationPending}
            isDeviceHeadingMode={isDeviceHeadingMode}
            desktopPanelSide={desktopPanelSide}
            isPanelCollapsed={isPanelCollapsed}
          />
        </>
      )}

      {isViewportResolved && shouldRenderSidePanels && (
        <HomeClientSidePanels
          closeAllPanels={closeAllPanels}
          isAdmin={isAdmin}
          isAnnouncementSheetOpen={isAnnouncementSheetOpen}
          isMobileOrTablet={isMobileOrTablet}
          isSubmissionModalOpen={isSubmissionModalOpen}
          selectedAnnouncement={selectedAnnouncement}
          setIsAnnouncementSheetOpen={setIsAnnouncementSheetOpen}
          setIsSubmissionModalOpen={setIsSubmissionModalOpen}
          setSelectedAnnouncement={setSelectedAnnouncement}
          state={state}
        />
      )}
    </>
  );
}
