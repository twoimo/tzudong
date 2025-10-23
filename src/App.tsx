import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Suspense, lazy } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

// Lazy load pages for code splitting with preload
const Index = lazy(() => import("./pages/Index"));
const GlobalMapPage = lazy(() => import("./pages/GlobalMapPage"));
const FilteringPage = lazy(() => import("./pages/FilteringPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const ServerCostsPage = lazy(() => import("./pages/ServerCostsPage"));
const RestaurantSubmissionsPage = lazy(() => import("./pages/RestaurantSubmissionsPage"));
const AdminSubmissionsPage = lazy(() => import("./pages/AdminSubmissionsPage"));
const AdminReviewsPage = lazy(() => import("./pages/AdminReviewsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Preload functions for performance optimization
const preloadGlobalMapPage = () => import("./pages/GlobalMapPage");
const preloadFilteringPage = () => import("./pages/FilteringPage");
const preloadReviewsPage = () => import("./pages/ReviewsPage");
const preloadLeaderboardPage = () => import("./pages/LeaderboardPage");
const preloadServerCostsPage = () => import("./pages/ServerCostsPage");
const preloadRestaurantSubmissionsPage = () => import("./pages/RestaurantSubmissionsPage");
const preloadAdminSubmissionsPage = () => import("./pages/AdminSubmissionsPage");
const preloadAdminReviewsPage = () => import("./pages/AdminReviewsPage");
import { useState } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AuthModal from "./components/auth/AuthModal";
import { ProfileModal } from "./components/profile/ProfileModal";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";

// 인증 에러 감지 및 자동 로그아웃 함수
const handleAuthError = async (error: any) => {
  // 401 에러 또는 인증 관련 에러 감지
  if (error?.status === 401 || error?.code === 'PGRST301' || error?.message?.includes('JWT')) {
    console.warn('Authentication error detected, signing out user');
    try {
      await supabase.auth.signOut();
      // 페이지 리로드로 상태 초기화
      window.location.reload();
    } catch (signOutError) {
      console.error('Error during sign out:', signOutError);
      // 강제 리로드
      window.location.reload();
    }
  }
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 데이터가 신선한 상태로 유지되는 시간 (15분으로 증가 - 새로고침 시 안정성 향상)
      staleTime: 15 * 60 * 1000,
      // 캐시 유지 시간 (60분으로 증가 - 장기 캐시로 새로고침 시 로딩 감소)
      gcTime: 60 * 60 * 1000,
      // 재시도 횟수 (3회로 증가 - 새로고침 시 네트워크 문제 대응)
      retry: (failureCount, error: any) => {
        // 401 에러 (인증 실패)인 경우 재시도하지 않고 바로 에러 핸들러 호출
        if (error?.status === 401 || error?.code === 'PGRST301' || error?.message?.includes('JWT')) {
          handleAuthError(error);
          return false;
        }
        // 다른 에러는 최대 3회 재시도 (새로고침 시 안정성 향상)
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // 최대 30초
      // 백그라운드 리패치 제한적 활성화
      refetchOnWindowFocus: true, // 창 포커스 시 리패치
      refetchOnReconnect: true, // 재연결 시 리패치
      // 글로벌 에러 핸들러
      onError: (error: any) => {
        console.error('Query error:', error);
        handleAuthError(error);
      },
      // 마운트 시 리패치 비활성화 (새로고침 시 과도한 API 호출 방지)
      refetchOnMount: false, // 캐시 우선 사용
      // 네트워크 모드 설정 (새로고침 시 안정성 향상)
      networkMode: 'online', // 온라인 상태일 때만 쿼리 실행
    },
    mutations: {
      // 뮤테이션 재시도 비활성화
      retry: false,
      // 뮤테이션 에러 핸들러
      onError: (error: any) => {
        console.error('Mutation error:', error);
        handleAuthError(error);
      },
    },
  },
});

function AppLayout() {
  const { user, signOut, isAdmin, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 새로고침 시 인증 로딩 중일 때는 기본 UI 표시 (안정성 향상)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground">앱을 초기화하는 중...</p>
          </div>
        </div>
      </div>
    );
  }

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
          onProfileClick={() => setIsProfileModalOpen(true)}
        />

        <main className="flex-1 relative overflow-hidden">
          <Suspense fallback={<div />}>

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
          </Suspense>
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
