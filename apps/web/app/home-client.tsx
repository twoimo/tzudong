'use client'; // [CSR] 상태 관리 및 브라우저 API 사용

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant, Region } from "@/types/restaurant";
import { FilterState } from "@/components/filters/FilterPanel";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import HomeModeToggle from "../components/home/home-mode-toggle";
import HomeControlPanel from "../components/home/home-control-panel";
import HomeMapContainer from "../components/home/home-map-container";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// [최적화] 동적 임포트 - 모달은 필요할 때만 로드
const AdminRestaurantModal = dynamic(
    () => import('@/components/admin/AdminRestaurantModal').then(mod => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);

const EditRestaurantModal = dynamic(
    () => import('@/components/modals/EditRestaurantModal').then(mod => ({ default: mod.EditRestaurantModal })),
    { ssr: false }
);

// [CSR] 글로벌 국가 목록 상수
const GLOBAL_COUNTRIES = [
    "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

export default function HomeClient() {
    const { isAdmin } = useAuth();

    // [CSR] 상태 관리 - 맛집 선택 및 모달
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
    const [adminRestaurantToEdit, setAdminRestaurantToEdit] = useState<Restaurant | null>(null);

    // [CSR] 상태 관리 - 지도 모드 및 지역/국가
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<string | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);

    // [CSR] 상태 관리 - UI 모드
    const [isGridMode, setIsGridMode] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

    // [CSR] 상태 관리 - 해외 모드 패널
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);

    // [CSR] 상태 관리 - 폼 데이터
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
    });

    // [CSR] 상태 관리 - 필터 및 카테고리
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // [CSR] 상태 관리 - 그리드 모드
    const gridRegions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시"] as Region[];
    const [gridSelectedRestaurants, setGridSelectedRestaurants] = useState<{ [key: string]: Restaurant | null }>({
        "서울특별시": null,
        "부산광역시": null,
        "대구광역시": null,
        "인천광역시": null,
    });

    // [CSR] mapMode 변경 시 디폴트값으로 초기화
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

    // [CSR] 새로고침 시 상태 초기화 - sessionStorage 클리어
    useEffect(() => {
        // 컴포넌트 마운트 시 sessionStorage 클리어하여 초기 상태 보장
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem('selectedRestaurant');
            sessionStorage.removeItem('selectedRegion');
        }
    }, []);

    // [CSR] 팝업에서 맛집 선택 시 이벤트 리스너
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleRestaurantSelected = (event: any) => {
            const { restaurant, region } = event.detail;
            console.log('[HomeClient] restaurant-selected 이벤트 수신:', restaurant?.name, region);

            // 국내 맛집인 경우만 처리 (mapMode === 'domestic')
            if (mapMode === 'domestic' && region) {
                setSelectedRegion(region as Region);
                setSelectedRestaurant(restaurant);
                setSearchedRestaurant(restaurant);

                // 약간의 딜레이를 주어 지도가 준비된 후 이동
                setTimeout(() => {
                    if (moveToRestaurant) {
                        console.log('[HomeClient] 지도 이동 함수 호출');
                        moveToRestaurant(restaurant);
                    }
                }, 300);
            }
        };

        window.addEventListener('restaurant-selected', handleRestaurantSelected);

        return () => {
            window.removeEventListener('restaurant-selected', handleRestaurantSelected);
        };
    }, [mapMode, moveToRestaurant]);

    // [CSR] 글로벌 맛집 데이터 가져오기 (React Query)
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

    // [CSR] 국가별 맛집 수 계산 (메모이제이션)
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

    // [CSR] 이벤트 핸들러들
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

    const onAdminEditRestaurant = isAdmin ? handleAdminEditRestaurant : undefined;

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

    return (
        <>
            {/* [CSR] 국내/해외 토글 - 클릭 이벤트 처리 */}
            <HomeModeToggle
                mode={mapMode}
                onModeChange={(mode) => {
                    setIsPanelOpen(false);
                    setPanelRestaurant(null);
                    setSelectedRestaurant(null);
                    setSearchedRestaurant(null);
                    setMapMode(mode);
                }}
            />

            {/* [CSR] 지역 선택 및 검색 컴포넌트 - 사용자 입력 처리 */}
            <HomeControlPanel
                mapMode={mapMode}
                selectedRegion={selectedRegion}
                selectedCountry={selectedCountry}
                selectedCategories={selectedCategories}
                filters={filters}
                countryCounts={countryCounts}
                isGridMode={isGridMode}
                onRegionChange={handleRegionChange}
                onCountryChange={handleCountryChange}
                onCategoryChange={handleCategoryChange}
                onRestaurantSelect={handleRestaurantSelect}
                onRestaurantSearch={handleRestaurantSearch}
                onSearchExecute={switchToSingleMap}
                onGridModeToggle={() => setIsGridMode(!isGridMode)}
            />

            {/* [CSR] 지도 컨테이너 - 브라우저 지도 라이브러리 사용 */}
            <HomeMapContainer
                mapMode={mapMode}
                isGridMode={isGridMode}
                gridRegions={gridRegions}
                gridSelectedRestaurants={gridSelectedRestaurants}
                filters={filters}
                selectedRegion={selectedRegion}
                selectedCountry={selectedCountry}
                searchedRestaurant={searchedRestaurant}
                selectedRestaurant={selectedRestaurant}
                refreshTrigger={refreshTrigger}
                panelRestaurant={panelRestaurant}
                isPanelOpen={isPanelOpen}
                onAdminEditRestaurant={onAdminEditRestaurant}
                onRequestEditRestaurant={handleRequestEditRestaurant}
                onRestaurantSelect={setSelectedRestaurant}
                onGridRestaurantSelect={handleGridRestaurantSelect}
                onGridRestaurantClose={handleGridRestaurantClose}
                onSwitchToSingleMap={switchToSingleMap}
                onMapReady={handleMapReady}
                onMarkerClick={handleMarkerClick}
                onPanelClose={handlePanelClose}
                onReviewModalOpen={() => setIsReviewModalOpen(true)}
            />

            {/* [최적화] 맛집 수정 요청 모달 - 동적 임포트 적용 */}
            <EditRestaurantModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false);
                    setRestaurantToEdit(null);
                }}
                restaurant={restaurantToEdit}
                initialFormData={editFormData}
            />


            {/* [CSR] 관리자 맛집 수정 모달 - 관리자 전용 기능 */}
            {isAdmin && (
                <AdminRestaurantModal
                    isOpen={isAdminEditModalOpen}
                    onClose={() => {
                        setIsAdminEditModalOpen(false);
                        setAdminRestaurantToEdit(null);
                    }}
                    restaurant={adminRestaurantToEdit}
                    onSuccess={(updatedRestaurant) => {
                        setRefreshTrigger(prev => prev + 1);
                        if (updatedRestaurant && selectedRestaurant?.id === updatedRestaurant.id) {
                            setSelectedRestaurant(updatedRestaurant);
                            setPanelRestaurant(updatedRestaurant);
                        }
                        setIsAdminEditModalOpen(false);
                        setAdminRestaurantToEdit(null);
                    }}
                />
            )}
        </>
    );
}
