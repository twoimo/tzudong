import { Home, Filter, Trophy, MessageSquare, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  isOpen: boolean;
  onFilterClick?: () => void;
}

const Sidebar = ({ isOpen, onFilterClick }: SidebarProps) => {
  const menuItems = [
    { icon: Home, label: "쯔동여지도 홈", active: true, onClick: undefined },
    { icon: Filter, label: "쯔동여지도 필터링", active: false, onClick: onFilterClick },
    { icon: Trophy, label: "사용자 리더보드", active: false, onClick: undefined },
    { icon: MessageSquare, label: "사용자 맛집 리뷰", active: false, onClick: undefined },
    { icon: DollarSign, label: "월 서버 운영 비용", active: false, onClick: undefined },
  ];

  return (
    <aside
      className={cn(
        "bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col",
        isOpen ? "w-64" : "w-0 overflow-hidden"
      )}
    >
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item, index) => (
          <Button
            key={index}
            variant={item.active ? "default" : "ghost"}
            className={cn(
              "w-full justify-start gap-3",
              item.active && "bg-gradient-primary shadow-primary"
            )}
            onClick={item.onClick}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Button>
        ))}
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
