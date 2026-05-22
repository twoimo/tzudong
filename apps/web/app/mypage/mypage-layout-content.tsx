"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import dynamic from "next/dynamic";
import { useMobileBottomNavAutoHide } from "@/hooks/use-mobile-bottom-nav-auto-hide";
import { Skeleton } from "@/components/ui/skeleton";
import { ReturnToMapButton } from "@/components/layout/ReturnToMapButton";

const MyPageSidebar = dynamic(
  () => import("@/components/mypage/MyPageSidebar").then((mod) => mod.MyPageSidebar),
  {
    ssr: false,
    loading: () => <MyPageSidebarExpandedPlaceholder />,
  }
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
      aria-label="마이페이지 내용 로딩 중"
    >
      <div className="rounded-3xl border border-border bg-card p-4" data-mypage-content-hero-skeleton="true">
        <div className="flex gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-2xl sm:h-20 sm:w-20" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-4 w-28 rounded-full" />
            <Skeleton className="h-7 w-3/4 max-w-sm rounded-lg" />
            <Skeleton className="h-4 w-1/2 max-w-xs rounded-full" />
            <div className="grid gap-2 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2" data-mypage-content-actions-skeleton="true">
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
    </div>
  );
}

export function MyPageLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: userLoading } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldRenderSidebar, setShouldRenderSidebar] = useState(false);
  const myPageBottomNavAutoHide = useMobileBottomNavAutoHide({
    scrollRef,
    source: 'mypage-scroll',
    disabled: !user,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const syncSidebarVisibility = () => setShouldRenderSidebar(mediaQuery.matches);

    syncSidebarVisibility();
    mediaQuery.addEventListener("change", syncSidebarVisibility);

    return () => mediaQuery.removeEventListener("change", syncSidebarVisibility);
  }, []);

  const shouldShowSidebarFrame = userLoading || Boolean(user);

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
          <div className="flex h-full min-h-full flex-col px-3 py-4 pb-[calc(var(--mobile-bottom-nav-height,60px)+env(safe-area-inset-bottom)+1rem)] sm:px-4 md:px-5 md:py-6 md:pb-6 lg:px-6 lg:py-7">
            <div className="mb-3" data-mypage-return-slot="true">
              {userLoading ? (
                <Skeleton className="h-9 w-24 rounded-full" data-mypage-return-skeleton="true" />
              ) : (
                <ReturnToMapButton className="w-fit" />
              )}
            </div>
            {userLoading ? <MyPageContentLoadingState /> : children}
          </div>
        </div>
      </div>
    </div>
  );
}
