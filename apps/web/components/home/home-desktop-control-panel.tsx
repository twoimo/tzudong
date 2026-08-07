"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import RegionSelector from "@/components/region/RegionSelector";
import DesktopLeftPanelMapHome from "@/components/home/DesktopLeftPanelMapHome";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { OVERSEAS_REGION_LIST } from "@/constants/overseas-regions";
import type { FilterState } from "@/components/filters/filter-state";
import type { HomeMapContextualRestaurantsPayload } from "@/lib/home-map-contextual-restaurants";
import { isPublicRestrictedMode } from "@/lib/site-config";
import type { Announcement } from "@/types/announcement";
import type { Region, Restaurant } from "@/types/restaurant";
import { useOverseasCountryCounts } from "@/components/home/use-overseas-country-counts";
import { useDeferredComponent } from "@/hooks/use-deferred-component";
import AnnouncementPanelLoadingFallback from "@/components/announcement/AnnouncementPanelLoadingFallback";
import HydratedDetailRestaurant from "@/components/home/HydratedDetailRestaurant";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { cn } from "@/lib/utils";
import { requestAuthUi } from "@/lib/auth-ui-events";
import { toast } from "@/lib/no-toast";
import { HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT } from "@/lib/desktop-left-panel-entry";
import {
  DEFAULT_HOME_MAP_USER_PREFERENCES,
  readHomeMapUserPreferences,
  writeHomeMapUserPreferences,
  type HomeMapLayoutMode,
  type HomeMapPanelDefault,
  type HomeMapPanelSide,
  type HomeMapUserPreferences,
} from "@/lib/home-map-user-preferences";
import {
  HOME_MAP_THEME_FILTERS,
  type HomeMapThemeFilterId,
} from "@/lib/home-map-theme-filters";
import { HomeMapThemeFilterIcon } from "@/components/home/home-map-theme-filter-icons";
import type { User } from "@supabase/supabase-js";
import {
  Bell,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Gauge,
  MapPin,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Settings2,
  SlidersHorizontal,
  Stamp,
  Trophy,
  UserRound,
  Video,
  X,
} from "lucide-react";

const EMPTY_SEARCH_PARAMS = new URLSearchParams();
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
  | "settings"
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

type InlinePanelRestaurant = Pick<Restaurant, "id" | "name" | "lat" | "lng"> &
  Partial<Restaurant>;

type DesktopLeftPanelBookmarksComponentProps = {
  onRestaurantOpen: (restaurant: InlinePanelRestaurant) => void;
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
  adminActionsMode?: "inline";
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
  onThemeChange: (themeId: HomeMapThemeFilterId | null) => void;
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onRestaurantSearch: (restaurant: Restaurant) => void;
  onSearchExecute: (region?: Region | null) => void;
  onPanelClick?: (panel: "map" | "detail" | "control") => void;
  initialIntent?: "search" | "bookmark" | "notification" | "user" | null;
  panelRestaurant?: Restaurant | null;
  isPanelOpen?: boolean;
  contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;
  isMapFullscreen?: boolean;
  onPanelClose?: () => void;
  onDetailPanelBack?: () => void;
  onReviewModalOpen?: () => void;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
  onRequestEditRestaurant?: (restaurant: Restaurant) => void;
  onModeChange?: (mode: "domestic" | "overseas") => void;
  isPanelCollapsed?: boolean;
  onTogglePanelCollapse?: () => void;
  onSetPanelCollapsed?: (collapsed: boolean) => void;
  desktopPanelSide?: HomeMapPanelSide;
  user?: User | null;
  isAdmin?: boolean;
  activeRightPanel?: HomeOverlayPanelType;
  selectedAnnouncement?: Announcement | null;
}

const DESKTOP_LEFT_PANEL_WIDTH_PX = 392;
const DESKTOP_MAP_FLOATING_FILTER_WIDTH = "10.9375rem";
const desktopMapMenuItemClass =
  "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground";
type DesktopMapMenuItem = {
  id: Extract<
    DesktopLeftPanelView,
    "feed" | "stamp" | "leaderboard" | "profile" | "bookmarks" | "notifications"
  >;
  label: string;
  icon: typeof MessageSquare;
};
const DESKTOP_MAP_MENU_ITEMS = [
  {
    id: "profile",
    label: "프로필",
    icon: UserRound,
  },
  {
    id: "bookmarks",
    label: "북마크",
    icon: Bookmark,
  },
  {
    id: "notifications",
    label: "알림",
    icon: Bell,
  },
  {
    id: "feed",
    label: "리뷰",
    icon: MessageSquare,
  },
  {
    id: "stamp",
    label: "도장",
    icon: Stamp,
  },
  {
    id: "leaderboard",
    label: "랭킹",
    icon: Trophy,
  },
] as const satisfies ReadonlyArray<DesktopMapMenuItem>;

const DESKTOP_LEFT_PANEL_AUTH_TOASTS = {
  profile: "로그인 후 프로필을 확인할 수 있어요",
  bookmarks: "로그인 후 북마크를 확인할 수 있어요",
  notifications: "로그인 후 알림을 확인할 수 있어요",
  settings: "로그인 후 지도 환경설정을 사용할 수 있어요",
  review: "로그인 후 리뷰를 작성할 수 있어요",
} as const;

const showDesktopLeftPanelAuthToast = (
  reason: keyof typeof DESKTOP_LEFT_PANEL_AUTH_TOASTS,
) => {
  toast.info(DESKTOP_LEFT_PANEL_AUTH_TOASTS[reason]);
};

const HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT =
  "home:desktop-detail-return-capture";

const replaceBrowserHistoryRoute = (route: string) => {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", route);
};

const LAYOUT_PRESETS = [
  {
    id: "balanced",
    title: "균형형",
    description: "사이드 패널을 펼치고 지도는 패널 너비를 고려해 보여줍니다.",
    desktopPanelDefault: "expanded",
    desktopMapLayout: "panel-aware",
  },
  {
    id: "map-first",
    title: "지도 우선",
    description: "초기 진입 시 패널을 접고 지도를 가장 넓게 보여줍니다.",
    desktopPanelDefault: "collapsed",
    desktopMapLayout: "map-first",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  desktopPanelDefault: HomeMapPanelDefault;
  desktopMapLayout: HomeMapLayoutMode;
}>;

function DesktopMapSettingsPanel({
  user,
  isPanelCollapsed,
  onClose,
  onSetPanelCollapsed,
}: {
  user: User;
  isPanelCollapsed: boolean;
  onClose: () => void;
  onSetPanelCollapsed?: (collapsed: boolean) => void;
}) {
  const [preferences, setPreferences] = useState<HomeMapUserPreferences>(() =>
    readHomeMapUserPreferences(user.id),
  );
  const selectedPreset =
    LAYOUT_PRESETS.find(
      (preset) =>
        preset.desktopPanelDefault === preferences.desktopPanelDefault &&
        preset.desktopMapLayout === preferences.desktopMapLayout,
    )?.id ?? "custom";

  useEffect(() => {
    setPreferences(readHomeMapUserPreferences(user.id));
  }, [user.id]);

  const persistPreferences = useCallback(
    (
      nextPreferences: HomeMapUserPreferences,
      options: { preservePanelCollapse?: boolean } = {},
    ) => {
      const normalized = writeHomeMapUserPreferences(
        user.id,
        nextPreferences,
        undefined,
        options,
      );
      setPreferences(normalized);
      if (!options.preservePanelCollapse) {
        onSetPanelCollapsed?.(normalized.desktopPanelDefault === "collapsed");
      }
    },
    [onSetPanelCollapsed, user.id],
  );

  const applyPreset = useCallback(
    (preset: (typeof LAYOUT_PRESETS)[number]) => {
      persistPreferences({
        ...preferences,
        desktopPanelDefault: preset.desktopPanelDefault,
        desktopMapLayout: preset.desktopMapLayout,
      });
    },
    [persistPreferences, preferences],
  );

  const updatePanelDefault = useCallback(
    (desktopPanelDefault: HomeMapPanelDefault) => {
      persistPreferences({
        ...preferences,
        desktopPanelDefault,
        desktopMapLayout:
          desktopPanelDefault === "collapsed"
            ? "map-first"
            : preferences.desktopMapLayout,
      });
    },
    [persistPreferences, preferences],
  );

  const updateMapLayout = useCallback(
    (desktopMapLayout: HomeMapLayoutMode) => {
      persistPreferences({
        ...preferences,
        desktopMapLayout,
        desktopPanelDefault:
          desktopMapLayout === "map-first"
            ? "collapsed"
            : preferences.desktopPanelDefault,
      });
    },
    [persistPreferences, preferences],
  );

  const updatePanelSide = useCallback(
    (desktopPanelSide: HomeMapPanelSide) => {
      persistPreferences(
        {
          ...preferences,
          desktopPanelSide,
        },
        { preservePanelCollapse: true },
      );
    },
    [persistPreferences, preferences],
  );

  const resetPreferences = useCallback(() => {
    persistPreferences(DEFAULT_HOME_MAP_USER_PREFERENCES);
  }, [persistPreferences]);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      data-desktop-left-panel-view="settings"
      aria-labelledby="desktop-map-settings-title"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-primary">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            계정별 환경설정
          </p>
          <h2
            id="desktop-map-settings-title"
            className="mt-1 text-lg font-bold tracking-[-0.04em] text-foreground"
          >
            지도와 사이드 패널 맞춤 설정
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            이 브라우저에서 {user.email ?? "현재 계정"} 기준으로 저장되고, 다음
            데스크탑 접속부터 같은 배치로 시작합니다.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full"
          onClick={onClose}
          aria-label="환경설정 닫기"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4">
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <PanelLeft
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  시작 레이아웃 프리셋
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  수치 슬라이더 대신 안전한 프리셋만 제공해 지도 영역이 깨지지
                  않게 했습니다.
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {LAYOUT_PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none",
                      isSelected
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-border bg-background hover:border-primary/25 hover:bg-secondary/50",
                    )}
                  >
                    <span className="text-sm font-bold">{preset.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {preset.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <MapPin
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  지도 영역 위치
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  패널을 고려해 마커를 보여줄지, 지도를 최대한 넓게 시작할지
                  고릅니다.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["panel-aware", "패널 고려"],
                ["map-first", "지도 우선"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={
                    preferences.desktopMapLayout === value
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={preferences.desktopMapLayout === value}
                  className="rounded-xl"
                  onClick={() => updateMapLayout(value as HomeMapLayoutMode)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <PanelRight
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  사이드 패널 위치
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  오른손 조작이나 넓은 화면 취향에 맞춰 패널을 좌우로 옮길 수
                  있습니다.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["left", "왼쪽"],
                ["right", "오른쪽"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={
                    preferences.desktopPanelSide === value
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={preferences.desktopPanelSide === value}
                  className="rounded-xl"
                  onClick={() => updatePanelSide(value as HomeMapPanelSide)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <Gauge
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  사이드 패널 기본 상태
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  현재 패널은 {isPanelCollapsed ? "접힘" : "펼침"} 상태입니다.
                  선택하면 즉시 적용됩니다.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["expanded", "펼쳐서 시작"],
                ["collapsed", "접어서 시작"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={
                    preferences.desktopPanelDefault === value
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={preferences.desktopPanelDefault === value}
                  className="rounded-xl"
                  onClick={() =>
                    updatePanelDefault(value as HomeMapPanelDefault)
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-background/95 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          className="w-full rounded-xl"
          onClick={resetPreferences}
        >
          기본값으로 되돌리기
        </Button>
      </footer>
    </section>
  );
}

const DESKTOP_LEFT_PANEL_ROUTE_VIEWS = [
  "feed",
  "stamp",
  "leaderboard",
  "profile",
  "bookmarks",
  "notifications",
  "settings",
  "announcement",
] as const satisfies ReadonlyArray<
  Exclude<DesktopLeftPanelView, "map" | "adminReviews">
>;

function isDesktopLeftPanelRouteView(
  value: string | null,
): value is Exclude<DesktopLeftPanelView, "map" | "adminReviews"> {
  return DESKTOP_LEFT_PANEL_ROUTE_VIEWS.includes(
    value as Exclude<DesktopLeftPanelView, "map" | "adminReviews">,
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

function buildOptimisticDetailRestaurant(
  restaurant: InlinePanelRestaurant,
): Restaurant {
  const categories = restaurant.categories ?? restaurant.category ?? [];
  const address =
    restaurant.address ??
    restaurant.road_address ??
    restaurant.jibun_address ??
    "";
  const createdAt = restaurant.created_at ?? new Date(0).toISOString();
  const updatedAt = restaurant.updated_at ?? createdAt;

  return {
    id: restaurant.id,
    approved_name: restaurant.approved_name ?? null,
    unique_id: restaurant.unique_id ?? restaurant.id,
    name: restaurant.name,
    phone: restaurant.phone ?? null,
    categories,
    status: restaurant.status ?? "approved",
    source_type: restaurant.source_type ?? "restaurant-preview",
    youtube_meta: restaurant.youtube_meta ?? null,
    evaluation_results: restaurant.evaluation_results ?? null,
    reasoning_basis: restaurant.reasoning_basis ?? null,
    tzuyang_review: restaurant.tzuyang_review ?? null,
    trace_id: restaurant.trace_id ?? null,
    origin_address: restaurant.origin_address ?? null,
    road_address: restaurant.road_address ?? null,
    jibun_address: restaurant.jibun_address ?? null,
    english_address: restaurant.english_address ?? null,
    address_elements: restaurant.address_elements ?? null,
    geocoding_success:
      restaurant.geocoding_success ?? Boolean(restaurant.lat && restaurant.lng),
    geocoding_false_stage: restaurant.geocoding_false_stage ?? null,
    is_missing: restaurant.is_missing ?? false,
    is_not_selected: restaurant.is_not_selected ?? false,
    lat: restaurant.lat ?? null,
    lng: restaurant.lng ?? null,
    youtube_link: restaurant.youtube_link ?? null,
    ai_rating: restaurant.ai_rating ?? null,
    visit_count: restaurant.visit_count ?? null,
    review_count: restaurant.review_count ?? null,
    description: restaurant.description ?? null,
    created_by: restaurant.created_by ?? null,
    updated_by_admin_id: restaurant.updated_by_admin_id ?? null,
    db_error_message: restaurant.db_error_message ?? null,
    db_error_details: restaurant.db_error_details ?? null,
    search_count: restaurant.search_count ?? null,
    weekly_search_count: restaurant.weekly_search_count ?? null,
    origin_name: restaurant.origin_name ?? null,
    naver_name: restaurant.naver_name ?? null,
    google_name: restaurant.google_name ?? null,
    trace_id_name_source: restaurant.trace_id_name_source ?? null,
    channel_name: restaurant.channel_name ?? null,
    description_map_url: restaurant.description_map_url ?? null,
    recollect_version: restaurant.recollect_version ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    address,
    category: categories,
    mergedYoutubeLinks: restaurant.mergedYoutubeLinks,
    mergedTzuyangReviews: restaurant.mergedTzuyangReviews,
    mergedYoutubeMetas: restaurant.mergedYoutubeMetas,
    youtube_links: restaurant.youtube_links,
    tzuyang_reviews: restaurant.tzuyang_reviews,
    mergedRestaurants: restaurant.mergedRestaurants,
  };
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
  onThemeChange,
  onRestaurantSelect,
  onRestaurantSearch,
  onSearchExecute,
  onPanelClick,
  initialIntent = null,
  panelRestaurant = null,
  isPanelOpen = false,
  contextualRestaurantsPayload = null,
  isMapFullscreen = false,
  onPanelClose,
  onDetailPanelBack,
  onReviewModalOpen,
  onAdminEditRestaurant,
  onRequestEditRestaurant,
  onModeChange,
  isPanelCollapsed = false,
  onTogglePanelCollapse,
  onSetPanelCollapsed,
  desktopPanelSide = "left",
  user = null,
  isAdmin = false,
  activeRightPanel = null,
  selectedAnnouncement = null,
}: HomeDesktopControlPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
  const initialRoutePanel = searchParams.get("panel");
  const countryCounts = useOverseasCountryCounts(mapMode);
  const desktopSearchShellRef = useRef<HTMLDivElement>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const [activeLeftPanelView, setActiveLeftPanelView] =
    useState<DesktopLeftPanelView>(() =>
      initialRoutePanel === "announcement" && !isPublicRestrictedMode ? "announcement" : "map",
    );
  const [activeProfileUserId, setActiveProfileUserId] = useState<string | null>(
    user?.id ?? null,
  );
  const [desktopSearchQuery, setDesktopSearchQuery] = useState("");
  const [desktopSearchType, setDesktopSearchType] =
    useState<SearchType>("name");
  const [isDesktopSearchActive, setIsDesktopSearchActive] = useState(
    initialIntent === "search",
  );
  const [, setIsInlineDetailOpenPending] = useState(false);
  const activeLeftPanelViewRef = useRef(activeLeftPanelView);
  const activeProfileUserIdRef = useRef(activeProfileUserId);
  const activeDetailRestaurantIdRef = useRef<string | null>(null);
  const revealDesktopLeftPanel = useCallback(() => {
    onSetPanelCollapsed?.(false);
    onPanelClick?.("control");
  }, [onPanelClick, onSetPanelCollapsed]);
  const hasCapturedDetailReturnRef = useRef(false);
  const pendingDetailReturnCaptureRef = useRef(false);
  const detailReturnStateRef = useRef<DesktopDetailReturnState>({
    view: "map",
    profileUserId: null,
    searchQuery: "",
    searchType: "name",
    isSearchActive: false,
  });
  const hasDesktopSearchIntent =
    isDesktopSearchActive || desktopSearchQuery.trim().length > 0;
  const shouldShowDesktopSearchResults =
    activeLeftPanelView === "map" &&
    hasDesktopSearchIntent;
  const shouldShowDesktopMapHome =
    activeLeftPanelView === "map" &&
    !isPanelOpen &&
    !shouldShowDesktopSearchResults;
  const DeferredRestaurantSearch =
    useDeferredComponent<RestaurantSearchComponentProps>(
      shouldShowDesktopSearchResults,
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
      activeLeftPanelView === "announcement" && !isPublicRestrictedMode,
      loadAnnouncementPanel,
    );
  const DeferredAdminReviewPanel =
    useDeferredComponent<AdminReviewPanelComponentProps>(
      activeLeftPanelView === "adminReviews" && isAdmin,
      loadAdminReviewPanel,
    );
  useEffect(() => {
    if (initialIntent !== "search") return;

    revealDesktopLeftPanel();
  }, [initialIntent, revealDesktopLeftPanel]);

  useEffect(() => {
    activeLeftPanelViewRef.current = activeLeftPanelView;
  }, [activeLeftPanelView]);

  useEffect(() => {
    activeProfileUserIdRef.current = activeProfileUserId;
  }, [activeProfileUserId]);

  const revealAnnouncementLeftPanel = useCallback(() => {
    if (isPublicRestrictedMode) return;
    flushSync(() => {
      setActiveLeftPanelView("announcement");
      setIsDesktopSearchActive(false);
    });
    onPanelClick?.("control");
  }, [onPanelClick]);

  useEffect(() => {
    window.addEventListener(
      "openAnnouncementDetail",
      revealAnnouncementLeftPanel,
    );
    window.addEventListener(
      "openAdminAnnouncements",
      revealAnnouncementLeftPanel,
    );
    return () => {
      window.removeEventListener(
        "openAnnouncementDetail",
        revealAnnouncementLeftPanel,
      );
      window.removeEventListener(
        "openAdminAnnouncements",
        revealAnnouncementLeftPanel,
      );
    };
  }, [revealAnnouncementLeftPanel]);

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
      pendingDetailReturnCaptureRef.current = Boolean(
        options.pendingDetailOpen,
      );
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
      if (returnState.view !== "map") {
        onSetPanelCollapsed?.(false);
      }
      setActiveProfileUserId(returnState.profileUserId || user?.id || null);
      router.replace(
        getDesktopLeftPanelRoute(
          returnState.view,
          returnState.profileUserId || user?.id,
        ),
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
  }, [onSetPanelCollapsed, router, user]);

  useEffect(() => {
    const panelParam = searchParams.get("panel");
    if (isPublicRestrictedMode) {
      if (activeRightPanel === null) {
        setActiveLeftPanelView("map");
      }
      return;
    }
    if (!isDesktopLeftPanelRouteView(panelParam)) {
      if (activeRightPanel === null) {
        setActiveLeftPanelView("map");
      }
      return;
    }

    if (
      (panelParam === "profile" ||
        panelParam === "bookmarks" ||
        panelParam === "notifications" ||
        panelParam === "settings") &&
      !user
    ) {
      showDesktopLeftPanelAuthToast(
        panelParam === "profile"
          ? "profile"
          : panelParam === "bookmarks"
            ? "bookmarks"
            : panelParam === "notifications"
              ? "notifications"
              : "settings",
      );
      requestAuthUi({
        source: "desktop-left-panel",
        route: "/",
        reason:
          panelParam === "profile"
            ? "open-profile"
            : panelParam === "bookmarks"
              ? "open-bookmarks"
              : panelParam === "notifications"
                ? "open-notifications"
                : "open-settings",
      });
      router.replace("/", { scroll: false });
      setActiveLeftPanelView("map");
      return;
    }

    setActiveLeftPanelView(panelParam);
    onSetPanelCollapsed?.(false);
    if (panelParam === "profile") {
      setActiveProfileUserId(searchParams.get("user") || user?.id || null);
    }
  }, [activeRightPanel, onSetPanelCollapsed, router, searchParams, user]);

  useEffect(() => {
    if (activeRightPanel === "announcement") {
    if (isPublicRestrictedMode) return;
      setActiveLeftPanelView("announcement");
      setIsDesktopSearchActive(false);
      revealDesktopLeftPanel();
      return;
    }

    if (activeRightPanel === "adminReviews" && isAdmin) {
      setActiveLeftPanelView("adminReviews");
      setIsDesktopSearchActive(false);
      revealDesktopLeftPanel();
      return;
    }

    const panelParam = searchParams.get("panel");
    if (
      activeRightPanel === null &&
      panelParam !== "announcement" &&
      (activeLeftPanelViewRef.current === "announcement" ||
        activeLeftPanelViewRef.current === "adminReviews")
    ) {
      setActiveLeftPanelView("map");
    }
  }, [activeRightPanel, isAdmin, revealDesktopLeftPanel, searchParams]);

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

    revealDesktopLeftPanel();
    setActiveLeftPanelView("map");
    setIsDesktopSearchActive(true);
  }, [activeRightPanel, onPanelClose, revealDesktopLeftPanel]);

  const toggleDesktopSearchType = useCallback(() => {
    setDesktopSearchType((current) =>
      current === "name" ? "youtube" : "name",
    );
    setIsDesktopSearchActive(true);
    desktopSearchInputRef.current?.focus();
  }, []);

  const clearDesktopSearch = useCallback(() => {
    setDesktopSearchQuery("");
    setIsDesktopSearchActive(false);
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
    (onDetailPanelBack ?? onPanelClose)?.();

    setDesktopSearchQuery(returnState.searchQuery);
    setDesktopSearchType(returnState.searchType);
    setIsDesktopSearchActive(returnState.isSearchActive);

    if (
      (returnView === "profile" ||
        returnView === "bookmarks" ||
        returnView === "notifications" ||
        returnView === "settings") &&
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
    if (returnView !== "map") {
      onSetPanelCollapsed?.(false);
    }
    router.replace(returnRoute, { scroll: false });
    replaceBrowserHistoryRoute(returnRoute);
  }, [onDetailPanelBack, onPanelClose, onSetPanelCollapsed, router, user]);

  const handleShortcutClick = useCallback(
    (
      panel: Extract<DesktopLeftPanelView, "feed" | "stamp" | "leaderboard">,
    ) => {
      pendingDetailReturnCaptureRef.current = false;
      setIsInlineDetailOpenPending(false);
      if (activeRightPanel !== null) {
        onPanelClose?.();
      }

      revealDesktopLeftPanel();
      setActiveLeftPanelView(panel);
      router.push(`/?panel=${panel}`, { scroll: false });
    },
    [activeRightPanel, onPanelClose, revealDesktopLeftPanel, router],
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
      showDesktopLeftPanelAuthToast("profile");
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

    revealDesktopLeftPanel();
    setActiveProfileUserId(user.id);
    setActiveLeftPanelView("profile");
    router.push("/?panel=profile", { scroll: false });
  }, [activeRightPanel, onPanelClose, revealDesktopLeftPanel, router, user]);

  const handleBookmarkClick = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (!user) {
      showDesktopLeftPanelAuthToast("bookmarks");
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

    revealDesktopLeftPanel();
    setActiveLeftPanelView("bookmarks");
    router.push("/?panel=bookmarks", { scroll: false });
  }, [activeRightPanel, onPanelClose, revealDesktopLeftPanel, router, user]);

  const handleNotificationClick = useCallback(() => {
    pendingDetailReturnCaptureRef.current = false;
    setIsInlineDetailOpenPending(false);

    if (!user) {
      showDesktopLeftPanelAuthToast("notifications");
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

    revealDesktopLeftPanel();
    setActiveLeftPanelView("notifications");
    router.push("/?panel=notifications", { scroll: false });
  }, [activeRightPanel, onPanelClose, revealDesktopLeftPanel, router, user]);

  const handleDesktopMapMenuItemSelect = useCallback(
    (id: DesktopMapMenuItem["id"]) => {
      switch (id) {
        case "profile":
          handleAccountClick();
          return;
        case "bookmarks":
          handleBookmarkClick();
          return;
        case "notifications":
          handleNotificationClick();
          return;
        case "feed":
        case "stamp":
        case "leaderboard":
          handleShortcutClick(id);
          return;
      }
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
      setIsInlineDetailOpenPending(false);
      setIsDesktopSearchActive(false);
      window.dispatchEvent(
        new CustomEvent("selectBookmarkRestaurant", {
          detail: {
            id: restaurantId,
            mode,
          },
        }),
      );
    },
    [captureDetailReturnView, mapMode],
  );

  const handleInlinePanelRestaurantOpen = useCallback(
    (restaurant: InlinePanelRestaurant) => {
      const optimisticRestaurant = buildOptimisticDetailRestaurant(restaurant);
      captureDetailReturnView(activeLeftPanelViewRef.current, {
        pendingDetailOpen: true,
      });
      setIsInlineDetailOpenPending(false);
      setIsDesktopSearchActive(false);
      if (activeRightPanel !== null) {
        onPanelClose?.();
      }

      handleModeChange(inferRestaurantMapMode(optimisticRestaurant));
      onRestaurantSearch(optimisticRestaurant);
    },
    [
      activeRightPanel,
      captureDetailReturnView,
      handleModeChange,
      onPanelClose,
      onRestaurantSearch,
    ],
  );

  const handleInlinePanelUserOpen = useCallback(
    (userId: string) => {
      revealDesktopLeftPanel();
      setActiveProfileUserId(userId);
      setActiveLeftPanelView("profile");
      router.push(`/?panel=profile&user=${encodeURIComponent(userId)}`, {
        scroll: false,
      });
    },
    [revealDesktopLeftPanel, router],
  );
  const hasActiveDetail = isPanelOpen && Boolean(panelRestaurant);
  const isInlinePanelViewActive = activeLeftPanelView !== "map";
  const hasDesktopSearchQuery = desktopSearchQuery.trim().length > 0;
  const selectedTheme = filters.featuredTheme ?? null;
  // The hamburger menu intentionally lives in the expanded desktop search slot.
  // When the panel is collapsed, the persistent edge toggle reveals this slot;
  // we do not add a second map-floating nav because the old map overlay buttons
  // were explicitly removed from the map surface.
  const panelSideLabel = desktopPanelSide === "right" ? "우측" : "좌측";
  const panelToggleLabel = isPanelCollapsed
    ? `${panelSideLabel} 패널 펼치기`
    : `${panelSideLabel} 패널 접기`;
  const desktopMapFloatingControlStyle = {
    left:
      !isPanelCollapsed && desktopPanelSide === "left"
        ? `calc(min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px)) + 1rem)`
        : "1rem",
    "--desktop-map-floating-filter-width": DESKTOP_MAP_FLOATING_FILTER_WIDTH,
  } as CSSProperties;
  const desktopMapThemeFilterStyle = {
    ...desktopMapFloatingControlStyle,
    right:
      !isPanelCollapsed && desktopPanelSide === "right"
        ? `calc(min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px)) + 1rem)`
        : "1rem",
  } as CSSProperties;

  return (
    <>
      {!hasActiveDetail && (
        <>
          <div
            className="fixed right-4 top-4 z-[70] min-w-0"
            style={desktopMapThemeFilterStyle}
            data-desktop-map-theme-filters="true"
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
          >
            <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto rounded-full p-0.5 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {HOME_MAP_THEME_FILTERS.map((theme) => {
                const isSelected = selectedTheme === theme.id;
                return (
                  <Button
                    key={theme.id}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onThemeChange(isSelected ? null : theme.id)}
                    aria-pressed={isSelected}
                    aria-label={`${theme.ariaLabel}${isSelected ? " 선택됨" : ""}`}
                    title={`${theme.label}: ${theme.description}`}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 home-map-floating-control-text text-xs font-semibold shadow-lg backdrop-blur-sm transition-colors motion-reduce:transition-none",
                      "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background/95 text-foreground hover:bg-secondary/80",
                    )}
                  >
                    <HomeMapThemeFilterIcon themeId={theme.id} />
                    <span>{theme.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div
            className="fixed bottom-6 z-[70] grid auto-rows-auto grid-cols-[max-content] items-start gap-2"
            style={desktopMapFloatingControlStyle}
            data-desktop-map-floating-filters="true"
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
          >
            {onModeChange && (
              <div
                className="flex w-[var(--desktop-map-floating-filter-width)] items-center gap-0.5 rounded-full border border-border bg-background/95 p-0.5 shadow-lg backdrop-blur-sm"
                data-desktop-map-mode-toggle="true"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleModeChange("domestic")}
                  aria-pressed={mapMode === "domestic"}
                  aria-label="국내 맛집 지도 보기"
                  className={cn(
                    "h-9 flex-1 rounded-full px-2 home-map-floating-control-text text-xs font-medium transition-colors motion-reduce:transition-none",
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
                    "h-9 flex-1 rounded-full px-2 home-map-floating-control-text text-xs font-medium transition-colors motion-reduce:transition-none",
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
                className="!h-9 !w-full !min-w-max rounded-full border-border bg-background/95 px-3 home-map-floating-control-text text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80"
                contentSide="top"
                contentAlign="start"
              />
            ) : (
              <Select
                value={selectedCountry || undefined}
                onValueChange={onCountryChange}
              >
                <SelectTrigger className="h-9 w-full min-w-max rounded-full border-border bg-background/95 px-3 home-map-floating-control-text text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80">
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
              className="h-9 w-full min-w-max rounded-full border-border bg-background/95 px-3 home-map-floating-control-text text-xs font-medium whitespace-nowrap shadow-lg backdrop-blur-sm hover:bg-secondary/80"
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
          "desktop-left-panel-scrollbarless fixed inset-y-0 z-[90] flex w-[min(392px,calc(100vw-32px))] flex-col border-border bg-background shadow-xl",
          desktopPanelSide === "right" ? "right-0 border-l" : "left-0 border-r",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          isPanelCollapsed
            ? desktopPanelSide === "right"
              ? "translate-x-full"
              : "-translate-x-full"
            : "translate-x-0",
        )}
        style={{
          width: `min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px))`,
        }}
        data-desktop-left-map-panel="true"
        data-desktop-panel-side={desktopPanelSide}
        data-panel-collapsed={isPanelCollapsed ? "true" : "false"}
        onMouseDownCapture={handlePanelMouseDownCapture}
        onFocusCapture={handlePanelFocusCapture}
      >
        {onTogglePanelCollapse && (
          <button
            type="button"
            onClick={onTogglePanelCollapse}
            className={cn(
              "group absolute top-1/2 z-50 flex h-12 w-6 -translate-y-1/2 items-center justify-center border border-border bg-background shadow-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              desktopPanelSide === "right"
                ? "left-0 -translate-x-full rounded-l-lg border-r-0"
                : "right-0 translate-x-full rounded-r-lg border-l-0",
            )}
            title={panelToggleLabel}
            aria-label={panelToggleLabel}
            aria-controls="desktop-left-map-panel"
            aria-expanded={!isPanelCollapsed}
          >
            {isPanelCollapsed ? (
              desktopPanelSide === "right" ? (
                <ChevronLeft
                  className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
                  aria-hidden="true"
                />
              )
            ) : desktopPanelSide === "right" ? (
              <ChevronRight
                className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronLeft
                className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
                aria-hidden="true"
              />
            )}
          </button>
        )}
        <div
          className="flex min-h-0 flex-1 flex-col"
          aria-hidden={isPanelCollapsed}
          inert={isPanelCollapsed}
        >
          <div
            className="space-y-3 border-b border-border px-4 py-3"
            data-desktop-left-panel-search-shell="true"
          >
            <div
              className={cn(
                "pointer-events-auto flex items-center gap-1.5 min-h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5",
              )}
              data-desktop-left-panel-search-bar="true"
              onClick={activateDesktopSearch}
            >
              <div className="flex-1 h-9 rounded-full flex items-center gap-2 px-2 bg-secondary/40 min-w-0">
                <Image
                  src="/logo.webp"
                  alt="로고"
                  width={24}
                  height={24}
                  className="shrink-0 rounded-md object-contain"
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
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/70"
                  aria-label="맛집 검색어 입력"
                />
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
                className="h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
              >
                {desktopSearchType === "name" ? (
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Video className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              {hasDesktopSearchQuery ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearDesktopSearch();
                    desktopSearchInputRef.current?.blur();
                  }}
                  aria-label="검색 닫기"
                  className="h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={(event) => event.stopPropagation()}
                      aria-label="지도 메뉴 열기"
                      className="h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
                      data-desktop-map-menu-trigger="true"
                    >
                      <Menu className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl"
                    data-desktop-map-menu="true"
                  >
                    {DESKTOP_MAP_MENU_ITEMS.map((item) => {
                      const isActive = activeLeftPanelView === item.id;
                      const ItemIcon = item.icon;
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() => handleDesktopMapMenuItemSelect(item.id)}
                          className={cn(
                            desktopMapMenuItemClass,
                            isActive && "bg-primary/10 text-primary focus:text-primary",
                          )}
                          aria-label={`${item.label} 패널 열기`}
                        >
                          <ItemIcon
                            className="mr-2 h-4 w-4"
                            aria-hidden="true"
                          />
                          {item.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
              hasActiveDetail ||
                isInlinePanelViewActive ||
                shouldShowDesktopMapHome
                ? "px-0 py-0"
                : "px-4 py-4",
            )}
          >
            {activeLeftPanelView === "feed" && DeferredFeedOverlay ? (
              <DeferredFeedOverlay
                onClose={handleReturnToMapPanel}
                onOpenReviewModal={onReviewModalOpen}
                hideReviewModal={Boolean(onReviewModalOpen)}
                initialReviewId={searchParams.get("review")}
                onOpenRestaurantDetail={
                  handleInlinePanelRestaurantOpen as (
                    restaurant: Restaurant,
                  ) => void
                }
                onOpenUserProfile={handleInlinePanelUserOpen}
                onOpenAuth={() => {
                  showDesktopLeftPanelAuthToast("review");
                  requestAuthUi({
                    source: "desktop-left-panel-feed",
                    route: "/",
                    reason: "write-review",
                  });
                }}
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
                  router.push("/?panel=profile", { scroll: false });
                }}
                onOpenAnnouncements={() => {
                  if (isPublicRestrictedMode) return;
                  router.push("/?panel=announcement", { scroll: false });
                }}
              />
            ) : activeLeftPanelView === "settings" && user ? (
              <DesktopMapSettingsPanel
                user={user}
                isPanelCollapsed={isPanelCollapsed}
                onClose={handleReturnToMapPanel}
                onSetPanelCollapsed={onSetPanelCollapsed}
              />
            ) : activeLeftPanelView === "announcement" && !isPublicRestrictedMode ? (
              <div
                className="h-full min-h-0 overflow-hidden bg-background"
                data-desktop-left-panel-announcement="true"
              >
                {DeferredAnnouncementPanel ? (
                  <DeferredAnnouncementPanel
                    isOpen
                    onClose={handleExternalLeftPanelClose}
                    isAdmin={isAdmin}
                    initialAnnouncement={selectedAnnouncement}
                    adminActionsMode="inline"
                  />
                ) : (
                  <AnnouncementPanelLoadingFallback
                    isAdmin={isAdmin}
                    onClose={handleExternalLeftPanelClose}
                  />
                )}
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
            ) : isInlinePanelViewActive ? null : (
              <>
                {shouldShowDesktopSearchResults && DeferredRestaurantSearch ? (
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
                        mapMode === "domestic"
                          ? selectedRegion
                          : selectedCountry
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
                ) : isPanelOpen && panelRestaurant ? (
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
                ) : shouldShowDesktopMapHome ? (
                  <DesktopLeftPanelMapHome
                    onRestaurantOpen={
                      handleInlinePanelRestaurantOpen as (
                        restaurant: Restaurant,
                      ) => void
                    }
                    selectedRegion={
                      mapMode === "domestic" ? selectedRegion : selectedCountry
                    }
                    isKoreanOnly={mapMode === "domestic"}
                    contextualRestaurantsPayload={mapMode === "domestic" && !isMapFullscreen ? contextualRestaurantsPayload : null}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
