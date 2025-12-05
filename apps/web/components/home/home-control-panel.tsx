'use client'; // [CSR] 사용자 입력 및 상호작용 처리

import { Suspense, lazy, useState, useRef, useEffect, useCallback } from 'react';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Globe, Filter, Search } from "lucide-react";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { SearchSkeleton } from "@/components/skeletons/SearchSkeleton";

// [CSR] 코드 스플리팅으로 성능 최적화
const RegionSelector = lazy(() => import("@/components/region/RegionSelector"));
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));

// 펼쳤을 때 패널의 최소 너비 (850px)
const EXPANDED_PANEL_WIDTH = 850;
// 축소됐을 때 패널의 대략적인 너비 (아이콘 3개 + padding)
const COLLAPSED_PANEL_WIDTH = 150;

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
    // 마우스가 패널 위에 있는지 여부
    const [isHovered, setIsHovered] = useState(false);
    // 패널이 좌우 패널과 겹치는지 여부
    const [canOverlap, setCanOverlap] = useState(false);

    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);

    // 화면 크기 및 패널 크기 기반으로 겹침 가능 여부 및 위치 계산
    useEffect(() => {
        const updateLayout = () => {
            if (!panelRef.current) return;

            const windowWidth = window.innerWidth;
            const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;

            // 1. 겹침 가능 여부 계산
            // 최소 필요 너비 = max(좌+축소패널+우, 펼친패널)
            // 축소된 상태에서 좌우 패널과 함께 배치될 때 필요한 너비
            const collapsedLayoutWidth = leftSidebarWidth + COLLAPSED_PANEL_WIDTH + rightPanelWidth;
            // 두 가지 중 더 큰 값이 필요한 최소 화면 너비
            const minRequiredWidth = Math.max(collapsedLayoutWidth, EXPANDED_PANEL_WIDTH);

            // 화면 너비가 최소 필요 너비보다 작으면 겹칠 가능성 있음
            setCanOverlap(windowWidth < minRequiredWidth);

            // 2. 위치 계산 (가용 영역의 정확한 중심점)
            // 가용 영역: leftSidebarWidth ~ (windowWidth - rightPanelWidth)
            // 중심점: leftSidebarWidth + (가용너비 / 2)
            const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
            setLeftPosition(`${centerOfVisibleArea}px`);
        };

        updateLayout();
        window.addEventListener('resize', updateLayout);
        return () => window.removeEventListener('resize', updateLayout);
    }, [leftSidebarWidth, rightPanelWidth]);

    // 패널 외부 마우스 이동 감지 (겹침 상태에서만 축소)
    useEffect(() => {
        if (!canOverlap) return; // 겹침 가능하지 않으면 리스너 불필요

        const handleMouseMove = (e: MouseEvent) => {
            if (!panelRef.current) return;

            const rect = panelRef.current.getBoundingClientRect();
            // 마우스가 패널 영역 내에 있는지 확인 (여유 공간 10px 추가)
            const isInsidePanel =
                e.clientX >= rect.left - 10 &&
                e.clientX <= rect.right + 10 &&
                e.clientY >= rect.top - 10 &&
                e.clientY <= rect.bottom + 10;

            setIsHovered(isInsidePanel);
        };

        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, [canOverlap]);

    // 확장 조건:
    // 1. activePanel이 'control'인 경우 (명시적 선택)
    // 2. 겹침 가능하지 않은 경우 (공간 충분)
    // 3. 겹침 가능하지만 마우스가 패널 위에 있는 경우
    const isExpanded = activePanel === 'control' || !canOverlap || isHovered;

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
            <div
                className={`
                    flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg transition-all duration-300 ease-in-out
                    ${isExpanded ? 'p-3 scale-100 opacity-100' : 'p-2 scale-95 opacity-90 hover:scale-100 hover:opacity-100'}
                    hover:shadow-xl hover:border-primary/50
                `}
                style={{
                    minWidth: isExpanded ? EXPANDED_PANEL_WIDTH : undefined
                }}
            >
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


