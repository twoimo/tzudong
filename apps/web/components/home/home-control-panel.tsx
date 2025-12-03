'use client'; // [CSR] 사용자 입력 및 상호작용 처리

import { Suspense, lazy, useState, useRef, useEffect } from 'react';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Grid3X3, Map, Globe, Filter, Search, Grid } from "lucide-react";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { SearchSkeleton } from "@/components/skeletons/SearchSkeleton";

// [CSR] 코드 스플리팅으로 성능 최적화
const RegionSelector = lazy(() => import("@/components/region/RegionSelector"));
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));

interface HomeControlPanelProps {
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
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    leftSidebarWidth?: number;
    rightPanelWidth?: number;
}

// [CSR] 지역/국가 선택, 카테고리 필터, 검색 통합 패널 - 모든 사용자 입력 처리
export default function HomeControlPanel({
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
    activePanel,
    onPanelClick,
    leftSidebarWidth = 64,
    rightPanelWidth = 0,
}: HomeControlPanelProps) {
    const [isObscured, setIsObscured] = useState(false);

    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);

    // 화면 크기 및 패널 크기 기반으로 충돌 감지 및 위치 계산
    useEffect(() => {
        const updateLayout = () => {
            if (!panelRef.current) return;

            const windowWidth = window.innerWidth;
            const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;

            // 1. 충돌 감지
            // 패널이 가용 공간보다 크거나, 여유 공간이 부족하면 가려진 것으로 판단 (여유 공간 40px)
            // 확장된 상태의 대략적인 너비를 850px로 가정하고 체크
            const estimatedExpandedWidth = 850;
            setIsObscured(availableWidth < estimatedExpandedWidth);

            // 2. 위치 계산 (JS로 정확하게 계산)
            // 가용 영역의 중심점 계산
            // 시작점(leftSidebarWidth) + 가용너비/2
            const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
            setLeftPosition(`${centerOfVisibleArea}px`);
        };

        updateLayout();
        window.addEventListener('resize', updateLayout);
        return () => window.removeEventListener('resize', updateLayout);
    }, [leftSidebarWidth, rightPanelWidth]);

    // activePanel이 'control'이거나, 가려지지 않았을 때 확장됨
    const isExpanded = activePanel === 'control' || !isObscured;

    return (
        <div
            ref={panelRef}
            className={`fixed bottom-4 transition-all duration-300 ease-in-out ${isExpanded ? 'z-[50]' : 'z-[60]'} hover:z-[60]`}
            style={{
                left: leftPosition,
                transform: 'translateX(-50%)'
            }}
            onClick={(e) => {
                e.stopPropagation();
                onPanelClick?.('control');
            }}
        >
            <div className={`
                flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg transition-all duration-300 ease-in-out
                ${isExpanded ? 'p-3 scale-100 opacity-100' : 'p-2 scale-95 opacity-90 hover:scale-100 hover:opacity-100'}
                hover:shadow-xl hover:border-primary/50
            `}>
                {isExpanded ? (
                    // 확장된 상태: 전체 컨트롤 패널 표시
                    <>
                        {/* [CSR] 지역/국가 선택 - 드롭다운 인터랙션 */}
                        {mapMode === 'domestic' ? (
                            <RegionSelector
                                selectedRegion={selectedRegion}
                                onRegionChange={onRegionChange}
                                onRegionSelect={onSearchExecute}
                            />
                        ) : (
                            <Select value={selectedCountry || undefined} onValueChange={onCountryChange}>
                                <SelectTrigger className="w-48">
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

                        {/* [CSR] 카테고리 필터 - 선택 인터랙션 */}
                        <CategoryFilter
                            selectedCategories={selectedCategories}
                            onCategoryChange={onCategoryChange}
                            selectedRegion={mapMode === 'domestic' ? selectedRegion : null}
                            selectedCountry={mapMode === 'overseas' ? selectedCountry : null}
                            className="w-48"
                        />

                        {/* [CSR] 검색 - 텍스트 입력 및 자동완성 */}
                        <Suspense fallback={<SearchSkeleton />}>
                            <RestaurantSearch
                                onRestaurantSelect={onRestaurantSelect}
                                onRestaurantSearch={onRestaurantSearch}
                                onSearchExecute={onSearchExecute}
                                filters={filters}
                                selectedRegion={mapMode === 'domestic' ? selectedRegion : (selectedCountry as any)}
                                isKoreanOnly={mapMode === 'domestic'}
                            />
                        </Suspense>

                    </>
                ) : (
                    // 축소된 상태: 아이콘만 표시 (텍스트 제거하여 너비 최소화)
                    <div className="flex items-center gap-2 px-2">
                        <div className="p-2 rounded-full hover:bg-secondary/80 transition-colors cursor-pointer" title="지역">
                            <Globe className="h-5 w-5 text-muted-foreground hover:text-primary" />
                        </div>

                        <div className="w-px h-6 bg-border/50" />

                        <div className="p-2 rounded-full hover:bg-secondary/80 transition-colors cursor-pointer" title="필터">
                            <Filter className="h-5 w-5 text-muted-foreground hover:text-primary" />
                        </div>

                        <div className="w-px h-6 bg-border/50" />

                        <div className="p-2 rounded-full hover:bg-secondary/80 transition-colors cursor-pointer" title="검색">
                            <Search className="h-5 w-5 text-muted-foreground hover:text-primary" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


