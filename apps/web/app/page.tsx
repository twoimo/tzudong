'use client';

import { useState, Suspense, lazy, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { mergeRestaurants } from "@/hooks/use-restaurants";

// 코드 스플리팅으로 성능 최적화
const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));
const MapView = lazy(() => import("@/components/map/MapView"));
const FilterPanel = lazy(() =>
    import("@/components/filters/FilterPanel").then(module => ({ default: module.FilterPanel }))
);
const RegionSelector = lazy(() => import("@/components/region/RegionSelector"));
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Grid3X3, Map, MapPin, Star, Users, ChefHat } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant, Region } from "@/types/restaurant";
import { FilterState } from "@/components/filters/FilterPanel";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function HomePage() {
    const { isAdmin } = useAuth();
    const pathname = usePathname();

    // 내부 상태로 관리 (이전에는 props로 받았음)
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const onAdminEditRestaurant = undefined; // Admin 기능은 별도로 구현
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<string | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);

    // mapMode 변경 시 디폴트값으로 초기화
    useEffect(() => {
        if (mapMode === 'domestic') {
            setSelectedRegion(null); // 전국
            setSelectedCategories([]);
        } else {
            setSelectedCountry("튀르키예"); // 기본 국가
            setSelectedCategories([]);
        }
        // 모든 선택 상태 초기화
        setSearchedRestaurant(null);
        setSelectedRestaurant(null);
        // 패널 상태 초기화
        setIsPanelOpen(false);
        setPanelRestaurant(null);
    }, [mapMode, setSelectedRestaurant]);

    const [isGridMode, setIsGridMode] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);

    // 해외 모드 패널 관리
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);
    const [editFormData, setEditFormData] = useState({
        name: '',
        address: '',
        phone: '',
        category: [] as string[],
        youtube_reviews: [] as { youtube_link: string; tzuyang_review: string; unique_id?: string }[]
    });
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // 글로벌 국가 목록
    const GLOBAL_COUNTRIES = [
        "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
    ];

    // 글로벌 맛집 데이터 가져오기 (병합 로직 적용)
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
        enabled: mapMode === 'overseas', // 해외 모드일 때만 로드
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

    const handleRequestEditRestaurant = (restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);

        // mergedRestaurants에서 모든 유튜브 링크와 쯔양 리뷰 추출
        const youtubeReviews: { youtube_link: string; tzuyang_review: string; unique_id?: string }[] = [];

        if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
            // 병합된 모든 레코드에서 유튜브 링크와 쯔양 리뷰 추출
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
            // 병합되지 않은 경우 (단일 레코드)
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
        // 지역 변경 시 검색 결과 초기화
        setSearchedRestaurant(null);
    };

    const handleCountryChange = (country: string) => {
        setSelectedCountry(country);
        // 국가 변경 시 패널과 선택 상태 초기화
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    };

    // mapMode 변경 시 상태 초기화
    useEffect(() => {
        // 모드 변경 시 해외 모드 관련 상태 모두 초기화
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null);
        setSearchedRestaurant(null);
    }, [mapMode]);

    const handleRestaurantSelect = (restaurant: Restaurant) => {
        // 선택된 맛집을 NaverMapView에 전달하기 위해 상태 업데이트
        setSelectedRestaurant(restaurant);
    };

    const handleRestaurantSearch = (restaurant: Restaurant) => {
        // 검색 시 해당 레스토랑으로 줌인하기 위해 searchedRestaurant 설정
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
        // 지역 필터는 유지 (사용자가 선택한 필터 존중)
    };

    // 맛집의 지역 정보를 추출하는 함수
    const getRestaurantRegion = (restaurant: Restaurant): Region | null => {
        if (restaurant.address_elements && typeof restaurant.address_elements === 'object') {
            const addressElements = restaurant.address_elements as any;
            if (addressElements.SIDO) {
                // SIDO 값이 "서울특별시" 형태로 저장되어 있는지 확인
                const sido = addressElements.SIDO;
                if (typeof sido === 'string') {
                    return sido as Region;
                }
            }
        }

        // address_elements에 지역 정보가 없는 경우 주소에서 추출 시도
        if (restaurant.road_address || restaurant.jibun_address) {
            const address = (restaurant.road_address || restaurant.jibun_address) as string;

            // 세부 지역명 우선 처리 (특정 지역의 세부 구역)
            const specificRegionMappings = [
                { pattern: "욕지면", region: "욕지도" as Region },
                // 필요에 따라 다른 세부 지역 매핑 추가 가능
                // { pattern: "울릉읍", region: "울릉도" as Region },
            ];

            for (const mapping of specificRegionMappings) {
                if (address.includes(mapping.pattern)) {
                    return mapping.region;
                }
            }

            // 일반 광역시도 패턴으로 추출
            const regionPatterns = [
                "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
                "대전광역시", "울산광역시", "세종특별자치시", "경기도", "충청북도",
                "충청남도", "전라남도", "경상북도", "경상남도", "전북특별자치도", "제주특별자치도",
                "울릉도", "욕지도"
            ];

            for (const region of regionPatterns) {
                if (address.includes(region)) {
                    return region as Region;
                }
            }
        }

        return null;
    };

    // selectedRestaurant 변경 시 지역 자동 변경 로직 제거
    // (마커 클릭/팝업 클릭 시 현재 지역 필터 유지)
    // useEffect(() => {
    //   if (selectedRestaurant) {
    //     const region = getRestaurantRegion(selectedRestaurant);
    //     if (region && region !== selectedRegion) {
    //       setSelectedRegion(region);
    //     }
    //   }
    // }, [selectedRestaurant]);

    // 팝업에서 전달된 음식점 정보 처리 (sessionStorage 사용)
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const storedRestaurant = sessionStorage.getItem('selectedRestaurant');
        const storedRegion = sessionStorage.getItem('selectedRegion');

        if (storedRestaurant) {
            const restaurant = JSON.parse(storedRestaurant) as Restaurant;

            // sessionStorage 초기화
            sessionStorage.removeItem('selectedRestaurant');
            sessionStorage.removeItem('selectedRegion');

            // 글로벌 국가 목록으로 해외/국내 판단
            const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';
            const isOverseas = GLOBAL_COUNTRIES.some(country => address.includes(country));

            // 해외/국내에 따라 모드 설정
            if (isOverseas) {
                setMapMode('overseas');
                // 해당 국가로 필터 설정
                const country = GLOBAL_COUNTRIES.find(c => address.includes(c));
                if (country) setSelectedCountry(country);
            } else {
                setMapMode('domestic');
                // 지역 필터를 '전국'으로 설정
                setSelectedRegion(storedRegion as Region || null);
            }

            // 음식점 선택
            setSelectedRestaurant(restaurant);
            setSearchedRestaurant(restaurant);
        }
    }, []);

    // useRestaurants의 결과를 활용해서 검색된 병합 데이터를 기존 데이터와 일치시키는 함수
    const normalizeSearchedRestaurant = (restaurant: Restaurant, allRestaurants: Restaurant[]): Restaurant => {
        if (!restaurant.mergedRestaurants || restaurant.mergedRestaurants.length === 0) {
            return restaurant;
        }

        // 병합된 데이터의 경우 기존 restaurants에서 같은 데이터를 찾음
        const mergedIds = restaurant.mergedRestaurants.map(r => r.id);
        const existingRestaurant = allRestaurants.find(r =>
            mergedIds.includes(r.id) ||
            (r.name === restaurant.name &&
                Math.abs(r.lat - restaurant.lat) < 0.0001 &&
                Math.abs(r.lng - restaurant.lng) < 0.0001)
        );

        return existingRestaurant || restaurant;
    };

    // 그리드 모드에서 사용할 지역들 (4개 지역)
    const gridRegions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시"] as Region[];

    // 각 그리드별 선택된 맛집 상태
    const [gridSelectedRestaurants, setGridSelectedRestaurants] = useState<{ [key: string]: Restaurant | null }>({
        "서울특별시": null,
        "부산광역시": null,
        "대구광역시": null,
        "인천광역시": null,
    });

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

    // 그리드 모드에서 단일 지도로 전환하는 함수
    const switchToSingleMap = (region?: Region | null) => {
        setIsGridMode(false);
        if (region !== undefined) {
            setSelectedRegion(region);
            // 지역 필터링 시 검색된 맛집 초기화 (지역 우선 적용)
            setSelectedRestaurant(null);
            setSearchedRestaurant(null);
        }
    };

    // 해외 모드 - 지도 준비 핸들러
    const handleMapReady = (moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    };

    // 해외 모드 - 마커 클릭 핸들러
    const handleMarkerClick = (restaurant: Restaurant) => {
        console.log('[Index] handleMarkerClick 호출:', restaurant.name);
        setPanelRestaurant(restaurant);
        setSelectedRestaurant(restaurant); // 마커 활성화
        setSearchedRestaurant(restaurant); // 마커 활성화를 위해 추가
        setIsPanelOpen(true);
        console.log('[Index] 패널 상태 업데이트 완료');
    };

    // 해외 모드 - 패널 닫기
    const handlePanelClose = () => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
        setSelectedRestaurant(null); // 마커 활성화 해제
        setSearchedRestaurant(null); // 검색 상태도 초기화
    };

    return (
        <>
            {/* 국내/해외 토글 버튼 - 지도 왼쪽 상단 */}
            <div className="absolute top-6 left-4 z-10">
                <div className="flex items-center p-1 bg-white/90 backdrop-blur-md rounded-xl shadow-sm border border-gray-200/50">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            // 토글 시 즉시 상태 초기화
                            setIsPanelOpen(false);
                            setPanelRestaurant(null);
                            setSelectedRestaurant(null);
                            setSearchedRestaurant(null);
                            setMapMode('domestic');
                        }}
                        className={`rounded-lg px-4 py-1.5 h-8 text-sm font-medium transition-all duration-200 ${mapMode === 'domestic'
                            ? 'bg-[#8B5A2B] text-white shadow-sm hover:bg-[#7A4E25]'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                            }`}
                    >
                        국내
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            console.log('[Index] 해외 토글 클릭 - 상태 초기화 시작');
                            // 토글 시 즉시 상태 초기화
                            setIsPanelOpen(false);
                            setPanelRestaurant(null);
                            setSelectedRestaurant(null);
                            setSearchedRestaurant(null);
                            console.log('[Index] 상태 초기화 완료, mapMode 변경');
                            setMapMode('overseas');
                        }}
                        className={`rounded-lg px-4 py-1.5 h-8 text-sm font-medium transition-all duration-200 ${mapMode === 'overseas'
                            ? 'bg-[#8B5A2B] text-white shadow-sm hover:bg-[#7A4E25]'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                            }`}
                    >
                        해외
                    </Button>
                </div>
            </div>

            {/* 지역 선택 및 검색 컴포넌트 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
                <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
                    <Suspense fallback={<div className="w-40 h-10 bg-muted animate-pulse rounded" />}>
                        {mapMode === 'domestic' ? (
                            <RegionSelector
                                selectedRegion={selectedRegion}
                                onRegionChange={setSelectedRegion}
                                onRegionSelect={switchToSingleMap}
                            />
                        ) : (
                            <Select value={selectedCountry || undefined} onValueChange={handleCountryChange}>
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
                    </Suspense>

                    {/* 카테고리 필터링 */}
                    <CategoryFilter
                        selectedCategories={selectedCategories}
                        onCategoryChange={handleCategoryChange}
                        selectedRegion={mapMode === 'domestic' ? selectedRegion : null}
                        selectedCountry={mapMode === 'overseas' ? selectedCountry : null}
                        className="w-48"
                    />

                    <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
                            filters={filters}
                            selectedRegion={mapMode === 'domestic' ? selectedRegion : (selectedCountry as any)}
                            isKoreanOnly={mapMode === 'domestic'}
                        />
                    </Suspense>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsGridMode(!isGridMode)}
                        className="flex items-center gap-2"
                    >
                        {isGridMode ? <Map className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {isGridMode ? (
                // 그리드 모드: 2x2 그리드로 4개 지역 표시
                <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-1 p-1">
                    {gridRegions.map((region, index) => {
                        const selectedRestaurant = gridSelectedRestaurants[region];
                        return (
                            <div key={region} className="relative min-h-0 overflow-hidden rounded-md border border-border">
                                <NaverMapView
                                    filters={filters}
                                    selectedRegion={region}
                                    searchedRestaurant={null} // 그리드 모드에서는 검색 기능 없음
                                    selectedRestaurant={null} // 그리드 모드에서는 단일 지도 selectedRestaurant 사용 안 함
                                    refreshTrigger={refreshTrigger}
                                    onAdminEditRestaurant={onAdminEditRestaurant}
                                    isGridMode={true}
                                    gridSelectedRestaurant={selectedRestaurant} // 각 그리드별 선택된 맛집
                                    onRestaurantSelect={(restaurant) => handleGridRestaurantSelect(region, restaurant)}
                                />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="absolute top-2 left-2 bg-background/95 backdrop-blur-sm hover:bg-background text-sm font-semibold shadow z-10 h-auto py-1 px-2 text-foreground"
                                    onClick={() => switchToSingleMap(region)}
                                >
                                    {region}
                                </Button>

                                {/* 각 그리드별 맛집 모달 - 그리드 안에서 표시 */}
                                {selectedRestaurant && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-30">
                                        <div className="bg-background rounded-lg border shadow-lg max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
                                            <div className="p-6">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-semibold flex items-center gap-2">
                                                        <ChefHat className="h-5 w-5 text-orange-500" />
                                                        {selectedRestaurant.name}
                                                    </h3>
                                                    <button
                                                        onClick={() => handleGridRestaurantClose(region)}
                                                        className="text-muted-foreground hover:text-foreground"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>

                                                <div className="space-y-4">
                                                    {/* 주소 */}
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <MapPin className="h-4 w-4" />
                                                        {selectedRestaurant.road_address || selectedRestaurant.jibun_address || selectedRestaurant.address}
                                                    </div>

                                                    {/* 방문 정보 */}
                                                    <div className="flex items-center gap-2">
                                                        <Users className="h-4 w-4 text-blue-500" />
                                                        <span className="text-sm">
                                                            방문: {selectedRestaurant.review_count || 0}회
                                                        </span>
                                                    </div>

                                                    {/* 카테고리 */}
                                                    {((selectedRestaurant.categories && selectedRestaurant.categories.length > 0) ||
                                                        (selectedRestaurant.category && selectedRestaurant.category.length > 0)) && (
                                                            <div className="flex flex-wrap gap-1">
                                                                {(selectedRestaurant.categories || selectedRestaurant.category)?.map((cat, index) => (
                                                                    <Badge key={index} variant="secondary" className="text-xs">
                                                                        {cat}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}

                                                    {/* 설명 */}
                                                    {selectedRestaurant.description && (
                                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                                            {selectedRestaurant.description}
                                                        </p>
                                                    )}

                                                    {/* 액션 버튼들 */}
                                                    <div className="flex gap-2 pt-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => {
                                                                setIsReviewModalOpen(true);
                                                                handleGridRestaurantClose(region);
                                                            }}
                                                            className="flex-1"
                                                        >
                                                            리뷰 쓰기
                                                        </Button>
                                                        {onAdminEditRestaurant && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    onAdminEditRestaurant(selectedRestaurant);
                                                                    handleGridRestaurantClose(region);
                                                                }}
                                                            >
                                                                수정
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                // 단일 지도 모드
                <Suspense fallback={<div className="flex items-center justify-center h-full">지도 로딩 중...</div>}>
                    {mapMode === 'domestic' ? (
                        <NaverMapView
                            filters={filters}
                            selectedRegion={selectedRegion}
                            searchedRestaurant={searchedRestaurant}
                            selectedRestaurant={selectedRestaurant}
                            refreshTrigger={refreshTrigger}
                            onAdminEditRestaurant={onAdminEditRestaurant}
                            onRequestEditRestaurant={handleRequestEditRestaurant}
                            isGridMode={false}
                            onRestaurantSelect={setSelectedRestaurant}
                        />
                    ) : (
                        <PanelGroup direction="horizontal" className="w-full h-full">
                            <Panel id="map-panel" order={1} defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}>
                                <MapView
                                    filters={filters}
                                    selectedCountry={selectedCountry}
                                    searchedRestaurant={searchedRestaurant}
                                    selectedRestaurant={selectedRestaurant}
                                    refreshTrigger={refreshTrigger}
                                    onAdminEditRestaurant={onAdminEditRestaurant}
                                    onRestaurantSelect={setSelectedRestaurant}
                                    onRequestEditRestaurant={handleRequestEditRestaurant}
                                    onMapReady={handleMapReady}
                                    onMarkerClick={handleMarkerClick}
                                />
                            </Panel>

                            {/* Resize Handle */}
                            {panelRestaurant && isPanelOpen && (
                                <PanelResizeHandle className="w-2 bg-border hover:bg-primary/20 transition-colors relative">
                                    <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-muted-foreground/30 rounded-full"></div>
                                </PanelResizeHandle>
                            )}

                            {/* Restaurant Detail Panel */}
                            {panelRestaurant && isPanelOpen && (
                                <Panel id="detail-panel" order={2} defaultSize={25} minSize={20} maxSize={33}>
                                    <div className="h-full">
                                        <RestaurantDetailPanel
                                            restaurant={panelRestaurant}
                                            onClose={handlePanelClose}
                                            onWriteReview={() => {
                                                setIsReviewModalOpen(true);
                                            }}
                                            onEditRestaurant={onAdminEditRestaurant ? () => {
                                                onAdminEditRestaurant(panelRestaurant);
                                            } : undefined}
                                            onRequestEditRestaurant={() => {
                                                handleRequestEditRestaurant(panelRestaurant);
                                            }}
                                        />
                                    </div>
                                </Panel>
                            )}
                        </PanelGroup>
                    )}
                </Suspense>
            )}

            <Suspense fallback={null}>
                <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                    <SheetContent side="left" className="w-80 p-0">
                        <FilterPanel
                            filters={filters}
                            onFilterChange={handleFilterChange}
                            onClose={() => setIsFilterOpen(false)}
                        />
                    </SheetContent>
                </Sheet>
            </Suspense>

            {/* 맛집 수정 요청 모달 */}
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            맛집 수정 요청
                        </DialogTitle>
                        <DialogDescription>
                            해당 맛집의 유튜브 영상별 정보를 수정해주세요
                        </DialogDescription>
                    </DialogHeader>

                    {restaurantToEdit && (
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            try {
                                const { data: { user } } = await supabase.auth.getUser();
                                if (!user) {
                                    throw new Error('로그인이 필요합니다.');
                                }

                                // 수정된 항목들을 user_restaurants_submission 형식으로 변환
                                const submissionData = editFormData.youtube_reviews.map(review => ({
                                    unique_id: review.unique_id || null,
                                    name: editFormData.name,
                                    categories: editFormData.category,
                                    address: editFormData.address,
                                    phone: editFormData.phone,
                                    youtube_link: review.youtube_link,
                                    tzuyang_review: review.tzuyang_review
                                }));

                                // 새로운 restaurant_submissions 테이블 구조에 맞춰 저장
                                const { error } = await supabase
                                    .from('restaurant_submissions')
                                    .insert({
                                        user_id: user.id,
                                        submission_type: 'edit',
                                        status: 'pending',
                                        user_restaurants_submission: submissionData
                                    } as any);

                                if (error) throw error;

                                toast.success('맛집 수정 요청이 성공적으로 제출되었습니다!');
                                setIsEditModalOpen(false);
                                setRestaurantToEdit(null);
                            } catch (error) {
                                console.error('제출 실패:', error);
                                toast.error('제출에 실패했습니다. 다시 시도해주세요.');
                            }
                        }} className="space-y-4 mt-4">

                            {/* 공통 정보 입력 */}
                            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                                <h3 className="font-semibold text-lg">공통 정보</h3>

                                <div className="space-y-2">
                                    <Label htmlFor="name">
                                        맛집 이름 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="name"
                                        value={editFormData.name}
                                        onChange={(e) => handleEditFormChange('name', e.target.value)}
                                        placeholder="맛집 이름을 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="address">
                                        주소 <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="address"
                                        value={editFormData.address}
                                        onChange={(e) => handleEditFormChange('address', e.target.value)}
                                        placeholder="주소를 입력해주세요"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone">전화번호</Label>
                                    <Input
                                        id="phone"
                                        value={editFormData.phone}
                                        onChange={(e) => handleEditFormChange('phone', e.target.value)}
                                        placeholder="전화번호를 입력해주세요"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="category">
                                        카테고리 <span className="text-red-500">*</span>
                                    </Label>
                                    <Popover open={isCategoryPopoverOpen} onOpenChange={setIsCategoryPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={isCategoryPopoverOpen}
                                                className="w-full justify-between"
                                            >
                                                {editFormData.category.length > 0
                                                    ? `${editFormData.category.length}개 선택됨`
                                                    : "카테고리를 선택해주세요"
                                                }
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-full p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder="카테고리 검색..." />
                                                <CommandList>
                                                    <CommandEmpty>카테고리를 찾을 수 없습니다.</CommandEmpty>
                                                    <CommandGroup>
                                                        {[
                                                            "한식", "중식", "일식", "양식", "분식", "치킨·피자",
                                                            "고기", "족발·보쌈", "돈까스·회", "아시안",
                                                            "패스트푸드", "카페·디저트", "기타"
                                                        ].map((category) => {
                                                            const isSelected = editFormData.category.includes(category);
                                                            return (
                                                                <CommandItem
                                                                    key={category}
                                                                    onSelect={() => {
                                                                        const newCategories = isSelected
                                                                            ? editFormData.category.filter(c => c !== category)
                                                                            : [...editFormData.category, category];
                                                                        handleEditFormChange('category', newCategories);
                                                                    }}
                                                                >
                                                                    <Check
                                                                        className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`}
                                                                    />
                                                                    {category}
                                                                </CommandItem>
                                                            );
                                                        })}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {editFormData.category.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {editFormData.category.map((category) => (
                                                <Badge key={category} variant="secondary" className="text-xs">
                                                    {category}
                                                    <button
                                                        type="button"
                                                        className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                                                        onClick={() => {
                                                            const newCategories = editFormData.category.filter(c => c !== category);
                                                            handleEditFormChange('category', newCategories);
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 유튜브 영상별 정보 */}
                            <div className="space-y-4">
                                <h3 className="font-semibold text-lg">유튜브 영상별 정보</h3>

                                {editFormData.youtube_reviews.map((review, index) => (
                                    <Card key={index} className="p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Badge variant="outline">영상 {index + 1}</Badge>
                                        </div>                    <div className="space-y-2">
                                            <Label>유튜브 링크</Label>
                                            <Input
                                                value={review.youtube_link}
                                                onChange={(e) => handleYoutubeReviewChange(index, 'youtube_link', e.target.value)}
                                                placeholder="https://www.youtube.com/watch?v=..."
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label>쯔양 리뷰</Label>
                                            <Textarea
                                                value={review.tzuyang_review}
                                                onChange={(e) => handleYoutubeReviewChange(index, 'tzuyang_review', e.target.value)}
                                                placeholder="쯔양의 리뷰 내용을 입력해주세요"
                                                rows={3}
                                            />
                                        </div>
                                    </Card>
                                ))}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)} className="flex-1">
                                    취소
                                </Button>
                                <Button type="submit" className="flex-1 bg-gradient-primary hover:opacity-90">
                                    수정 요청 제출
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
