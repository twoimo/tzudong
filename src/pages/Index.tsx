import { useState, memo, Suspense, lazy, useEffect } from "react";

// 코드 스플리팅으로 성능 최적화
const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));
const FilterPanel = lazy(() =>
  import("@/components/filters/FilterPanel").then(module => ({ default: module.FilterPanel }))
);
const RegionSelector = lazy(() => import("@/components/region/RegionSelector"));
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

interface IndexProps {
  refreshTrigger: number;
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurant: (restaurant: Restaurant | null) => void;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

const Index = memo(({ refreshTrigger, selectedRestaurant, setSelectedRestaurant, onAdminEditRestaurant }: IndexProps) => {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>("서울특별시");
  const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);
  const [isGridMode, setIsGridMode] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    phone: '',
    category: [] as string[],
    youtube_link: '',
    tzuyang_review: ''
  });
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    minReviews: 0,
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // URL 쿼리 파라미터로 맛집 ID를 받아서 자동으로 선택
  useEffect(() => {
    const restaurantId = searchParams.get('restaurant');
    if (restaurantId && !selectedRestaurant) {
      // Supabase에서 해당 맛집 조회
      const fetchRestaurant = async () => {
        const { data, error } = await supabase
          .from('restaurants')
          .select('*')
          .eq('id', restaurantId)
          .eq('status', 'approved')
          .single();

        if (error) {
          console.error('맛집 조회 실패:', error);
          toast.error('맛집을 찾을 수 없습니다.');
          // URL 파라미터 제거
          searchParams.delete('restaurant');
          setSearchParams(searchParams);
          return;
        }

        if (data) {
          // 맛집 선택
          setSelectedRestaurant(data as Restaurant);
          // URL 파라미터 제거 (한 번만 실행)
          searchParams.delete('restaurant');
          setSearchParams(searchParams);
        }
      };

      fetchRestaurant();
    }
  }, [searchParams, setSearchParams, selectedRestaurant, setSelectedRestaurant]);

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
    setEditFormData({
      name: restaurant.name,
      address: restaurant.road_address || restaurant.jibun_address || '',
      phone: restaurant.phone || '',
      category: Array.isArray(restaurant.categories)
        ? restaurant.categories
        : (restaurant.categories ? [restaurant.categories] : []),
      youtube_link: restaurant.youtube_link || '',
      tzuyang_review: restaurant.tzuyang_review || ''
    });
    setIsEditModalOpen(true);
  };

  const handleEditFormChange = (field: string, value: string | string[]) => {
    setEditFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const getEditChanges = () => {
    if (!restaurantToEdit) return [];

    const originalData = {
      name: restaurantToEdit.name,
      address: restaurantToEdit.road_address || restaurantToEdit.jibun_address || '',
      phone: restaurantToEdit.phone || '',
      category: Array.isArray(restaurantToEdit.categories)
        ? restaurantToEdit.categories
        : (restaurantToEdit.categories ? [restaurantToEdit.categories] : []),
      youtube_link: restaurantToEdit.youtube_link || '',
      tzuyang_review: restaurantToEdit.tzuyang_review || ''
    };

    return Object.entries(editFormData).filter(([key, value]) => {
      const originalValue = originalData[key as keyof typeof originalData];
      if (key === 'category') {
        // 카테고리는 배열 비교
        return JSON.stringify(originalValue) !== JSON.stringify(value);
      }
      return originalValue !== value;
    });
  };

  const handleRegionChange = (region: Region | null) => {
    setSelectedRegion(region);
    // 지역 변경 시 검색 결과 초기화
    setSearchedRestaurant(null);
  };

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    // 선택된 맛집을 NaverMapView에 전달하기 위해 상태 업데이트
    setSelectedRestaurant(restaurant);
  };

  const handleRestaurantSearch = (restaurant: Restaurant) => {
    // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정
    // 모든 검색 결과에 대해 searchedRestaurant을 null로 설정해서 중복 마커 생성 방지
    // (지도에 이미 표시된 맛집을 검색하는 경우)
    setSearchedRestaurant(null);
    setSelectedRestaurant(restaurant);

    // 검색된 맛집의 지역으로 하단 컨트롤 패널의 지역 필터 실시간 변경
    const restaurantRegion = getRestaurantRegion(restaurant);
    if (restaurantRegion && restaurantRegion !== selectedRegion) {
      setSelectedRegion(restaurantRegion);
      console.log('🔍 검색된 맛집 지역으로 필터 변경:', restaurantRegion);
    }
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

  return (
    <>
      {/* 지역 선택 및 검색 컴포넌트 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
        <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
          <Suspense fallback={<div className="w-40 h-10 bg-muted animate-pulse rounded" />}>
            <RegionSelector
              selectedRegion={selectedRegion}
              onRegionChange={setSelectedRegion}
              onRegionSelect={switchToSingleMap}
            />
          </Suspense>

          {/* 카테고리 필터링 */}
          <CategoryFilter
            selectedCategories={selectedCategories}
            onCategoryChange={handleCategoryChange}
            selectedRegion={selectedRegion}
            className="w-48"
          />

          <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
            <RestaurantSearch
              onRestaurantSelect={handleRestaurantSelect}
              onRestaurantSearch={handleRestaurantSearch}
              onSearchExecute={switchToSingleMap}
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
          <NaverMapView
            filters={filters}
            selectedRegion={selectedRegion}
            searchedRestaurant={searchedRestaurant} // 검색 시 지도 재조정용
            selectedRestaurant={selectedRestaurant}
            refreshTrigger={refreshTrigger}
            onAdminEditRestaurant={onAdminEditRestaurant}
            onRequestEditRestaurant={handleRequestEditRestaurant}
            isGridMode={false}
            onRestaurantSelect={setSelectedRestaurant} // 단일 모드에서도 선택 상태 관리
          />
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
              맛집 수정 요청
            </DialogTitle>
            <DialogDescription>
              잘못된 정보나 오타가 있는 맛집 정보를 수정해주세요
            </DialogDescription>
          </DialogHeader>

          {restaurantToEdit && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const formData = new FormData(e.target as HTMLFormElement);
                const updatedData = {
                  name: editFormData.name,
                  address: editFormData.address,
                  phone: editFormData.phone,
                  category: editFormData.category,
                  youtube_link: editFormData.youtube_link,
                  tzuyang_review: editFormData.tzuyang_review,
                };

                // 변경사항 계산
                const originalData = {
                  restaurant_name: restaurantToEdit.name,
                  address: restaurantToEdit.address,
                  phone: restaurantToEdit.phone || '',
                  category: Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category : [restaurantToEdit.category],
                  youtube_link: restaurantToEdit.youtube_link || '',
                  tzuyang_review: restaurantToEdit.tzuyang_review || ''
                };

                const changes_requested: Record<string, { from: unknown; to: unknown }> = {};
                Object.entries(updatedData).forEach(([key, value]) => {
                  const originalValue = originalData[key === 'name' ? 'restaurant_name' : key as keyof typeof originalData];
                  const hasChanged = key === 'category'
                    ? JSON.stringify(originalValue) !== JSON.stringify(value)
                    : originalValue !== value;

                  if (hasChanged) {
                    changes_requested[key === 'name' ? 'restaurant_name' : key] = {
                      from: originalValue,
                      to: value
                    };
                  }
                });

                // restaurant_submissions 테이블에 수정 요청 저장
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                  throw new Error('로그인이 필요합니다.');
                }

                const { error } = await supabase
                  .from('restaurant_submissions')
                  .insert({
                    user_id: user.id,
                    submission_type: 'update',
                    restaurant_name: updatedData.name.trim(),
                    address: updatedData.address.trim(),
                    phone: updatedData.phone?.trim() || null,
                    category: [updatedData.category], // TEXT[] 타입이므로 배열로
                    youtube_link: updatedData.youtube_link?.trim() || null,
                    tzuyang_review: updatedData.tzuyang_review?.trim() || null,
                    original_restaurant_id: restaurantToEdit.id,
                    changes_requested: changes_requested,
                    status: 'pending'
                  });

                if (error) throw error;

                toast.success('맛집 수정 요청이 성공적으로 제출되었습니다!');
                setIsEditModalOpen(false);
                setRestaurantToEdit(null);
              } catch (error) {
                console.error('제출 실패:', error);
                toast.error('제출에 실패했습니다. 다시 시도해주세요.');
              }
            }} className="space-y-4 mt-4">
              {/* 수정할 정보 입력 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    맛집 이름 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    name="name"
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
                    name="address"
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
                    name="phone"
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
                                    className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"
                                      }`}
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

                <div className="space-y-2">
                  <Label htmlFor="youtube_link">쯔양 유튜브 영상 링크</Label>
                  <Input
                    id="youtube_link"
                    name="youtube_link"
                    value={editFormData.youtube_link}
                    onChange={(e) => handleEditFormChange('youtube_link', e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tzuyang_review">쯔양의 리뷰</Label>
                  <Textarea
                    id="tzuyang_review"
                    name="tzuyang_review"
                    value={editFormData.tzuyang_review}
                    onChange={(e) => handleEditFormChange('tzuyang_review', e.target.value)}
                    placeholder="쯔양의 리뷰 내용을 입력해주세요"
                    rows={4}
                  />
                </div>
              </div>

              {/* 변경사항 표시 */}
              {getEditChanges().length > 0 && (
                <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="text-blue-600">📋</div>
                      <Label className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        수정 요청 내용
                      </Label>
                    </div>

                    <div className="space-y-3">
                      {getEditChanges().map(([key, value]) => {
                        const originalValue = restaurantToEdit ? {
                          name: restaurantToEdit.name,
                          address: restaurantToEdit.address,
                          phone: restaurantToEdit.phone || '',
                          category: Array.isArray(restaurantToEdit.category) ? restaurantToEdit.category : [restaurantToEdit.category],
                          youtube_link: restaurantToEdit.youtube_link || '',
                          tzuyang_review: restaurantToEdit.tzuyang_review || ''
                        }[key as keyof typeof restaurantToEdit] || '' : '';

                        const fieldName = {
                          name: '맛집 이름',
                          address: '주소',
                          phone: '전화번호',
                          category: '카테고리',
                          youtube_link: '유튜브 링크',
                          tzuyang_review: '쯔양의 리뷰'
                        }[key] || key;

                        return (
                          <div key={key} className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {fieldName}
                              </span>
                              <div className="flex items-center gap-1 text-xs text-orange-600">
                                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                변경됨
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xs text-red-600 line-through">
                                기존: {key === 'category' ? (Array.isArray(originalValue) ? originalValue.join(', ') : originalValue) : (originalValue || '없음')}
                              </div>
                              <div className="text-xs text-green-600 font-medium">
                                변경: {key === 'category' ? (Array.isArray(value) ? value.join(', ') : value) : (value || '없음')}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              )}

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
});

Index.displayName = 'Index';

export default Index;
