import { Home, Trophy, Stamp, DollarSign, ClipboardCheck, User, FileText, MessageSquare, PlusCircle, Edit3, Heart, ChevronDown, BarChart2, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import AdBanner from "./AdBanner";
import { memo, useCallback, useMemo, useState } from "react";
import { useHydration } from "@/hooks/useHydration";

interface SidebarProps {
  isOpen: boolean;
  isMyPageMode?: boolean;
}

const SidebarComponent = ({ isOpen, isMyPageMode = false }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();
  const isHydrated = useHydration();
  const [isSubmissionsExpanded, setIsSubmissionsExpanded] = useState(true);

  // [최적화] 레스토랑 데이터 프리페치 함수 (useCallback으로 메모이제이션)
  const prefetchRestaurants = useCallback(async () => {
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
  }, [queryClient]);

  // [메뉴 설정] 메뉴 아이템 메모이제이션
  const menuItems = useMemo(() => {
    // 마이페이지 모드가 아닐 때는 일반 메뉴 표시
    const baseMenuItems = [
      { icon: Home, label: "쯔동여지도 홈", path: "/", onClick: () => router.push("/") },
      { icon: Stamp, label: "쯔동여지도 도장", path: "/stamp", onClick: () => router.push("/stamp") },
      { icon: Trophy, label: "쯔동여지도 랭킹", path: "/leaderboard", onClick: () => router.push("/leaderboard") },
    ];

    // [권한 관리] 관리자 메뉴 (hydration 완료 후에만 표시)
    const adminMenuItems = (isHydrated && user && isAdmin) ? [
      { icon: DollarSign, label: "월 서버 운영 비용", path: "/costs", onClick: () => router.push("/costs") },
      { icon: ClipboardCheck, label: "관리자 데이터 검수", path: "/admin/evaluations", onClick: () => router.push("/admin/evaluations") },
      { icon: BarChart2, label: "쯔동여지도 인사이트", path: "/admin/insight", onClick: () => router.push("/admin/insight") },
    ] : [];

    return [...baseMenuItems, ...adminMenuItems];
  }, [router, isHydrated, user, isAdmin]);

  // 마이페이지 메뉴 아이템
  const myPageMenuItems = useMemo(() => [
    { icon: User, label: "마이페이지", path: "/mypage/profile", onClick: () => router.push("/mypage/profile") },
    {
      icon: FileText,
      label: "나의 제보 내역",
      isParent: true,
      children: [
        { icon: PlusCircle, label: "신규 맛집 제보", path: "/mypage/submissions/new", onClick: () => router.push("/mypage/submissions/new") },
        { icon: Edit3, label: "맛집 수정 요청", path: "/mypage/submissions/edit", onClick: () => router.push("/mypage/submissions/edit") },
        { icon: Heart, label: "쯔양 맛집 제보", path: "/mypage/submissions/recommend", onClick: () => router.push("/mypage/submissions/recommend") },
      ]
    },
    { icon: MessageSquare, label: "나의 리뷰 내역", path: "/mypage/reviews", onClick: () => router.push("/mypage/reviews") },
    { icon: Bookmark, label: "나의 북마크 내역", path: "/mypage/bookmarks", onClick: () => router.push("/mypage/bookmarks") },
  ], [router]);

  // 마이페이지 메뉴 렌더링
  const renderMyPageMenu = () => (
    <>
      <nav className={cn("flex-1 space-y-1 overflow-y-auto relative z-10", isOpen ? "p-4" : "p-2")}>
        {myPageMenuItems.map((item, index) => {
          if (item.isParent && item.children) {
            const isParentActive = pathname?.includes('/submissions');
            return (
              <div key={index} className="space-y-1">
                <Button
                  variant="ghost"
                  title={!isOpen ? item.label : undefined}
                  className={cn(
                    "w-full font-serif text-base h-11 transition-all duration-200",
                    isOpen ? "justify-between gap-3" : "justify-center p-0",
                    isParentActive
                      ? "bg-stone-200/70 text-stone-900"
                      : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900"
                  )}
                  onClick={() => setIsSubmissionsExpanded(!isSubmissionsExpanded)}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className={cn("h-5 w-5", isParentActive ? "text-stone-700" : "text-stone-400")} />
                    {isOpen && <span>{item.label}</span>}
                  </div>
                  {isOpen && (
                    <ChevronDown className={cn(
                      "h-4 w-4 transition-transform",
                      isSubmissionsExpanded ? "rotate-180" : ""
                    )} />
                  )}
                </Button>
                {isOpen && isSubmissionsExpanded && (
                  <div className="ml-4 pl-4 border-l border-stone-200 space-y-1">
                    {item.children.map((child, childIndex) => {
                      const isActive = pathname === child.path;
                      return (
                        <Button
                          key={childIndex}
                          variant="ghost"
                          className={cn(
                            "w-full font-serif text-sm h-9 justify-start gap-2",
                            isActive
                              ? "bg-stone-800 text-white shadow-md hover:bg-stone-700 hover:text-white"
                              : "text-stone-500 hover:bg-stone-200/50 hover:text-stone-900"
                          )}
                          onClick={child.onClick}
                        >
                          <child.icon className={cn("h-4 w-4", isActive ? "text-white" : "text-stone-400")} />
                          <span>{child.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const isActive = pathname === item.path;
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
    </>
  );

  // 일반 메뉴 렌더링
  const renderNormalMenu = () => (
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
              // [성능 최적화] 홈 페이지 호버 시 레스토랑 데이터 미리 로드
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
  );

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hover:z-[60] bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out flex flex-col h-screen shadow-xl",
        isOpen ? "w-64" : "w-16"
      )}
    >
      {/* [배경 효과] 한지 질감 오버레이 - 더 선명하게 */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")` }}
      />

      {/* 전통 문양 테두리 (내부) */}
      <div className="absolute inset-1 border border-stone-800/10 rounded-sm pointer-events-none z-0" />

      {/* 우측 테두리 강조 */}
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-stone-800/20 to-transparent pointer-events-none z-0" />

      {/* 로고 영역 */}
      <div className="h-16 border-b border-stone-800/10 relative z-10 flex items-center justify-center overflow-hidden">
        <div className="cursor-pointer w-full h-full flex items-center justify-center px-4" onClick={() => router.push("/")}>
          {isOpen ? (
            <Image
              src="/sidebar-logo.png"
              alt="쯔동여지도"
              width={200}
              height={56}
              priority
              sizes="(max-width: 768px) 150px, 200px"
              className="h-12 w-auto object-contain mix-blend-multiply opacity-90 drop-shadow-sm grayscale contrast-125"
            />
          ) : (
            <Home className="h-6 w-6 text-stone-600" />
          )}
        </div>
      </div>

      {/* 마이페이지 모드 or 일반 모드 메뉴 */}
      {isMyPageMode ? renderMyPageMenu() : renderNormalMenu()}

      {isOpen && (
        <div className={cn(
          "p-4 space-y-4 relative z-10 transition-opacity duration-300",
          isHydrated ? "opacity-100" : "opacity-0"
        )}>
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

// [최적화] React.memo로 래핑하여 isOpen이 변경되지 않으면 리렌더링 방지
const Sidebar = memo(SidebarComponent);
Sidebar.displayName = "Sidebar";

export default Sidebar;
