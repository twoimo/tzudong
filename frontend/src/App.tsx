import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import GlobalMapPage from "./pages/GlobalMapPage";
import FilteringPage from "./pages/FilteringPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import StampPage from "./pages/StampPage";
import ServerCostsPage from "./pages/ServerCostsPage";
import RestaurantSubmissionsPage from "./pages/RestaurantSubmissionsPage";
import AdminSubmissionsPage from "./pages/AdminSubmissionsPage";
import AdminReviewsPage from "./pages/AdminReviewsPage";
import AdminEvaluationPage from "./pages/AdminEvaluationPage";
import NotFound from "./pages/NotFound";
import { useState } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AuthModal from "./components/auth/AuthModal";
import { ProfileModal } from "./components/profile/ProfileModal";
import { NicknameSetupModal } from "./components/profile/NicknameSetupModal";
import { AdminRestaurantModal } from "./components/admin/AdminRestaurantModal";
import { DailyRecommendationPopup } from "./components/recommendation/DailyRecommendationPopup";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 refetch 비활성화
      refetchOnMount: false, // 컴포넌트 마운트 시 자동 refetch 비활성화 (필요시 수동으로)
      refetchOnReconnect: false, // 네트워크 재연결 시 자동 refetch 비활성화
    },
  },
});

function AppLayout() {
  const { user, signOut, isAdmin, needsNicknameSetup, completeNicknameSetup } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCenteredLayout, setIsCenteredLayout] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 팝업에서 전달된 레스토랑 처리
  useEffect(() => {
    const state = location.state as { selectedRestaurant?: Restaurant };
    if (state?.selectedRestaurant) {
      setSelectedRestaurant(state.selectedRestaurant);
    }
  }, [location.state]);

  // 팝업 데이터 즉시 prefetch (빠른 팝업 표시를 위해)
  useEffect(() => {
    if (user?.id) {
      // 사용자 리뷰 데이터 prefetch
      queryClient.prefetchQuery({
        queryKey: ['user-reviews', user.id],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('reviews')
            .select('restaurant_id, is_verified')
            .eq('user_id', user.id)
            .eq('is_verified', true);
          if (error) throw error;
          return data;
        },
        staleTime: 5 * 60 * 1000,
      });

      // 승인된 맛집 데이터 prefetch
      queryClient.prefetchQuery({
        queryKey: ['unvisited-restaurants-all'],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('restaurants')
            .select('id, name, youtube_link, review_count, categories, road_address, jibun_address, lat, lng')
            .eq('status', 'approved')
            .not('youtube_link', 'is', null)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return data;
        },
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [user?.id, queryClient]);

  // 홈페이지, 글로벌, 필터링 페이지에서는 가운데 정렬 버튼 숨기기
  const shouldShowCenteredLayoutButton = location.pathname !== '/' && location.pathname !== '/global' && location.pathname !== '/filtering';

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
          isCenteredLayout={isCenteredLayout}
          onToggleCenteredLayout={shouldShowCenteredLayoutButton ? () => setIsCenteredLayout(!isCenteredLayout) : undefined}
        />

        <main className={cn(
          "flex-1 relative overflow-hidden",
          isCenteredLayout && shouldShowCenteredLayoutButton && "flex items-center justify-center"
        )}>
          <div className={cn(
            "h-full w-full",
            isCenteredLayout && shouldShowCenteredLayoutButton && "max-w-7xl mx-auto"
          )}>
            <Routes>
              <Route path="/" element={<Index refreshTrigger={refreshTrigger} selectedRestaurant={selectedRestaurant} setSelectedRestaurant={setSelectedRestaurant} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
              <Route path="/global" element={<GlobalMapPage refreshTrigger={refreshTrigger} selectedRestaurant={selectedRestaurant} setSelectedRestaurant={setSelectedRestaurant} onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
              <Route path="/filtering" element={<FilteringPage onAdminEditRestaurant={isAdmin ? handleAdminEditRestaurant : undefined} />} />
              <Route path="/stamp" element={<StampPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/submissions" element={<RestaurantSubmissionsPage />} />
              <Route path="/admin/submissions" element={<AdminSubmissionsPage />} />
              <Route path="/admin/reviews" element={<AdminReviewsPage />} />
              <Route path="/admin/evaluations" element={<AdminEvaluationPage />} />
              <Route path="/costs" element={<ServerCostsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
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

      <NicknameSetupModal
        isOpen={needsNicknameSetup}
        onComplete={completeNicknameSetup}
      />

      <DailyRecommendationPopup />

    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <NotificationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <AppLayout />
          </BrowserRouter>
        </TooltipProvider>
      </NotificationProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
