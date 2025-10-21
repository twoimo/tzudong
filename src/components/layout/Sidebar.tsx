import { Home, Filter, Trophy, MessageSquare, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar = ({ isOpen }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { icon: Home, label: "쯔동여지도 홈", path: "/", onClick: () => navigate("/") },
    { icon: Filter, label: "쯔동여지도 필터링", path: "/filtering", onClick: () => navigate("/filtering") },
    { icon: Trophy, label: "사용자 리더보드", path: "/leaderboard", onClick: undefined },
    { icon: MessageSquare, label: "맛집 리뷰", path: "/reviews", onClick: undefined },
    { icon: DollarSign, label: "월 서버 운영 비용", path: "/costs", onClick: undefined },
  ];

  return (
    <aside
      className={cn(
        "bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col h-full",
        isOpen ? "w-64" : "w-0 overflow-hidden"
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
          return (
            <Button
              key={index}
              variant={isActive ? "default" : "ghost"}
              className={cn(
                "w-full justify-start gap-3",
                isActive && "bg-gradient-primary shadow-primary"
              )}
              onClick={item.onClick}
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
