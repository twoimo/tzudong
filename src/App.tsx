import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import GlobalMapPage from "./pages/GlobalMapPage";
import FilteringPage from "./pages/FilteringPage";
import ReviewsPage from "./pages/ReviewsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ServerCostsPage from "./pages/ServerCostsPage";
import RestaurantSubmissionsPage from "./pages/RestaurantSubmissionsPage";
import AdminSubmissionsPage from "./pages/AdminSubmissionsPage";
import AdminReviewsPage from "./pages/AdminReviewsPage";
import NotFound from "./pages/NotFound";
import { useState } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AuthModal from "./components/auth/AuthModal";
import { AdminRestaurantModal } from "./components/admin/AdminRestaurantModal";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";

const queryClient = new QueryClient();

function AppLayout() {
  const { user, signOut, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleAdminSuccess = () => {
    // React Query 캐시 무효화 - 모든 restaurants 쿼리 다시 불러오기
    queryClient.invalidateQueries({ queryKey: ['restaurants'] });
    setRefreshTrigger(prev => prev + 1);
    // selectedRestaurant는 초기화하지 않음 - 맵 컴포넌트에서 업데이트됨
  };

  const handleAdminEditRestaurant = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setIsAdminModalOpen(true);
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar isOpen={isSidebarOpen} />

      <div className={cn(
        "flex-1 flex flex-col overflow-hidden transition-all duration-300",
        isSidebarOpen ? "ml-64" : "ml-0"
      )}>
        <Header
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isLoggedIn={!!user}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onLogout={handleLogout}
          onAdminClick={() => setIsAdminModalOpen(true)}
        />

        <main className="flex-1 relative overflow-hidden">
          <Routes>
            <Route path="/" element={<Index refreshTrigger={refreshTrigger} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/global" element={<GlobalMapPage refreshTrigger={refreshTrigger} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/filtering" element={<FilteringPage onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/submissions" element={<RestaurantSubmissionsPage />} />
            <Route path="/admin/submissions" element={<AdminSubmissionsPage />} />
            <Route path="/admin/reviews" element={<AdminReviewsPage />} />
            <Route path="/costs" element={<ServerCostsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {isAdmin && (
        <AdminRestaurantModal
          isOpen={isAdminModalOpen}
          onClose={() => {
            setIsAdminModalOpen(false);
            // selectedRestaurant는 유지 - 맵에서 업데이트된 정보를 보여줌
          }}
          restaurant={selectedRestaurant}
          onSuccess={handleAdminSuccess}
        />
      )}
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
