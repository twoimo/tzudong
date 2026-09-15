"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import dynamic from "next/dynamic";
import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useMobileBottomNavAutoHide } from "@/hooks/use-mobile-bottom-nav-auto-hide";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DataPending } from "@/components/ui/data-pending";
import { MyPageSectionFrame } from "@/components/mypage/MyPageSectionFrame";
import { MOBILE_ROUTE_HEADERS, resolveMobileRouteHeader, type MyPageMobileRouteHeader } from "./route-presentation";
import { toast } from "@/lib/no-toast";
import { buildBrowserTitle } from "@/lib/seo";


function getMyPageBrowserTitleLabel(header: MyPageMobileRouteHeader) {
  return header.href === "/mypage/profile" ? "마이페이지" : header.title;
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
  const pathname = usePathname();
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border bg-card md:flex" data-mypage-left-panel-expanded="pending">
      <div className="min-h-40 border-b p-6"><h2 className="font-semibold">마이페이지</h2><DataPending label="프로필을 확인하는 중입니다." /></div>
      <nav aria-label="마이페이지 메뉴" className="space-y-1 p-3">
        {MOBILE_ROUTE_HEADERS.map(({ href, title, icon: Icon }) => <Link key={href} href={href} aria-current={pathname?.startsWith(href) ? 'page' : undefined} className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-muted-foreground hover:bg-muted">
          <Icon className="h-4 w-4" aria-hidden="true" />{href === '/mypage/profile' ? '내 프로필' : title}
        </Link>)}
      </nav>
    </aside>
  );
}

function MyPageContentLoadingState({ header }: { header: MyPageMobileRouteHeader }) {
  return (
    <MyPageSectionFrame icon={header.icon} eyebrow="마이페이지" title={header.title} description={header.description}>
      <DataPending label="로그인 상태를 확인하는 중입니다." className="min-h-48" />
    </MyPageSectionFrame>
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
  useDocumentTitle(buildBrowserTitle(getMyPageBrowserTitleLabel(mobileRouteHeader)));

  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      console.error("로그아웃 실패:");
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
            {userLoading ? <MyPageContentLoadingState header={mobileRouteHeader} /> : children}
          </div>
        </div>
      </div>
    </div>
  );
}
