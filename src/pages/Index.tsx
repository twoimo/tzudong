import { useState, memo } from "react";
import NaverMapView from "@/components/map/NaverMapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant } from "@/types/restaurant";

interface IndexProps {
  refreshTrigger: number;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

const Index = memo(({ refreshTrigger, onAdminEditRestaurant }: IndexProps) => {
  const { isAdmin } = useAuth();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
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

  return (
    <>
      <NaverMapView
        filters={filters}
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
