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
        youtube_reviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[];
    }>>;
    setIsEditModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSelectedRegion: React.Dispatch<React.SetStateAction<Region | null>>;
    setSearchedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setSelectedCountry: React.Dispatch<React.SetStateAction<string | null>>;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setPanelRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setSelectedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setGridSelectedRestaurants: React.Dispatch<React.SetStateAction<{ [key: string]: Restaurant | null }>>;
    setIsGridMode: React.Dispatch<React.SetStateAction<boolean>>;
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
        setGridSelectedRestaurants,
        setIsGridMode,
        setMoveToRestaurant,
    } = props;

    const handleFilterChange = (newFilters: FilterState) => {
        setFilters(newFilters);
    };

    const handleCategoryChange = (categories: string[]) => {
        setSelectedCategories(categories);
        setFilters(prev => ({
            ...prev,
            categories: categories
        }));
    };

    const handleAdminEditRestaurant = (restaurant: Restaurant) => {
        setAdminRestaurantToEdit(restaurant);
        setIsAdminEditModalOpen(true);
    };

    const handleRequestEditRestaurant = (restaurant: Restaurant) => {
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
    };

    const handleEditFormChange = (field: string, value: string | string[]) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleYoutubeReviewChange = (index: number, field: 'youtube_link' | 'tzuyang_review', value: string) => {
        setEditFormData(prev => ({
            ...prev,
            youtube_reviews: prev.youtube_reviews.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            )
        }));
    };

    const handleRegionChange = (region: Region | null) => {
        setSelectedRegion(region);
        setSearchedRestaurant(null);
    };

    const handleCountryChange = (country: string) => {
        setSelectedCountry(country);
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    };

    const handleRestaurantSelect = (restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
    };

    const handleRestaurantSearch = (restaurant: Restaurant) => {
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
    };

    const handleGridRestaurantSelect = (region: Region, restaurant: Restaurant) => {
        setGridSelectedRestaurants(prev => ({
            ...prev,
            [region]: restaurant,
        }));
    };

    const handleGridRestaurantClose = (region: Region) => {
        setGridSelectedRestaurants(prev => ({
            ...prev,
            [region]: null,
        }));
    };

    const switchToSingleMap = (region?: Region | null) => {
        setIsGridMode(false);
        if (region !== undefined) {
            setSelectedRegion(region);
            setSelectedRestaurant(null);
            setSearchedRestaurant(null);
        }
    };

    const handleMapReady = (moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    };

    const handleMarkerClick = (restaurant: Restaurant) => {
        console.log('[HomeClient] handleMarkerClick 호출:', restaurant.name);
        setPanelRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
        setSearchedRestaurant(restaurant);
        setIsPanelOpen(true);
        console.log('[HomeClient] 패널 상태 업데이트 완료');
    };

    const handlePanelClose = () => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    };

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
        handleGridRestaurantSelect,
        handleGridRestaurantClose,
        switchToSingleMap,
        handleMapReady,
        handleMarkerClick,
        handlePanelClose,
    };
}
