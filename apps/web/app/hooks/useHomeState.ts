import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';

const GLOBAL_COUNTRIES = [
    "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

export function useHomeState(mapMode: 'domestic' | 'overseas') {
    // 맛집 선택 및 모달
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
    const [adminRestaurantToEdit, setAdminRestaurantToEdit] = useState<Restaurant | null>(null);

    // 지도 모드 및 지역/국가
    const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<string | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);

    // UI 모드
    const [isGridMode, setIsGridMode] = useState(false);
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
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
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

    // 그리드 모드
    const gridRegions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시"] as Region[];
    const [gridSelectedRestaurants, setGridSelectedRestaurants] = useState<{ [key: string]: Restaurant | null }>({
        "서울특별시": null,
        "부산광역시": null,
        "대구광역시": null,
        "인천광역시": null,
    });

    // mapMode 변경 시 초기화
    useEffect(() => {
        if (mapMode === 'domestic') {
            setSelectedRegion(null);
            setSelectedCategories([]);
        } else {
            setSelectedCountry("튀르키예");
            setSelectedCategories([]);
        }
        setSearchedRestaurant(null);
        setSelectedRestaurant(null);
        setIsPanelOpen(false);
        setPanelRestaurant(null);
    }, [mapMode]);

    // 새로고침 시 상태 초기화
    useEffect(() => {
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem('selectedRestaurant');
            sessionStorage.removeItem('selectedRegion');
        }
    }, []);

    // 글로벌 맛집 데이터
    const { data: globalRestaurants = [] } = useQuery({
        queryKey: ['global-restaurants-count'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('*')
                .eq('status', 'approved');

            if (error) {
                console.error('글로벌 맛집 데이터 조회 실패:', error);
                return [];
            }
            return mergeRestaurants(data || []);
        },
        enabled: mapMode === 'overseas',
    });

    // 국가별 맛집 수 계산
    const countryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        globalRestaurants.forEach((restaurant) => {
            const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';

            GLOBAL_COUNTRIES.forEach((country) => {
                if (address.includes(country)) {
                    counts[country] = (counts[country] || 0) + 1;
                }
            });
        });

        return counts;
    }, [globalRestaurants]);

    return {
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
        isGridMode,
        setIsGridMode,
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
        gridRegions,
        gridSelectedRestaurants,
        setGridSelectedRestaurants,
        countryCounts,
    };
}
