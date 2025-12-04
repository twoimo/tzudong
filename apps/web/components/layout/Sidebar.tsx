import { Home, Trophy, Stamp, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdBanner from "./AdBanner";
import SeasonalLogo from "@/components/common/SeasonalLogo";

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar = ({ isOpen }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

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

  // 메뉴 항목 (관리자 메뉴는 헤더 드롭다운으로 이동됨)
  const menuItems = [
    { icon: Home, label: "쯔동여지도 홈", path: "/", onClick: () => router.push("/") },
    { icon: Stamp, label: "쯔동여지도 도장", path: "/stamp", onClick: () => router.push("/stamp") },
    { icon: Trophy, label: "쯔동여지도 랭킹", path: "/leaderboard", onClick: () => router.push("/leaderboard") },
    { icon: DollarSign, label: "월 서버 운영 비용", path: "/costs", onClick: () => router.push("/costs") },
  ];

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hover:z-[60] bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out flex flex-col h-screen shadow-xl",
        isOpen ? "w-64" : "w-16"
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

      {/* 로고 영역 */}
      <div className="h-16 border-b border-stone-800/10 relative z-10 flex items-center justify-center overflow-hidden">
        <div className="cursor-pointer w-full h-full" onClick={() => router.push("/")}>
          {isOpen ? (
            <SeasonalLogo />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Home className="h-6 w-6 text-stone-600" />
            </div>
          )}
        </div>
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto relative z-10", isOpen ? "p-4" : "p-2")}>
        {menuItems.map((item, index) => {
          const isActive = pathname === item.path;
          const isHomePage = item.path === "/";

          return (
            <Button
              key={index}
              variant="ghost"
              title={!isOpen ? item.label : undefined}
              className={cn(
                "w-full font-serif text-base h-11 transition-all duration-200",
                isOpen ? "justify-start gap-3" : "justify-center p-0",
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
              {isOpen && (
                <>
                  <span>{item.label}</span>
                  {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />}
                </>
              )}
            </Button>
          );
        })}
      </nav>

      {isOpen && (
        <div className="p-4 space-y-4 relative z-10">
          {/* 광고 배너 */}
          <AdBanner />

          {/* 버전 정보 */}
          <div className="border-t border-stone-800/10 pt-4 text-center">
            <div className="text-xs text-stone-400 font-serif space-y-1">
              <p>쯔동여지도 v1.5.3</p>
              <p className="text-stone-300">@ 2025 Tzudong</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
