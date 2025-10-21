import { Home, Globe, Filter, Trophy, MessageSquare, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar = ({ isOpen }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

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

  const menuItems = [
    { icon: Home, label: "쯔동여지도 홈", path: "/", onClick: () => navigate("/") },
    { icon: Globe, label: "쯔동여지도 글로벌", path: "/global", onClick: () => navigate("/global") },
    { icon: Filter, label: "쯔동여지도 필터링", path: "/filtering", onClick: () => navigate("/filtering") },
    { icon: Trophy, label: "쯔양 팬 랭킹", path: "/leaderboard", onClick: () => navigate("/leaderboard") },
    { icon: MessageSquare, label: "쯔양 팬 맛집 리뷰", path: "/reviews", onClick: () => navigate("/reviews") },
    { icon: DollarSign, label: "월 서버 운영 비용", path: "/costs", onClick: () => navigate("/costs") },
  ];

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out flex flex-col h-screen w-64",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
            <span className="text-xl">🔥</span>
          </div>
          <h1 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
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
          <p>쯔양 공식 맛집 지도</p>
          <p className="text-primary font-semibold">© 2025 쯔동여지도</p>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
