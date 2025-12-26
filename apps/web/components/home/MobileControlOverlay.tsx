'use client';

import { memo, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { Filter, Search, X, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// [OPTIMIZATION] 바텀시트 내 컴포넌트 lazy loading
const RegionSelector = lazy(() => import('@/components/region/RegionSelector'));
const RestaurantSearch = lazy(() => import('@/components/search/RestaurantSearch'));
const CategoryFilter = lazy(() => import('@/components/filters/CategoryFilter'));

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
 * [OPTIMIZATION] useMemo로 레이블 캐싱, lazy loading으로 번들 최적화
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

    const handleClose = useCallback(() => {
        setActiveSheet('none');
    }, []);

    const toggleSheet = useCallback((sheet: ActiveSheet) => {
        setActiveSheet(prev => prev === sheet ? 'none' : sheet);
    }, []);

    // [OPTIMIZATION] useMemo로 레이블 캐싱
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
            {/* 우측 하단: 지역/카테고리 버튼 */}
            <div className="fixed bottom-20 right-4 z-40 flex flex-col gap-2">
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

            {/* 좌측 하단: 검색 버튼 */}
            <div className="fixed bottom-20 left-4 z-40">
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
                            'animate-in slide-in-from-bottom duration-300',
                            // 검색 시트일 때는 드롭다운이 위로 나오도록 overflow visible
                            activeSheet === 'search' ? 'max-h-[85vh] overflow-visible' : 'max-h-[75vh] overflow-y-auto',
                            // 하단 네비게이션바 공간 + iOS safe area + 여유 공간
                            'pb-[calc(env(safe-area-inset-bottom)+80px)]'
                        )}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 핸들 바 */}
                        <div className="flex justify-center py-2">
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

                        {/* 컨텐츠 - lazy loading 컴포넌트 Suspense 적용 */}
                        <div className="p-4">
                            <Suspense fallback={<SheetLoading />}>
                                {activeSheet === 'region' && (
                                    <div className="space-y-4">
                                        {mapMode === 'domestic' ? (
                                            <RegionSelector
                                                selectedRegion={selectedRegion}
                                                onRegionChange={(region) => {
                                                    onRegionChange(region);
                                                    handleClose();
                                                }}
                                                onRegionSelect={() => {
                                                    onSearchExecute();
                                                    handleClose();
                                                }}
                                            />
                                        ) : (
                                            <Select
                                                value={selectedCountry || undefined}
                                                onValueChange={(value) => {
                                                    onCountryChange(value);
                                                    handleClose();
                                                }}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="국가 선택" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="미국">미국 ({countryCounts["미국"] || 0}개)</SelectItem>
                                                    <SelectItem value="일본">일본 ({countryCounts["일본"] || 0}개)</SelectItem>
                                                    <SelectItem value="대만">대만 ({countryCounts["대만"] || 0}개)</SelectItem>
                                                    <SelectItem value="태국">태국 ({countryCounts["태국"] || 0}개)</SelectItem>
                                                    <SelectItem value="인도네시아">인도네시아 ({countryCounts["인도네시아"] || 0}개)</SelectItem>
                                                    <SelectItem value="튀르키예">튀르키예 ({countryCounts["튀르키예"] || 0}개)</SelectItem>
                                                    <SelectItem value="헝가리">헝가리 ({countryCounts["헝가리"] || 0}개)</SelectItem>
                                                    <SelectItem value="오스트레일리아">오스트레일리아 ({countryCounts["오스트레일리아"] || 0}개)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                )}

                                {activeSheet === 'category' && (
                                    <div className="space-y-4">
                                        <CategoryFilter
                                            selectedCategories={selectedCategories}
                                            onCategoryChange={(categories) => {
                                                onCategoryChange(categories);
                                            }}
                                            selectedRegion={mapMode === 'domestic' ? selectedRegion : null}
                                            selectedCountry={mapMode === 'overseas' ? selectedCountry : null}
                                            className="w-full"
                                        />
                                        <Button
                                            className="w-full"
                                            onClick={handleClose}
                                        >
                                            적용하기
                                        </Button>
                                    </div>
                                )}

                                {activeSheet === 'search' && (
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
                                )}
                            </Suspense>
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
