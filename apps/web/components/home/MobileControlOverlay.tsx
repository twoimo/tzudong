'use client';

import { memo, useState, useCallback, useMemo, useRef, useEffect, type ComponentType, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
    Filter,
    X,
    MapPin,
    Video,
    Bookmark,
    Bell,
    Check,
    Send,
    User as UserIcon,
    Megaphone,
    BarChart2,
    PanelLeft,
    LogOut,
    ChevronDown,
    ChevronUp,
    LocateFixed,
    Navigation
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
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
import type { FilterState } from '@/components/filters/filter-state';
import { useQuery } from '@tanstack/react-query';
import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { toast } from '@/lib/no-toast';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContextBase';
import { resolveDeviceLocationButtonLabel, type DeviceMapLocation } from '@/lib/device-location-map';
import { useDeferredComponent } from '@/hooks/use-deferred-component';
import { useOverseasCountryCounts } from '@/components/home/use-overseas-country-counts';

// 카테고리 상수
const CATEGORIES = [
    "한식", "중식", "양식", "분식", "치킨", "피자", "고기",
    "족발·보쌈", "돈까스·회", "아시안", "패스트푸드",
    "카페·디저트", "찜·탕", "야식", "도시락"
];
const MIN_SHEET_HEIGHT = 25;
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
    clearQueryOnSelect?: boolean;
};

type MobileBookmarkMenuButtonProps = {
    user: User;
    defaultOpen?: boolean;
};

const loadMobileBookmarkMenuButton = async () => {
    const mod = await import('@/components/home/MobileBookmarkMenuButton');
    return mod.default as ComponentType<MobileBookmarkMenuButtonProps>;
};

type MobileNotificationMenuButtonProps = {
    user: User;
    defaultOpen?: boolean;
};

const loadMobileNotificationMenuButton = async () => {
    const mod = await import('@/components/home/MobileNotificationMenuButton');
    return mod.default as ComponentType<MobileNotificationMenuButtonProps>;
};

const mobileTopIconButtonClass = cn(
    'h-9 w-9 rounded-full border border-border bg-background',
    'hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation'
);

const mobileTopIconButtonWithBadgeClass = cn(mobileTopIconButtonClass, 'relative');
const mobileTopIconGlyphClass = 'h-[18px] w-[18px]';
const mobileTopUserIconGlyphClass = 'h-5 w-5';

const loadRestaurantSearch = async () => {
    const mod = await import('@/components/search/RestaurantSearch');
    return mod.default as ComponentType<RestaurantSearchComponentProps>;
};


// [OPTIMIZATION] 로딩 스켈레톤
const SheetLoading = () => (
    <div
        className="flex items-center justify-center py-8"
        role="status"
        aria-live="polite"
        aria-busy="true"
    >
        <div
            className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
            aria-hidden="true"
        />
        <span className="sr-only">목록을 불러오는 중입니다</span>
    </div>
);

interface MobileControlOverlayProps {
    mapMode: 'domestic' | 'overseas';
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
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    user?: User | null;
    onSubmissionClick?: () => void;
    onTopShellUserIconClick?: () => void;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
    initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null;
}

type ActiveSheet = 'none' | 'region' | 'category' | 'search';
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
    onRegionChange,
    onCountryChange,
    onCategoryChange,
    onRestaurantSelect,
    onRestaurantSearch,
    onSearchExecute,
    isAdmin = false,
    onModeChange,
    user,
    onSubmissionClick,
    onTopShellUserIconClick,
    onDeviceLocationClick,
    deviceLocation,
    isDeviceLocationPending = false,
    isDeviceHeadingMode = false,
    initialIntent = null,
}: MobileControlOverlayProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { signOut } = useAuth();
    const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
    const [quickSelectedCategories, setQuickSelectedCategories] = useState<string[]>(selectedCategories);
    const [searchViewportHeight, setSearchViewportHeight] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState<'name' | 'youtube'>('name');
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);
    const shouldOpenBookmarkOnMount = initialIntent === 'bookmark';
    const shouldOpenNotificationOnMount = initialIntent === 'notification';
    const DeferredMobileBookmarkMenuButton = useDeferredComponent<MobileBookmarkMenuButtonProps>(
        Boolean(user),
        loadMobileBookmarkMenuButton
    );
    const DeferredMobileNotificationMenuButton = useDeferredComponent<MobileNotificationMenuButtonProps>(
        Boolean(user),
        loadMobileNotificationMenuButton
    );
    const DeferredRestaurantSearch = useDeferredComponent<RestaurantSearchComponentProps>(
        activeSheet === 'search',
        loadRestaurantSearch
    );
    const countryCounts = useOverseasCountryCounts(mapMode);
    const deviceLocationButtonLabel = resolveDeviceLocationButtonLabel({
        hasLocation: Boolean(deviceLocation),
        isHeadingMode: isDeviceHeadingMode,
        isPending: isDeviceLocationPending,
    });

    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchLayerRef = useRef<HTMLDivElement>(null);
    const searchSelectionCloseRafRef = useRef<number | null>(null);
    const searchPreviouslyFocusedElementRef = useRef<HTMLElement | null>(null);
    const hiddenSearchLayerSiblingStatesRef = useRef<HiddenSearchLayerSiblingState[]>([]);

    // 맛집 데이터 조회 (지역/카테고리 카운트용) - [OPTIMIZATION] 필요한 필드만 선택
    const { data: restaurants = [] } = useQuery({
        queryKey: ['mobile-control-restaurants', mapMode],
        queryFn: async () => {
            try {
                const data = await fetchSupabaseRows<Restaurant>('restaurants', [
                    ['select', 'id, name:approved_name, road_address, jibun_address, categories'],
                    ['status', 'eq.approved'],
                ]);
                return mergeRestaurants(data);
            } catch {
                return [];
            }
        },
        enabled: activeSheet === 'region' || activeSheet === 'category',
        staleTime: 1000 * 60 * 5, // 5분간 fresh
        gcTime: 1000 * 60 * 15, // 15분간 캐시 유지
        refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 방지
    });

    const handleClose = useCallback(() => {
        setActiveSheet('none');
    }, []);

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

    const toggleSheet = useCallback((sheet: ActiveSheet) => {
        setActiveSheet(prev => prev === sheet ? 'none' : sheet);
    }, []);

    // [OPTIMIZATION] 지역별 맛집 수 계산 - 단일 패스로 최적화
    const regionCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        // 특수 지역 키워드 매핑 (욕지도/울릉도는 상위 지역보다 먼저 체크해야 함)
        const specialRegions: Record<string, string> = {
            '울릉도': '울릉',
            '욕지도': '욕지'
        };

        restaurants.forEach((restaurant) => {
            const address = restaurant.road_address || restaurant.jibun_address || '';

            // 1. 특수 지역 먼저 체크 (욕지도, 울릉도)
            let matched = false;
            for (const [region, keyword] of Object.entries(specialRegions)) {
                if (address.includes(keyword)) {
                    counts[region] = (counts[region] || 0) + 1;
                    matched = true;
                    break;
                }
            }

            // 2. 특수 지역에 매칭되지 않았으면 일반 지역 체크
            if (!matched) {
                for (const region of REGIONS) {
                    // 특수 지역은 이미 위에서 처리했으니 스킵
                    if (region in specialRegions) continue;

                    if (address.includes(region)) {
                        counts[region] = (counts[region] || 0) + 1;
                        break;
                    }
                }
            }
        });
        return counts;
    }, [restaurants]);

    // [OPTIMIZATION] 카테고리별 맛집 수 계산 (선택된 지역 고려) - 지역 필터링 최적화
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        // 지역 키워드 매핑
        const regionKeywords: Record<string, string> = {
            '울릉도': '울릉',
            '욕지도': '욕지'
        };
        const keyword = selectedRegion ? (regionKeywords[selectedRegion] || selectedRegion) : null;

        // 지역이 선택된 경우 해당 지역만 필터링, 아니면 전체
        const targetRestaurants = keyword
            ? restaurants.filter((r) => {
                const addr = r.road_address || r.jibun_address || '';
                return addr.includes(keyword);
            })
            : restaurants;

        for (const restaurant of targetRestaurants) {
            const categories = restaurant.categories || [];
            for (const category of categories) {
                counts[category] = (counts[category] || 0) + 1;
            }
        }
        return counts;
    }, [restaurants, selectedRegion]);

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

    const quickTopCategories = useMemo(() => CATEGORIES.slice(0, 8), []);

    const handleQuickCategoryToggle = useCallback((category: string) => {
        const nextCategories = quickSelectedCategories.includes(category)
            ? quickSelectedCategories.filter((item) => item !== category)
            : [...quickSelectedCategories, category];
        setQuickSelectedCategories(nextCategories);
        onCategoryChange(nextCategories);
    }, [onCategoryChange, quickSelectedCategories]);

    useEffect(() => {
        setQuickSelectedCategories(selectedCategories);
    }, [selectedCategories]);

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

        if (initialIntent === 'user') {
            if (user) {
                setIsUserMenuOpen(true);
            } else {
                onTopShellUserIconClick?.();
            }
        }
    }, [initialIntent, onTopShellUserIconClick, user]);

    const closeUserMenu = useCallback(() => {
        setIsUserMenuOpen(false);
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
            console.error('로그아웃 실패:', error);
            toast.error('로그아웃에 실패했습니다');
        } finally {
            closeUserMenu();
        }
    }, [closeUserMenu, router, signOut]);

    const renderAnonymousBookmarkMenuButton = () => (
        <DropdownMenu defaultOpen={shouldOpenBookmarkOnMount}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={mobileTopIconButtonClass}
                    aria-label="북마크"
                >
                    <Bookmark className={mobileTopIconGlyphClass} aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(calc(100vw-1rem),22rem)] bg-card border-border font-serif z-[110] shadow-primary">
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

    const renderBookmarkMenuButton = () => {
        if (!user || !DeferredMobileBookmarkMenuButton) return renderAnonymousBookmarkMenuButton();

        return <DeferredMobileBookmarkMenuButton user={user} defaultOpen={shouldOpenBookmarkOnMount} />;
    };

    const renderAnonymousNotificationMenuButton = () => (
        <DropdownMenu defaultOpen={shouldOpenNotificationOnMount}>
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
            <DropdownMenuContent align="end" className="w-[min(calc(100vw-1rem),22rem)] bg-card border-border font-serif z-[110] shadow-primary">
                <DropdownMenuLabel className="flex items-start justify-between gap-3 text-foreground">
                    <div className="min-w-0">
                        <span className="block font-semibold">알림</span>
                        <span className="block text-xs font-normal text-muted-foreground">로그인하면 알림을 바로 볼 수 있어요</span>
                    </div>
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
        if (!user || !DeferredMobileNotificationMenuButton) return renderAnonymousNotificationMenuButton();

        return <DeferredMobileNotificationMenuButton user={user} defaultOpen={shouldOpenNotificationOnMount} />;
    };
    const renderUserMenuButton = () => {
        if (!user) {
            return (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTopShellUserIconClick?.();
                    }}
                    className={mobileTopIconButtonClass}
                    aria-label="사용자 메뉴"
                >
                    <UserIcon className={mobileTopUserIconGlyphClass} aria-hidden="true" />
                </Button>
            );
        }

        return (
            <DropdownMenu open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={mobileTopIconButtonClass}
                        aria-label="사용자 메뉴"
                    >
                        <UserIcon className={mobileTopUserIconGlyphClass} aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-card border-border font-serif w-44 z-[110]">
                    <DropdownMenuItem onClick={() => dispatchWindowEvent('openMyPage')} className="text-foreground hover:bg-accent py-1.5">
                        <UserIcon className="mr-2 h-4 w-4" />
                        마이페이지
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => dispatchWindowEvent('openAdminAnnouncements')} className="text-foreground hover:bg-accent py-1.5">
                        <Megaphone className="mr-2 h-4 w-4" />
                        공지사항
                    </DropdownMenuItem>
                    {!isAdmin && (
                        <DropdownMenuItem onClick={handleInsightMenuClick} className="text-foreground hover:bg-accent py-1.5">
                            <BarChart2 className="mr-2 h-4 w-4" />
                            인사이트
                        </DropdownMenuItem>
                    )}
                    {isAdmin && (
                        <>
                            <DropdownMenuSeparator className="bg-border my-1" />
                            <DropdownMenuItem onClick={handleAdminConsoleClick} className="text-foreground hover:bg-accent py-1.5">
                                <PanelLeft className="mr-2 h-4 w-4" />
                                관리자 콘솔
                            </DropdownMenuItem>
                        </>
                    )}
                    <DropdownMenuSeparator className="bg-border my-1" />
                    <DropdownMenuItem onClick={handleLogoutClick} className="text-foreground hover:bg-accent py-1.5">
                        <LogOut className="mr-2 h-4 w-4" />
                        로그아웃
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border my-1" />
                    <div className="px-2 py-1">
                        <button
                            type="button"
                            aria-label="사업자 정보 펼치기/접기"
                            onClick={() => setIsBusinessInfoExpanded((prev) => !prev)}
                            className="w-full flex items-center justify-between hover:bg-accent rounded px-1 py-0.5 transition-colors"
                        >
                            <span className="text-[10px] text-muted-foreground">v1.0.0 © 타이니번</span>
                            {isBusinessInfoExpanded ? (
                                <ChevronUp className="h-3 w-3 text-muted-foreground ml-1" />
                            ) : (
                                <ChevronDown className="h-3 w-3 text-muted-foreground ml-1" />
                            )}
                        </button>
                        {isBusinessInfoExpanded && (
                            <div className="mt-1 pt-1 border-t border-border text-[9px] text-muted-foreground space-y-0.5 px-1">
                                <p className="font-medium text-foreground">타이니번 데이터랩</p>
                                <p>대표: 최연우</p>
                                <p>사업자: 601-09-04613</p>
                                <p>이메일: cs@tzudong.app</p>
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
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
                <div
                    className={cn(
                        'pointer-events-auto flex items-center gap-2 h-12 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-2',
                        activeSheet === 'search' && 'ring-2 ring-primary'
                    )}
                >
                    <Button
                        variant="ghost"
                        onClick={() => toggleSheet('search')}
                        className="flex-1 h-10 min-h-11 rounded-full justify-start gap-2 px-2.5 hover:bg-secondary/80"
                        aria-label={searchQuery.trim() ? `${searchQuery.trim()} 검색 열기` : '쯔동여지도 검색하기'}
                    >
                        <Image
                            src="/logo.png"
                            alt=""
                            aria-hidden="true"
                            width={26}
                            height={26}
                            className="rounded-md object-contain shrink-0"
                        />
                        <span className={cn(
                            'text-[15px] truncate',
                            searchQuery.trim() ? 'text-foreground' : 'text-muted-foreground'
                        )}>
                            {searchQuery.trim() || '쯔동여지도 검색하기'}
                        </span>
                    </Button>

                    {renderBookmarkMenuButton()}
                    {renderNotificationMenuButton()}

                    {renderUserMenuButton()}
                </div>

                <div className="pointer-events-auto mt-2 -mx-3 flex gap-2 overflow-x-auto pl-[calc(env(safe-area-inset-left)+8px)] pr-[calc(env(safe-area-inset-right)+8px)] py-0.5 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {quickTopCategories.map((category) => {
                        const isSelected = quickSelectedCategories.includes(category);
                        return (
                        <Button
                            key={category}
                            variant="secondary"
                            size="sm"
                            onClick={() => handleQuickCategoryToggle(category)}
                            aria-pressed={isSelected}
                            aria-label={`${category} 카테고리 ${isSelected ? '선택 해제' : '선택'}`}
                            className={cn(
                                'pointer-events-auto h-9 shrink-0 rounded-full shadow-sm border border-border bg-background/95 backdrop-blur-sm',
                                'px-3 text-xs font-medium transition-colors motion-reduce:transition-none hover:bg-secondary/80',
                                isSelected
                                    ? 'bg-red-700 text-white border-red-700 hover:bg-red-800'
                                    : 'text-foreground'
                            )}
                        >
                            {category}
                        </Button>
                        );
                    })}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleSheet('category')}
                        aria-expanded={activeSheet === 'category'}
                        aria-label="카테고리 더보기"
                        className={cn(
                            'pointer-events-auto h-9 shrink-0 rounded-full shadow-sm border border-border bg-background/95 backdrop-blur-sm',
                            'hover:bg-secondary/80 px-3 text-xs font-medium transition-colors motion-reduce:transition-none',
                            activeSheet === 'category' && 'ring-2 ring-primary'
                        )}
                    >
                        <Filter className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        더보기
                    </Button>
                </div>
            </div>

            {/* 좌측 하단: 국내/해외, 지역/카테고리 버튼 */}
            <div className="fixed bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] left-4 z-40 flex flex-col gap-2">
                {/* 국내/해외 토글 버튼 - 모든 사용자에게 표시 */}
                {onModeChange && (
                    <div className="flex items-center gap-0.5 p-0.5 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border w-[clamp(84px,28vw,105px)]">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onModeChange('domestic')}
                            aria-pressed={mapMode === 'domestic'}
                            aria-label="국내 맛집 지도 보기"
                            className={`rounded-full h-9 px-2 text-xs font-medium transition-all motion-reduce:transition-none flex-1 ${mapMode === 'domestic'
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
                            aria-pressed={mapMode === 'overseas'}
                            aria-label="해외 맛집 지도 보기"
                            className={`rounded-full h-9 px-2 text-xs font-medium transition-all motion-reduce:transition-none flex-1 ${mapMode === 'overseas'
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
                    onClick={() => toggleSheet('region')}
                    aria-expanded={activeSheet === 'region'}
                    aria-label={`${mapMode === 'domestic' ? '지역' : '국가'} 선택 열기: ${regionLabel}`}
                    className={cn(
                        'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80 w-[clamp(84px,28vw,105px)] h-9 px-2',
                        activeSheet === 'region' && 'ring-2 ring-primary'
                    )}
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

            </div>

            {/* 우측 하단: 현재 위치, 제보 버튼 */}
            <div className="fixed bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] right-4 z-40 flex flex-col gap-2">
                {/* 기기 위치 버튼: 첫 탭은 현재 위치, 두 번째 탭부터 방향 표시 */}
                <Button
                    type="button"
                    onClick={onDeviceLocationClick}
                    disabled={isDeviceLocationPending}
                    aria-label={deviceLocationButtonLabel}
                    className={cn(
                        'h-12 w-12 rounded-full shadow-lg',
                        'transition-all duration-300 ease-in-out motion-reduce:transition-none',
                        'hover:scale-110 active:scale-95',
                        'flex items-center justify-center',
                        'border-2',
                        isDeviceHeadingMode
                            ? 'bg-blue-600 hover:bg-blue-700 text-white border-white/70 ring-2 ring-blue-200/70'
                            : deviceLocation
                                ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                : 'bg-background/95 hover:bg-secondary text-foreground border-border/70 backdrop-blur-sm',
                        isDeviceLocationPending && 'animate-pulse opacity-80'
                    )}
                    title={deviceLocationButtonLabel}
                >
                    {isDeviceHeadingMode ? (
                        <Navigation className="h-5 w-5" aria-hidden="true" />
                    ) : (
                        <LocateFixed className="h-5 w-5" aria-hidden="true" />
                    )}
                </Button>

                {/* 제보 버튼 */}
                <Button
                    onClick={() => {
                        onSubmissionClick?.();
                    }}
                    className={cn(
                        'h-12 w-12 rounded-full shadow-lg',
                        'bg-red-800 hover:bg-red-900 text-white',
                        'transition-all duration-300 ease-in-out motion-reduce:transition-none',
                        'hover:scale-110 active:scale-95',
                        'flex items-center justify-center',
                        'border-2 border-border/20'
                    )}
                    title="맛집 제보하기"
                    aria-label="맛집 제보하기"
                >
                    <Send className="h-5 w-5" aria-hidden="true" />
                </Button>
            </div>

            {/* 전체 화면 검색 레이어 */}
            {activeSheet === 'search' && (
                <div
                    ref={searchLayerRef}
                    className="fixed inset-0 z-[75] bg-background/95 backdrop-blur-sm pointer-events-auto animate-in fade-in-0 duration-200 motion-reduce:animate-none"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="mobile-map-search-title"
                    onKeyDown={handleSearchLayerKeyDown}
                    tabIndex={-1}
                >
                    <div
                        className="flex flex-col overflow-hidden animate-in slide-in-from-top-3 duration-300 motion-reduce:animate-none"
                        style={{
                            height: searchViewportHeight ? `${searchViewportHeight}px` : '100dvh',
                            paddingTop: 'calc(env(safe-area-inset-top) + 10px)',
                            paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                        }}
                    >
                        <div className="px-3 pb-3">
                            <h2 id="mobile-map-search-title" className="sr-only">쯔동여지도 검색</h2>
                            <div className="flex items-center gap-1.5 min-h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5">
                                <div className="flex-1 h-9 rounded-full flex items-center gap-2 px-2 bg-secondary/40">
                                    <Image
                                        src="/logo.png"
                                        alt="로고"
                                        width={24}
                                        height={24}
                                        className="rounded-md object-contain shrink-0"
                                    />
                                    <input
                                        ref={searchInputRef}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={searchType === 'name' ? '쯔동여지도 검색하기' : '유튜브 제목으로 검색하기'}
                                        inputMode="search"
                                        enterKeyHint="search"
                                        autoComplete="off"
                                        className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/70 outline-none"
                                        aria-label="맛집 검색어 입력"
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery('')}
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
                                    onClick={() => setSearchType((prev) => prev === 'name' ? 'youtube' : 'name')}
                                    title={searchType === 'name' ? "유튜브 제목으로 검색" : "맛집 이름으로 검색"}
                                    aria-label={searchType === 'name' ? "유튜브 제목 검색으로 전환" : "맛집 이름 검색으로 전환"}
                                    aria-pressed={searchType === 'youtube'}
                                    className="min-h-11 min-w-11 rounded-full border border-border bg-background hover:bg-secondary/80"
                                >
                                    {searchType === 'name' ? (
                                        <MapPin className="h-4 w-4" aria-hidden="true" />
                                    ) : (
                                        <Video className="h-4 w-4" aria-hidden="true" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClose}
                                    aria-label="검색 닫기"
                                    className="min-h-11 min-w-11 rounded-full border border-border bg-background hover:bg-secondary/80"
                                >
                                    <X className="h-5 w-5" aria-hidden="true" />
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden px-3 pb-2">
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
                                    clearQueryOnSelect={false}
                                    className="h-full w-full"
                                />
                            ) : (
                                <SheetLoading />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 바텀시트 (지역/카테고리 전용) - 맛집 바텀시트와 동일한 인터랙션 */}
            {activeSheet !== 'none' && activeSheet !== 'search' && (
                <BottomSheet
                    isOpen
                    onClose={handleClose}
                    defaultHeight={HALF_SHEET_HEIGHT}
                    minHeight={MIN_SHEET_HEIGHT}
                    maxHeight={MAX_SHEET_HEIGHT}
                    enablePeek
                    hideBottomNavWhenOpen
                    progressiveHeaderHide
                    hideHandleWhenFull
                    showBackdrop={false}
                    closeOnOutsidePointerDown
                    layoutSource="mobile-control-overlay-sheet"
                    className="z-[95]"
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
                        <h3 className="text-lg font-semibold">
                            {activeSheet === 'region' && (mapMode === 'domestic' ? '지역 선택' : '국가 선택')}
                            {activeSheet === 'category' && '카테고리 필터'}
                        </h3>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClose}
                            aria-label={`${activeSheet === 'region' ? (mapMode === 'domestic' ? '지역 선택' : '국가 선택') : '카테고리 필터'} 닫기`}
                            className="min-h-11 min-w-11"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    </div>

                    <div className="p-4 pb-8">
                        {activeSheet === 'region' && (
                            <div className="space-y-3">
                                {mapMode === 'domestic' ? (
                                    <>
                                        <Button
                                            variant={selectedRegion === null ? "default" : "outline"}
                                            className="w-full justify-between h-auto min-h-11 py-3"
                                            onClick={() => {
                                                onRegionChange(null);
                                                onSearchExecute(null);
                                                handleClose();
                                            }}
                                        >
                                            <span className="font-medium">전국</span>
                                            <span className="text-sm opacity-75">({restaurants.length}개)</span>
                                        </Button>

                                        <div className="grid grid-cols-2 gap-2">
                                            {REGIONS.map((region) => {
                                                const count = regionCounts[region] || 0;
                                                const isSelected = selectedRegion === region;
                                                return (
                                                    <Button
                                                        key={region}
                                                        variant={isSelected ? "default" : "outline"}
                                                        className="justify-between h-auto min-h-11 py-3"
                                                        onClick={() => {
                                                            onRegionChange(region);
                                                            onSearchExecute(region);
                                                            handleClose();
                                                        }}
                                                    >
                                                        <span className="font-medium">{region}</span>
                                                        <span className="text-xs opacity-75">({count})</span>
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.keys(countryCounts).map((country) => {
                                            const count = countryCounts[country] || 0;
                                            const isSelected = selectedCountry === country;
                                            return (
                                                <Button
                                                    key={country}
                                                    variant={isSelected ? "default" : "outline"}
                                                    className="justify-between h-auto min-h-11 py-3"
                                                    onClick={() => {
                                                        onCountryChange(country);
                                                        handleClose();
                                                    }}
                                                >
                                                    <span className="font-medium">{country}</span>
                                                    <span className="text-xs opacity-75">({count})</span>
                                                </Button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeSheet === 'category' && (
                            <div className="space-y-3">
                                {selectedCategories.length > 0 && (
                                    <Button
                                        variant="outline"
                                        className="w-full min-h-11"
                                        onClick={() => {
                                            setQuickSelectedCategories([]);
                                            onCategoryChange([]);
                                        }}
                                    >
                                        초기화 ({selectedCategories.length}개 선택됨)
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
                                                onClick={() => {
                                                    const newCategories = isSelected
                                                        ? selectedCategories.filter(cat => cat !== category)
                                                        : [...selectedCategories, category];
                                                    setQuickSelectedCategories(newCategories);
                                                    onCategoryChange(newCategories);
                                                }}
                                            >
                                                <span className="font-medium flex items-center gap-1.5">
                                                    {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
                                                    {category}
                                                </span>
                                                <span className="text-xs opacity-75">({count})</span>
                                            </Button>
                                        );
                                    })}
                                </div>

                                <Button className="w-full min-h-11" onClick={handleClose}>
                                    적용하기
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
