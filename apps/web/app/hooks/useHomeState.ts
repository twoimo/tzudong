import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Restaurant, Region } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { releaseSearchSelectionOwnership as releaseSearchSelectionOwnershipSnapshot } from '@/lib/mobile-home-search-selection';

export function useHomeState(mapMode: 'domestic' | 'overseas') {
    // 맛집 선택 및 모달
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
    const [adminRestaurantToEdit, setAdminRestaurantToEdit] = useState<Restaurant | null>(null);

    // 지도 모드 및 지역/국가
    const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<string | null>("헝가리(부다페스트)");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);

    // UI 모드
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

    // 해외 모드 패널
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);

    // 폼 데이터
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; restaurant_id: string }[]
    });

    // 필터 및 카테고리
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // Mobile-home detail selection stays parent-owned so search, marker taps,
    // swipe navigation, and close/reset flows all converge on one contract.
    const syncRestaurantDetailSelection = useCallback((
        restaurant: Restaurant | null,
        options?: {
            isPanelOpen?: boolean;
            searchFocusRestaurant?: Restaurant | null;
        }
    ) => {
        setSelectedRestaurant(restaurant);
        setPanelRestaurant(restaurant);
        setIsPanelOpen(options?.isPanelOpen ?? Boolean(restaurant));
        setSearchedRestaurant(options?.searchFocusRestaurant ?? null);
    }, []);

    const openRestaurantDetailSelection = useCallback((
        restaurant: Restaurant,
        options?: {
            searchFocusRestaurant?: Restaurant | null;
        }
    ) => {
        syncRestaurantDetailSelection(restaurant, {
            isPanelOpen: true,
            searchFocusRestaurant: options?.searchFocusRestaurant ?? null,
        });
    }, [syncRestaurantDetailSelection]);

    const clearRestaurantDetailSelection = useCallback(() => {
        syncRestaurantDetailSelection(null, {
            isPanelOpen: false,
            searchFocusRestaurant: null,
        });
    }, [syncRestaurantDetailSelection]);

    const releaseSearchSelectionOwnership = useCallback(() => {
        const nextSnapshot = releaseSearchSelectionOwnershipSnapshot({
            searchedRestaurant,
            selectedRestaurant,
            panelRestaurant,
            isPanelOpen,
        });

        if (nextSnapshot.searchedRestaurant !== searchedRestaurant) {
            setSearchedRestaurant(nextSnapshot.searchedRestaurant);
        }
    }, [isPanelOpen, panelRestaurant, searchedRestaurant, selectedRestaurant]);
    // mapMode 변경 시 초기화
    useEffect(() => {
        if (mapMode === 'domestic') {
            setSelectedRegion(null);
            setSelectedCategories([]);
        } else {
            setSelectedCountry("헝가리(부다페스트)");
            setSelectedCategories([]);
        }
        clearRestaurantDetailSelection();
    }, [clearRestaurantDetailSelection, mapMode]);

    // 새로고침 시 상태 초기화
    useEffect(() => {
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem('selectedRestaurant');
            sessionStorage.removeItem('selectedRegion');
        }
    }, []);
    return useMemo(() => ({
        // States
        selectedRestaurant,
        setSelectedRestaurant,
        refreshTrigger,
        setRefreshTrigger,
        isAdminEditModalOpen,
        setIsAdminEditModalOpen,
        adminRestaurantToEdit,
        setAdminRestaurantToEdit,
        selectedRegion,
        setSelectedRegion,
        selectedCountry,
        setSelectedCountry,
        searchedRestaurant,
        setSearchedRestaurant,

        isEditModalOpen,
        setIsEditModalOpen,
        restaurantToEdit,
        setRestaurantToEdit,
        isReviewModalOpen,
        setIsReviewModalOpen,
        isCategoryPopoverOpen,
        setIsCategoryPopoverOpen,
        moveToRestaurant,
        setMoveToRestaurant,
        isPanelOpen,
        setIsPanelOpen,
        panelRestaurant,
        setPanelRestaurant,
        editFormData,
        setEditFormData,
        filters,
        setFilters,
        selectedCategories,
        setSelectedCategories,
        syncRestaurantDetailSelection,
        openRestaurantDetailSelection,
        clearRestaurantDetailSelection,
        releaseSearchSelectionOwnership,
    }), [
        selectedRestaurant,
        refreshTrigger,
        isAdminEditModalOpen,
        adminRestaurantToEdit,
        selectedRegion,
        selectedCountry,
        searchedRestaurant,
        isEditModalOpen,
        restaurantToEdit,
        isReviewModalOpen,
        isCategoryPopoverOpen,
        moveToRestaurant,
        isPanelOpen,
        panelRestaurant,
        editFormData,
        filters,
        selectedCategories,
        syncRestaurantDetailSelection,
        openRestaurantDetailSelection,
        clearRestaurantDetailSelection,
        releaseSearchSelectionOwnership,
    ]);
}
