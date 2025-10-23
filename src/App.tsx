import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Suspense, lazy } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load pages for code splitting
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
import { useState } from "react";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import AuthModal from "./components/auth/AuthModal";
import { ProfileModal } from "./components/profile/ProfileModal";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 데이터가 신선한 상태로 유지되는 시간 (5분)
      staleTime: 5 * 60 * 1000,
      // 캐시 유지 시간 (10분)
      gcTime: 10 * 60 * 1000,
      // 재시도 횟수 (2회)
      retry: 2,
      // 백그라운드 리패치 비활성화 (성능 향상)
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      // 뮤테이션 재시도 비활성화
      retry: false,
    },
  },
});

function AppLayout() {
  const { user, signOut, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
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
          onProfileClick={() => setIsProfileModalOpen(true)}
        />

        <main className="flex-1 relative overflow-hidden">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="space-y-4 w-full max-w-4xl p-6">
                <Skeleton className="h-8 w-64" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-48 w-full rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          }>
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
