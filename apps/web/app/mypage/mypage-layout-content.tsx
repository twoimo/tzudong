"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import dynamic from "next/dynamic";
import {
  Bookmark,
  Edit3,
  Heart,
  LogOut,
  MessageSquare,
  PlusCircle,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useMobileBottomNavAutoHide } from "@/hooks/use-mobile-bottom-nav-auto-hide";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/no-toast";

const STAT_SKELETON_WIDTHS = ["w-full", "w-11/12", "w-10/12"];
const ACTION_SKELETON_WIDTHS = ["w-full", "w-[92%]", "w-[84%]", "w-[76%]"];
const SECTION_SKELETON_WIDTHS = ["w-full", "w-[94%]"];

type MyPageMobileRouteHeader = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const MOBILE_ROUTE_HEADERS: MyPageMobileRouteHeader[] = [
  {
    href: "/mypage/bookmarks",
    title: "나의 북마크 내역",
    description: "저장한 맛집을 확인하세요.",
    icon: Bookmark,
  },
  {
    href: "/mypage/reviews",
    title: "나의 리뷰 내역",
    description: "작성한 리뷰 상태를 확인하세요.",
    icon: MessageSquare,
  },
  {
    href: "/mypage/submissions/new",
    title: "신규 맛집 제보",
    description: "새 맛집 제보 상태를 확인하세요.",
    icon: PlusCircle,
  },
  {
    href: "/mypage/submissions/edit",
    title: "맛집 수정 요청",
    description: "수정 요청 처리 상태를 확인하세요.",
    icon: Edit3,
  },
  {
    href: "/mypage/submissions/recommend",
    title: "쯔양 맛집 제보",
    description: "추천한 맛집을 확인하세요.",
    icon: Heart,
  },
  {
    href: "/mypage/profile",
    title: "쯔동여지도 마이페이지",
    description: "내 활동과 계정 정보를 관리하세요.",
    icon: UserRound,
  },
];

function resolveMobileRouteHeader(pathname: string | null) {
  return (
    MOBILE_ROUTE_HEADERS.find((item) => pathname?.startsWith(item.href)) ??
    MOBILE_ROUTE_HEADERS[MOBILE_ROUTE_HEADERS.length - 1]
  );
}

const MyPageSidebar = dynamic(
  () =>
    import("@/components/mypage/MyPageSidebar").then(
      (mod) => mod.MyPageSidebar,
    ),
  {
    ssr: false,
    loading: () => <MyPageSidebarExpandedPlaceholder />,
  },
);

function MyPageSidebarExpandedPlaceholder() {
  return (
    <aside
      className="hidden md:flex w-64 shrink-0 border-r border-border bg-card"
      aria-hidden="true"
      data-mypage-left-panel-expanded="pending"
    />
  );
}

function MyPageContentLoadingState() {
  return (
    <div
      className="flex min-h-full flex-col gap-4"
      data-mypage-content-loading="true"
      data-mypage-content-loading-behavior="static-shell-dynamic-skeleton"
      aria-label="마이페이지 내용 로딩 중"
      aria-live="polite"
      role="status"
    >
      <div
        className="space-y-5 md:rounded-3xl md:border md:border-border md:bg-card md:p-5"
        data-mypage-content-hero-skeleton="borderless-mobile"
      >
        <div className="flex gap-4 sm:gap-5">
          <Skeleton className="h-16 w-16 shrink-0 rounded-2xl bg-muted/50 sm:h-20 sm:w-20" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-4 w-24 rounded-full sm:w-28" />
            <Skeleton className="h-7 w-3/4 max-w-sm rounded-lg" />
            <Skeleton className="h-4 w-[58%] max-w-xs rounded-full" />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {STAT_SKELETON_WIDTHS.map((widthClass, index) => (
            <Skeleton
              key={index}
              className={`${widthClass} h-14 rounded-2xl bg-muted/50 md:h-16`}
            />
          ))}
        </div>
        <div
          className="grid gap-2 sm:grid-cols-2"
          data-mypage-content-actions-skeleton="true"
        >
          {ACTION_SKELETON_WIDTHS.map((widthClass, index) => (
            <Skeleton
              key={index}
              className={`${widthClass} h-14 rounded-2xl bg-muted/50`}
            />
          ))}
        </div>
      </div>
      {SECTION_SKELETON_WIDTHS.map((widthClass, index) => (
        <Skeleton
          key={index}
          className={`${widthClass} h-24 rounded-2xl bg-muted/50 md:h-28 md:border md:border-border/60 md:bg-card`}
        />
      ))}
    </div>
  );
}

export function MyPageLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: userLoading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldRenderSidebar, setShouldRenderSidebar] = useState(false);
  const myPageBottomNavAutoHide = useMobileBottomNavAutoHide({
    scrollRef,
    source: "mypage-scroll",
    disabled: !user,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const syncSidebarVisibility = () =>
      setShouldRenderSidebar(mediaQuery.matches);

    syncSidebarVisibility();
    mediaQuery.addEventListener("change", syncSidebarVisibility);

    return () =>
      mediaQuery.removeEventListener("change", syncSidebarVisibility);
  }, []);

  const shouldShowSidebarFrame = userLoading || Boolean(user);
  const mobileRouteHeader = resolveMobileRouteHeader(pathname);
  const MobileRouteIcon = mobileRouteHeader.icon;

  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      toast.error("로그아웃에 실패했습니다");
    }
  };

  // /mypage is protected in middleware. Keep the desktop panel frame visible while
  // client auth hydrates so the routed page does not collapse to a blank canvas.
  if (!shouldShowSidebarFrame) return null;

  return (
    <div className="h-full min-h-0 bg-background overflow-hidden">
      <div
        className="flex h-full min-h-0 w-full max-w-none"
        data-mypage-viewport-layout="edge-to-edge"
      >
        {/* 사이드바는 자체 높이를 가지며 레이아웃 내에 고정됨 */}
        {shouldShowSidebarFrame &&
          (user && shouldRenderSidebar ? (
            <MyPageSidebar />
          ) : (
            <MyPageSidebarExpandedPlaceholder />
          ))}

        {/* 콘텐츠 영역만 스크롤 가능하도록 설정 */}
        <div
          ref={scrollRef}
          className="flex-1 h-full min-h-0 overflow-y-auto min-w-0 overscroll-contain"
          onScroll={myPageBottomNavAutoHide.onScroll}
          onTouchStart={myPageBottomNavAutoHide.onTouchStart}
          onTouchMove={myPageBottomNavAutoHide.onTouchMove}
        >
          <div
            className="shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4 md:hidden"
            data-mypage-mobile-route-header="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 basis-[min(11rem,100%)]">
                <h1 className="flex min-w-0 flex-wrap items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl">
                  <MobileRouteIcon
                    className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">
                    {mobileRouteHeader.title}
                  </span>
                </h1>
                <p className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm">
                  {mobileRouteHeader.description}
                </p>
              </div>
              {user && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={handleLogout}
                  aria-label="로그아웃"
                  data-mypage-mobile-route-header-action="logout"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          <div
            className="flex min-h-full w-full flex-col px-3 py-4 pb-[calc(var(--mobile-bottom-nav-height,60px)+env(safe-area-inset-bottom)+1rem)] sm:px-4 md:h-full md:min-h-0 md:px-4 md:py-3 md:pb-3 lg:px-5 lg:py-3"
            data-mypage-content-width="viewport-fill"
            data-mypage-content-density="viewport-profile"
          >
            {userLoading ? <MyPageContentLoadingState /> : children}
          </div>
        </div>
      </div>
    </div>
  );
}
