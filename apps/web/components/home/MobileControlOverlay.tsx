'use client';

import { memo, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { Filter, Search, X, MapPin, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Region, REGIONS } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mergeRestaurants } from '@/hooks/use-restaurants';

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
}: MobileControlOverlayProps) {
    const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
    const [sheetHeight, setSheetHeight] = useState(75); // 바텀시트 높이 (vh 단위, 기본 75%)
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(75);

    // 맛집 데이터 조회 (지역/카테고리 카운트용)
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
    });

    const handleClose = useCallback(() => {
        setActiveSheet('none');
    }, []);

    const toggleSheet = useCallback((sheet: ActiveSheet) => {
        setActiveSheet(prev => prev === sheet ? 'none' : sheet);
        // 새 시트 열 때 기본 높이로 초기화
        if (activeSheet !== sheet) {
            // 검색 시트는 50%, 나머지는 75%
            setSheetHeight(sheet === 'search' ? 25 : 50);
        }
    }, [activeSheet]);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        setIsDragging(true);
        setStartY(e.touches[0].clientY);
        setStartHeight(sheetHeight);
    }, [sheetHeight]);

    // 드래그 중
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;

        const deltaY = startY - e.touches[0].clientY;
        const viewportHeight = window.innerHeight;
        const deltaPercent = (deltaY / viewportHeight) * 100;

        let newHeight = startHeight + deltaPercent;
        // 최소 30%, 최대 85%로 제한
        newHeight = Math.max(30, Math.min(85, newHeight));

        setSheetHeight(newHeight);
    }, [isDragging, startY, startHeight]);

    // 드래그 종료
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        // 스냅 포인트: 30%, 50%, 75%, 85%
        const snapPoints = [30, 50, 75, 85];
        const closest = snapPoints.reduce((prev, curr) =>
            Math.abs(curr - sheetHeight) < Math.abs(prev - sheetHeight) ? curr : prev
        );

        setSheetHeight(closest);
    }, [sheetHeight]);

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

    // [OPTIMIZATION] 카테고리별 맛집 수 계산
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        restaurants.forEach((restaurant) => {
            const categories = restaurant.categories || [];
            categories.forEach((category: string) => {
                counts[category] = (counts[category] || 0) + 1;
            });
        });
        return counts;
    }, [restaurants]);

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
            {/* 좌측 하단: 지역/카테고리 버튼 */}
            <div className="fixed bottom-20 left-4 z-40 flex flex-col gap-2">
                {/* 지역/국가 선택 버튼 */}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSheet('region')}
                    className={cn(
                        'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80',
                        activeSheet === 'region' && 'ring-2 ring-primary'
                    )}
                >
                    <MapPin className="h-4 w-4 mr-1.5" />
                    <span className="text-sm truncate max-w-[80px]">{regionLabel}</span>
                </Button>

                {/* 카테고리 필터 버튼 */}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSheet('category')}
                    className={cn(
                        'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                        'hover:bg-secondary/80',
                        activeSheet === 'category' && 'ring-2 ring-primary',
                        selectedCategories.length > 0 && 'bg-primary/10'
                    )}
                >
                    <Filter className="h-4 w-4 mr-1.5" />
                    <span className="text-sm truncate max-w-[80px]">{categoryLabel}</span>
                </Button>
            </div>

            {/* 우측 하단: 검색 버튼 */}
            <div className="fixed bottom-20 right-4 z-40">
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
                        className={cn(
                            'fixed bottom-0 left-0 right-0 z-50',
                            'bg-background rounded-t-2xl shadow-xl',
                            'transition-all duration-150',
                            isDragging ? '' : 'ease-out',
                            // 검색 시트일 때는 드롭다운이 위로 나오도록 overflow visible
                            activeSheet === 'search' ? 'overflow-visible' : 'overflow-y-auto',
                            // 하단 네비게이션바 공간 + iOS safe area + 여유 공간
                            'pb-[calc(env(safe-area-inset-bottom)+80px)]'
                        )}
                        style={{ height: `${sheetHeight}vh` }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 핸들 바 - 드래그 가능, 항상 상단 고정 */}
                        <div
                            className="sticky top-0 z-20 flex justify-center py-3 bg-background cursor-grab active:cursor-grabbing border-b border-border/50"
                            onTouchStart={handleDragStart}
                            onTouchMove={handleDragMove}
                            onTouchEnd={handleDragEnd}
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

                        {/* 컨텐츠 - 직접 선택 가능한 버튼 UI */}
                        <div className="p-4">
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
                                                    onSearchExecute();
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
                                                                onSearchExecute();
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
            )}
        </>
    );
}

const MobileControlOverlay = memo(MobileControlOverlayComponent);
MobileControlOverlay.displayName = 'MobileControlOverlay';

export default MobileControlOverlay;
