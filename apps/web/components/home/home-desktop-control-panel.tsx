"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import RegionSelector from "@/components/region/RegionSelector";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { OVERSEAS_REGION_LIST } from "@/constants/overseas-regions";
import type { FilterState } from "@/components/filters/filter-state";
import type { Announcement } from "@/types/announcement";
import type { Region, Restaurant } from "@/types/restaurant";
import { useOverseasCountryCounts } from "@/components/home/use-overseas-country-counts";
import { useDeferredComponent } from "@/hooks/use-deferred-component";
import HydratedDetailRestaurant from "@/components/home/HydratedDetailRestaurant";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { cn } from "@/lib/utils";
import { requestAuthUi } from "@/lib/auth-ui-events";
import { HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT } from "@/lib/desktop-left-panel-entry";
import type { User } from "@supabase/supabase-js";
import {
  Bell,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  MapPin,
  MessageSquare,
  Stamp,
  Trophy,
  UserRound,
  Video,
  X,
} from "lucide-react";

type SearchType = "name" | "youtube";
type HomeOverlayPanelType = "mypage" | "adminReviews" | "announcement" | null;

type RestaurantSearchComponentProps = {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onRestaurantSearch?: (restaurant: Restaurant) => void;
  onSearchExecute?: (region?: Region | null) => void;
  filters?: FilterState;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
  maxItems?: number;
  popularMaxItems?: number;
  autoFocusInput?: boolean;
  resultView?: "dropdown" | "inline";
  dropdownPlacement?: "top" | "bottom";
  className?: string;
  hideHistoryAndPopular?: boolean;
  hideSearchControls?: boolean;
  searchQueryValue?: string;
  onSearchQueryChange?: (value: string) => void;
  searchTypeValue?: SearchType;
  onSearchTypeChange?: (value: SearchType) => void;
  clearQueryOnSelect?: boolean;
  edgeToEdgeInlineLayout?: boolean;
};

const loadDesktopRestaurantSearch = async () => {
  const mod = await import("@/components/search/RestaurantSearch");
  return mod.default as ComponentType<RestaurantSearchComponentProps>;
};

type DesktopLeftPanelView =
  | "map"
  | "feed"
  | "stamp"
  | "leaderboard"
  | "profile"
  | "bookmarks"
  | "notifications"
  | "announcement"
  | "adminReviews";

type DesktopDetailReturnState = {
  view: DesktopLeftPanelView;
  profileUserId: string | null;
  searchQuery: string;
  searchType: SearchType;
  isSearchActive: boolean;
};

type FeedOverlayComponentProps = {
  onClose: () => void;
  onOpenReviewModal?: () => void;
  hideReviewModal?: boolean;
  hideFloatingButton?: boolean;
  initialReviewId?: string | null;
  onOpenRestaurantDetail?: (restaurant: Restaurant) => void;
  onOpenUserProfile?: (userId: string) => void;
  onOpenAuth?: () => void;
};

type StampOverlayComponentProps = {
  onClose?: () => void;
  onOpenRestaurantDetail?: (restaurant: Restaurant) => void;
  singleColumnCards?: boolean;
};

type LeaderboardOverlayComponentProps = {
  onClose?: () => void;
  onOpenUserProfile?: (userId: string) => void;
};

type UserProfilePanelComponentProps = {
  userId: string;
  onClose?: () => void;
  showBackButton?: boolean;
  onUserClick?: (userId: string) => void;
  onRestaurantClick?: (restaurant: Restaurant) => void;
};

type DesktopLeftPanelBookmarksComponentProps = {
  onRestaurantOpen: (
    restaurant: Pick<Restaurant, "id" | "lat" | "lng">,
  ) => void;
  onClose?: () => void;
};

type DesktopLeftPanelNotificationsComponentProps = {
  onRestaurantIdOpen: (restaurantId: string) => void;
  onOpenProfile: () => void;
  onOpenAnnouncements: () => void;
  onClose?: () => void;
};

type AnnouncementPanelComponentProps = {
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  initialAnnouncement?: Announcement | null;
  adminActionsMode?: "inline" | "console-link";
};

type AdminReviewPanelComponentProps = {
  isOpen: boolean;
  onClose: () => void;
};

const loadFeedOverlay = async () => {
  const mod = await import("@/components/overlay-pages/FeedOverlay");
  return mod.default as ComponentType<FeedOverlayComponentProps>;
};

const loadStampOverlay = async () => {
  const mod = await import("@/components/overlay-pages/StampOverlay");
  return mod.default as ComponentType<StampOverlayComponentProps>;
};

const loadLeaderboardOverlay = async () => {
  const mod = await import("@/components/overlay-pages/LeaderboardOverlay");
  return mod.default as ComponentType<LeaderboardOverlayComponentProps>;
};

const loadUserProfilePanel = async () => {
  const mod = await import("@/components/profile/UserProfilePanel");
  return mod.UserProfilePanel as ComponentType<UserProfilePanelComponentProps>;
};

const loadDesktopLeftPanelBookmarks = async () => {
  const mod = await import("@/components/home/DesktopLeftPanelBookmarks");
  return mod.default as ComponentType<DesktopLeftPanelBookmarksComponentProps>;
};

const loadDesktopLeftPanelNotifications = async () => {
  const mod = await import("@/components/home/DesktopLeftPanelNotifications");
  return mod.default as ComponentType<DesktopLeftPanelNotificationsComponentProps>;
};

const loadAnnouncementPanel = async () => {
  const mod = await import("@/components/announcement/AnnouncementPanel");
  return mod.default as ComponentType<AnnouncementPanelComponentProps>;
};

const loadAdminReviewPanel = async () => {
  const mod = await import("@/components/admin/AdminReviewPanel");
  return mod.default as ComponentType<AdminReviewPanelComponentProps>;
};

interface HomeDesktopControlPanelProps {
  mapMode: "domestic" | "overseas";
  selectedRegion: Region | null;
  selectedCountry: string | null;
  selectedCategories: string[];
  filters: FilterState;
  onRegionChange: (region: Region | null) => void;
  onCountryChange: (country: string) => void;
  onCategoryChange: (categories: string[]) => void;
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onRestaurantSearch: (restaurant: Restaurant) => void;
  onSearchExecute: (region?: Region | null) => void;
  onPanelClick?: (panel: "map" | "detail" | "control") => void;
  initialIntent?: "search" | "bookmark" | "notification" | "user" | null;
  panelRestaurant?: Restaurant | null;
  isPanelOpen?: boolean;
  onPanelClose?: () => void;
  onReviewModalOpen?: () => void;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
  onRequestEditRestaurant?: (restaurant: Restaurant) => void;
  onModeChange?: (mode: "domestic" | "overseas") => void;
  isPanelCollapsed?: boolean;
  onTogglePanelCollapse?: () => void;
  user?: User | null;
  isAdmin?: boolean;
  activeRightPanel?: HomeOverlayPanelType;
  selectedAnnouncement?: Announcement | null;
}

const DESKTOP_LEFT_PANEL_WIDTH_PX = 392;
const DESKTOP_FLOATING_NAV_ITEMS = [
  { id: "profile", label: "프로필", icon: UserRound },
  { id: "bookmarks", label: "북마크", icon: Bookmark },
  { id: "notifications", label: "알림", icon: Bell },
  { id: "feed", label: "리뷰", icon: MessageSquare },
  { id: "stamp", label: "도장", icon: Stamp },
  { id: "leaderboard", label: "랭킹", icon: Trophy },
] as const satisfies ReadonlyArray<{
  id: Extract<
    DesktopLeftPanelView,
    "feed" | "stamp" | "leaderboard" | "profile" | "bookmarks" | "notifications"
  >;
  label: string;
  icon: typeof MessageSquare;
}>;
const DESKTOP_FLOATING_NAV_ROW_STARTS = [0, 3] as const;
const DESKTOP_FLOATING_NAV_BUTTON_WIDTH = `${Math.max(
  5.5,
  ...DESKTOP_FLOATING_NAV_ITEMS.map((item) => item.label.length * 0.55 + 3.85),
).toFixed(2)}rem`;

const HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT =
  "home:desktop-detail-return-capture";

const replaceBrowserHistoryRoute = (route: string) => {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", route);
};

const DESKTOP_LEFT_PANEL_LOADING_LABELS: Partial<Record<DesktopLeftPanelView, string>> = {
  feed: "리뷰",
  stamp: "도장",
  leaderboard: "랭킹",
  profile: "프로필",
  bookmarks: "북마크",
  notifications: "알림",
  announcement: "공지사항",
  adminReviews: "관리자 리뷰",
};

function DesktopLeftPanelLoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} 패널 불러오는 중`}
      className="flex h-full min-h-0 flex-col gap-3 bg-background p-4"
      data-desktop-left-panel-loading="true"
    >
      <div className="h-7 w-32 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
      <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
        <div className="h-4 w-3/4 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-2/3 rounded bg-muted animate-pulse motion-reduce:animate-none" />
      </div>
      <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
        <div className="h-4 w-2/3 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-1/2 rounded bg-muted animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}

const DESKTOP_LEFT_PANEL_ROUTE_VIEWS = [
  "feed",
  "stamp",
  "leaderboard",
  "profile",
  "bookmarks",
  "notifications",
] as const satisfies ReadonlyArray<Exclude<DesktopLeftPanelView, "map" | "announcement" | "adminReviews">>;

function isDesktopLeftPanelRouteView(
  value: string | null,
): value is Exclude<DesktopLeftPanelView, "map" | "announcement" | "adminReviews"> {
  return DESKTOP_LEFT_PANEL_ROUTE_VIEWS.includes(
    value as Exclude<DesktopLeftPanelView, "map" | "announcement" | "adminReviews">,
  );
}

const getDesktopLeftPanelRoute = (
  panel: DesktopLeftPanelView,
  profileUserId?: string | null,
) => {
  if (panel === "map") return "/";
  if (panel === "profile" && profileUserId) {
    return `/?panel=profile&user=${encodeURIComponent(profileUserId)}`;
  }
  return `/?panel=${panel}`;
};

function inferRestaurantMapMode(
  restaurant: Pick<Restaurant, "lat" | "lng">,
): "domestic" | "overseas" {
  if (
    restaurant.lat &&
    restaurant.lng &&
    (restaurant.lat < 33 ||
      restaurant.lat > 39 ||
      restaurant.lng < 124 ||
      restaurant.lng > 132)
  ) {
    return "overseas";
  }

  return "domestic";
}

export default function HomeDesktopControlPanel({
  mapMode,
  selectedRegion,
  selectedCountry,
  selectedCategories,
  filters,
  onRegionChange,
  onCountryChange,
  onCategoryChange,
  onRestaurantSelect,
  onRestaurantSearch,
  onSearchExecute,
  onPanelClick,
  initialIntent = null,
  panelRestaurant = null,
  isPanelOpen = false,
  onPanelClose,
  onReviewModalOpen,
  onAdminEditRestaurant,
  onRequestEditRestaurant,
  onModeChange,
  isPanelCollapsed = false,
  onTogglePanelCollapse,
  user = null,
  isAdmin = false,
  activeRightPanel = null,
  selectedAnnouncement = null,
}: HomeDesktopControlPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const countryCounts = useOverseasCountryCounts(mapMode);
  const desktopSearchShellRef = useRef<HTMLDivElement>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const [activeLeftPanelView, setActiveLeftPanelView] =
    useState<DesktopLeftPanelView>("map");
  const [activeProfileUserId, setActiveProfileUserId] = useState<string | null>(
    user?.id ?? null,
  );
  const [desktopSearchQuery, setDesktopSearchQuery] = useState("");
  const [desktopSearchType, setDesktopSearchType] =
    useState<SearchType>("name");
  const [isDesktopSearchActive, setIsDesktopSearchActive] = useState(
    initialIntent === "search",
  );
  const [isInlineDetailOpenPending, setIsInlineDetailOpenPending] =
    useState(false);
  const activeLeftPanelViewRef = useRef(activeLeftPanelView);
  const activeProfileUserIdRef = useRef(activeProfileUserId);
  const activeDetailRestaurantIdRef = useRef<string | null>(null);
  const hasCapturedDetailReturnRef = useRef(false);
  const pendingDetailReturnCaptureRef = useRef(false);
  const detailReturnStateRef = useRef<DesktopDetailReturnState>({
    view: "map",
    profileUserId: null,
    searchQuery: "",
    searchType: "name",
    isSearchActive: false,
  });
  const DeferredRestaurantSearch =
    useDeferredComponent<RestaurantSearchComponentProps>(
      activeLeftPanelView === "map" && !isPanelOpen,
      loadDesktopRestaurantSearch,
    );
  const DeferredFeedOverlay = useDeferredComponent<FeedOverlayComponentProps>(
    activeLeftPanelView === "feed",
    loadFeedOverlay,
  );
  const DeferredStampOverlay = useDeferredComponent<StampOverlayComponentProps>(
    activeLeftPanelView === "stamp",
    loadStampOverlay,
  );
  const DeferredLeaderboardOverlay =
    useDeferredComponent<LeaderboardOverlayComponentProps>(
      activeLeftPanelView === "leaderboard",
      loadLeaderboardOverlay,
    );
  const DeferredUserProfilePanel =
    useDeferredComponent<UserProfilePanelComponentProps>(
      activeLeftPanelView === "profile" && Boolean(activeProfileUserId),
      loadUserProfilePanel,
    );
  const DeferredDesktopLeftPanelBookmarks =
    useDeferredComponent<DesktopLeftPanelBookmarksComponentProps>(
      activeLeftPanelView === "bookmarks" && Boolean(user),
      loadDesktopLeftPanelBookmarks,
    );
  const DeferredDesktopLeftPanelNotifications =
    useDeferredComponent<DesktopLeftPanelNotificationsComponentProps>(
      activeLeftPanelView === "notifications" && Boolean(user),
      loadDesktopLeftPanelNotifications,
    );
  const DeferredAnnouncementPanel =
    useDeferredComponent<AnnouncementPanelComponentProps>(
      activeLeftPanelView === "announcement",
      loadAnnouncementPanel,
    );
  const DeferredAdminReviewPanel =
    useDeferredComponent<AdminReviewPanelComponentProps>(
      activeLeftPanelView === "adminReviews" && isAdmin,
      loadAdminReviewPanel,
    );
  useEffect(() => {
    if (initialIntent !== "search") return;

    onPanelClick?.("control");
  }, [initialIntent, onPanelClick]);

  useEffect(() => {
    activeLeftPanelViewRef.current = activeLeftPanelView;
  }, [activeLeftPanelView]);

  useEffect(() => {
    activeProfileUserIdRef.current = activeProfileUserId;
  }, [activeProfileUserId]);

  const captureDetailReturnView = useCallback(
    (
      view: DesktopLeftPanelView = activeLeftPanelViewRef.current,
      options: { pendingDetailOpen?: boolean } = {},
    ) => {
      detailReturnStateRef.current = {
        view,
        profileUserId: activeProfileUserIdRef.current,
        searchQuery: desktopSearchQuery,
        searchType: desktopSearchType,
        isSearchActive: isDesktopSearchActive,
      };
      hasCapturedDetailReturnRef.current = true;
      pendingDetailReturnCaptureRef.current = Boolean(options.pendingDetailOpen);
    },
    [desktopSearchQuery, desktopSearchType, isDesktopSearchActive],
  );

  useEffect(() => {
    const handleExternalDetailReturnCapture = () => {
      if (pendingDetailReturnCaptureRef.current) return;

      captureDetailReturnView(activeLeftPanelViewRef.current, {
        pendingDetailOpen: true,
      });
    };

    window.addEventListener(
      HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT,
      handleExternalDetailReturnCapture,
    );
    return () => {
      window.removeEventListener(
        HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT,
        handleExternalDetailReturnCapture,
      );
    };
  }, [captureDetailReturnView]);

  useEffect(() => {
    const handleInlineDetailOpenFailed = () => {
      setIsInlineDetailOpenPending(false);
      const returnState = detailReturnStateRef.current;
      setActiveLeftPanelView(returnState.view);
      setActiveProfileUserId(returnState.profileUserId || user?.id || null);
      router.replace(
        getDesktopLeftPanelRoute(returnState.view, returnState.profileUserId || user?.id),
        { scroll: false },
      );
    };

    window.addEventListener(
      HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT,
      handleInlineDetailOpenFailed,
    );
    return () => {
      window.removeEventListener(
        HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT,
        handleInlineDetailOpenFailed,
      );
    };
  }, [router, user]);

  useEffect(() => {
    const panelParam = searchParams.get("panel");
    if (!isDesktopLeftPanelRouteView(panelParam)) {
      if (activeRightPanel === null) {
        setActiveLeftPanelView("map");
      }
      return;
    }

    if (
      (panelParam === "profile" ||
        panelParam === "bookmarks" ||
        panelParam === "notifications") &&
      !user
    ) {
      requestAuthUi({
        source: "desktop-left-panel",
        route: "/",
        reason:
          panelParam === "profile"
            ? "open-profile"
            : panelParam === "bookmarks"
              ? "open-bookmarks"
              : "open-notifications",
      });
      router.replace("/", { scroll: false });
      setActiveLeftPanelView("map");
      return;
    }

    setActiveLeftPanelView(panelParam);
    if (panelParam === "profile") {
      setActiveProfileUserId(searchParams.get("user") || user?.id || null);
    }
  }, [activeRightPanel, router, searchParams, user]);


  useEffect(() => {
    if (activeRightPanel === "announcement") {
      setActiveLeftPanelView("announcement");
      setIsDesktopSearchActive(false);
      onPanelClick?.("control");
      return;
    }

    if (activeRightPanel === "adminReviews" && isAdmin) {
      setActiveLeftPanelView("adminReviews");
      setIsDesktopSearchActive(false);
      onPanelClick?.("control");
      return;
    }

    if (
      activeRightPanel === null &&
      (activeLeftPanelViewRef.current === "announcement" ||
        activeLeftPanelViewRef.current === "adminReviews")
    ) {
      setActiveLeftPanelView("map");
    }
  }, [activeRightPanel, isAdmin, onPanelClick]);

  useEffect(() => {
    if (!isPanelOpen || !panelRestaurant) {
      activeDetailRestaurantIdRef.current = null;
      if (!pendingDetailReturnCaptureRef.current) {
        hasCapturedDetailReturnRef.current = false;
      }
      return;
    }

    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (activeDetailRestaurantIdRef.current !== panelRestaurant.id) {
      activeDetailRestaurantIdRef.current = panelRestaurant.id;
      if (!hasCapturedDetailReturnRef.current) {
        captureDetailReturnView();
      }
    }

    setActiveLeftPanelView("map");
    if (isDesktopLeftPanelRouteView(searchParams.get("panel"))) {
      replaceBrowserHistoryRoute("/");
    }
  }, [
    captureDetailReturnView,
    isPanelOpen,
    panelRestaurant,
    panelRestaurant?.id,
    router,
    searchParams,
  ]);

  const handlePanelMouseDownCapture = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      onPanelClick?.("control");
    },
    [onPanelClick],
  );

  const handlePanelFocusCapture = useCallback(() => {
    onPanelClick?.("control");
  }, [onPanelClick]);

  useEffect(() => {
    if (initialIntent !== "search") return;
    setIsDesktopSearchActive(true);
    desktopSearchInputRef.current?.focus();
  }, [initialIntent]);

  useEffect(() => {
    if (!isDesktopSearchActive) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        desktopSearchShellRef.current &&
        !desktopSearchShellRef.current.contains(event.target as Node)
      ) {
        setIsDesktopSearchActive(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsDesktopSearchActive(false);
      desktopSearchInputRef.current?.blur();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDesktopSearchActive]);

  const activateDesktopSearch = useCallback(() => {
    if (activeRightPanel !== null) {
      onPanelClose?.();
    }

    setActiveLeftPanelView("map");
    setIsDesktopSearchActive(true);
  }, [activeRightPanel, onPanelClose]);

  const toggleDesktopSearchType = useCallback(() => {
    setDesktopSearchType((current) =>
      current === "name" ? "youtube" : "name",
    );
    setIsDesktopSearchActive(true);
    desktopSearchInputRef.current?.focus();
  }, []);

  const clearDesktopSearch = useCallback(() => {
    setDesktopSearchQuery("");
    setIsDesktopSearchActive(true);
    desktopSearchInputRef.current?.focus();
  }, []);

  const handleDesktopSearchRestaurantSelect = useCallback(
    (restaurant: Restaurant) => {
      captureDetailReturnView("map", { pendingDetailOpen: true });
      onRestaurantSelect(restaurant);
      setIsDesktopSearchActive(false);
    },
    [captureDetailReturnView, onRestaurantSelect],
  );

  const handleDesktopSearchRestaurantSearch = useCallback(
    (restaurant: Restaurant) => {
      captureDetailReturnView("map", { pendingDetailOpen: true });
      onRestaurantSearch(restaurant);
      setIsDesktopSearchActive(false);
    },
    [captureDetailReturnView, onRestaurantSearch],
  );

  const handleModeChange = useCallback(
    (mode: "domestic" | "overseas") => {
      onModeChange?.(mode);
      window.dispatchEvent(new CustomEvent("syncMapMode", { detail: mode }));
    },
    [onModeChange],
  );

  const handleReturnToMapPanel = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);
    setActiveLeftPanelView("map");
    router.replace("/", { scroll: false });
  }, [router]);

  const handleExternalLeftPanelClose = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);
    onPanelClose?.();
    setActiveLeftPanelView("map");
    router.replace("/", { scroll: false });
  }, [onPanelClose, router]);

  const handleDetailPanelClose = useCallback(() => {
    setIsInlineDetailOpenPending(false);
    const returnState = detailReturnStateRef.current;
    const returnView = returnState.view;
    const returnProfileUserId = returnState.profileUserId;

    pendingDetailReturnCaptureRef.current = false;
    onPanelClose?.();

    setDesktopSearchQuery(returnState.searchQuery);
    setDesktopSearchType(returnState.searchType);
    setIsDesktopSearchActive(returnState.isSearchActive);

    if (
      (returnView === "profile" ||
        returnView === "bookmarks" ||
        returnView === "notifications") &&
      !user
    ) {
      setActiveLeftPanelView("map");
      router.replace("/", { scroll: false });
      return;
    }

    if (returnView === "profile") {
      setActiveProfileUserId(returnProfileUserId || user?.id || null);
    }

    const returnRoute = getDesktopLeftPanelRoute(
      returnView,
      returnProfileUserId || user?.id,
    );

    setActiveLeftPanelView(returnView);
    router.replace(returnRoute, { scroll: false });
    replaceBrowserHistoryRoute(returnRoute);
  }, [onPanelClose, router, user]);

  const handleShortcutClick = useCallback(
    (panel: Extract<DesktopLeftPanelView, "feed" | "stamp" | "leaderboard">) => {
      pendingDetailReturnCaptureRef.current = false;
      setIsInlineDetailOpenPending(false);
      if (activeRightPanel !== null) {
        onPanelClose?.();
      }

      setActiveLeftPanelView(panel);
      router.replace(`/?panel=${panel}`, { scroll: false });
    },
    [activeRightPanel, onPanelClose, router],
  );


  const handleAdminEditRestaurant = useCallback(() => {
    if (!panelRestaurant) return;
    onAdminEditRestaurant?.(panelRestaurant);
  }, [onAdminEditRestaurant, panelRestaurant]);

  const handleRequestEditRestaurant = useCallback(
    (restaurant: Restaurant) => {
      onRequestEditRestaurant?.(restaurant);
    },
    [onRequestEditRestaurant],
  );

  const handleAccountClick = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (!user) {
      requestAuthUi({
        source: "desktop-left-panel",
        route: "/",
        reason: "open-profile",
      });
      return;
    }

    if (activeRightPanel !== null) {
      onPanelClose?.();
    }

    setActiveProfileUserId(user.id);
    setActiveLeftPanelView("profile");
    router.replace("/?panel=profile", { scroll: false });
  }, [activeRightPanel, onPanelClose, router, user]);

  const handleBookmarkClick = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (!user) {
      requestAuthUi({
        source: "desktop-left-panel",
        route: "/",
        reason: "open-bookmarks",
      });
      return;
    }

    if (activeRightPanel !== null) {
      onPanelClose?.();
    }

    setActiveLeftPanelView("bookmarks");
    router.replace("/?panel=bookmarks", { scroll: false });
  }, [activeRightPanel, onPanelClose, router, user]);

  const handleNotificationClick = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (!user) {
      requestAuthUi({
        source: "desktop-left-panel",
        route: "/",
        reason: "open-notifications",
      });
      return;
    }

    if (activeRightPanel !== null) {
      onPanelClose?.();
    }

    setActiveLeftPanelView("notifications");
    router.replace("/?panel=notifications", { scroll: false });
  }, [activeRightPanel, onPanelClose, router, user]);

  const handleFloatingNavClick = useCallback(
    (panel: (typeof DESKTOP_FLOATING_NAV_ITEMS)[number]["id"]) => {
      if (panel === "profile") {
        handleAccountClick();
        return;
      }

      if (panel === "bookmarks") {
        handleBookmarkClick();
        return;
      }

      if (panel === "notifications") {
        handleNotificationClick();
        return;
      }

      handleShortcutClick(panel);
    },
    [
      handleAccountClick,
      handleBookmarkClick,
      handleNotificationClick,
      handleShortcutClick,
    ],
  );

  const handleInlinePanelRestaurantIdOpen = useCallback(
    (restaurantId: string, mode: "domestic" | "overseas" = mapMode) => {
      captureDetailReturnView(activeLeftPanelViewRef.current, {
        pendingDetailOpen: true,
      });
      setIsInlineDetailOpenPending(true);
      setIsDesktopSearchActive(false);
      window.dispatchEvent(
        new CustomEvent("selectBookmarkRestaurant", {
          detail: {
            id: restaurantId,
            mode,
          },
        }),
      );
      setActiveLeftPanelView("map");
      router.replace("/", { scroll: false });
    },
    [captureDetailReturnView, mapMode, router],
  );

  const handleInlinePanelRestaurantOpen = useCallback(
    (restaurant: Pick<Restaurant, "id" | "lat" | "lng">) => {
      handleInlinePanelRestaurantIdOpen(
        restaurant.id,
        inferRestaurantMapMode(restaurant),
      );
    },
    [handleInlinePanelRestaurantIdOpen],
  );

  const handleInlinePanelUserOpen = useCallback(
    (userId: string) => {
      setActiveProfileUserId(userId);
      setActiveLeftPanelView("profile");
      router.replace(`/?panel=profile&user=${encodeURIComponent(userId)}`, {
        scroll: false,
      });
    },
    [router],
  );
  const hasActiveDetail = isPanelOpen && Boolean(panelRestaurant);
  const isDetailPanelTransitionPending =
    isInlineDetailOpenPending && !hasActiveDetail;
  const isInlinePanelViewActive = activeLeftPanelView !== "map";
  const panelToggleLabel = isPanelCollapsed
    ? "좌측 패널 펼치기"
    : "좌측 패널 접기";
  const floatingControlsStyle = {
    left: isPanelCollapsed
      ? "1rem"
      : `calc(min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px)) + 1rem)`,
    "--desktop-floating-nav-button-width": DESKTOP_FLOATING_NAV_BUTTON_WIDTH,
  } as CSSProperties;

  return (
    <>
      {!hasActiveDetail && !isDetailPanelTransitionPending && (
        <>
          <nav
            className="fixed top-4 z-[70] flex flex-col items-start gap-2"
            style={floatingControlsStyle}
            aria-label="지도 화면 보조 탐색"
            data-desktop-map-floating-nav="true"
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
          >
            {DESKTOP_FLOATING_NAV_ROW_STARTS.map((rowStart) => (
              <div
                key={rowStart}
                className="grid grid-cols-3 gap-2"
                data-desktop-map-floating-nav-row={rowStart === 0 ? "account" : "content"}
              >
                {DESKTOP_FLOATING_NAV_ITEMS.slice(rowStart, rowStart + 3).map(
                  (item) => {
                    const isActive = activeLeftPanelView === item.id;
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-pressed={isActive}
                        className={cn(
                          "pointer-events-auto h-9 w-[var(--desktop-floating-nav-button-width)] shrink-0 justify-center rounded-full border border-border bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors motion-reduce:transition-none hover:bg-secondary/80",
                          isActive &&
                            "border-red-700 bg-red-700 text-white hover:bg-red-800",
                        )}
                        onClick={() => handleFloatingNavClick(item.id)}
                      >
                        <item.icon
                          className="mr-1 h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {item.label}
                      </Button>
                    );
                  },
                )}
              </div>
            ))}
          </nav>

          <div
            className="fixed bottom-6 z-[70] grid auto-rows-auto grid-cols-[max-content] items-start gap-2"
            style={floatingControlsStyle}
            data-desktop-map-floating-filters="true"
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
          >
            {onModeChange && (
              <div className="flex w-full min-w-max items-center gap-0.5 rounded-full border border-border bg-background/95 p-0.5 shadow-lg backdrop-blur-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleModeChange("domestic")}
                  aria-pressed={mapMode === "domestic"}
                  aria-label="국내 맛집 지도 보기"
                  className={cn(
                    "h-9 flex-1 rounded-full px-2 text-xs font-medium transition-colors motion-reduce:transition-none",
                    mapMode === "domestic"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                  )}
                >
                  국내
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleModeChange("overseas")}
                  aria-pressed={mapMode === "overseas"}
                  aria-label="해외 맛집 지도 보기"
                  className={cn(
                    "h-9 flex-1 rounded-full px-2 text-xs font-medium transition-colors motion-reduce:transition-none",
                    mapMode === "overseas"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                  )}
                >
                  해외
                </Button>
              </div>
            )}

            {mapMode === "domestic" ? (
              <RegionSelector
                selectedRegion={selectedRegion}
                onRegionChange={onRegionChange}
                onRegionSelect={onSearchExecute}
                className="!h-9 !w-full !min-w-max rounded-full border-border bg-background/95 px-3 text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80"
                contentSide="top"
                contentAlign="start"
              />
            ) : (
              <Select
                value={selectedCountry || undefined}
                onValueChange={onCountryChange}
              >
                <SelectTrigger className="h-9 w-full min-w-max rounded-full border-border bg-background/95 px-3 text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80">
                  <SelectValue placeholder="해외 지역" />
                </SelectTrigger>
                <SelectContent
                  side="top"
                  align="start"
                  className="z-[180] max-h-[min(24rem,calc(100dvh-8rem))] rounded-2xl border-border shadow-2xl"
                >
                  {OVERSEAS_REGION_LIST.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region} ({countryCounts[region] || 0}개)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <CategoryFilter
              selectedCategories={selectedCategories}
              onCategoryChange={onCategoryChange}
              selectedRegion={mapMode === "domestic" ? selectedRegion : null}
              selectedCountry={mapMode === "overseas" ? selectedCountry : null}
              className="h-9 w-full min-w-max rounded-full border-border bg-background/95 px-3 text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80"
              contentSide="top"
              contentAlign="start"
            />
          </div>
        </>
      )}

      <div
        id="desktop-left-map-panel"
        ref={desktopSearchShellRef}
        className={cn(
          "fixed inset-y-0 left-0 z-[90] flex w-[min(392px,calc(100vw-32px))] flex-col border-r border-border bg-background shadow-xl",
          "transition-transform duration-300 ease-out",
          isPanelCollapsed ? "-translate-x-full" : "translate-x-0",
        )}
        style={{
          width: `min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px))`,
        }}
        data-desktop-left-map-panel="true"
        data-panel-collapsed={isPanelCollapsed ? "true" : "false"}
        onMouseDownCapture={handlePanelMouseDownCapture}
        onFocusCapture={handlePanelFocusCapture}
      >
        {onTogglePanelCollapse && (
          <button
            type="button"
            onClick={onTogglePanelCollapse}
            className="group absolute right-0 top-1/2 z-50 flex h-12 w-6 -translate-y-1/2 translate-x-full items-center justify-center rounded-r-lg border border-l-0 border-border bg-background shadow-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            title={panelToggleLabel}
            aria-label={panelToggleLabel}
            aria-controls="desktop-left-map-panel"
            aria-expanded={!isPanelCollapsed}
          >
            {isPanelCollapsed ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
            )}
          </button>
        )}
        <div
          className="flex min-h-0 flex-1 flex-col"
          aria-hidden={isPanelCollapsed}
          inert={isPanelCollapsed}
        >
        {!hasActiveDetail && !isDetailPanelTransitionPending && (
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div
              className={cn(
                "pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-border bg-background/95 px-2 shadow-lg backdrop-blur-sm",
                "focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
                activeLeftPanelView === "map" && "ring-2 ring-primary",
              )}
              data-desktop-left-panel-search-bar="true"
              onClick={activateDesktopSearch}
            >
              <div className="flex h-9 min-w-0 flex-1 items-center justify-start gap-2 rounded-full px-2.5 hover:bg-secondary/80">
                <Image
                  src="/logo.png"
                  alt=""
                  aria-hidden="true"
                  width={26}
                  height={26}
                  className="shrink-0 rounded-md object-contain"
                  priority
                />
                <input
                  ref={desktopSearchInputRef}
                  value={desktopSearchQuery}
                  onChange={(event) => {
                    setDesktopSearchQuery(event.target.value);
                    if (!isDesktopSearchActive) {
                      setIsDesktopSearchActive(true);
                    }
                  }}
                  onFocus={activateDesktopSearch}
                  placeholder={
                    desktopSearchType === "name"
                      ? "쯔동여지도 검색하기"
                      : "유튜브 제목으로 검색하기"
                  }
                  name="desktop-left-panel-restaurant-search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  className="w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                  aria-label="맛집 검색어 입력"
                />
                {desktopSearchQuery && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearDesktopSearch();
                    }}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label="검색어 지우기"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleDesktopSearchType();
                }}
                title={
                  desktopSearchType === "name"
                    ? "유튜브 제목으로 검색"
                    : "맛집 이름으로 검색"
                }
                aria-label={
                  desktopSearchType === "name"
                    ? "유튜브 제목 검색으로 전환"
                    : "맛집 이름 검색으로 전환"
                }
                aria-pressed={desktopSearchType === "youtube"}
                className="h-9 w-9 shrink-0 rounded-full border border-border bg-background p-0 hover:bg-secondary/80"
              >
                {desktopSearchType === "name" ? (
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Video className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        )}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain",
            hasActiveDetail || isDetailPanelTransitionPending || isInlinePanelViewActive
              ? "px-0 py-0"
              : "px-4 py-4",
          )}
        >
          {isDetailPanelTransitionPending ? (
            <DesktopLeftPanelLoadingState label="맛집 상세" />
          ) : activeLeftPanelView === "feed" && DeferredFeedOverlay ? (
            <DeferredFeedOverlay
              onClose={handleReturnToMapPanel}
              hideReviewModal={false}
              hideFloatingButton
              initialReviewId={searchParams.get("review")}
              onOpenRestaurantDetail={
                handleInlinePanelRestaurantOpen as (
                  restaurant: Restaurant,
                ) => void
              }
              onOpenUserProfile={handleInlinePanelUserOpen}
              onOpenAuth={() =>
                requestAuthUi({
                  source: "desktop-left-panel-feed",
                  route: "/",
                  reason: "write-review",
                })
              }
            />
          ) : activeLeftPanelView === "stamp" && DeferredStampOverlay ? (
            <DeferredStampOverlay
              onClose={handleReturnToMapPanel}
              singleColumnCards
              onOpenRestaurantDetail={
                handleInlinePanelRestaurantOpen as (
                  restaurant: Restaurant,
                ) => void
              }
            />
          ) : activeLeftPanelView === "leaderboard" &&
            DeferredLeaderboardOverlay ? (
            <DeferredLeaderboardOverlay
              onClose={handleReturnToMapPanel}
              onOpenUserProfile={handleInlinePanelUserOpen}
            />
          ) : activeLeftPanelView === "profile" &&
            activeProfileUserId &&
            DeferredUserProfilePanel ? (
            <DeferredUserProfilePanel
              userId={activeProfileUserId}
              onClose={handleReturnToMapPanel}
              showBackButton
              onUserClick={handleInlinePanelUserOpen}
              onRestaurantClick={
                handleInlinePanelRestaurantOpen as (
                  restaurant: Restaurant,
                ) => void
              }
            />
          ) : activeLeftPanelView === "bookmarks" &&
            DeferredDesktopLeftPanelBookmarks ? (
            <DeferredDesktopLeftPanelBookmarks
              onRestaurantOpen={handleInlinePanelRestaurantOpen}
              onClose={handleReturnToMapPanel}
            />
          ) : activeLeftPanelView === "notifications" &&
            DeferredDesktopLeftPanelNotifications ? (
            <DeferredDesktopLeftPanelNotifications
              onRestaurantIdOpen={handleInlinePanelRestaurantIdOpen}
              onClose={handleReturnToMapPanel}
              onOpenProfile={() => {
                if (!user) return;
                setActiveProfileUserId(user.id);
                setActiveLeftPanelView("profile");
                router.replace("/?panel=profile", { scroll: false });
              }}
              onOpenAnnouncements={() =>
                router.replace("/?panel=announcement", { scroll: false })
              }
            />
          ) : activeLeftPanelView === "announcement" &&
            DeferredAnnouncementPanel ? (
            <div
              className="h-full min-h-0 overflow-hidden bg-background"
              data-desktop-left-panel-announcement="true"
            >
              <DeferredAnnouncementPanel
                isOpen
                onClose={handleExternalLeftPanelClose}
                isAdmin={isAdmin}
                initialAnnouncement={selectedAnnouncement}
                adminActionsMode="console-link"
              />
            </div>
          ) : activeLeftPanelView === "adminReviews" &&
            DeferredAdminReviewPanel ? (
            <div
              className="h-full min-h-0 overflow-hidden bg-background"
              data-desktop-left-panel-admin-reviews="true"
            >
              <DeferredAdminReviewPanel
                isOpen
                onClose={handleExternalLeftPanelClose}
              />
            </div>
          ) : isInlinePanelViewActive ? (
            <DesktopLeftPanelLoadingState
              label={DESKTOP_LEFT_PANEL_LOADING_LABELS[activeLeftPanelView] ?? "패널"}
            />
          ) : (
            <>
              {isPanelOpen && panelRestaurant ? (
                <div
                  className="h-full min-h-0 overflow-hidden bg-background"
                  data-desktop-left-panel-detail-fill="true"
                >
                  <HydratedDetailRestaurant restaurant={panelRestaurant}>
                    {(detailPanelRestaurant) => (
                      <RestaurantDetailPanel
                        restaurant={detailPanelRestaurant}
                        onClose={handleDetailPanelClose}
                        onWriteReview={onReviewModalOpen}
                        onEditRestaurant={
                          onAdminEditRestaurant
                            ? handleAdminEditRestaurant
                            : undefined
                        }
                        onRequestEditRestaurant={handleRequestEditRestaurant}
                        isPanelOpen={isPanelOpen}
                        showDesktopBackButton
                        className="rounded-none border-0 shadow-none"
                      />
                    )}
                  </HydratedDetailRestaurant>
                </div>
              ) : DeferredRestaurantSearch ? (
                <div
                  className="h-full min-h-0 px-0 py-0"
                  data-desktop-left-panel-search-home="true"
                  data-desktop-left-panel-search-results="true"
                >
                  <DeferredRestaurantSearch
                    onRestaurantSelect={handleDesktopSearchRestaurantSelect}
                    onRestaurantSearch={handleDesktopSearchRestaurantSearch}
                    onSearchExecute={onSearchExecute}
                    filters={filters}
                    selectedRegion={
                      mapMode === "domestic" ? selectedRegion : selectedCountry
                    }
                    isKoreanOnly={mapMode === "domestic"}
                    maxItems={12}
                    popularMaxItems={10}
                    resultView="inline"
                    hideSearchControls
                    edgeToEdgeInlineLayout
                    searchQueryValue={desktopSearchQuery}
                    onSearchQueryChange={setDesktopSearchQuery}
                    searchTypeValue={desktopSearchType}
                    onSearchTypeChange={setDesktopSearchType}
                    clearQueryOnSelect
                    className="h-full w-full"
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
