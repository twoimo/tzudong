import { useState } from "react";
import MapView from "@/components/map/MapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

interface IndexProps {
  refreshTrigger: number;
}

const Index = ({ refreshTrigger }: IndexProps) => {
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
      <MapView
        filters={filters}
        refreshTrigger={refreshTrigger}
        onAdminAddRestaurant={isAdmin ? undefined : undefined}
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
};

export default Index;
