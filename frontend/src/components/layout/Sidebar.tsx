import { Home, Filter, Trophy, MessageSquare, DollarSign, Send, Shield, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AdBanner from "./AdBanner";
import SeasonalLogo from "@/components/common/SeasonalLogo";

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar = ({ isOpen }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();

  // 레스토랑 데이터 프리페치 함수
  const prefetchRestaurants = async () => {
    await queryClient.prefetchQuery({
      queryKey: ["restaurants", undefined, undefined, undefined, undefined, undefined, undefined],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("restaurants")
          .select("*")
          .order("name", { ascending: true });

        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });
  };

  // 기본 메뉴 항목
  const baseMenuItems = [
    { icon: Home, label: "쯔동여지도여지도 홈", path: "/", onClick: () => navigate("/") },
    { icon: Filter, label: "쯔동여지도여지도 필터링", path: "/filtering", onClick: () => navigate("/filtering") },
    { icon: Trophy, label: "쯔동여지도여지도 도장", path: "/stamp", onClick: () => navigate("/stamp") },
    { icon: Trophy, label: "쯔동여지도여지도 랭킹", path: "/leaderboard", onClick: () => navigate("/leaderboard") },
    { icon: Send, label: "쯔동여지도여지도 제보", path: "/submissions", onClick: () => navigate("/submissions") },
  ];

  // 관리자에게만 보이는 메뉴
  const adminMenuItems = (user && isAdmin) ? [
    { icon: Shield, label: "관리자 제보 관리", path: "/admin/submissions", onClick: () => navigate("/admin/submissions") },
    { icon: MessageSquare, label: "관리자 리뷰 관리", path: "/admin/reviews", onClick: () => navigate("/admin/reviews") },
    { icon: ClipboardCheck, label: "관리자 데이터 검수", path: "/admin/evaluations", onClick: () => navigate("/admin/evaluations") },
  ] : [];

  // 공통 메뉴
  const commonMenuItems = [
    { icon: DollarSign, label: "월 서버 운영 비용", path: "/costs", onClick: () => navigate("/costs") },
  ];

  // 모든 메뉴 합치기
  const menuItems = [...baseMenuItems, ...adminMenuItems, ...commonMenuItems];

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 bg-sidebar border-r border-sidebar-border transition-colors duration-300 ease-in-out flex flex-col h-screen w-64 shadow-xl",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* 한지 질감 오버레이 - 더 선명하게 */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")` }}
      />

      {/* 전통 문양 테두리 (내부) */}
      <div className="absolute inset-1 border border-stone-800/10 rounded-sm pointer-events-none z-0" />

      {/* 우측 테두리 강조 */}
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-stone-800/20 to-transparent pointer-events-none z-0" />

      {/* 로고 영역 - "쯔동여지도여지도" 5글자만 크게 조선100년체로 가운데 배치 */}
      <div className="h-16 border-b border-stone-800/10 relative z-10">
        <div className="cursor-pointer w-full h-full" onClick={() => navigate("/")}>
          <SeasonalLogo />
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto relative z-10">
        {menuItems.map((item, index) => {
          const isActive = location.pathname === item.path;
          const isHomePage = item.path === "/";

          return (
            <Button
              key={index}
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 font-serif text-base h-11 transition-all duration-200",
                isActive
                  ? "bg-stone-800 text-white shadow-md hover:bg-stone-700 hover:text-white"
                  : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900"
              )}
              onClick={item.onClick}
              onMouseEnter={() => {
                // 홈 페이지 호버 시 레스토랑 데이터 미리 로드
                if (isHomePage && !isActive) {
                  prefetchRestaurants();
                }
              }}
              disabled={!item.onClick}
            >
              <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-stone-400")} />
              <span>{item.label}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />}
            </Button>
          );
        })}
      </nav>

      <div className="p-4 space-y-4 relative z-10">
        {/* 광고 배너 */}
        <AdBanner />

        {/* 버전 정보 */}
        <div className="border-t border-stone-800/10 pt-4 text-center">
          <div className="text-xs text-stone-400 font-serif space-y-1">
            <p>쯔동여지도여지도 v1.5.3</p>
            <p className="text-stone-300">@ 2025 Tzudong</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
