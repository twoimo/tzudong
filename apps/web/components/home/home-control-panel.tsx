'use client'; // [CSR] 사용자 입력 및 상호작용 처리

import { Suspense, lazy } from 'react';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Grid3X3, Map } from "lucide-react";
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
    isGridMode: boolean;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onRestaurantSelect: (restaurant: any) => void;
    onRestaurantSearch: (restaurant: any) => void;
    onSearchExecute: (region?: Region | null) => void;
    onGridModeToggle: () => void;
}

// [CSR] 지역/국가 선택, 카테고리 필터, 검색 통합 패널 - 모든 사용자 입력 처리
export default function HomeControlPanel({
    mapMode,
    selectedRegion,
    selectedCountry,
    selectedCategories,
    filters,
    countryCounts,
    isGridMode,
    onRegionChange,
    onCountryChange,
    onCategoryChange,
    onRestaurantSelect,
    onRestaurantSearch,
    onSearchExecute,
    onGridModeToggle,
}: HomeControlPanelProps) {
    return (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
            <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
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
            </div>
        </div>
    );
}
