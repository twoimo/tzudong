import { useState } from "react";
import MapView from "@/components/map/MapView";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import AuthModal from "@/components/auth/AuthModal";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { AdminRestaurantModal } from "@/components/admin/AdminRestaurantModal";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const { user, signOut, isAdmin } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    minRating: 1,
    minReviews: 0,
    minVisits: 0,
  });

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
  };

  const handleAdminSuccess = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isLoggedIn={!!user}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        onAdminClick={() => setIsAdminModalOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          onFilterClick={() => setIsFilterOpen(true)}
        />

        <main className="flex-1 relative">
          <MapView
            filters={filters}
            refreshTrigger={refreshTrigger}
            onAdminAddRestaurant={isAdmin ? () => setIsAdminModalOpen(true) : undefined}
          />
        </main>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
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

      {isAdmin && (
        <AdminRestaurantModal
          isOpen={isAdminModalOpen}
          onClose={() => setIsAdminModalOpen(false)}
          onSuccess={handleAdminSuccess}
        />
      )}
    </div>
  );
};

export default Index;
