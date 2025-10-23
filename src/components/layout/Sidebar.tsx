import { Home, Globe, Filter, Trophy, MessageSquare, DollarSign, Send, Shield, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
          .order("ai_rating", { ascending: false });

        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });
  };

  // 기본 메뉴 항목
  const baseMenuItems = [
    { icon: Home, label: "쯔동여지도 홈", path: "/", onClick: () => navigate("/") },
    { icon: Globe, label: "쯔동여지도 글로벌", path: "/global", onClick: () => navigate("/global") },
    { icon: Filter, label: "쯔동여지도 필터링", path: "/filtering", onClick: () => navigate("/filtering") },
    { icon: Trophy, label: "쯔양 팬 랭킹", path: "/leaderboard", onClick: () => navigate("/leaderboard") },
    { icon: MessageSquare, label: "쯔양 팬 맛집 리뷰", path: "/reviews", onClick: () => navigate("/reviews") },
    { icon: Send, label: "쯔양 맛집 제보", path: "/submissions", onClick: () => navigate("/submissions") },
  ];

  // 관리자에게만 보이는 메뉴
  const adminMenuItems = (user && isAdmin) ? [
    { icon: Shield, label: "제보 관리", path: "/admin/submissions", onClick: () => navigate("/admin/submissions") },
    { icon: MessageSquare, label: "리뷰 관리", path: "/admin/reviews", onClick: () => navigate("/admin/reviews") },
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
        "fixed left-0 top-0 z-40 bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out flex flex-col h-screen w-64",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3 group animate-fade-in cursor-pointer" onClick={() => navigate("/")}>
          {/* Enhanced Logo */}
          <div className="relative">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-400 via-red-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-12">
              <MapPin className="w-4 h-4 text-white drop-shadow-sm group-hover:animate-pulse" />
            </div>
            {/* Subtle glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-orange-400/30 to-pink-500/30 rounded-lg blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 animate-pulse"></div>
            {/* Floating particles effect */}
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-400 rounded-full opacity-0 group-hover:opacity-100 animate-ping"></div>
            <div className="absolute -bottom-1 -left-1 w-1.5 h-1.5 bg-pink-500 rounded-full opacity-0 group-hover:opacity-100 animate-ping" style={{ animationDelay: '0.2s' }}></div>
          </div>

          {/* Enhanced Title */}
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-400 via-red-500 to-pink-500 bg-clip-text text-transparent group-hover:from-orange-300 group-hover:via-red-400 group-hover:to-pink-400 transition-all duration-300 group-hover:scale-105 group-hover:tracking-wide">
            쯔동여지도
          </h1>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item, index) => {
          const isActive = location.pathname === item.path;
          const isHomePage = item.path === "/";

          return (
            <Button
              key={index}
              variant={isActive ? "default" : "ghost"}
              className={cn(
                "w-full justify-start gap-3",
                isActive && "bg-gradient-primary shadow-primary"
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
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-muted-foreground space-y-1">
          <p>쯔동여지도, 유튜브 쯔양 맛집 지도 v1.0.0</p>
          <p className="text-primary font-semibold">@ 2025 Tzudong. All rights reserved.</p>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
