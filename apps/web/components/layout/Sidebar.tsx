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

  // [최적화] 도장 페이지 데이터 프리페치 (전체 맛집 + 사용자 리뷰)
  const prefetchStampData = useCallback(async () => {
    // 전체 맛집 데이터 prefetch
    await queryClient.prefetchQuery({
      queryKey: ["restaurants", undefined, undefined, undefined, undefined],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("restaurants")
          .select("id, name, lat, lng, road_address, jibun_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, english_address, status, created_at")
          .eq("status", "approved")
          .order("name");

        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // 로그인된 사용자의 스탬프 데이터 prefetch
    if (user?.id) {
      await queryClient.prefetchQuery({
        queryKey: ['user-stamp-reviews', user.id],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('reviews')
            .select('restaurant_id, is_verified')
            .eq('user_id', user.id)
            .eq('is_verified', true);
          if (error) throw error;
          return data || [];
        },
      });
    }
  }, [queryClient, user?.id]);

  // [최적화] 랭킹 페이지 데이터 프리페치
  const prefetchLeaderboardData = useCallback(async () => {
    await queryClient.prefetchQuery({
      queryKey: ['leaderboard-all-users'],
      queryFn: async () => {
        try {
          // 모든 프로필 조회
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('user_id, nickname')
            .not('nickname', 'is', null)
            .neq('nickname', '탈퇴한 사용자');

          if (profilesError) throw new Error(`프로필 데이터 조회 실패: ${profilesError.message}`);
          if (!profilesData || profilesData.length === 0) return [];

          // 해당 사용자들의 모든 리뷰 조회
          const userIds = profilesData.map((profile: any) => profile.user_id);
          const { data: allReviewsData } = await supabase
            .from('reviews')
            .select('id, user_id, is_verified')
            .in('user_id', userIds);

          // 모든 리뷰의 좋아요 데이터 조회
          let reviewIds: string[] = [];
          if (allReviewsData) {
            reviewIds = allReviewsData.map((review: any) => review.id);
          }

          const { data: likesData } = await supabase
            .from('review_likes')
            .select('review_id')
            .in('review_id', reviewIds);

          // 통계 계산
          const reviewCountMap = new Map<string, number>();
          const verifiedReviewCountMap = new Map<string, number>();
          const totalLikesMap = new Map<string, number>();
          const reviewLikesMap = new Map<string, number>();

          if (likesData) {
            likesData.forEach((like: any) => {
              const current = reviewLikesMap.get(like.review_id) || 0;
              reviewLikesMap.set(like.review_id, current + 1);
            });
          }

          if (allReviewsData && allReviewsData.length > 0) {
            allReviewsData.forEach((review: any) => {
              const currentReviewCount = reviewCountMap.get(review.user_id) || 0;
              reviewCountMap.set(review.user_id, currentReviewCount + 1);

              if (review.is_verified) {
                const currentVerifiedCount = verifiedReviewCountMap.get(review.user_id) || 0;
                verifiedReviewCountMap.set(review.user_id, currentVerifiedCount + 1);
              }

              const reviewLikes = reviewLikesMap.get(review.id) || 0;
              const currentLikes = totalLikesMap.get(review.user_id) || 0;
              totalLikesMap.set(review.user_id, currentLikes + reviewLikes);
            });
          }

          const users = profilesData.map((profile: any) => {
            const reviewCount = reviewCountMap.get(profile.user_id) || 0;
            const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
            const totalLikes = totalLikesMap.get(profile.user_id) || 0;

            return {
              id: profile.user_id,
              username: profile.nickname,
              reviewCount,
              verifiedReviewCount,
              totalLikes,
            };
          });

          return users
            .sort((a: any, b: any) => b.verifiedReviewCount - a.verifiedReviewCount)
            .map((user: any, index: number) => ({
              ...user,
              rank: index + 1,
            }));
        } catch (error) {
          console.warn('리더보드 데이터 조회 중 오류 발생:', error);
          return [];
        }
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
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  onClick={() => setIsSubmissionsExpanded(!isSubmissionsExpanded)}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className={cn("h-5 w-5", isParentActive ? "text-foreground" : "text-muted-foreground")} />
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
                  <div className="ml-4 pl-4 border-l border-border space-y-1">
                    {item.children.map((child, childIndex) => {
                      const isActive = pathname === child.path;
                      return (
                        <Button
                          key={childIndex}
                          variant="ghost"
                          className={cn(
                            "w-full font-serif text-sm h-9 justify-start gap-2",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                          onClick={child.onClick}
                        >
                          <child.icon className={cn("h-4 w-4", isActive ? "text-white" : "text-muted-foreground")} />
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
                  ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={item.onClick}
            >
              <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-muted-foreground")} />
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
                ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={item.onClick}
            onMouseEnter={() => {
              // [성능 최적화] 페이지 호버 시 해당 페이지 데이터 미리 로드
              if (!isActive) {
                if (isHomePage) {
                  prefetchRestaurants();
                } else if (item.path === "/stamp") {
                  prefetchStampData();
                } else if (item.path === "/leaderboard") {
                  prefetchLeaderboardData();
                }
              }
            }}
            disabled={!item.onClick}
          >
            <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-muted-foreground")} />
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
      {/* [배경 효과] 한지 질감 오버레이 - 다크모드에서 숨김 */}
      <div className="absolute inset-0 opacity-40 dark:opacity-0 pointer-events-none z-0 transition-opacity"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")` }}
      />

      {/* 전통 문양 테두리 (내부) - 다크모드에서 숨김 */}
      <div className="absolute inset-1 border border-border dark:border-transparent rounded-sm pointer-events-none z-0" />

      {/* 우측 테두리 강조 */}
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-border to-transparent pointer-events-none z-0" />

      {/* 로고 영역 */}
      <div className="h-16 border-b border-border relative z-10 flex items-center justify-center overflow-hidden">
        <div className="cursor-pointer w-full h-full flex items-center justify-center px-4" onClick={() => router.push("/")}>
          {isOpen ? (
            <Image
              src="/sidebar-logo.png"
              alt="쯔동여지도"
              width={200}
              height={56}
              priority
              sizes="(max-width: 768px) 150px, 200px"
              className="h-12 w-auto object-contain opacity-90 drop-shadow-sm dark:invert dark:brightness-200"
            />
          ) : (
            <Home className="h-6 w-6 text-muted-foreground" />
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

          {/* 버전 및 사업자 정보 */}
          <div
            className="border-t border-border pt-4 text-center cursor-help"
            title={`타이니번 데이터랩\n대표: 최연우\n사업자등록번호: 601-09-04613\n이메일: twoimo@dgu.ac.kr`}
          >
            <div className="text-xs text-muted-foreground font-serif space-y-1">
              <p>쯔동여지도 v1.0.0 (AI 분석 정보 포함)</p>
              <p className="text-muted-foreground/70">© 2026 타이니번 데이터랩</p>
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
