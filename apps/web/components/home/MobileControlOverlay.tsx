'use client';

import { memo, useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
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
    Utensils,
    ClipboardList,
    MessageSquare,
    Image as ImageIcon,
    DollarSign,
    LogOut,
    ChevronDown,
    ChevronUp
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Region, REGIONS, Restaurant } from '@/types/restaurant';
import type { Notification } from '@/types/notification';
import { FilterState } from '@/components/filters/FilterPanel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useBookmarks } from '@/hooks/use-bookmarks';

// 카테고리 상수
const CATEGORIES = [
    "한식", "중식", "양식", "분식", "치킨", "피자", "고기",
    "족발·보쌈", "돈까스·회", "아시안", "패스트푸드",
    "카페·디저트", "찜·탕", "야식", "도시락"
];
const MIN_DRAG_HEIGHT = 5;
const MIN_SHEET_HEIGHT = 25;
const HALF_SHEET_HEIGHT = 50;
const MAX_SHEET_HEIGHT = 100;
const CLOSE_THRESHOLD = 15;
const SWIPE_VELOCITY_THRESHOLD = 0.5;
const CONTENT_TOP_EPSILON = 2;
const CONTENT_DRAG_START_THRESHOLD = 16;
const CONTENT_VERTICAL_INTENT_RATIO = 1.2;

const isVerticallyScrollable = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    return allowsScroll && element.scrollHeight > element.clientHeight;
};

const findScrollableTouchTarget = (
    target: EventTarget | null,
    boundary: HTMLElement | null
): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return boundary;

    let node: HTMLElement | null = target;
    while (node && node !== boundary) {
        if (isVerticallyScrollable(node)) return node;
        node = node.parentElement;
    }

    if (boundary && isVerticallyScrollable(boundary)) return boundary;
    return null;
};

// [OPTIMIZATION] RestaurantSearch만 lazy loading
const RestaurantSearch = lazy(() => import('@/components/search/RestaurantSearch'));

// [OPTIMIZATION] 로딩 스켈레톤
const SheetLoading = () => (
    <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
);

interface MobileControlOverlayProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    countryCounts: Record<string, number>;
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
}

type ActiveSheet = 'none' | 'region' | 'category' | 'search';

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
    countryCounts,
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
}: MobileControlOverlayProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { signOut } = useAuth();
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
    const { data: bookmarksData = [] } = useBookmarks();
    const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
    const [sheetHeight, setSheetHeight] = useState(50); // 최종 높이 (스냅 시에만 업데이트)
    // [OPTIMIZATION] isDragging은 UI 업데이트용으로만 사용, 실제 드래그 로직은 ref 사용
    const [isDragging, setIsDragging] = useState(false);
    const [quickSelectedCategories, setQuickSelectedCategories] = useState<string[]>(selectedCategories);
    const [searchViewportHeight, setSearchViewportHeight] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState<'name' | 'youtube'>('name');
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);
    const [adminBadgeCounts, setAdminBadgeCounts] = useState({ submissions: 0, reviews: 0 });

    // [OPTIMIZATION] ref로 실시간 드래그 상태 추적 (리렌더링 없이)
    const sheetRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const currentHeightRef = useRef(50); // 현재 드래그 중인 높이
    const startYRef = useRef(0);
    const startHeightRef = useRef(50);
    const isDraggingRef = useRef(false); // [OPTIMIZATION] isDragging도 ref로 관리
    // 드래그 속도 측정용 ref
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);
    const contentTouchStartYRef = useRef(0);
    const contentTouchStartXRef = useRef(0);
    const isContentDraggingSheetRef = useRef(false);
    const contentStartBoundaryRef = useRef<'top' | null>(null);
    const contentScrollTargetRef = useRef<HTMLElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const getContentSnapPoints = useCallback(() => {
        return [MIN_SHEET_HEIGHT, HALF_SHEET_HEIGHT, MAX_SHEET_HEIGHT];
    }, []);

    const getNearestSnapHeight = useCallback((currentHeight: number) => {
        const snapPoints = getContentSnapPoints();
        return snapPoints.reduce((closest, snap) =>
            Math.abs(snap - currentHeight) < Math.abs(closest - currentHeight) ? snap : closest
            , snapPoints[0]);
    }, [getContentSnapPoints]);

    // 맛집 데이터 조회 (지역/카테고리 카운트용) - [OPTIMIZATION] 필요한 필드만 선택
    const { data: restaurants = [] } = useQuery({
        queryKey: ['mobile-control-restaurants', mapMode],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name:approved_name, road_address, jibun_address, categories')
                .eq('status', 'approved');

            if (error) return [];
            return mergeRestaurants(data || []);
        },
        staleTime: 1000 * 60 * 5, // 5분간 fresh
        gcTime: 1000 * 60 * 15, // 15분간 캐시 유지
        refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 방지
    });

    const handleClose = useCallback(() => {
        setActiveSheet('none');
    }, []);

    const toggleSheet = useCallback((sheet: ActiveSheet) => {
        setActiveSheet(prev => prev === sheet ? 'none' : sheet);
        // 새 시트 열 때 기본 높이로 초기화
        if (activeSheet !== sheet) {
            const initialHeight = sheet === 'search' ? 25 : 50;
            setSheetHeight(initialHeight);
            currentHeightRef.current = initialHeight;
        }
    }, [activeSheet]);

    // [OPTIMIZATION] 드래그 시작 - ref 기반으로 리렌더링 최소화 (터치 + 마우스 통합)
    const handleDragStart = useCallback((clientY: number) => {
        isDraggingRef.current = true;
        setIsDragging(true); // will-change 적용용
        startYRef.current = clientY;
        startHeightRef.current = currentHeightRef.current;
        lastYRef.current = clientY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;
    }, []);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        handleDragStart(e.touches[0].clientY);
    }, [handleDragStart]);

    const handleMouseDown = useCallback((e: MouseEvent) => {
        e.preventDefault(); // 텍스트 선택 방지
        handleDragStart(e.clientY);
    }, [handleDragStart]);

    // [OPTIMIZATION] 드래그 중 - ref로 직접 DOM 조작 (리렌더링 없음, 터치 + 마우스 통합)
    const handleDragMove = useCallback((clientY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = Date.now();

        // 속도 계산 (양수면 아래로 드래그)
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (clientY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = clientY;
        lastTimeRef.current = currentTime;

        const deltaY = startYRef.current - clientY;
        const viewportHeight = window.innerHeight;
        const deltaVh = (deltaY / viewportHeight) * 100;

        let newHeight = startHeightRef.current + deltaVh;
        // 최소 5%까지 드래그 가능 (닫기 영역), 최대 100%
        newHeight = Math.max(MIN_DRAG_HEIGHT, Math.min(MAX_SHEET_HEIGHT, newHeight));

        currentHeightRef.current = newHeight;

        // [OPTIMIZATION] requestAnimationFrame으로 DOM 직접 조작
        requestAnimationFrame(() => {
            if (sheetRef.current) {
                sheetRef.current.style.transform = `translateY(calc(100% - ${newHeight}dvh))`;
            }
        });
    }, []);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        handleDragMove(e.touches[0].clientY);
    }, [handleDragMove]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        handleDragMove(e.clientY);
    }, [handleDragMove]);

    // 드래그 종료 - 25 / 50 / full 스냅
    const handleDragEnd = useCallback((source: 'handle' | 'content' = 'handle') => {
        isDraggingRef.current = false;
        setIsDragging(false);

        const currentHeight = currentHeightRef.current;

        // 빠르게 아래로 스와이프 (velocity > 0.5px/ms) 하면 닫기
        if (velocityRef.current > SWIPE_VELOCITY_THRESHOLD) {
            handleClose();
            return;
        }

        // 닫기 임계값 (15% 이하시 닫기)
        if (currentHeight <= CLOSE_THRESHOLD) {
            handleClose();
            return;
        }

        const targetHeight = getNearestSnapHeight(currentHeight);
        setSheetHeight(targetHeight);
        currentHeightRef.current = targetHeight;

        if (source === 'handle' && sheetRef.current) {
            sheetRef.current.style.transform = `translateY(calc(100% - ${targetHeight}dvh))`;
        }
    }, [handleClose, getNearestSnapHeight]);

    const handleContentTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (activeSheet === 'search') return;
        contentTouchStartYRef.current = e.touches[0].clientY;
        contentTouchStartXRef.current = e.touches[0].clientX;
        isContentDraggingSheetRef.current = false;
        const scrollTarget = findScrollableTouchTarget(e.target, e.currentTarget);
        contentScrollTargetRef.current = scrollTarget;
        const scrollTop = scrollTarget ? scrollTarget.scrollTop : e.currentTarget.scrollTop;
        const isAtTop = scrollTop <= CONTENT_TOP_EPSILON;
        contentStartBoundaryRef.current = isAtTop ? 'top' : null;
    }, [activeSheet]);

    const handleContentTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (activeSheet === 'search') return;

        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = currentY - contentTouchStartYRef.current;
        const deltaX = currentX - contentTouchStartXRef.current;
        const absDeltaY = Math.abs(deltaY);
        const absDeltaX = Math.abs(deltaX);
        const scrollTarget = contentScrollTargetRef.current ?? findScrollableTouchTarget(e.target, e.currentTarget);
        if (!contentScrollTargetRef.current) {
            contentScrollTargetRef.current = scrollTarget;
        }

        if (!isContentDraggingSheetRef.current) {
            if (contentStartBoundaryRef.current !== 'top') return;
            if (absDeltaY <= CONTENT_DRAG_START_THRESHOLD) return;
            if (absDeltaY <= absDeltaX * CONTENT_VERTICAL_INTENT_RATIO) return;
            handleDragStart(contentTouchStartYRef.current);
            isContentDraggingSheetRef.current = true;
        }

        e.stopPropagation();
        handleDragMove(currentY);
    }, [activeSheet, handleDragStart, handleDragMove]);

    const handleContentTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isContentDraggingSheetRef.current) {
            contentScrollTargetRef.current = null;
            contentStartBoundaryRef.current = null;
            return;
        }
        e.stopPropagation();
        isContentDraggingSheetRef.current = false;
        contentScrollTargetRef.current = null;
        contentStartBoundaryRef.current = null;
        handleDragEnd('content');
    }, [handleDragEnd]);

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

    // [OPTIMIZATION] 이벤트 리스너 등록 (터치 + 마우스 지원)
    // Pull-to-Refresh 방지를 위해 touchmove는 passive: false로 설정
    useEffect(() => {
        const handleEl = handleRef.current;
        if (!handleEl || activeSheet === 'none' || activeSheet === 'search') return;

        const preventPullToRefresh = (e: TouchEvent) => {
            // 드래그 중일 때 Pull-to-Refresh 방지
            if (isDraggingRef.current) {
                e.preventDefault();
            }
        };
        const handleTouchEnd = () => {
            handleDragEnd('handle');
        };
        const handleTouchStartListener: EventListener = (event) => {
            handleTouchStart(event as TouchEvent);
        };
        const handleTouchMoveListener: EventListener = (event) => {
            handleTouchMove(event as TouchEvent);
        };
        const handleMouseDownListener: EventListener = (event) => {
            handleMouseDown(event as MouseEvent);
        };

        // 터치 이벤트
        handleEl.addEventListener('touchstart', handleTouchStartListener, { passive: true });
        handleEl.addEventListener('touchmove', handleTouchMoveListener, { passive: false });
        handleEl.addEventListener('touchmove', preventPullToRefresh, { passive: false });
        handleEl.addEventListener('touchend', handleTouchEnd, { passive: true });
        handleEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });

        // 마우스 이벤트 (핸들에서 시작)
        handleEl.addEventListener('mousedown', handleMouseDownListener);

        // 마우스 move/up은 window에 등록 (핸들 밖으로 드래그해도 동작)
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingRef.current) {
                e.preventDefault();
                handleMouseMove(e);
            }
        };

        const handleWindowMouseUp = () => {
            if (isDraggingRef.current) {
                handleDragEnd('handle');
            }
        };

        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);

        return () => {
            handleEl.removeEventListener('touchstart', handleTouchStartListener);
            handleEl.removeEventListener('touchmove', handleTouchMoveListener);
            handleEl.removeEventListener('touchmove', preventPullToRefresh);
            handleEl.removeEventListener('touchend', handleTouchEnd);
            handleEl.removeEventListener('touchcancel', handleTouchEnd);
            handleEl.removeEventListener('mousedown', handleMouseDownListener);
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [activeSheet, handleTouchStart, handleTouchMove, handleMouseDown, handleMouseMove, handleDragEnd]);

    // [CRITICAL] activeSheet 변경 시 초기 높이 설정
    useEffect(() => {
        if (activeSheet === 'none' || !sheetRef.current) return;

        const initialHeight = activeSheet === 'search' ? 25 : 50;
        currentHeightRef.current = initialHeight;
        setSheetHeight(initialHeight);

        // DOM에 즉시 반영 (애니메이션과 함께) - 검색 시트는 transform 사용 안 함
        if (activeSheet !== 'search') {
            sheetRef.current.style.transform = `translateY(calc(100% - ${initialHeight}dvh))`;
        } else {
            sheetRef.current.style.transform = 'none';
        }
    }, [activeSheet]);

    // [OPTIMIZATION] useMemo로 버튼 레이블 캐싱
    const regionLabel = useMemo(() =>
        mapMode === 'domestic' ? (selectedRegion || '전체') : (selectedCountry || '국가'),
        [mapMode, selectedRegion, selectedCountry]);
    const isSheetAtFullHeight = sheetHeight >= MAX_SHEET_HEIGHT - 0.5;

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
        if (!user || !isAdmin || activeSheet !== 'none') return;

        let isMounted = true;
        const loadPendingCounts = async () => {
            try {
                const [{ count: submissionsCount }, { count: reviewsCount }] = await Promise.all([
                    supabase
                        .from('restaurant_submissions')
                        .select('id', { count: 'exact', head: true })
                        .eq('status', 'pending'),
                    supabase
                        .from('reviews')
                        .select('id', { count: 'exact', head: true })
                        .eq('is_verified', false),
                ]);

                if (!isMounted) return;
                setAdminBadgeCounts({
                    submissions: submissionsCount ?? 0,
                    reviews: reviewsCount ?? 0,
                });
            } catch {
                if (!isMounted) return;
                setAdminBadgeCounts({ submissions: 0, reviews: 0 });
            }
        };

        loadPendingCounts();
        return () => {
            isMounted = false;
        };
    }, [activeSheet, isAdmin, user]);

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

    const handleAdminBannersClick = useCallback(() => {
        router.push('/admin/banners');
        closeUserMenu();
    }, [closeUserMenu, router]);

    const handleAdminCostClick = useCallback(() => {
        router.push('/admin/costs');
        closeUserMenu();
    }, [closeUserMenu, router]);

    const handleAdminRestaurantsClick = useCallback(() => {
        router.push('/admin/evaluations');
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

    const handleNotificationItemClick = useCallback((notification: Notification) => {
        markAsRead(notification.id);

        if (notification.type === 'review_approved' || notification.type === 'review_rejected') {
            const reviewId = notification.data?.reviewId;
            const status = notification.type === 'review_approved' ? 'approved' : 'rejected';
            if (reviewId) {
                router.push(`/mypage/reviews?reviewId=${reviewId}&status=${status}`);
            } else {
                router.push(`/mypage/reviews?status=${status}`);
            }
            return;
        }

        router.push('/?panel=announcement');
    }, [markAsRead, router]);

    const renderBookmarkMenuButton = () => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'h-8 w-8 rounded-full border border-border bg-background',
                        'hover:bg-secondary/80'
                    )}
                    aria-label="북마크"
                >
                    <Bookmark className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 bg-card border-border font-serif z-[110]">
                <DropdownMenuLabel className="flex items-center justify-between text-foreground">
                    <span>북마크</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                            if (!user) {
                                toast.error('로그인 후 북마크를 확인할 수 있어요');
                                onTopShellUserIconClick?.();
                                return;
                            }
                            router.push('/mypage/bookmarks');
                        }}
                        className="h-6 px-2 text-xs"
                    >
                        전체보기
                    </Button>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <ScrollArea className="h-64">
                    {!user ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            로그인 후 북마크를 확인할 수 있어요
                        </div>
                    ) : bookmarksData.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            북마크한 맛집이 없습니다
                        </div>
                    ) : (
                        <DropdownMenuGroup>
                            {bookmarksData.slice(0, 20).map((bookmark) => (
                                <DropdownMenuItem
                                    key={bookmark.id}
                                    className="flex items-center gap-2 p-3 cursor-pointer hover:bg-accent w-full max-w-full"
                                    onClick={() => {
                                        const restaurant = bookmark.restaurant;
                                        const isOverseas = restaurant.lat && restaurant.lng && (
                                            restaurant.lat < 33 || restaurant.lat > 39 ||
                                            restaurant.lng < 124 || restaurant.lng > 132
                                        );

                                        if (pathname === '/') {
                                            window.dispatchEvent(new CustomEvent('selectBookmarkRestaurant', {
                                                detail: {
                                                    id: bookmark.restaurant_id,
                                                    mode: isOverseas ? 'overseas' : 'domestic'
                                                }
                                            }));
                                            return;
                                        }

                                        const modeParam = isOverseas ? '&mode=overseas' : '';
                                        router.push(`/?r=${bookmark.restaurant_id}${modeParam}&z=13`);
                                    }}
                                >
                                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                        <div className="flex items-center justify-between gap-2 w-full">
                                            <span className="text-sm font-medium text-foreground truncate block">
                                                {bookmark.restaurant.name}
                                            </span>
                                            {bookmark.restaurant.category?.[0] && (
                                                <Badge variant="secondary" className="text-[10px] shrink-0 h-5 px-1.5 font-normal">
                                                    {bookmark.restaurant.category[0]}
                                                </Badge>
                                            )}
                                        </div>
                                        <span className="text-xs text-muted-foreground truncate block">
                                            {bookmark.restaurant.road_address || bookmark.restaurant.jibun_address || '주소 없음'}
                                        </span>
                                    </div>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    )}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const renderNotificationMenuButton = () => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'h-8 w-8 rounded-full border border-border bg-background',
                        'hover:bg-secondary/80 relative'
                    )}
                    aria-label="알림"
                >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                        <Badge
                            variant="destructive"
                            className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] bg-red-800"
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 bg-card border-border font-serif z-[110]">
                <DropdownMenuLabel className="flex items-center justify-between text-foreground">
                    <span>알림</span>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={markAllAsRead}
                            className="h-6 px-2 text-xs"
                        >
                            모두 읽음
                        </Button>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <ScrollArea className="h-64">
                    {!user ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            로그인 후 알림을 확인할 수 있어요
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            새로운 알림이 없습니다
                        </div>
                    ) : (
                        <DropdownMenuGroup>
                            {notifications.map((notification) => (
                                <DropdownMenuItem
                                    key={notification.id}
                                    className={cn(
                                        "flex items-center gap-2 p-3 cursor-pointer hover:bg-accent w-full max-w-full",
                                        !notification.isRead && "bg-accent/50"
                                    )}
                                    onClick={() => handleNotificationItemClick(notification)}
                                >
                                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                        <div className="flex items-center justify-between gap-2 w-full">
                                            <p className="text-sm font-medium text-foreground truncate">{notification.title}</p>
                                            {!notification.isRead && (
                                                <span className="h-2 w-2 rounded-full bg-red-700 shrink-0" aria-hidden />
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                                            {notification.createdAt.toLocaleString('ko-KR')}
                                        </p>
                                    </div>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    )}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );

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
                    className={cn(
                        'h-8 w-8 rounded-full border border-border bg-background',
                        'hover:bg-secondary/80'
                    )}
                    aria-label="사용자 메뉴"
                >
                    <UserIcon className="h-4 w-4" />
                </Button>
            );
        }

        return (
            <DropdownMenu open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            'h-8 w-8 rounded-full border border-border bg-background',
                            'hover:bg-secondary/80'
                        )}
                        aria-label="사용자 메뉴"
                    >
                        <UserIcon className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-card border-border font-serif w-40 z-[110]">
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
                            <DropdownMenuItem onClick={handleAdminRestaurantsClick} className="text-foreground hover:bg-accent py-1.5">
                                <Utensils className="mr-2 h-4 w-4" />
                                맛집관리
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => dispatchWindowEvent('openAdminSubmissions')} className="text-foreground hover:bg-accent py-1.5">
                                <ClipboardList className="mr-2 h-4 w-4" />
                                제보관리
                                {adminBadgeCounts.submissions > 0 && (
                                    <Badge variant="destructive" className="ml-auto h-4 min-w-[16px] px-1 text-[10px] bg-red-800">
                                        {adminBadgeCounts.submissions > 99 ? '99+' : adminBadgeCounts.submissions}
                                    </Badge>
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => dispatchWindowEvent('openAdminReviews')} className="text-foreground hover:bg-accent py-1.5">
                                <MessageSquare className="mr-2 h-4 w-4" />
                                리뷰관리
                                {adminBadgeCounts.reviews > 0 && (
                                    <Badge variant="destructive" className="ml-auto h-4 min-w-[16px] px-1 text-[10px] bg-red-800">
                                        {adminBadgeCounts.reviews > 99 ? '99+' : adminBadgeCounts.reviews}
                                    </Badge>
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleAdminBannersClick} className="text-foreground hover:bg-accent py-1.5">
                                <ImageIcon className="mr-2 h-4 w-4" />
                                배너관리
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-border my-1" />
                            <DropdownMenuItem onClick={handleAdminCostClick} className="text-foreground hover:bg-accent py-1.5">
                                <DollarSign className="mr-2 h-4 w-4" />
                                서버비용
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleInsightMenuClick} className="text-foreground hover:bg-accent py-1.5">
                                <BarChart2 className="mr-2 h-4 w-4" />
                                인사이트
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
                        'pointer-events-auto flex items-center gap-1.5 h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5',
                        activeSheet === 'search' && 'ring-2 ring-primary'
                    )}
                >
                    <Button
                        variant="ghost"
                        onClick={() => toggleSheet('search')}
                        className="flex-1 h-9 rounded-full justify-start gap-2 px-2 hover:bg-secondary/80"
                        aria-label="맛집 검색 열기"
                    >
                        <Image
                            src="/logo.png"
                            alt="로고"
                            width={24}
                            height={24}
                            className="rounded-md object-contain shrink-0"
                        />
                        <span className="text-sm text-muted-foreground truncate">쯔동여지도 맛집 검색하기</span>
                    </Button>

                    {renderBookmarkMenuButton()}
                    {renderNotificationMenuButton()}

                    {renderUserMenuButton()}
                </div>

                <div className="pointer-events-auto mt-2 -mx-3 flex gap-2 overflow-x-auto pl-[calc(env(safe-area-inset-left)+8px)] pr-[calc(env(safe-area-inset-right)+8px)] pb-1 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {quickTopCategories.map((category) => (
                        <Button
                            key={category}
                            variant="secondary"
                            size="sm"
                            onClick={() => handleQuickCategoryToggle(category)}
                            className={cn(
                                'pointer-events-auto h-8 shrink-0 rounded-full shadow-sm border border-border bg-background/95 backdrop-blur-sm',
                                'px-3 text-xs font-medium transition-colors hover:bg-secondary/80',
                                quickSelectedCategories.includes(category)
                                    ? 'bg-red-700 text-white border-red-700 hover:bg-red-800'
                                    : 'text-foreground'
                            )}
                        >
                            {category}
                        </Button>
                    ))}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleSheet('category')}
                        className={cn(
                            'pointer-events-auto h-8 shrink-0 rounded-full shadow-sm border border-border bg-background/95 backdrop-blur-sm',
                            'hover:bg-secondary/80 px-3 text-xs font-medium',
                            activeSheet === 'category' && 'ring-2 ring-primary'
                        )}
                    >
                        <Filter className="mr-1 h-3.5 w-3.5" />
                        더보기
                    </Button>
                </div>
            </div>

            {/* 좌측 하단: 국내/해외, 지역/카테고리 버튼 */}
            <div className="fixed bottom-20 left-4 z-40 flex flex-col gap-2">
                {/* 국내/해외 토글 버튼 - 모든 사용자에게 표시 */}
                {onModeChange && (
                    <div className="flex items-center gap-0.5 p-0.5 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border w-[clamp(84px,28vw,105px)]">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onModeChange('domestic')}
                            className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mapMode === 'domestic'
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
                            className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mapMode === 'overseas'
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
                    className={cn(
                        'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80 w-[clamp(84px,28vw,105px)] px-2 h-8',
                        activeSheet === 'region' && 'ring-2 ring-primary'
                    )}
                >
                    <div className="flex items-center w-full gap-1">
                        <div className="flex items-center justify-center w-4 shrink-0">
                            <MapPin className="h-4 w-4" />
                        </div>
                        <div className="flex-1 flex items-center justify-center min-w-0">
                            <span className="text-xs truncate">{regionLabel}</span>
                        </div>
                    </div>
                </Button>

            </div>

            {/* 우측 하단: 제보, 검색 버튼 */}
            <div className="fixed bottom-20 right-4 z-40 flex flex-col gap-2">
                {/* 제보 버튼 */}
                <Button
                    onClick={() => {
                        if (!user) {
                            toast.error('맛집 제보는 로그인 후 이용 가능합니다');
                            return;
                        }
                        onSubmissionClick?.();
                    }}
                    className={cn(
                        'h-12 w-12 rounded-full shadow-lg',
                        'bg-red-800 hover:bg-red-900 text-white',
                        'transition-all duration-300 ease-in-out',
                        'hover:scale-110 active:scale-95',
                        'flex items-center justify-center',
                        'border-2 border-border/20'
                    )}
                    title="맛집 제보하기"
                >
                    <Send className="h-5 w-5" />
                </Button>
            </div>

            {/* 전체 화면 검색 레이어 */}
            {activeSheet === 'search' && (
                <div className="fixed inset-0 z-[75] bg-background/95 backdrop-blur-sm pointer-events-auto animate-in fade-in-0 duration-200">
                    <div
                        className="flex flex-col overflow-hidden animate-in slide-in-from-top-3 duration-300"
                        style={{
                            height: searchViewportHeight ? `${searchViewportHeight}px` : '100dvh',
                            paddingTop: 'calc(env(safe-area-inset-top) + 10px)',
                            paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                        }}
                    >
                        <div className="px-3 pb-3">
                            <div className="flex items-center gap-1.5 h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5">
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
                                        placeholder={searchType === 'name' ? '쯔동여지도 맛집 검색하기' : '유튜브 제목으로 검색하기'}
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
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                                            aria-label="검색어 지우기"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSearchType((prev) => prev === 'name' ? 'youtube' : 'name')}
                                    title={searchType === 'name' ? "유튜브 제목으로 검색" : "맛집 이름으로 검색"}
                                    className="h-8 w-8 rounded-full border border-border bg-background hover:bg-secondary/80"
                                >
                                    {searchType === 'name' ? (
                                        <MapPin className="h-4 w-4" />
                                    ) : (
                                        <Video className="h-4 w-4" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClose}
                                    aria-label="검색 닫기"
                                    className="h-8 w-8 rounded-full border border-border bg-background hover:bg-secondary/80"
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden px-3 pb-2">
                            <Suspense fallback={<SheetLoading />}>
                                <RestaurantSearch
                                    onRestaurantSelect={(restaurant) => {
                                        onRestaurantSelect(restaurant);
                                        handleClose();
                                    }}
                                    onRestaurantSearch={(restaurant) => {
                                        onRestaurantSearch(restaurant);
                                        handleClose();
                                    }}
                                    onSearchExecute={() => {
                                        onSearchExecute();
                                        handleClose();
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
                                    className="h-full w-full"
                                />
                            </Suspense>
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
                        <Button variant="ghost" size="icon" onClick={handleClose}>
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    <div className="p-4 pb-8">
                        {activeSheet === 'region' && (
                            <div className="space-y-3">
                                {mapMode === 'domestic' ? (
                                    <>
                                        <Button
                                            variant={selectedRegion === null ? "default" : "outline"}
                                            className="w-full justify-between h-auto py-3"
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
                                                        className="justify-between h-auto py-3"
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
                                                    className="justify-between h-auto py-3"
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
                                        className="w-full"
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
                                                className="justify-between h-auto py-3"
                                                onClick={() => {
                                                    const newCategories = isSelected
                                                        ? selectedCategories.filter(cat => cat !== category)
                                                        : [...selectedCategories, category];
                                                    setQuickSelectedCategories(newCategories);
                                                    onCategoryChange(newCategories);
                                                }}
                                            >
                                                <span className="font-medium flex items-center gap-1.5">
                                                    {isSelected && <Check className="h-4 w-4" />}
                                                    {category}
                                                </span>
                                                <span className="text-xs opacity-75">({count})</span>
                                            </Button>
                                        );
                                    })}
                                </div>

                                <Button
                                    className="w-full"
                                    onClick={handleClose}
                                >
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
