import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';

import { OVERSEAS_REGIONS, OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';

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



    // mapMode 변경 시 초기화
    useEffect(() => {
        if (mapMode === 'domestic') {
            setSelectedRegion(null);
            setSelectedCategories([]);
        } else {
            setSelectedCountry("헝가리(부다페스트)");
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
                .select('*, name:approved_name') // [수정] approved_name을 name으로 사용
                .eq('status', 'approved');

            if (error) {
                console.error('글로벌 맛집 데이터 조회 실패:', error);
                return [];
            }
            return mergeRestaurants(data || []);
        },
        enabled: mapMode === 'overseas',
    });


    // 국가별 맛집 수 계산 (이제는 도시/지역별 계산)
    const countryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        OVERSEAS_REGION_LIST.forEach(region => { counts[region] = 0; });

        globalRestaurants.forEach((restaurant) => {
            const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';
            const lowerAddress = address.toLowerCase();

            OVERSEAS_REGION_LIST.forEach((regionKey) => {
                const config = OVERSEAS_REGIONS[regionKey];
                // 해당 지역의 키워드 중 하나라도 포함되면 카운트
                // 대소문자 구분 없이 검색
                const isMatch = config.keywords.some(keyword =>
                    lowerAddress.includes(keyword.toLowerCase())
                );

                // 또는 국가 이름 자체가 포함되어 있으면 (포괄적 검색) - but handled by specific keywords now
                // 만약 국가 이름만 있고 도시 이름이 없는 경우를 대비해 국가 이름도 키워드에 포함할지 고려
                // 현재는 정밀한 도시 매칭을 위해 키워드 기반으로만 카운트

                if (isMatch) {
                    counts[regionKey] = (counts[regionKey] || 0) + 1;
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
        countryCounts,
    };
}
