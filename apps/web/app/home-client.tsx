'use client'; // [CSR] 상태 관리 및 브라우저 API 사용

import { useState, useEffect, useMemo } from "react";
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
import { AdminRestaurantModal } from "@/components/admin/AdminRestaurantModal";
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

            {/* [CSR] 맛집 수정 요청 모달 - 사용자 폼 인터랙션 */}
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl text-primary font-bold">
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

                                const submissionData = editFormData.youtube_reviews.map(review => ({
                                    unique_id: review.unique_id || null,
                                    name: editFormData.name,
                                    categories: editFormData.category,
                                    address: editFormData.address,
                                    phone: editFormData.phone,
                                    youtube_link: review.youtube_link,
                                    tzuyang_review: review.tzuyang_review
                                }));

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
                                        </div>
                                        <div className="space-y-2">
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
