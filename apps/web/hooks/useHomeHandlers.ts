import { useCallback } from 'react';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseHomeHandlersProps {
    setFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
    setSelectedCategories: (categories: string[]) => void;
    setAdminRestaurantToEdit: (restaurant: Restaurant | null) => void;
    setIsAdminEditModalOpen: (open: boolean) => void;
    setRestaurantToEdit: (restaurant: Restaurant | null) => void;
    setEditFormData: (data: any) => void;
    setIsEditModalOpen: (open: boolean) => void;
    setSelectedRegion: (region: Region | null) => void;
    setSearchedRestaurant: (restaurant: Restaurant | null) => void;
    setSelectedCountry: (country: string) => void;
    setIsPanelOpen: (open: boolean) => void;
    setPanelRestaurant: (restaurant: Restaurant | null) => void;
    setSelectedRestaurant: (restaurant: Restaurant | null) => void;
    setGridSelectedRestaurants: (setter: (prev: { [key: string]: Restaurant | null }) => { [key: string]: Restaurant | null }) => void;
    setIsGridMode: (mode: boolean) => void;
    setMoveToRestaurant: (fn: ((restaurant: Restaurant) => void) | null) => void;
    isAdmin?: boolean;
}

export function useHomeHandlers(props: UseHomeHandlersProps) {
    const {
        setFilters,
        setSelectedCategories,
        setAdminRestaurantToEdit,
        setIsAdminEditModalOpen,
        setRestaurantToEdit,
        setEditFormData,
        setIsEditModalOpen,
        setSelectedRegion,
        setSearchedRestaurant,
        setSelectedCountry,
        setIsPanelOpen,
        setPanelRestaurant,
        setSelectedRestaurant,
        setGridSelectedRestaurants,
        setIsGridMode,
        setMoveToRestaurant,
        isAdmin,
    } = props;

    const handleFilterChange = useCallback((newFilters: FilterState) => {
        setFilters(newFilters);
    }, [setFilters]);

    const handleCategoryChange = useCallback((categories: string[]) => {
        setSelectedCategories(categories);
        setFilters(prev => ({
            ...prev,
            categories: categories
        }));
    }, [setSelectedCategories, setFilters]);

    const handleAdminEditRestaurant = useCallback((restaurant: Restaurant) => {
        setAdminRestaurantToEdit(restaurant);
        setIsAdminEditModalOpen(true);
    }, [setAdminRestaurantToEdit, setIsAdminEditModalOpen]);

    const onAdminEditRestaurant = isAdmin ? handleAdminEditRestaurant : undefined;

    const handleRequestEditRestaurant = useCallback((restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);

        const youtubeReviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[] = [];

        if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
            restaurant.mergedRestaurants.forEach(record => {
                if (record.youtube_link && record.tzuyang_review) {
                    youtubeReviews.push({
                        youtube_link: record.youtube_link,
                        tzuyang_review: record.tzuyang_review,
                        unique_id: record.unique_id || undefined
                    });
                }
            });
        } else {
            if (restaurant.youtube_link && restaurant.tzuyang_review) {
                youtubeReviews.push({
                    youtube_link: restaurant.youtube_link,
                    tzuyang_review: restaurant.tzuyang_review,
                    unique_id: restaurant.unique_id || undefined
                });
            }
        }

        setEditFormData({
            name: restaurant.name,
            address: restaurant.road_address || restaurant.jibun_address || '',
            phone: restaurant.phone || '',
            category: Array.isArray(restaurant.categories)
                ? restaurant.categories
                : (restaurant.categories ? [restaurant.categories] : []),
            youtube_reviews: youtubeReviews
        });
        setIsEditModalOpen(true);
    }, [setRestaurantToEdit, setEditFormData, setIsEditModalOpen]);

    const handleRegionChange = useCallback((region: Region | null) => {
        setSelectedRegion(region);
        setSearchedRestaurant(null);
    }, [setSelectedRegion, setSearchedRestaurant]);

    const handleCountryChange = useCallback((country: string) => {
        setSelectedCountry(country);
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    }, [setSelectedCountry, setIsPanelOpen, setPanelRestaurant, setSelectedRestaurant, setSearchedRestaurant]);

    const handleRestaurantSelect = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
    }, [setSelectedRestaurant]);

    const handleRestaurantSearch = useCallback((restaurant: Restaurant) => {
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
    }, [setSearchedRestaurant, setSelectedRestaurant]);

    const handleGridRestaurantSelect = useCallback((region: Region, restaurant: Restaurant) => {
        setGridSelectedRestaurants(prev => ({
            ...prev,
            [region]: restaurant,
        }));
    }, [setGridSelectedRestaurants]);

    const handleGridRestaurantClose = useCallback((region: Region) => {
        setGridSelectedRestaurants(prev => ({
            ...prev,
            [region]: null,
        }));
    }, [setGridSelectedRestaurants]);

    const switchToSingleMap = useCallback((region?: Region | null) => {
        setIsGridMode(false);
        if (region !== undefined) {
            setSelectedRegion(region);
            setSelectedRestaurant(null);
            setSearchedRestaurant(null);
        }
    }, [setIsGridMode, setSelectedRegion, setSelectedRestaurant, setSearchedRestaurant]);

    const handleMapReady = useCallback((moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    }, [setMoveToRestaurant]);

    const handleMarkerClick = useCallback((restaurant: Restaurant) => {
        console.log('[HomeClient] handleMarkerClick 호출:', restaurant.name);
        setPanelRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
        setSearchedRestaurant(restaurant);
        setIsPanelOpen(true);
        console.log('[HomeClient] 패널 상태 업데이트 완료');
    }, [setPanelRestaurant, setSelectedRestaurant, setSearchedRestaurant, setIsPanelOpen]);

    const handlePanelClose = useCallback(() => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    }, [setIsPanelOpen, setPanelRestaurant, setSelectedRestaurant, setSearchedRestaurant]);

    return {
        handleFilterChange,
        handleCategoryChange,
        onAdminEditRestaurant,
        handleRequestEditRestaurant,
        handleRegionChange,
        handleCountryChange,
        handleRestaurantSelect,
        handleRestaurantSearch,
        handleGridRestaurantSelect,
        handleGridRestaurantClose,
        switchToSingleMap,
        handleMapReady,
        handleMarkerClick,
        handlePanelClose,
    };
}
