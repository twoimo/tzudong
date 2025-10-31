import { useState, memo } from "react";
import NaverMapView from "@/components/map/NaverMapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import RegionSelector from "@/components/region/RegionSelector";
import RestaurantSearch from "@/components/search/RestaurantSearch";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Grid3X3, Map, MapPin, Star, Users, ChefHat } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant, Region } from "@/types/restaurant";

interface IndexProps {
  refreshTrigger: number;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

const Index = memo(({ refreshTrigger, onAdminEditRestaurant }: IndexProps) => {
  const { isAdmin } = useAuth();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>("서울특별시");
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [isGridMode, setIsGridMode] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    minRating: 1,
    minReviews: 0,
    minUserVisits: 0,
    minJjyangVisits: 0,
  });

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
  };

  const handleRegionChange = (region: Region | null) => {
    setSelectedRegion(region);
  };

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    // 선택된 맛집을 NaverMapView에 전달하기 위해 상태 업데이트
    setSelectedRestaurant(restaurant);
  };

  // 그리드 모드에서 사용할 지역들 (4개 지역)
  const gridRegions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시"] as Region[];

  // 각 그리드별 선택된 맛집 상태
  const [gridSelectedRestaurants, setGridSelectedRestaurants] = useState<{[key: string]: Restaurant | null}>({
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
    }
  };

  return (
    <>
      {/* 지역 선택 및 검색 컴포넌트 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
        <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
          <RegionSelector
            selectedRegion={selectedRegion}
            onRegionChange={setSelectedRegion}
            onRegionSelect={switchToSingleMap}
          />
          <RestaurantSearch
            onRestaurantSelect={handleRestaurantSelect}
            onSearchExecute={switchToSingleMap}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsGridMode(!isGridMode)}
            className="flex items-center gap-2"
          >
            {isGridMode ? <Map className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
            {isGridMode ? "단일 지도" : "그리드 지도"}
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
                  searchedRestaurant={null}
                  refreshTrigger={refreshTrigger}
                  onAdminEditRestaurant={onAdminEditRestaurant}
                  isGridMode={true}
                  onRestaurantSelect={(restaurant) => handleGridRestaurantSelect(region, restaurant)}
                />
                <div className="absolute top-2 left-2 bg-background/90 backdrop-blur-sm rounded px-2 py-1 text-sm font-semibold shadow z-10">
                  {region}
                </div>

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
                            {selectedRestaurant.address}
                          </div>

                          {/* 평점 및 방문 정보 */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center gap-2">
                              <Star className="h-4 w-4 text-yellow-500" />
                              <span className="text-sm">
                                평점: {selectedRestaurant.ai_rating?.toFixed(1) || 'N/A'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-blue-500" />
                              <span className="text-sm">
                                방문: {selectedRestaurant.visit_count || 0}회
                              </span>
                            </div>
                          </div>

                          {/* 카테고리 */}
                          {selectedRestaurant.category && selectedRestaurant.category.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedRestaurant.category.map((cat, index) => (
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
        <NaverMapView
          filters={filters}
          selectedRegion={selectedRegion}
          searchedRestaurant={selectedRestaurant}
          refreshTrigger={refreshTrigger}
          onAdminEditRestaurant={onAdminEditRestaurant}
          isGridMode={false}
        />
      )}

      <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <FilterPanel
            filters={filters}
            onFilterChange={handleFilterChange}
            onClose={() => setIsFilterOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
});

Index.displayName = 'Index';

export default Index;
