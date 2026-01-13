'use client';

import { memo, useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { Filter, Search, X, MapPin, Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Region, REGIONS } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { toast } from 'sonner';

// 카테고리 상수
const CATEGORIES = [
    "한식", "중식", "양식", "분식", "치킨", "피자", "고기",
    "족발·보쌈", "돈까스·회", "아시안", "패스트푸드",
    "카페·디저트", "찜·탕", "야식", "도시락"
];

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
    onRestaurantSelect: (restaurant: any) => void;
    onRestaurantSearch: (restaurant: any) => void;
    onSearchExecute: (region?: Region | null) => void;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    user?: any;
    onSubmissionClick?: () => void;
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
}: MobileControlOverlayProps) {
    const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
    const [sheetHeight, setSheetHeight] = useState(50); // 최종 높이 (스냅 시에만 업데이트)
    // [OPTIMIZATION] isDragging은 UI 업데이트용으로만 사용, 실제 드래그 로직은 ref 사용
    const [isDragging, setIsDragging] = useState(false);

    // [OPTIMIZATION] ref로 실시간 드래그 상태 추적 (리렌더링 없이)
    const sheetRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const currentHeightRef = useRef(50); // 현재 드래그 중인 높이
    const startYRef = useRef(0);
    const startHeightRef = useRef(50);
    const isDraggingRef = useRef(false); // [OPTIMIZATION] isDragging도 ref로 관리
    // 드래그 속도 측정용 ref
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);

    // 맛집 데이터 조회 (지역/카테고리 카운트용) - [OPTIMIZATION] 필요한 필드만 선택
    const { data: restaurants = [] } = useQuery({
        queryKey: ['mobile-control-restaurants', mapMode],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name, road_address, jibun_address, categories')
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
        // 최소 5%까지 드래그 가능 (닫기 영역), 최대 90%
        newHeight = Math.max(5, Math.min(90, newHeight));

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

    // [OPTIMIZATION] 드래그 종료 - 닫기만 처리, 스냅 없이 현재 위치 유지
    const handleDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // 빠르게 아래로 스와이프 (velocity > 0.5px/ms) 하면 닫기
        if (velocityRef.current > 0.5) {
            handleClose();
            return;
        }

        const currentHeight = currentHeightRef.current;

        // 닫기 임계값 (15% 이하시 닫기)
        if (currentHeight <= 15) {
            handleClose();
            return;
        }

        // 최소 높이 이하면 최소 높이로 조정 (20%)
        if (currentHeight < 20) {
            const minHeight = 20;
            setSheetHeight(minHeight);
            currentHeightRef.current = minHeight;
            if (sheetRef.current) {
                sheetRef.current.style.transform = `translateY(calc(100% - ${minHeight}dvh))`;
            }
        } else {
            // [Fix] 드래그 종료 시 현재 높이로 state 업데이트하여 위치 유지 (리렌더링 시 스냅백 방지)
            setSheetHeight(currentHeight);
        }
        // 스냅 없음 - 현재 위치 그대로 유지
    }, [handleClose]);

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

        // 터치 이벤트
        handleEl.addEventListener('touchstart', handleTouchStart as any, { passive: true });
        handleEl.addEventListener('touchmove', handleTouchMove as any, { passive: false });
        handleEl.addEventListener('touchmove', preventPullToRefresh, { passive: false });
        handleEl.addEventListener('touchend', handleDragEnd as any, { passive: true });

        // 마우스 이벤트 (핸들에서 시작)
        handleEl.addEventListener('mousedown', handleMouseDown as any);

        // 마우스 move/up은 window에 등록 (핸들 밖으로 드래그해도 동작)
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingRef.current) {
                e.preventDefault();
                handleMouseMove(e);
            }
        };

        const handleWindowMouseUp = () => {
            if (isDraggingRef.current) {
                handleDragEnd();
            }
        };

        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);

        return () => {
            handleEl.removeEventListener('touchstart', handleTouchStart as any);
            handleEl.removeEventListener('touchmove', handleTouchMove as any);
            handleEl.removeEventListener('touchmove', preventPullToRefresh);
            handleEl.removeEventListener('touchend', handleDragEnd as any);
            handleEl.removeEventListener('mousedown', handleMouseDown as any);
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

    const categoryLabel = useMemo(() =>
        selectedCategories.length > 0
            ? `${selectedCategories[0]}${selectedCategories.length > 1 ? ` +${selectedCategories.length - 1}` : ''}`
            : '카테고리',
        [selectedCategories]);

    return (
        <>
            {/* 좌측 하단: 국내/해외, 지역/카테고리 버튼 */}
            <div className="fixed bottom-20 left-4 z-40 flex flex-col gap-2">
                {/* 국내/해외 토글 버튼 - 관리자만 표시 */}
                {isAdmin && onModeChange && (
                    <div className="flex items-center gap-0.5 p-0.5 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border w-[105px]">
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
                        'hover:bg-secondary/80 min-w-[105px] max-w-[140px] px-2',
                        activeSheet === 'region' && 'ring-2 ring-primary'
                    )}
                >
                    <div className="flex items-center w-full gap-1">
                        <div className="flex items-center justify-center w-4 shrink-0">
                            <MapPin className="h-4 w-4" />
                        </div>
                        <div className="flex-1 flex items-center justify-center min-w-0">
                            <span className="text-sm truncate">{regionLabel}</span>
                        </div>
                    </div>
                </Button>

                {/* 카테고리 필터 버튼 */}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSheet('category')}
                    className={cn(
                        'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80 min-w-[105px] max-w-[140px] px-2',
                        activeSheet === 'category' && 'ring-2 ring-primary',
                        selectedCategories.length > 0 && 'bg-primary/10'
                    )}
                >
                    <div className="flex items-center w-full gap-1">
                        <div className="flex items-center justify-center w-4 shrink-0">
                            <Filter className="h-4 w-4" />
                        </div>
                        <div className="flex-1 flex items-center justify-center min-w-0">
                            <span className="text-sm truncate">{categoryLabel}</span>
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

                {/* 검색 버튼 */}
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => toggleSheet('search')}
                    className={cn(
                        'h-12 w-12 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80',
                        activeSheet === 'search' && 'ring-2 ring-primary'
                    )}
                >
                    <Search className="h-5 w-5" />
                </Button>
            </div>

            {/* 바텀시트 오버레이 */}
            {activeSheet !== 'none' && (
                <div
                    className="fixed inset-0 z-50 bg-black/30"
                    onClick={handleClose}
                >
                    {/* 바텀시트 컨테이너 */}
                    <div
                        ref={sheetRef}
                        className={cn(
                            'fixed bottom-0 left-0 right-0 z-50',
                            'bg-background rounded-t-2xl shadow-xl',
                            'flex flex-col', // flexbox로 변경하여 컨텐츠 영역 제어
                            // [OPTIMIZATION] transition은 드래그 종료 시에만 (검색 시트는 제외)
                            (isDragging || activeSheet === 'search') ? '' : 'transition-transform duration-150 ease-out',
                            // 검색 시트일 때는 드롭다운이 위로 나오도록 overflow visible
                            activeSheet === 'search' ? 'overflow-visible' : 'overflow-hidden',
                            // 하단 네비게이션바 공간 + iOS safe area + 여유 공간
                            // 검색 시트는 컨텐츠에 딱 맞게 불필요한 여백 최소화
                            activeSheet === 'search'
                                ? 'pb-4'
                                : 'pb-[calc(env(safe-area-inset-bottom)+80px)]'
                        )}
                        style={{
                            // [OPTIMIZATION] 검색 시트는 auto height, 나머지는 고정 높이 + transform
                            // [Fix] 100vh 대신 100%를 사용하여 모바일 브라우저 호환성 향상 (부모가 fixed inset-0임)
                            // [Fix] 삼성 인터넷/사파리 대응: max-height와 dvh 단위를 사용하여 헤더(64px) 침범 방지
                            height: activeSheet === 'search' ? 'auto' : '100%',
                            maxHeight: activeSheet === 'search' ? 'none' : 'calc(100dvh - 64px)',
                            transform: activeSheet === 'search'
                                ? 'none'
                                : `translateY(calc(100% - ${sheetHeight}dvh))`,
                            willChange: isDragging ? 'transform' : 'auto', // 드래그 중 GPU 레이어 유지
                            // 검색 시트는 네비게이션 바(약 65px) + Safe Area 위로 띄움
                            bottom: activeSheet === 'search' ? 'calc(35px + env(safe-area-inset-bottom))' : 0,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 핸들 바 - 검색 시트는 드래그 불가, touch-action: none으로 Pull-to-Refresh 방지 */}
                        {activeSheet !== 'search' && (
                            <div
                                ref={handleRef}
                                className="sticky top-0 z-20 flex justify-center py-3 bg-background cursor-grab active:cursor-grabbing select-none border-b border-border/50"
                                style={{ touchAction: 'none' }}
                            >
                                <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                            </div>
                        )}

                        {/* 헤더 */}
                        <div className={cn(
                            "flex items-center justify-between px-4 pb-3 border-b border-border",
                            activeSheet === 'search' && "pt-3" // 검색 시트는 핸들이 없으므로 상단 패딩 추가
                        )}>
                            <h3 className="text-lg font-semibold">
                                {activeSheet === 'region' && (mapMode === 'domestic' ? '지역 선택' : '국가 선택')}
                                {activeSheet === 'category' && '카테고리 필터'}
                                {activeSheet === 'search' && '맛집 검색'}
                            </h3>
                            <Button variant="ghost" size="icon" onClick={handleClose}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>

                        {/* 컨텐츠 - 별도의 스크롤 컨테이너 */}
                        <div
                            className={cn(
                                "flex-1",
                                // 검색 시트일 때는 드롭다운이 보이도록 overflow visible
                                activeSheet === 'search' ? 'overflow-visible' : 'overflow-y-auto'
                            )}
                            style={{
                                // [Fix] vh 대신 dvh 사용 및 헤더 오프셋 정합성 유지
                                maxHeight: activeSheet === 'search'
                                    ? 'none' // 검색 시트는 높이 제한 없음 (컨텐츠만큼만)
                                    : `calc(${sheetHeight}dvh - 120px)`,
                            }}
                        >
                            <div className="p-4 pb-8">{/* 하단 패딩으로 스크롤 끝까지 가능 */}
                                {activeSheet === 'region' && (
                                    <div className="space-y-3">
                                        {mapMode === 'domestic' ? (
                                            // 국내 지역 버튼 그리드
                                            <>
                                                {/* 전국 버튼 */}
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

                                                {/* 지역 버튼 그리드 */}
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
                                            // 해외 국가 버튼 그리드
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
                                        {/* 초기화 버튼 */}
                                        {selectedCategories.length > 0 && (
                                            <Button
                                                variant="outline"
                                                className="w-full"
                                                onClick={() => onCategoryChange([])}
                                            >
                                                초기화 ({selectedCategories.length}개 선택됨)
                                            </Button>
                                        )}

                                        {/* 카테고리 버튼 그리드 */}
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

                                        {/* 적용 버튼 */}
                                        <Button
                                            className="w-full"
                                            onClick={handleClose}
                                        >
                                            적용하기
                                        </Button>
                                    </div>
                                )}

                                {activeSheet === 'search' && (
                                    <Suspense fallback={<SheetLoading />}>
                                        <div className="space-y-4">
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
                                                selectedRegion={mapMode === 'domestic' ? selectedRegion : (selectedCountry as any)}
                                                isKoreanOnly={mapMode === 'domestic'}
                                                maxItems={3} // 모바일에서는 3개씩만 표시
                                            />
                                        </div>
                                    </Suspense>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

const MobileControlOverlay = memo(MobileControlOverlayComponent);
MobileControlOverlay.displayName = 'MobileControlOverlay';

export default MobileControlOverlay;
