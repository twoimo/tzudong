'use client';

import { isSupersededLogout } from '@/lib/auth/logout-result';
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';

import { memo, useState, useCallback, useMemo, useRef, useEffect, type ComponentType, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
    Filter,
    List,
    X,
    MapPin,
    Video,
    Bookmark,
    Bell,
    Check,
    Send,
    User as UserIcon,
    BarChart2,
    PanelLeft,
    LogOut,
    ChevronDown,
    ChevronUp,
    LocateFixed,
    Navigation,
    Eye,
    EyeOff
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { StampCard } from '@/components/stamp/StampCard';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuGroup,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { DEFAULT_FOCUS_TRAP_ALLOW_SELECTORS, getFocusTrapContainers, shouldHideModalSibling } from '@/components/ui/bottom-sheet';
import { Region, REGIONS, Restaurant } from '@/types/restaurant';
import { homeMapResultCountLabel, homeMapResultStatusText, reconcileHomeMapContextualResults, type HomeMapResultSummary } from '@/lib/home-map-result-summary';
import type { FilterState } from '@/components/filters/filter-state';
import { toast } from '@/lib/no-toast';
import { incrementSearchCount } from '@/lib/search-count';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContextBase';
import { resolveDeviceLocationButtonLabel, type DeviceMapLocation } from '@/lib/device-location-map';
import { DeviceLocationDisclosure } from '@/components/home/DeviceLocationDisclosure';
import { DeferredPanelFallback } from '@/components/home/DeferredPanelFallback';
import { useDeferredComponentWithRetry } from '@/hooks/use-deferred-component';
import { OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import { isPublicRestrictedMode, siteConfig } from "@/lib/site-config";
import {
    HOME_MAP_CONTEXTUAL_MOBILE_LIMIT,
    type HomeMapContextualRestaurantsPayload,
} from '@/lib/home-map-contextual-restaurants';
import {
    type HomeMapThemeFilterId,
} from '@/lib/home-map-theme-filters';
import { HomeMapThemeFilters } from '@/components/home/HomeMapThemeFilters';
import { getHomeMapRegionOptionCount } from '@/components/home/home-map-region-option-count';
import { preloadOverseasMap } from '@/lib/overseas-map-loader';

declare global {
    interface Window {
        /** Set while the mobile control overlay is mounted; read by hydration checks. */
        __tzudong_mobile_overlay_ready?: boolean;
    }
}

// 카테고리 상수
const CATEGORIES = [
    "한식", "중식", "양식", "분식", "치킨", "피자", "고기",
    "족발·보쌈", "돈까스·회", "아시안", "패스트푸드",
    "카페·디저트", "찜·탕", "야식", "도시락"
];
const MIN_SHEET_HEIGHT = 25;
const VISIBLE_MARKER_SHEET_HEIGHT = 25;
const HALF_SHEET_HEIGHT = 50;
const MAX_SHEET_HEIGHT = 100;
const MOBILE_SEARCH_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

type SearchType = 'name' | 'youtube';

type RestaurantSearchComponentProps = {
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onSearchExecute?: () => void;
    onRestaurantSearch?: (restaurant: Restaurant) => void;
    className?: string;
    filters?: FilterState;
    selectedRegion?: string | null;
    isKoreanOnly?: boolean;
    maxItems?: number;
    resultView?: 'dropdown' | 'inline';
    hideSearchControls?: boolean;
    searchQueryValue?: string;
    onSearchQueryChange?: (value: string) => void;
    searchTypeValue?: SearchType;
    onSearchTypeChange?: (value: SearchType) => void;
    onSearchInputFocus?: () => void;
    clearQueryOnSelect?: boolean;
};

type MobileBookmarkMenuButtonProps = {
    user: User;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

const loadMobileBookmarkMenuButton = async () => {
    const mod = await import('@/components/home/MobileBookmarkMenuButton');
    return mod.default as ComponentType<MobileBookmarkMenuButtonProps>;
};

type MobileNotificationMenuButtonProps = {
    user: User;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

const loadMobileNotificationMenuButton = async () => {
    const mod = await import('@/components/home/MobileNotificationMenuButton');
    return mod.default as ComponentType<MobileNotificationMenuButtonProps>;
};

const mobileTopIconButtonClass = cn(
    'h-11 w-11 shrink-0 rounded-full border border-border bg-background',
    'hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation'
);

const mobileTopIconButtonWithBadgeClass = cn(mobileTopIconButtonClass, 'relative');
const mobileTopIconGlyphClass = 'h-[18px] w-[18px]';

const mobileUserMenuContentClass = 'w-max max-w-[calc(100vw-1rem)] bg-card border-border font-sans z-[110]';
const mobileUserMenuItemClass = 'text-foreground hover:bg-accent py-1.5 whitespace-nowrap';

const loadRestaurantSearch = async () => {
    const mod = await import('@/components/search/RestaurantSearch');
    return mod.default as ComponentType<RestaurantSearchComponentProps>;
};


// [OPTIMIZATION] 로딩 스켈레톤


interface MobileControlOverlayProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    resultSummary: HomeMapResultSummary;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onThemeChange: (themeId: HomeMapThemeFilterId | null) => void;
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onRestaurantSearch: (restaurant: Restaurant) => void;
    onSearchExecute: (region?: Region | null) => void;
    panelRestaurant?: Restaurant | null;
    isPanelOpen?: boolean;
    contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;
    isMapFullscreen?: boolean;
    mapInteractionEpoch?: number;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    user?: User | null;
    onSubmissionClick?: () => void;
    onTopShellUserIconClick?: () => void;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
    showUserSubmittedMarkers?: boolean;
    onUserSubmittedMarkersToggle?: () => void;
    initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null;
}

type ActiveSheet = 'none' | 'region' | 'category' | 'search' | 'visibleMarkers';
type MobileTopDropdown = 'bookmark' | 'notification' | 'user' | null;
type InertableHTMLElement = HTMLElement & { inert: boolean };

type HiddenSearchLayerSiblingState = {
    element: InertableHTMLElement;
    ariaHidden: string | null;
    inert: boolean;
};

const getMobileSearchFocusableElements = (container: HTMLElement | null) => {
    if (!container) return [];

    return Array.from(container.querySelectorAll<HTMLElement>(MOBILE_SEARCH_FOCUSABLE_SELECTOR))
        .filter((element) => {
            if (element.getAttribute('aria-hidden') === 'true') return false;
            return element.offsetParent !== null || element === document.activeElement;
        });
};

/**
 * 모바일용 컨트롤 오버레이 컴포넌트
 * [OPTIMIZATION] 직접 버튼 그리드 UI로 구현하여 빠른 선택 가능
 */
function MobileControlOverlayComponent({
    mapMode,
    selectedRegion,
    selectedCountry,
    selectedCategories,
    filters,
    resultSummary,
    onRegionChange,
    onCountryChange,
    onCategoryChange,
    onThemeChange,
    onRestaurantSelect,
    onRestaurantSearch,
    onSearchExecute,
    panelRestaurant = null,
    isPanelOpen = false,
    contextualRestaurantsPayload = null,
    isMapFullscreen = false,
    mapInteractionEpoch = 0,
    isAdmin = false,
    onModeChange,
    user,
    onSubmissionClick,
    onTopShellUserIconClick,
    onDeviceLocationClick,
    deviceLocation,
    isDeviceLocationPending = false,
    isDeviceHeadingMode = false,
    showUserSubmittedMarkers = true,
    onUserSubmittedMarkersToggle,
    initialIntent = null,
}: MobileControlOverlayProps) {
    const mobileTopControlsRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const controls = mobileTopControlsRef.current;
        if (!controls) return;

        const updateControlsBottom = () => {
            document.documentElement.style.setProperty(
                '--mobile-map-controls-bottom',
                `${Math.ceil(controls.getBoundingClientRect().bottom + 8)}px`,
            );
        };
        updateControlsBottom();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateControlsBottom) : null;
        observer?.observe(controls);
        window.addEventListener('resize', updateControlsBottom);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateControlsBottom);
            document.documentElement.style.removeProperty('--mobile-map-controls-bottom');
        };
    }, []);

    const pathname = usePathname();
    const router = useRouter();
    const { signOut, isLoading: isAuthLoading } = useAuth();

    // 클라이언트 마운트 및 수화(Hydration) 완료 감지용 글로벌 플래그 설정 및 이벤트 발행
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.__tzudong_mobile_overlay_ready = true;
            document.documentElement.dataset.homeMobileChromeReady = 'true';
            markInitialLoadMilestone('mobileControlsMounted');
            window.dispatchEvent(new CustomEvent('tzudong_mobile_overlay_ready'));
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.__tzudong_mobile_overlay_ready = false;
            }
        };
    }, []);

    const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
    useEffect(() => {
        document.documentElement.toggleAttribute('data-mobile-search-open', activeSheet === 'search');

        return () => {
            document.documentElement.removeAttribute('data-mobile-search-open');
        };
    }, [activeSheet]);
    const [searchViewportHeight, setSearchViewportHeight] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState<'name' | 'youtube'>('name');
    const [openTopDropdown, setOpenTopDropdown] = useState<MobileTopDropdown>(() => {
        if (
            !isPublicRestrictedMode
            && (initialIntent === 'bookmark' || initialIntent === 'notification' || initialIntent === 'user')
        ) {
            return initialIntent;
        }

        return null;
    });
    const [visibleMarkerThumbnailIndexes, setVisibleMarkerThumbnailIndexes] =
        useState<Record<string, number>>({});
    const [visibleMarkerSheetHeightRequestKey, setVisibleMarkerSheetHeightRequestKey] =
        useState(0);
    const lastMapInteractionEpochRef = useRef(mapInteractionEpoch);
    const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);
    const isBookmarkMenuOpen = openTopDropdown === 'bookmark';
    const isNotificationMenuOpen = openTopDropdown === 'notification';
    const isUserMenuOpen = openTopDropdown === 'user';
    const handleBookmarkMenuOpenChange = useCallback((open: boolean) => setOpenTopDropdown(open ? 'bookmark' : null), []);
    const handleNotificationMenuOpenChange = useCallback((open: boolean) => setOpenTopDropdown(open ? 'notification' : null), []);
    const handleUserMenuOpenChange = useCallback((open: boolean) => setOpenTopDropdown(open ? 'user' : null), []);
    const bookmarkMenuLoad = useDeferredComponentWithRetry<MobileBookmarkMenuButtonProps>(
        !isPublicRestrictedMode && Boolean(user),
        loadMobileBookmarkMenuButton
    );
    const notificationMenuLoad = useDeferredComponentWithRetry<MobileNotificationMenuButtonProps>(
        !isPublicRestrictedMode && Boolean(user),
        loadMobileNotificationMenuButton
    );
    const searchLoad = useDeferredComponentWithRetry<RestaurantSearchComponentProps>(
        activeSheet === 'search',
        loadRestaurantSearch
    );
    const DeferredMobileBookmarkMenuButton = bookmarkMenuLoad.Component;
    const DeferredMobileNotificationMenuButton = notificationMenuLoad.Component;
    const DeferredRestaurantSearch = searchLoad.Component;
    const { categoryCounts } = resultSummary;
    const deviceLocationButtonLabel = resolveDeviceLocationButtonLabel({
        hasLocation: Boolean(deviceLocation),
        isHeadingMode: isDeviceHeadingMode,
        isPending: isDeviceLocationPending,
    });
    const currentContextualPayload = useMemo(() => reconcileHomeMapContextualResults(resultSummary, contextualRestaurantsPayload, mapMode), [resultSummary, contextualRestaurantsPayload, mapMode]);
    const visibleMarkerRestaurants = useMemo(
        () =>
            resultSummary.active ? resultSummary.restaurants : currentContextualPayload?.mode === mapMode && currentContextualPayload.isEligible
                ? currentContextualPayload.restaurants.slice(0, HOME_MAP_CONTEXTUAL_MOBILE_LIMIT)
                : [],
        [currentContextualPayload, mapMode, resultSummary],
    );
    const visibleMarkerRestaurantCount =
        resultSummary.active ? resultSummary.count : currentContextualPayload?.mode === mapMode ? currentContextualPayload.totalVisibleCount : visibleMarkerRestaurants.length;
    const visibleMarkerRestaurantsSignature = useMemo(
        () => `${visibleMarkerRestaurantCount}:${visibleMarkerRestaurants.map((restaurant) => restaurant.id).join('|')}`,
        [visibleMarkerRestaurantCount, visibleMarkerRestaurants],
    );
    const visibleMarkerSheetDismissScope = useMemo(
        () =>
            [
                mapMode,
                selectedRegion ?? '',
                selectedCountry ?? '',
                filters.featuredTheme ?? '',
                [...selectedCategories].sort().join(','),
            ].join('|'),
        [filters.featuredTheme, mapMode, selectedCategories, selectedCountry, selectedRegion],
    );
    const dismissedVisibleMarkerSheetScopeRef = useRef<string | null>(null);
    const [dismissedVisibleMarkerSheetScope, setDismissedVisibleMarkerSheetScope] =
        useState<string | null>(null);
    const canAutoShowVisibleMarkerSheet =
        (mapMode === 'domestic' || resultSummary.active) &&
        !isMapFullscreen &&
        !isPanelOpen &&
        !panelRestaurant &&
        (resultSummary.active || visibleMarkerRestaurants.length > 0);
    const shouldShowVisibleMarkerListRestore =
        canAutoShowVisibleMarkerSheet &&
        activeSheet === 'none' &&
        dismissedVisibleMarkerSheetScope === visibleMarkerSheetDismissScope;
    const doesDetailOwnBottomRightSafeArea = isPanelOpen && Boolean(panelRestaurant);
    const doesMobileSheetOwnFixedControlSpace =
        doesDetailOwnBottomRightSafeArea || activeSheet !== 'none';
    const shouldRenderMobileBottomControls = !doesMobileSheetOwnFixedControlSpace;
    const shouldRenderMobileFloatingActions = !doesMobileSheetOwnFixedControlSpace;


    const handleVisibleMarkerRestaurantSelect = useCallback((restaurant: Restaurant) => {
        incrementSearchCount(restaurant.id).catch(() => {});
        setActiveSheet('none');
        onRestaurantSelect(restaurant);
    }, [onRestaurantSelect]);

    const handleVisibleMarkerThumbnailChange = useCallback(
        (id: string, index: number) => {
            setVisibleMarkerThumbnailIndexes((current) => ({
                ...current,
                [id]: index,
            }));
        },
        [],
    );

    const handleVisibleMarkerSheetClose = useCallback(() => {
        dismissedVisibleMarkerSheetScopeRef.current = visibleMarkerSheetDismissScope;
        setDismissedVisibleMarkerSheetScope(visibleMarkerSheetDismissScope);
        setActiveSheet('none');
    }, [visibleMarkerSheetDismissScope]);
    const handleVisibleMarkerSheetRestore = useCallback(() => {
        dismissedVisibleMarkerSheetScopeRef.current = null;
        setDismissedVisibleMarkerSheetScope(null);
        setActiveSheet('visibleMarkers');
    }, []);
    useEffect(() => {
        if (lastMapInteractionEpochRef.current === mapInteractionEpoch) return;

        lastMapInteractionEpochRef.current = mapInteractionEpoch;
        if (activeSheet !== 'visibleMarkers') return;

        setVisibleMarkerSheetHeightRequestKey((key) => key + 1);
    }, [activeSheet, mapInteractionEpoch]);
    useEffect(() => {
        if (!canAutoShowVisibleMarkerSheet || activeSheet !== 'none') return;
        if (dismissedVisibleMarkerSheetScopeRef.current === visibleMarkerSheetDismissScope) return;
        setActiveSheet('visibleMarkers');
    }, [
        activeSheet,
        canAutoShowVisibleMarkerSheet,
        visibleMarkerRestaurantsSignature,
        visibleMarkerSheetDismissScope,
    ]);

    useEffect(() => {
        if (activeSheet !== 'visibleMarkers') return;
        if (canAutoShowVisibleMarkerSheet) return;
        setActiveSheet('none');
    }, [activeSheet, canAutoShowVisibleMarkerSheet]);



    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchLayerRef = useRef<HTMLDivElement>(null);
    const searchSelectionCloseRafRef = useRef<number | null>(null);
    const searchPreviouslyFocusedElementRef = useRef<HTMLElement | null>(null);
    const hiddenSearchLayerSiblingStatesRef = useRef<HiddenSearchLayerSiblingState[]>([]);
    const mobileSheetTriggerRef = useRef<'region' | 'category' | null>(null);

    const handleClose = useCallback(() => {
        setActiveSheet('none');
    }, []);

    const handleBottomSheetClose = useCallback(() => {
        if (activeSheet === 'visibleMarkers') return;

        handleClose();
    }, [activeSheet, handleClose]);

    const handleSearchLayerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            handleClose();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusableElements = getFocusTrapContainers(searchLayerRef.current, DEFAULT_FOCUS_TRAP_ALLOW_SELECTORS)
            .flatMap((container) => getMobileSearchFocusableElements(container as HTMLElement));

        if (focusableElements.length === 0) {
            event.preventDefault();
            searchLayerRef.current?.focus({ preventScroll: true });
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;

        if (activeElement === searchLayerRef.current) {
            event.preventDefault();
            (event.shiftKey ? lastElement : firstElement).focus({ preventScroll: true });
            return;
        }

        if (event.shiftKey && activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus({ preventScroll: true });
            return;
        }

        if (!event.shiftKey && activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus({ preventScroll: true });
        }
    }, [handleClose]);

    const cancelPendingSearchSelectionClose = useCallback(() => {
        if (searchSelectionCloseRafRef.current === null) return;
        window.cancelAnimationFrame(searchSelectionCloseRafRef.current);
        searchSelectionCloseRafRef.current = null;
    }, []);

    const scheduleSearchSelectionClose = useCallback(() => {
        cancelPendingSearchSelectionClose();
        searchSelectionCloseRafRef.current = window.requestAnimationFrame(() => {
            searchSelectionCloseRafRef.current = null;
            handleClose();
        });
    }, [cancelPendingSearchSelectionClose, handleClose]);

    useEffect(() => () => {
        cancelPendingSearchSelectionClose();
    }, [cancelPendingSearchSelectionClose]);

    const toggleSheet = useCallback((sheet: ActiveSheet, trigger?: 'region' | 'category') => {
        setActiveSheet((previous) => {
            const nextSheet = previous === sheet ? 'none' : sheet;
            if (trigger) {
                mobileSheetTriggerRef.current = trigger;
            }
            return nextSheet;
        });
    }, []);

    useEffect(() => {
        if (activeSheet === 'visibleMarkers' || activeSheet === 'search') return;

        if (activeSheet === 'region' || activeSheet === 'category') {
            const focusTimer = window.setTimeout(() => {
                document
                    .querySelector<HTMLElement>('[data-bottom-sheet-layout-source="mobile-control-overlay-sheet"]')
                    ?.querySelector<HTMLButtonElement>('button:not([disabled])')
                    ?.focus({ preventScroll: true });
            });

            return () => window.clearTimeout(focusTimer);
        }

        const trigger = mobileSheetTriggerRef.current;
        if (!trigger) return;

        const focusTimer = window.setTimeout(() => {
            document
                .querySelector<HTMLElement>(`[data-mobile-map-sheet-trigger="${trigger}"]`)
                ?.focus({ preventScroll: true });
            mobileSheetTriggerRef.current = null;
        });

        return () => window.clearTimeout(focusTimer);
    }, [activeSheet]);

    // Pull-to-Refresh 방지: 바텀시트가 열려있을 때 body에 overscroll-behavior 적용
    useEffect(() => {
        if (activeSheet !== 'none') {
            document.body.style.overscrollBehavior = 'contain';
            document.documentElement.style.overscrollBehavior = 'contain';
        }
        return () => {
            document.body.style.overscrollBehavior = '';
            document.documentElement.style.overscrollBehavior = '';
        };
    }, [activeSheet]);

    // [OPTIMIZATION] useMemo로 버튼 레이블 캐싱
    const regionLabel = useMemo(() =>
        mapMode === 'domestic' ? (selectedRegion || '전체') : (selectedCountry || '국가'),
        [mapMode, selectedRegion, selectedCountry]);
    const selectedTheme = filters.featuredTheme ?? null;
    const activeBottomSheetTitle =
        activeSheet === 'region'
            ? (mapMode === 'domestic' ? '지역 선택' : '국가 선택')
            : activeSheet === 'category'
                ? '카테고리 필터'
                : '맛집 목록';


    useEffect(() => {
        if (activeSheet !== 'search') {
            setSearchViewportHeight(null);
            return;
        }

        const visualViewport = window.visualViewport;
        const updateViewportHeight = () => {
            const nextHeight = visualViewport?.height ?? window.innerHeight;
            setSearchViewportHeight(Math.max(320, nextHeight));
        };

        updateViewportHeight();
        visualViewport?.addEventListener('resize', updateViewportHeight);
        visualViewport?.addEventListener('scroll', updateViewportHeight);
        window.addEventListener('resize', updateViewportHeight);

        return () => {
            visualViewport?.removeEventListener('resize', updateViewportHeight);
            visualViewport?.removeEventListener('scroll', updateViewportHeight);
            window.removeEventListener('resize', updateViewportHeight);
        };
    }, [activeSheet]);

    useEffect(() => {
        if (activeSheet !== 'search') return;

        const focusTimer = window.setTimeout(() => {
            searchInputRef.current?.focus();
        }, 120);

        return () => window.clearTimeout(focusTimer);
    }, [activeSheet]);

    useEffect(() => {
        if (activeSheet === 'search') {
            searchPreviouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            return;
        }

        searchPreviouslyFocusedElementRef.current?.focus({ preventScroll: true });
        searchPreviouslyFocusedElementRef.current = null;
    }, [activeSheet]);

    useEffect(() => {
        if (activeSheet !== 'search') return;

        const layer = searchLayerRef.current;
        if (!layer) return;
        const seen = new Set<HTMLElement>();
        const hiddenStates: HiddenSearchLayerSiblingState[] = [];
        let current: HTMLElement | null = layer;

        while (current && current !== document.body) {
            const parent: HTMLElement | null = current.parentElement;
            if (!parent) break;

            Array.from(parent.children).forEach((sibling) => {
                if (!(sibling instanceof HTMLElement)) return;
                if (seen.has(sibling)) return;
                if (!shouldHideModalSibling(sibling, current, layer)) return;

                const inertSibling = sibling as InertableHTMLElement;
                seen.add(sibling);
                hiddenStates.push({
                    element: inertSibling,
                    ariaHidden: sibling.getAttribute('aria-hidden'),
                    inert: Boolean(inertSibling.inert),
                });
                sibling.setAttribute('aria-hidden', 'true');
                inertSibling.inert = true;
            });

            current = parent;
        }

        hiddenSearchLayerSiblingStatesRef.current = hiddenStates;

        return () => {
            hiddenSearchLayerSiblingStatesRef.current.forEach(({ element, ariaHidden, inert }) => {
                if (ariaHidden === null) {
                    element.removeAttribute('aria-hidden');
                } else {
                    element.setAttribute('aria-hidden', ariaHidden);
                }
                element.inert = inert;
            });
            hiddenSearchLayerSiblingStatesRef.current = [];
        };
    }, [activeSheet]);

    useEffect(() => {
        if (!initialIntent) return;

        if (initialIntent === 'search') {
            setActiveSheet('search');
            return;
        }
        if (isPublicRestrictedMode) return;

        if (initialIntent === 'bookmark' || initialIntent === 'notification') {
            setOpenTopDropdown(initialIntent);
            return;
        }

        if (initialIntent === 'user') {
            if (user) {
                setOpenTopDropdown('user');
            } else {
                setOpenTopDropdown(null);
                onTopShellUserIconClick?.();
            }
        }
    }, [initialIntent, onTopShellUserIconClick, user]);

    const closeUserMenu = useCallback(() => {
        setOpenTopDropdown(null);
    }, []);

    const dispatchWindowEvent = useCallback((eventName: string) => {
        window.dispatchEvent(new Event(eventName));
        closeUserMenu();
    }, [closeUserMenu]);

    const handleInsightMenuClick = useCallback(() => {
        router.push('/insights');
        closeUserMenu();
    }, [closeUserMenu, router]);

    const handleAdminConsoleClick = useCallback(() => {
        router.push('/admin');
        closeUserMenu();
    }, [closeUserMenu, router]);

    const handleLogoutClick = useCallback(async () => {
        try {
            await signOut();
            toast.success('로그아웃되었습니다');
            router.push('/');
        } catch (error) {
            if (isSupersededLogout(error)) return;
            console.error('로그아웃 실패:');
            toast.error('로그아웃에 실패했습니다');
        }
        closeUserMenu();
    }, [closeUserMenu, router, signOut]);

    const renderAnonymousBookmarkMenuButton = () => (
        <DropdownMenu open={isBookmarkMenuOpen} onOpenChange={handleBookmarkMenuOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        mobileTopIconButtonClass,
                        '!text-primary hover:!text-primary data-[state=open]:!text-primary [&_svg]:!text-primary'
                    )}
                    aria-label="북마크"
                >
                    <Bookmark className={cn(mobileTopIconGlyphClass, '!text-primary')} aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(calc(100vw-1rem),22rem)] bg-card border-border font-sans z-[110] shadow-primary">
                <DropdownMenuLabel className="flex items-start justify-between gap-3 text-foreground">
                    <div className="min-w-0">
                        <span className="block font-semibold">북마크</span>
                        <span className="block text-xs font-normal text-muted-foreground">로그인하면 저장한 맛집을 바로 볼 수 있어요</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label="북마크 전체보기 로그인 안내"
                        onClick={() => {
                            toast.error('로그인 후 북마크를 확인할 수 있어요');
                            onTopShellUserIconClick?.();
                        }}
                        className="h-8 shrink-0 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
                    >
                        전체보기
                    </Button>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <ScrollArea className="h-72 max-h-[min(70vh,28rem)]">
                    <div className="grid min-h-40 place-items-center p-4 text-center text-sm text-muted-foreground">
                        <div>
                            <Bookmark className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                            <p className="font-medium text-foreground">로그인 후 북마크를 확인할 수 있어요</p>
                            <p className="mt-1 text-xs leading-5">맛집을 저장하고 다시 찾아오는 데 사용합니다.</p>
                        </div>
                    </div>
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const renderPendingMenuButton = (kind: 'bookmark' | 'notification', load: { failed: boolean; retry: () => void }) => {
        const bookmark = kind === 'bookmark';
        const title = bookmark ? '북마크' : '알림';
        const open = bookmark ? isBookmarkMenuOpen : isNotificationMenuOpen;
        const onOpenChange = bookmark ? handleBookmarkMenuOpenChange : handleNotificationMenuOpenChange;
        return <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className={mobileTopIconButtonWithBadgeClass} aria-label={title}>
                {bookmark ? <Bookmark className={mobileTopIconGlyphClass} aria-hidden="true" /> : <Bell className={mobileTopIconGlyphClass} aria-hidden="true" />}
            </Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[110] w-[min(calc(100vw-1rem),22rem)]">
                <DeferredPanelFallback title={title} failed={load.failed} onRetry={load.retry} onClose={() => onOpenChange(false)} />
            </DropdownMenuContent>
        </DropdownMenu>;
    };

    const renderBookmarkMenuButton = () => {
        if (isPublicRestrictedMode) return null;
        if (!user) return renderAnonymousBookmarkMenuButton();
        if (!DeferredMobileBookmarkMenuButton) return renderPendingMenuButton('bookmark', bookmarkMenuLoad);

        return <DeferredMobileBookmarkMenuButton user={user} open={isBookmarkMenuOpen} onOpenChange={handleBookmarkMenuOpenChange} />;
    };

    const renderAnonymousNotificationMenuButton = () => (
        <DropdownMenu open={isNotificationMenuOpen} onOpenChange={handleNotificationMenuOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={mobileTopIconButtonWithBadgeClass}
                    aria-label="알림"
                >
                    <Bell className={mobileTopIconGlyphClass} aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(calc(100vw-1rem),22rem)] bg-card border-border font-sans z-[110] shadow-primary">
                <DropdownMenuLabel className="flex items-start justify-between gap-3 text-foreground">
                    <div className="min-w-0">
                        <span className="block font-semibold">알림</span>
                        <span className="block text-xs font-normal text-muted-foreground">로그인하면 알림을 바로 볼 수 있어요</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label="알림 로그인 안내"
                        onClick={() => {
                            toast.error('로그인 후 알림을 확인할 수 있어요');
                            onTopShellUserIconClick?.();
                        }}
                        className="h-8 shrink-0 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
                    >
                        로그인
                    </Button>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <ScrollArea className="h-72 max-h-[min(70vh,28rem)]">
                    <div className="grid min-h-40 place-items-center p-4 text-center text-sm text-muted-foreground">
                        <div>
                            <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                            <p className="font-medium text-foreground">로그인 후 알림을 확인할 수 있어요</p>
                            <p className="mt-1 text-xs leading-5">제보 처리, 리뷰 승인, 랭킹 소식을 놓치지 않게 알려드립니다.</p>
                        </div>
                    </div>
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const renderNotificationMenuButton = () => {
        if (isPublicRestrictedMode) return null;
        if (!user) return renderAnonymousNotificationMenuButton();
        if (!DeferredMobileNotificationMenuButton) return renderPendingMenuButton('notification', notificationMenuLoad);

        return <DeferredMobileNotificationMenuButton user={user} open={isNotificationMenuOpen} onOpenChange={handleNotificationMenuOpenChange} />;
    };
    const renderUserMenuButton = () => {
        if (isPublicRestrictedMode) return null;
        if (!user) {
            return (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                        event.stopPropagation();
                        setOpenTopDropdown(null);
                        onTopShellUserIconClick?.();
                    }}
                    className={mobileTopIconButtonClass}
                    aria-label="사용자 메뉴"
                >
                    <UserIcon className={mobileTopIconGlyphClass} aria-hidden="true" />
                </Button>
            );
        }

        return (
            <DropdownMenu open={isUserMenuOpen} onOpenChange={handleUserMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={mobileTopIconButtonClass}
                        aria-label="사용자 메뉴"
                    >
                        <UserIcon className={mobileTopIconGlyphClass} aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={mobileUserMenuContentClass}>
                    <DropdownMenuItem onClick={() => dispatchWindowEvent('openMyPage')} className={mobileUserMenuItemClass}>
                        <UserIcon className="mr-2 h-4 w-4" />
                        마이페이지
                    </DropdownMenuItem>
                    {!isAdmin && (
                        <DropdownMenuItem onClick={handleInsightMenuClick} className={mobileUserMenuItemClass}>
                            <BarChart2 className="mr-2 h-4 w-4" />
                            인사이트
                        </DropdownMenuItem>
                    )}
                    {isAdmin && (
                        <>
                            <DropdownMenuSeparator className="bg-border my-1" />
                            <DropdownMenuItem
                                onSelect={handleAdminConsoleClick}
                                data-admin-console-menu-item="true"
                                className={mobileUserMenuItemClass}
                            >
                                <PanelLeft className="mr-2 h-4 w-4" />
                                관리자 콘솔
                            </DropdownMenuItem>
                        </>
                    )}
                    <DropdownMenuSeparator className="bg-border my-1" />
                    <DropdownMenuItem onClick={handleLogoutClick} className={mobileUserMenuItemClass}>
                        <LogOut className="mr-2 h-4 w-4" />
                        로그아웃
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border my-1" />
                    <div className="px-2 py-1">
                        <button
                            type="button"
                            aria-label="사업자 정보 펼치기/접기"
                            onClick={() => setIsBusinessInfoExpanded((prev) => !prev)}
                            className="flex w-max max-w-full items-center justify-between whitespace-nowrap hover:bg-accent rounded px-1 py-0.5"
                        >
                            <span className="text-2xs text-muted-foreground">{siteConfig.operator.copyrightLabel}</span>
                            {isBusinessInfoExpanded ? (
                                <ChevronUp className="h-3 w-3 text-muted-foreground ml-1" />
                            ) : (
                                <ChevronDown className="h-3 w-3 text-muted-foreground ml-1" />
                            )}
                        </button>
                        {isBusinessInfoExpanded && (
                            <div className="mt-1 w-max max-w-[calc(100vw-2rem)] border-t border-border pt-1 text-2xs text-muted-foreground space-y-0.5 px-1">
                                <p className="font-medium text-foreground">{siteConfig.operator.companyName}</p>
                                <p>대표: {siteConfig.operator.representative}</p>
                                <p>사업자: {siteConfig.operator.businessRegistrationNumber}</p>
                                <p>이메일: {siteConfig.contact.email}</p>
                            </div>
                        )}
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    return (
        <>
            {/* 상단: 로고/검색/유저 아이콘 + 카테고리 플로팅 행 */}
            <div
                ref={mobileTopControlsRef}
                className="pointer-events-none fixed inset-x-0 top-0 z-[60] min-w-0 px-3 pt-[calc(env(safe-area-inset-top)+12px)]"
                data-layout-primitives="cluster wrap-row overlay-stack"
                data-fixed-control-region="mobile-map-top-controls"
                role="group"
                aria-label="지도 상단 제어"
            >
                <div
                    className={cn(
                        'pointer-events-auto flex min-h-14 w-full min-w-0 items-center gap-1 rounded-full border border-border bg-background/95 px-1 shadow-sm',
                        activeSheet === 'search' && 'ring-2 ring-primary'
                    )}
                >
                    <Button
                        id="tzudong-mobile-search-button"
                        variant="ghost"
                        onClick={() => toggleSheet('search')}
                        className="min-w-0 flex-1 h-11 rounded-full justify-start gap-2 px-2 hover:bg-secondary/80"
                        aria-label="맛집 검색 열기"
                        title={searchQuery.trim() ? `${searchQuery.trim()} 검색` : '맛집 이름 검색'}
                    >
                        <Image
                            src="/logo-png-129-8d374bb80346.png"
                            unoptimized
                            alt=""
                            aria-hidden="true"
                            width={26}
                            height={26}
                            className="rounded-md bg-transparent object-contain shrink-0"
                        />
                        <span className={cn(
                            'text-sm truncate',
                            searchQuery.trim() ? 'text-foreground' : 'text-muted-foreground'
                        )}>
                            {searchQuery.trim() || '맛집 이름 검색'}
                        </span>
                    </Button>

                    {renderBookmarkMenuButton()}
                    {renderNotificationMenuButton()}

                    {renderUserMenuButton()}
                </div>

                <div id="tzudong-mobile-category-slider" data-mobile-topic-slider="true" data-layout-primitives="cluster wrap-row" className="mt-2 min-w-0">
                    <HomeMapThemeFilters activeThemeId={selectedTheme} onThemeChange={onThemeChange} layout="reel" />
                </div>
            </div>

            {/* 좌측 하단: 국내/해외, 지역/카테고리 버튼 */}
            {shouldRenderMobileBottomControls && (
                <div
                    className="fixed bottom-[calc(env(safe-area-inset-bottom)+var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] left-4 z-40 flex min-w-0 flex-col gap-2"
                    data-layout-primitives="cluster wrap-row overlay-stack"
                    data-fixed-control-region="mobile-map-bottom-controls"
                    role="group"
                    aria-label="지도 필터 제어"
                >
                {/* 국내/해외 토글 버튼 - 모든 사용자에게 표시 */}
                {onModeChange && (
                    <div className="flex items-center gap-0.5 p-0.5 bg-background/95 rounded-full shadow-sm border border-border w-[clamp(110px,29vw,128px)]">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onModeChange('domestic')}
                            aria-pressed={mapMode === 'domestic'}
                            aria-label="국내 맛집 지도 보기"
                            className={`rounded-full h-11 px-2 home-map-floating-control-text text-xs font-medium whitespace-nowrap motion-reduce:transition-none flex-1 ${mapMode === 'domestic'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                                }`}
                        >
                            국내
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onModeChange('overseas')}
                            onPointerEnter={preloadOverseasMap}
                            onPointerDown={preloadOverseasMap}
                            onFocus={preloadOverseasMap}
                            aria-pressed={mapMode === 'overseas'}
                            aria-label="해외 맛집 지도 보기"
                            className={`rounded-full h-11 px-2 home-map-floating-control-text text-xs font-medium whitespace-nowrap motion-reduce:transition-none flex-1 ${mapMode === 'overseas'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                                }`}
                        >
                            해외
                        </Button>
                    </div>
                )}

                {/* 지역/국가 선택 버튼 */}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSheet('region', 'region')}
                    aria-expanded={false}
                    aria-label={`${mapMode === 'domestic' ? '지역' : '국가'} 선택 열기: ${regionLabel}`}
                    data-mobile-map-sheet-trigger="region"
                    className="rounded-full shadow-sm bg-background/95 border border-border hover:bg-secondary/80 w-[clamp(110px,29vw,128px)] h-11 px-3 home-map-floating-control-text"
                >
                    <div className="flex items-center w-full gap-1">
                        <div className="flex items-center justify-center w-4 shrink-0">
                            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <div className="flex-1 flex items-center justify-center min-w-0">
                            <span className="text-xs truncate">{regionLabel}</span>
                        </div>
                    </div>
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSheet('category', 'category')}
                    aria-expanded={false}
                    aria-label={`카테고리 필터 열기${selectedCategories.length > 0 ? `: ${selectedCategories.length}개 선택됨` : ''}`}
                    data-mobile-map-sheet-trigger="category"
                    className="rounded-full shadow-sm bg-background/95 border border-border hover:bg-secondary/80 w-[clamp(110px,29vw,128px)] h-11 px-3 home-map-floating-control-text"
                >
                    <div className="flex items-center w-full gap-1">
                        <div className="flex items-center justify-center w-4 shrink-0">
                            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <div className="flex-1 flex items-center justify-center min-w-0">
                            <span className="text-xs truncate">
                                카테고리{selectedCategories.length > 0 ? ` ${selectedCategories.length}` : ''}
                            </span>
                        </div>
                    </div>
                </Button>


                </div>
            )}

            {shouldRenderMobileFloatingActions && (
            <div
                className="fixed bottom-[calc(env(safe-area-inset-bottom)+var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] right-4 z-[90] flex min-w-0 flex-col gap-2"
                data-mobile-bottom-right-safe-area-owner="mobile-floating-actions"
                data-layout-primitives="cluster wrap-row overlay-stack"
                data-fixed-control-region="mobile-map-actions"
                role="group"
                aria-label="지도 빠른 작업"
            >
                {shouldShowVisibleMarkerListRestore && (
                    <Button
                        type="button"
                        onClick={handleVisibleMarkerSheetRestore}
                        aria-label="맛집 목록 다시 열기"
                        title="맛집 목록 다시 열기"
                        data-mobile-visible-marker-restaurants-restore="true"
                        className={cn(
                            'h-12 w-12 rounded-full shadow-sm',
                            'bg-background/95 hover:bg-secondary text-foreground border-border/70',
                            'flex items-center justify-center',
                            'border'
                        )}
                    >
                        <List className="h-5 w-5" aria-hidden="true" />
                    </Button>
                )}
                {/* 사용자 제보 마커 표시 토글: 관리자 검수용 */}
                {isAdmin && (
                    <Button
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onUserSubmittedMarkersToggle?.();
                        }}
                        aria-pressed={showUserSubmittedMarkers}
                        className={cn(
                            'h-12 w-12 rounded-full shadow-sm',
                            'flex items-center justify-center',
                            'border',
                            showUserSubmittedMarkers
                                ? 'bg-blue-600 hover:bg-blue-700 text-white border-transparent'
                                : 'bg-background/95 hover:bg-secondary text-foreground border-border/70'
                        )}
                        title={showUserSubmittedMarkers ? '사용자 제보 맛집 마커 숨기기' : '사용자 제보 맛집 마커 보이기'}
                        aria-label={showUserSubmittedMarkers ? '사용자 제보 맛집 마커 숨기기' : '사용자 제보 맛집 마커 보이기'}
                        data-user-submitted-marker-toggle="admin-only"
                    >
                        {showUserSubmittedMarkers ? (
                            <Eye className="h-5 w-5" aria-hidden="true" />
                        ) : (
                            <EyeOff className="h-5 w-5" aria-hidden="true" />
                        )}
                    </Button>
                )}
                {!isPublicRestrictedMode && (
                    <>
                        {/* 제보 버튼 */}
                        <Button
                            disabled={isAuthLoading}
                            aria-busy={isAuthLoading}
                            onClick={() => {
                                onSubmissionClick?.();
                            }}
                            className={cn(
                                'h-12 w-12 rounded-full shadow-sm',
                                'bg-brand-ink hover:bg-black text-white',
                                'active:scale-95',
                                'flex items-center justify-center',
                                'border border-border/20'
                            )}
                            title="맛집 제보하기"
                            aria-label="맛집 제보하기"
                            data-mobile-submission-floating-action="true"
                        >
                            <Send className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    </>
                )}

                {!isPublicRestrictedMode && (
                    <>
                        {/* 기기 위치 버튼: 첫 탭은 현재 위치, 두 번째 탭부터 방향 표시 */}
                        <div className="relative">
                            <DeviceLocationDisclosure id="mobile-device-location-disclosure" onConfirm={() => onDeviceLocationClick?.()} skipDisclosure={Boolean(deviceLocation)}>
                            <Button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                }}
                                disabled={isDeviceLocationPending}
                                aria-label={deviceLocationButtonLabel}
                                aria-busy={isDeviceLocationPending}
                                className={cn(
                                    'h-12 w-12 rounded-full shadow-sm',
                                    'flex items-center justify-center',
                                    'border',
                                    isDeviceHeadingMode
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white border-white/70 ring-2 ring-blue-200/70'
                                        : deviceLocation
                                            ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                            : 'bg-background/95 hover:bg-secondary text-foreground border-border/70',
                                    isDeviceLocationPending && 'opacity-80'
                                )}
                                title={deviceLocationButtonLabel}
                            >
                                {isDeviceHeadingMode ? (
                                    <Navigation className="h-5 w-5" aria-hidden="true" />
                                ) : (
                                    <LocateFixed className="h-5 w-5" aria-hidden="true" />
                                )}
                            </Button>
                            </DeviceLocationDisclosure>
                        </div>
                    </>
                )}
            </div>
            )}

            {/* 전체 화면 검색 레이어 */}
            {activeSheet === 'search' && (
                <div
                    ref={searchLayerRef}
                    className="fixed inset-0 z-[75] bg-background/95 pointer-events-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="mobile-map-search-title"
                    onKeyDown={handleSearchLayerKeyDown}
                    tabIndex={-1}
                >
                    <div
                        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                        style={{
                            height: searchViewportHeight ? `${searchViewportHeight}px` : '100dvh',
                            paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
                            paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                        }}
                    >
                        <div className="px-3 pb-3">
                            <h2 id="mobile-map-search-title" className="sr-only">맛집 검색</h2>
                            <div className="flex min-h-14 min-w-0 items-center gap-2 rounded-full border border-border bg-background/95 px-1 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                                <div className="min-w-0 flex-1 h-11 rounded-full flex items-center gap-2 pl-3">
                                    <Image
                                        src="/logo-png-129-8d374bb80346.png"
                                        unoptimized
                                        alt="로고"
                                        width={24}
                                        height={24}
                                        className="rounded-md object-contain shrink-0"
                                    />
                                    <input
                                        ref={searchInputRef}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={searchType === 'name' ? '맛집 이름 검색' : '유튜브 제목 검색'}
                                        name="mobile-home-restaurant-search"
                                        inputMode="search"
                                        enterKeyHint="search"
                                        autoComplete="off"
                                        className="min-w-0 flex-1 w-full bg-transparent text-sm text-foreground placeholder:text-foreground/70 outline-none"
                                        aria-label={searchType === 'name' ? '맛집 이름 검색어 입력' : '유튜브 제목 검색어 입력'}
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSearchQuery('');
                                                searchInputRef.current?.focus({ preventScroll: true });
                                            }}
                                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                                            aria-label="검색어 지우기"
                                        >
                                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClose}
                                    aria-label="검색 닫기"
                                    className={mobileTopIconButtonClass}
                                >
                                    <X className="h-5 w-5" aria-hidden="true" />
                                </Button>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="검색 방식">
                                <Button
                                    type="button"
                                    variant={searchType === 'name' ? 'secondary' : 'ghost'}
                                    onClick={() => {
                                        setSearchType('name');
                                        searchInputRef.current?.focus({ preventScroll: true });
                                    }}
                                    aria-pressed={searchType === 'name'}
                                    className="min-h-11 gap-2 rounded-lg text-sm"
                                >
                                    <MapPin className="h-4 w-4" aria-hidden="true" />
                                    맛집 이름
                                </Button>
                                <Button
                                    type="button"
                                    variant={searchType === 'youtube' ? 'secondary' : 'ghost'}
                                    onClick={() => {
                                        setSearchType('youtube');
                                        searchInputRef.current?.focus({ preventScroll: true });
                                    }}
                                    aria-pressed={searchType === 'youtube'}
                                    className="min-h-11 gap-2 rounded-lg text-sm"
                                >
                                    <Video className="h-4 w-4" aria-hidden="true" />
                                    영상 제목
                                </Button>
                            </div>
                        </div>

                        <div className="min-h-0 min-w-0 flex-1 overflow-hidden px-3 pb-2">
                            {DeferredRestaurantSearch ? (
                                <DeferredRestaurantSearch
                                    onRestaurantSelect={(restaurant) => {
                                        onRestaurantSelect(restaurant);
                                    }}
                                    onRestaurantSearch={(restaurant) => {
                                        onRestaurantSearch(restaurant);
                                    }}
                                    onSearchExecute={() => {
                                        onSearchExecute();
                                        scheduleSearchSelectionClose();
                                    }}
                                    filters={filters}
                                    selectedRegion={mapMode === 'domestic' ? selectedRegion : selectedCountry}
                                    isKoreanOnly={mapMode === 'domestic'}
                                    maxItems={5}
                                    resultView="inline"
                                    hideSearchControls
                                    searchQueryValue={searchQuery}
                                    onSearchQueryChange={setSearchQuery}
                                    searchTypeValue={searchType}
                                    onSearchTypeChange={setSearchType}
                                    onSearchInputFocus={() => searchInputRef.current?.focus({ preventScroll: true })}
                                    clearQueryOnSelect={false}
                                    className="h-full w-full"
                                />
                            ) : (
                                <DeferredPanelFallback title="검색" failed={searchLoad.failed} onRetry={searchLoad.retry} onClose={handleClose} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 바텀시트 (지역/카테고리/맛집 목록) - 맛집 바텀시트와 동일한 인터랙션 */}
            {activeSheet !== 'none' && activeSheet !== 'search' && (
                <BottomSheet
                    isOpen
                    onClose={handleBottomSheetClose}
                    defaultHeight={HALF_SHEET_HEIGHT}
                    minHeight={
                        activeSheet === 'visibleMarkers' ? VISIBLE_MARKER_SHEET_HEIGHT : MIN_SHEET_HEIGHT
                    }
                    maxHeight={MAX_SHEET_HEIGHT}
                    enablePeek
                    hideBottomNavWhenOpen
                    progressiveHeaderHide
                    hideHandleWhenFull={activeSheet !== 'visibleMarkers'}
                    showBackdrop={false}
                    closeOnOutsidePointerDown={activeSheet !== 'visibleMarkers'}
                    layoutSource="mobile-control-overlay-sheet"
                    heightRequest={
                        activeSheet === 'visibleMarkers' && visibleMarkerSheetHeightRequestKey > 0
                            ? { key: visibleMarkerSheetHeightRequestKey, height: VISIBLE_MARKER_SHEET_HEIGHT, mode: 'exact' }
                            : undefined
                    }
                    contentClassName={activeSheet === 'visibleMarkers' ? 'scrollbar-hide' : undefined}
                    className="z-[95]"
                >
                    {activeSheet !== 'visibleMarkers' ? (
                        <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
                            <h3 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                                <span className="truncate">{activeBottomSheetTitle}</span>
                            </h3>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleClose}
                                aria-label={`${activeBottomSheetTitle} 닫기`}
                                className="min-h-11 min-w-11"
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        </div>
                    ) : null}

                    <div
                        className={cn("min-w-0", activeSheet === 'visibleMarkers' ? "px-3 pb-6 pt-2" : "p-4 pb-8")}
                        data-layout-primitives="list-detail frame stack"
                        data-scroll-owner="home-mobile-list-sheet"
                    >
                        {activeSheet === 'region' && (
                            <div className="space-y-3">
                                <p className="text-xs leading-5 text-muted-foreground">맛집 수는 현재 지도 결과 기준입니다.</p>
                                {mapMode === 'domestic' ? (
                                    <>
                                        <Button
                                            variant={selectedRegion === null ? "default" : "outline"}
                                            className="w-full justify-between h-auto min-h-11 py-3"
                                            aria-pressed={selectedRegion === null}
                                            onClick={() => {
                                                onRegionChange(null);
                                                onSearchExecute(null);
                                                handleClose();
                                            }}
                                        >
                                            <span className="font-medium">대한민국</span>
                                            <span className="text-sm opacity-75">{selectedRegion === null ? `${homeMapResultCountLabel(resultSummary, resultSummary.count ?? undefined)}곳` : '전체 지역 보기'}</span>
                                        </Button>

                                        <div className="grid grid-cols-2 gap-2">
                                            {REGIONS.map((region) => {
                                                const count = getHomeMapRegionOptionCount(resultSummary, { mapMode, selectedRegion, selectedCountry }, region);
                                                const isSelected = selectedRegion === region;
                                                return (
                                                    <Button
                                                        key={region}
                                                        variant={isSelected ? "default" : "outline"}
                                                        className="justify-between h-auto min-h-11 py-3"
                                                        aria-pressed={isSelected}
                                                        onClick={() => {
                                                            onRegionChange(region);
                                                            onSearchExecute(region);
                                                            handleClose();
                                                        }}
                                                    >
                                                        <span className="font-medium">{region}</span>
                                                        {count !== undefined && <span className="text-xs opacity-75">{count}곳</span>}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        {OVERSEAS_REGION_LIST.map((country) => {
                                            const count = getHomeMapRegionOptionCount(resultSummary, { mapMode, selectedRegion, selectedCountry }, country);
                                            const isSelected = selectedCountry === country;
                                            return (
                                                <Button
                                                    key={country}
                                                    variant={isSelected ? "default" : "outline"}
                                                    className="justify-between h-auto min-h-11 py-3"
                                                    aria-pressed={isSelected}
                                                    onClick={() => {
                                                        onCountryChange(country);
                                                        handleClose();
                                                    }}
                                                >
                                                    <span className="font-medium">{country}</span>
                                                    {count !== undefined && <span className="text-xs opacity-75">{count}곳</span>}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeSheet === 'visibleMarkers' && (
                            <div
                                className="grid grid-cols-1 gap-1"
                                data-mobile-visible-marker-restaurants-sheet="true"
                                data-mobile-visible-marker-restaurants-sheet-frame="true"
                            >
                                <div className="sticky top-0 z-10 -mx-1 -mt-1 bg-background/95 px-1 py-1">
                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-bold leading-5 text-foreground">
                                            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                            <span className="truncate">맛집 목록</span>
                                            <span
                                                className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-2xs font-semibold leading-4 text-primary-foreground"
                                                aria-label={`맛집 목록 ${visibleMarkerRestaurantCount ?? "확인 중"}곳`}
                                            >
                                                {visibleMarkerRestaurantCount ?? "—"}곳
                                            </span>
                                        </h2>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={handleVisibleMarkerSheetClose}
                                            aria-label="맛집 목록 닫기"
                                            className="h-11 w-11 shrink-0 rounded-full"
                                        >
                                            <X className="h-4 w-4" aria-hidden="true" />
                                        </Button>
                                    </div>
                                </div>
                                {resultSummary.active && <p className="px-2 py-2 text-sm text-muted-foreground" role={resultSummary.status === 'error' ? 'alert' : 'status'}>{homeMapResultStatusText(resultSummary)}</p>}
                                {resultSummary.active && resultSummary.status === 'ready' && resultSummary.count === 0 && (selectedTheme || selectedCategories.length > 0) && (
                                    <div className="px-2 pb-4">
                                        <p className="mb-3 text-sm leading-6 text-muted-foreground">선택한 위치에서 조건을 넓혀 찾아보세요.</p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="min-h-11 w-full"
                                            onClick={() => {
                                                onThemeChange(null);
                                                onCategoryChange([]);
                                            }}
                                        >
                                            테마·카테고리 해제
                                        </Button>
                                    </div>
                                )}
                                {visibleMarkerRestaurants.map((restaurant) => (
                                    <StampCard
                                        key={restaurant.id}
                                        restaurant={restaurant}
                                        isVisited={false}
                                        isUserStampsReady={false}
                                        currentThumbnailIndex={
                                            visibleMarkerThumbnailIndexes[restaurant.id] ?? 0
                                        }
                                        onThumbnailChange={handleVisibleMarkerThumbnailChange}
                                        onClick={handleVisibleMarkerRestaurantSelect}
                                        size="compact"
                                        stampSize="mobile"
                                        density="dense"
                                        showAddress
                                        layout="list"
                                        categoryFallback="맛집"
                                    />
                                ))}
                            </div>
                        )}
                        {activeSheet === 'category' && (
                            <div className="space-y-3">
                                {selectedCategories.length > 0 && (
                                    <Button
                                        variant="outline"
                                        className="w-full min-h-11"
                                        onClick={() => {
                                            onCategoryChange([]);
                                        }}
                                    >
                                        선택한 카테고리 {selectedCategories.length}개 해제
                                    </Button>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                    {CATEGORIES.map((category) => {
                                        const count = categoryCounts[category] || 0;
                                        const isSelected = selectedCategories.includes(category);
                                        return (
                                            <Button
                                                key={category}
                                                variant={isSelected ? "default" : "outline"}
                                                className="justify-between h-auto min-h-11 py-3"
                                                aria-pressed={isSelected}
                                                onClick={() => {
                                                    const newCategories = isSelected
                                                        ? selectedCategories.filter(cat => cat !== category)
                                                        : [...selectedCategories, category];
                                                    onCategoryChange(newCategories);
                                                }}
                                            >
                                                <span className="font-medium flex items-center gap-2">
                                                    {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
                                                    {category}
                                                </span>
                                                <span className="text-xs opacity-75">({homeMapResultCountLabel(resultSummary, count)})</span>
                                            </Button>
                                        );
                                    })}
                                </div>

                                <Button
                                    type="button"
                                    className="min-h-11 w-full"
                                    onClick={handleClose}
                                    data-mobile-category-sheet-commit="immediate"
                                >
                                    지도에서 보기
                                </Button>
                            </div>
                        )}
                    </div>
                </BottomSheet>
            )}
        </>
    );
}

const MobileControlOverlay = memo(MobileControlOverlayComponent);
MobileControlOverlay.displayName = 'MobileControlOverlay';

export default MobileControlOverlay;
