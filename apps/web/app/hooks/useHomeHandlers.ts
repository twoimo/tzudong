import { useCallback } from 'react';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';

interface UseHomeHandlersProps {
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
    setAdminRestaurantToEdit: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setIsAdminEditModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setRestaurantToEdit: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setEditFormData: React.Dispatch<React.SetStateAction<{
        name: string;
        address: string;
        phone: string;
        category: string[];
        youtube_reviews: { youtube_link: string; tzuyang_review: string; restaurant_id: string }[];
    }>>;
    setIsEditModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSelectedRegion: React.Dispatch<React.SetStateAction<Region | null>>;
    setSearchedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setSelectedCountry: React.Dispatch<React.SetStateAction<string | null>>;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setPanelRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setSelectedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setMoveToRestaurant: React.Dispatch<React.SetStateAction<((restaurant: Restaurant) => void) | null>>;
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
        setMoveToRestaurant,
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

    const handleRequestEditRestaurant = useCallback((restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);

        const youtubeReviews: { youtube_link: string; tzuyang_review: string; restaurant_id: string }[] = [];

        if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
            restaurant.mergedRestaurants.forEach(record => {
                if (record.youtube_link && record.tzuyang_review) {
                    youtubeReviews.push({
                        youtube_link: record.youtube_link,
                        tzuyang_review: record.tzuyang_review,
                        restaurant_id: record.id // 각 레코드의 restaurants.id 저장
                    });
                }
            });
        } else {
            if (restaurant.youtube_link && restaurant.tzuyang_review) {
                youtubeReviews.push({
                    youtube_link: restaurant.youtube_link,
                    tzuyang_review: restaurant.tzuyang_review,
                    restaurant_id: restaurant.id // 해당 레코드의 restaurants.id 저장
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

    const handleEditFormChange = useCallback((field: string, value: string | string[]) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    }, [setEditFormData]);

    const handleYoutubeReviewChange = useCallback((index: number, field: 'youtube_link' | 'tzuyang_review', value: string) => {
        setEditFormData(prev => ({
            ...prev,
            youtube_reviews: prev.youtube_reviews.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            )
        }));
    }, [setEditFormData]);

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
        setPanelRestaurant(restaurant);
        setIsPanelOpen(true);
    }, [setSearchedRestaurant, setSelectedRestaurant, setPanelRestaurant, setIsPanelOpen]);



    const switchToSingleMap = useCallback((region?: Region | null) => {
        if (region !== undefined) {
            setSelectedRegion(region);
            setSelectedRestaurant(null);
            setSearchedRestaurant(null);

            // 지역 변경 시 사용자 지도 이동 플래그 리셋 (지도가 새 지역으로 이동할 수 있도록)
            window.dispatchEvent(new CustomEvent('resetUserMapMovement'));
        }
    }, [setSelectedRegion, setSelectedRestaurant, setSearchedRestaurant]);

    const handleMapReady = useCallback((moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    }, [setMoveToRestaurant]);



    const handlePanelClose = useCallback(() => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    }, [setIsPanelOpen, setPanelRestaurant, setSelectedRestaurant, setSearchedRestaurant]);

    return {
        handleFilterChange,
        handleCategoryChange,
        handleAdminEditRestaurant,
        handleRequestEditRestaurant,
        handleEditFormChange,
        handleYoutubeReviewChange,
        handleRegionChange,
        handleCountryChange,
        handleRestaurantSelect,
        handleRestaurantSearch,
        switchToSingleMap,
        handleMapReady,

        handlePanelClose,
    };
}
