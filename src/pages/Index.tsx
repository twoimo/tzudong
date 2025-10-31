import { useState, memo } from "react";
import NaverMapView from "@/components/map/NaverMapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import RegionSelector from "@/components/region/RegionSelector";
import RestaurantSearch from "@/components/search/RestaurantSearch";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    // 선택된 맛집을 NaverMapView에 전달하기 위해 상태 업데이트
    setSelectedRestaurant(restaurant);
  };

  return (
    <>
      {/* 지역 선택 및 검색 컴포넌트 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
        <div className="flex items-center gap-4 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
          <RegionSelector
            selectedRegion={selectedRegion}
            onRegionChange={setSelectedRegion}
          />
          <RestaurantSearch
            onRestaurantSelect={handleRestaurantSelect}
          />
        </div>
      </div>

      <NaverMapView
        filters={filters}
        selectedRegion={selectedRegion}
        searchedRestaurant={selectedRestaurant}
        refreshTrigger={refreshTrigger}
        onAdminEditRestaurant={onAdminEditRestaurant}
      />

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
