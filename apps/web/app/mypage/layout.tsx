"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { requestAuthUi } from "@/lib/auth-ui-events";
import { useMobileBottomNavAutoHide } from "@/hooks/use-mobile-bottom-nav-auto-hide";
import { GlobalLoader } from "@/components/ui/global-loader";

import { MyPageSidebar } from "@/components/mypage/MyPageSidebar";

export default function MyPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: userLoading } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const myPageBottomNavAutoHide = useMobileBottomNavAutoHide({
    scrollRef,
    source: 'mypage-scroll',
    disabled: !user,
  });

  useEffect(() => {
    if (!userLoading && !user) {
      window.setTimeout(() => {
        requestAuthUi({ source: 'mypage-guard', route: '/mypage', reason: 'mypage' });
      }, 0);
      router.replace("/");
    }
  }, [user, userLoading, router]);

  // 로그인 안한 상태로 접근 시 아무것도 안보여줌
  // (useEffect에서 홈으로 리다이렉트 처리)
  if (!userLoading && !user) return null;

  return (
    <div className="h-full min-h-0 bg-background overflow-hidden">
      <div className="container mx-auto h-full min-h-0 max-w-6xl flex">
        {/* 사이드바는 자체 높이를 가지며 레이아웃 내에 고정됨 */}
        {user && <MyPageSidebar />}

        {/* 콘텐츠 영역만 스크롤 가능하도록 설정 */}
        <div
          ref={scrollRef}
          className="flex-1 h-full min-h-0 overflow-y-auto min-w-0 overscroll-contain"
          onScroll={myPageBottomNavAutoHide.onScroll}
          onTouchStart={myPageBottomNavAutoHide.onTouchStart}
          onTouchMove={myPageBottomNavAutoHide.onTouchMove}
        >
          <div className="flex h-full min-h-full flex-col p-4 md:p-8 md:pt-14 pb-[calc(var(--mobile-bottom-nav-height,60px)+env(safe-area-inset-bottom)+1rem)] md:pb-8">
            {userLoading ? (
              <GlobalLoader
                message="마이페이지를 확인하는 중..."
                subMessage="로그인 상태를 확인하고 있습니다"
              />
            ) : children}
          </div>
        </div>
      </div>
    </div>
  );
}
