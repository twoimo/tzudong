'use client';

import { memo, useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { Filter, Search, X, MapPin, Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Region, REGIONS } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    const [isDragging, setIsDragging] = useState(false);

    // [OPTIMIZATION] ref로 실시간 드래그 상태 추적 (리렌더링 없이)
    const sheetRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const currentHeightRef = useRef(50); // 현재 드래그 중인 높이
    const startYRef = useRef(0);
    const startHeightRef = useRef(50);

    // 맛집 데이터 조회 (지역/카테고리 카운트용) - [OPTIMIZATION] 캐싱 전략 추가
    const { data: restaurants = [] } = useQuery({
        queryKey: ['mobile-control-restaurants', mapMode],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('*')
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

    // [OPTIMIZATION] 드래그 시작 - passive 이벤트 방지를 위해 별도 처리
    const handleDragStart = useCallback((e: TouchEvent) => {
        setIsDragging(true);
        startYRef.current = e.touches[0].clientY;
        startHeightRef.current = currentHeightRef.current;
    }, []);

    // [OPTIMIZATION] 드래그 중 - ref로 직접 DOM 조작 (리렌더링 없음, sheetRef 체크 제거)
    const handleDragMove = useCallback((e: TouchEvent) => {
        if (!isDragging) return;

        const currentY = e.touches[0].clientY;
        const deltaY = startYRef.current - currentY;
        const viewportHeight = window.innerHeight;
        const deltaVh = (deltaY / viewportHeight) * 100;

        let newHeight = startHeightRef.current + deltaVh;
        newHeight = Math.max(10, Math.min(85, newHeight));

        currentHeightRef.current = newHeight;

        // [OPTIMIZATION] ref로 DOM 직접 조작 (리렌더링 제거)
        requestAnimationFrame(() => {
            if (sheetRef.current) {
                sheetRef.current.style.transform = `translateY(calc(85vh - ${newHeight}vh))`;
            }
        });
    }, [isDragging]);
    // [OPTIMIZATION] 드래그 종료 - 스냅 포인트로 이동
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        const currentHeight = currentHeightRef.current;
        const snapPoints = activeSheet === 'search' ? [10, 25, 50] : [10, 30, 50, 75, 85];

        // 가장 가까운 스냅 포인트 찾기
        const snapHeight = snapPoints.reduce((prev, curr) =>
            Math.abs(curr - currentHeight) < Math.abs(prev - currentHeight) ? curr : prev
        );

        // 닫기 임계값 (10vh 이하시 닫기)
        if (snapHeight <= 10) {
            handleClose();
            return;
        }

        // 스냅 포인트로 이동 (transition 포함)
        setSheetHeight(snapHeight);
        currentHeightRef.current = snapHeight;
        if (sheetRef.current) {
            sheetRef.current.style.transform = `translateY(calc(85vh - ${snapHeight}vh))`;
        }
    }, [activeSheet, handleClose]);

    // [OPTIMIZATION] 지역별 맛집 수 계산
    const regionCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        restaurants.forEach((restaurant) => {
            const address = restaurant.road_address || restaurant.jibun_address || '';
            REGIONS.forEach((region) => {
                if (region === "울릉도" && address.includes('울릉')) {
                    counts[region] = (counts[region] || 0) + 1;
                } else if (region === "욕지도" && address.includes('욕지')) {
                    counts[region] = (counts[region] || 0) + 1;
                } else if (address.includes(region)) {
                    counts[region] = (counts[region] || 0) + 1;
                }
            });
        });
        return counts;
    }, [restaurants]);

    // [OPTIMIZATION] 카테고리별 맛집 수 계산 (선택된 지역 고려)
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        // 지역이 선택된 경우 해당 지역의 맛집만 필터링
        const filteredRestaurants = selectedRegion
            ? restaurants.filter((restaurant) => {
                const address = restaurant.road_address || restaurant.jibun_address || '';
                if (selectedRegion === "울릉도") {
                    return address.includes('울릉');
                } else if (selectedRegion === "욕지도") {
                    return address.includes('욕지');
                } else {
                    return address.includes(selectedRegion);
                }
            })
            : restaurants;

        filteredRestaurants.forEach((restaurant) => {
            const categories = restaurant.categories || [];
            categories.forEach((category: string) => {
                counts[category] = (counts[category] || 0) + 1;
            });
        });
        return counts;
    }, [restaurants, selectedRegion]);

    // [OPTIMIZATION] Passive 이벤트 리스너 등록
    useEffect(() => {
        const handleEl = handleRef.current;
        if (!handleEl || activeSheet === 'none') return;

        // Passive: true로 스크롤 성능 최적화
        handleEl.addEventListener('touchstart', handleDragStart as any, { passive: true });
        handleEl.addEventListener('touchmove', handleDragMove as any, { passive: true });
        handleEl.addEventListener('touchend', handleDragEnd as any, { passive: true });

        return () => {
            handleEl.removeEventListener('touchstart', handleDragStart as any);
            handleEl.removeEventListener('touchmove', handleDragMove as any);
            handleEl.removeEventListener('touchend', handleDragEnd as any);
        };
    }, [activeSheet, handleDragStart, handleDragMove, handleDragEnd]);

    // [CRITICAL] activeSheet 변경 시 초기 높이 설정
    useEffect(() => {
        if (activeSheet === 'none' || !sheetRef.current) return;

        const initialHeight = activeSheet === 'search' ? 25 : 50;
        currentHeightRef.current = initialHeight;
        setSheetHeight(initialHeight);

        // DOM에 즉시 반영 (애니메이션과 함께)
        sheetRef.current.style.transform = `translateY(calc(85vh - ${initialHeight}vh))`;
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
                        'border-2 border-stone-200/20'
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
                            // [OPTIMIZATION] transition은 드래그 종료 시에만
                            isDragging ? '' : 'transition-transform duration-150 ease-out',
                            // 검색 시트일 때는 드롭다운이 위로 나오도록 overflow visible
                            activeSheet === 'search' ? 'overflow-visible' : 'overflow-hidden',
                            // 하단 네비게이션바 공간 + iOS safe area + 여유 공간
                            'pb-[calc(env(safe-area-inset-bottom)+80px)]'
                        )}
                        style={{
                            // [OPTIMIZATION] 고정 높이 + transform으로 위치 조정 (GPU 합성)
                            height: '85vh',
                            transform: `translateY(calc(85vh - ${sheetHeight}vh))`,
                            willChange: isDragging ? 'transform' : 'auto', // 드래그 중 GPU 레이어 유지
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 핸들 바 - 드래그 가능, 항상 상단 고정 */}
                        <div
                            ref={handleRef}
                            className="sticky top-0 z-20 flex justify-center py-3 bg-background cursor-grab active:cursor-grabbing border-b border-border/50"
                        >
                            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                        </div>

                        {/* 헤더 */}
                        <div className="flex items-center justify-between px-4 pb-3 border-b border-border">
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
                                maxHeight: `calc(${sheetHeight}vh - 120px)`, // 핸들바(52px) + 헤더(68px) 제외
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
