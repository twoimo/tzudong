import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { useEffect } from "react";
import Index from "./pages/Index";
import GlobalMapPage from "./pages/GlobalMapPage";
import FilteringPage from "./pages/FilteringPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import StampPage from "./pages/StampPage";
import ServerCostsPage from "./pages/ServerCostsPage";
import RestaurantSubmissionsPage from "./pages/RestaurantSubmissionsPage";
import AdminSubmissionsPage from "./pages/AdminSubmissionsPage";
import AdminReviewsPage from "./pages/AdminReviewsPage";
import NotFound from "./pages/NotFound";
import { useState } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AuthModal from "./components/auth/AuthModal";
import { ProfileModal } from "./components/profile/ProfileModal";
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
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Google Maps를 앱 시작 시 미리 로드 (빠른 지도 표시를 위해)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  useGoogleMaps({ apiKey }); // 백그라운드에서 로드되므로 결과 사용하지 않음

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
    // React Query 캐시 무효화 - 모든 restaurants 쿼리 다시 불러오기
    queryClient.invalidateQueries({ queryKey: ['restaurants'] });
    setRefreshTrigger(prev => prev + 1);

    // 수정된 맛집이 있으면 selectedRestaurant 업데이트
    if (updatedRestaurant) {
      setSelectedRestaurant(updatedRestaurant);
    }
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
          onProfileClick={() => setIsProfileModalOpen(true)}
        />

        <main className="flex-1 relative overflow-hidden">
          <Routes>
            <Route path="/" element={<Index refreshTrigger={refreshTrigger} selectedRestaurant={selectedRestaurant} setSelectedRestaurant={setSelectedRestaurant} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/global" element={<GlobalMapPage refreshTrigger={refreshTrigger} selectedRestaurant={selectedRestaurant} setSelectedRestaurant={setSelectedRestaurant} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/filtering" element={<FilteringPage onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
            <Route path="/stamp" element={<StampPage />} />
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

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      <AdminRestaurantModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        restaurant={selectedRestaurant}
        onSuccess={handleAdminSuccess}
      />

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
