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
        setPanelRestaurant(restaurant);
        setIsPanelOpen(true);
    };



    const switchToSingleMap = (region?: Region | null) => {
        if (region !== undefined) {
            setSelectedRegion(region);
            setSelectedRestaurant(null);
            setSearchedRestaurant(null);

            // 지역 변경 시 사용자 지도 이동 플래그 리셋 (지도가 새 지역으로 이동할 수 있도록)
            window.dispatchEvent(new CustomEvent('resetUserMapMovement'));
        }
    };

    const handleMapReady = (moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
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
        switchToSingleMap,
        handleMapReady,

        handlePanelClose,
    };
}
