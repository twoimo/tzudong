import { useState } from 'react';
import { Restaurant, Region } from '@/types/restaurant';

export interface HomeState {
    // 맛집 선택 및 검색
    selectedRestaurant: Restaurant | null;
    searchedRestaurant: Restaurant | null;

    // 지도 모드
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;

    // UI 상태
    isGridMode: boolean;
    isPanelOpen: boolean;
    panelRestaurant: Restaurant | null;

    // 그리드 모드
    gridSelectedRestaurants: { [key: string]: Restaurant | null };

    // 필터
    selectedCategories: string[];

    // 지도 제어
    moveToRestaurant: ((restaurant: Restaurant) => void) | null;
}

export function useHomeState() {
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);

    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<string | null>("튀르키예");

    const [isGridMode, setIsGridMode] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);

    const gridRegions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시"] as Region[];
    const [gridSelectedRestaurants, setGridSelectedRestaurants] = useState<{ [key: string]: Restaurant | null }>({
        "서울특별시": null,
        "부산광역시": null,
        "대구광역시": null,
        "인천광역시": null,
    });

    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);

    return {
        selectedRestaurant,
        setSelectedRestaurant,
        searchedRestaurant,
        setSearchedRestaurant,
        mapMode,
        setMapMode,
        selectedRegion,
        setSelectedRegion,
        selectedCountry,
        setSelectedCountry,
        isGridMode,
        setIsGridMode,
        isPanelOpen,
        setIsPanelOpen,
        panelRestaurant,
        setPanelRestaurant,
        gridRegions,
        gridSelectedRestaurants,
        setGridSelectedRestaurants,
        selectedCategories,
        setSelectedCategories,
        moveToRestaurant,
        setMoveToRestaurant,
    };
}
