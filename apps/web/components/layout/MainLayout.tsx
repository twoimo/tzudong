"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";
import {
  APP_HEADER_HEIGHT_VAR,
  MOBILE_SHEET_HEADER_OFFSET_VAR,
  MOBILE_SHEET_HEADER_PROGRESS_VAR,
} from "@/lib/mobile-sheet-layout";
import { AUTH_UI_REQUEST_EVENT } from "@/lib/auth-ui-events";

// [PERF] 모달과 비핵심 컴포넌트를 동적 임포트로 코드 스플리팅
// 이 컴포넌트들은 사용자 인터랙션 후에만 필요하므로 초기 번들에서 제외

const AuthModal = dynamic(() => import("@/components/auth/AuthModal"), {
  ssr: false,
});
const ProfileModal = dynamic(
  () =>
    import("@/components/profile/ProfileModal").then((mod) => ({
      default: mod.ProfileModal,
    })),
  { ssr: false },
);
const NicknameSetupModal = dynamic(
  () =>
    import("@/components/profile/NicknameSetupModal").then((mod) => ({
      default: mod.NicknameSetupModal,
    })),
  { ssr: false },
);
const AdminRestaurantModal = dynamic(
  () =>
    import("@/components/admin/AdminRestaurantModal").then((mod) => ({
      default: mod.AdminRestaurantModal,
    })),
  { ssr: false },
);
const CombinedPopup = dynamic(
  () => import("@/components/layout/CombinedPopup"),
  { ssr: false },
);

const NONCRITICAL_CHROME_DELAY_MS = 0;
const NONCRITICAL_CHROME_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
];

// [PERF] Lazy load components
const UserDataPrefetcher = dynamic(
  () => import("@/components/layout/UserDataPrefetcher"),
  {
    ssr: false,
  },
);

const MobileBottomNav = dynamic(
  () => import("@/components/layout/MobileBottomNav"),
  {
    ssr: false,
  },
);

const NavigationPrefetcher = dynamic(
  () => import("@/components/layout/NavigationPrefetcher"),
  {
    ssr: false,
  },
);

const OverlayLayout = dynamic(
  () => import("@/components/layout/OverlayLayout"),
  {
    ssr: false,
  },
);

export function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, needsNicknameSetup, completeNicknameSetup } = useAuth();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { isDesktop } = useDeviceType();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<Restaurant | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [canMountNoncriticalChrome, setCanMountNoncriticalChrome] =
    useState(false);

  const prevPathnameRef = useRef(pathname);

  // 페이지 이동 감지
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      setSelectedRestaurant(null);
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  const shouldSuppressNoncriticalChrome =
    pathname?.startsWith("/auth/") ||
    pathname?.startsWith("/admin") ||
    pathname === "/feed" ||
    pathname === "/stamp" ||
    pathname === "/leaderboard";
  const shouldRenderMobileBottomNav = !shouldSuppressNoncriticalChrome;

  // 성능 최적화: 핸들러 메모이제이션
  const handleOpenAuth = useCallback(() => setIsAuthModalOpen(true), []);
  const setHeaderlessLayoutVars = useCallback(() => {
    const root = document.documentElement;
    root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, "0");
    root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, "0px");
    root.style.setProperty(APP_HEADER_HEIGHT_VAR, "0px");
  }, []);

  const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
    queryClient.invalidateQueries({ queryKey: ["restaurants"] });

    if (updatedRestaurant) {
      setSelectedRestaurant(updatedRestaurant);
    }
  };

  // 모바일 홈 전용 헤더-리스너 계약 기반 이벤트 처리
  const handleMobileAuthRequest = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const handleMobileProfileRequest = useCallback(() => {
    setIsProfileModalOpen(true);
  }, []);

  useEffect(() => {
    setHasMounted(true);
  }, []);
  useEffect(() => {
    if (!hasMounted) return;

    if (shouldSuppressNoncriticalChrome) {
      setCanMountNoncriticalChrome(false);
      return;
    }

    if (pathname !== "/") {
      setCanMountNoncriticalChrome(true);
      return;
    }

    let timer = 0;
    const mountNoncriticalChrome = () => {
      window.clearTimeout(timer);
      setCanMountNoncriticalChrome(true);
    };

    timer = window.setTimeout(
      mountNoncriticalChrome,
      NONCRITICAL_CHROME_DELAY_MS,
    );
    for (const eventName of NONCRITICAL_CHROME_EVENTS) {
      window.addEventListener(eventName, mountNoncriticalChrome, {
        once: true,
        passive: true,
      });
    }

    return () => {
      window.clearTimeout(timer);
      for (const eventName of NONCRITICAL_CHROME_EVENTS) {
        window.removeEventListener(eventName, mountNoncriticalChrome);
      }
    };
  }, [hasMounted, pathname, shouldSuppressNoncriticalChrome]);

  useEffect(() => {
    setHeaderlessLayoutVars();

    const openAuthListener = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: string }> | undefined)
        ?.detail;
      if (detail?.route && detail.route !== "/") return;
      handleMobileAuthRequest();
    };

    const openProfileListener = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: string }> | undefined)
        ?.detail;
      if (detail?.route && detail.route !== "/") return;
      handleMobileProfileRequest();
    };

    window.addEventListener(AUTH_UI_REQUEST_EVENT, handleMobileAuthRequest);
    window.addEventListener("home:mobile-auth-request", openAuthListener);
    window.addEventListener("home:mobile-profile-request", openProfileListener);

    return () => {
      window.removeEventListener(
        AUTH_UI_REQUEST_EVENT,
        handleMobileAuthRequest,
      );
      window.removeEventListener("home:mobile-auth-request", openAuthListener);
      window.removeEventListener(
        "home:mobile-profile-request",
        openProfileListener,
      );
      setHeaderlessLayoutVars();
    };
  }, [
    handleMobileAuthRequest,
    handleMobileProfileRequest,
    setHeaderlessLayoutVars,
  ]);

  if (!hasMounted) {
    return (
      <div className="min-h-[var(--full-height,100vh)] bg-background">
        <a href="#main-content" className="skip-link">
          본문 바로가기
        </a>
        <main id="main-content" className="h-full w-full">
          {children}
        </main>
      </div>
    );
  }

  // [NEW] 데스크탑에서는 항상 오버레이 레이아웃 사용 (사이드바 완전 제거)
  if (isDesktop) {
    return (
      <>
        <NavigationPrefetcher />
        <OverlayLayout>{children}</OverlayLayout>
      </>
    );
  }

  // 모바일/태블릿 레이아웃

  return (
    // h-screen 대신 CSS 변수(--full-height)로 모바일 브라우저 UI 고려
    // dvh/svh 지원 브라우저에서는 동적 뷰포트, 미지원은 JS fallback
    <div
      className="flex overflow-hidden"
      style={{ height: "var(--full-height, 100vh)" }}
    >
      <NavigationPrefetcher />

      {/* [OPTIMIZATION] Load Supabase logic only when user is logged in */}
      {user && <UserDataPrefetcher />}

      {/* 사이드바 제거됨 */}

      <div
        className={cn(
          "flex-1 flex flex-col overflow-hidden transition-[margin] duration-300",
        )}
        style={{
          transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1.0)",
          paddingBottom: shouldRenderMobileBottomNav
            ? "calc(var(--mobile-bottom-nav-height, 60px) * (1 - var(--mobile-sheet-hide-bottom-nav, 0)))"
            : "0px",
        }}>
        <a href="#main-content" className="skip-link">
          본문 바로가기
        </a>
        <main
          id="main-content"
          className="flex-1 relative overflow-hidden transition-[margin] duration-300"
          style={{
            marginTop: "calc(-1 * var(--mobile-sheet-header-offset, 0px))",
          }}
        >
          <div className="h-full w-full">{children}</div>
        </main>
      </div>

      {/* 모바일/태블릿용 하단 네비게이션바 (1599px 이하) */}
      {shouldRenderMobileBottomNav && (
        <div
          className={cn(
            // CSS 미디어 쿼리: 1600px 이상에서 숨김 (데스크탑)
            "min-[1600px]:hidden",
            // JS 기반 조건: isDesktop이 true면 숨김 (hydration 후)
            isDesktop && "hidden",
            "transition-transform duration-300",
          )}
        >
          <MobileBottomNav
            className="transition-transform duration-300"
            style={{
              transform:
                "translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)",
              willChange: "transform",
            }}
          />
        </div>
      )}

      {/* [PERF] 조건부 렌더링 - 모달이 닫혀있을 때 DOM 마운트 방지 (TBT 개선) */}
      {isAuthModalOpen && (
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      )}

      {isProfileModalOpen && (
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      )}

      {isAdminModalOpen && (
        <AdminRestaurantModal
          isOpen={isAdminModalOpen}
          onClose={() => setIsAdminModalOpen(false)}
          restaurant={selectedRestaurant}
          onSuccess={handleAdminSuccess}
        />
      )}

      {needsNicknameSetup && (
        <NicknameSetupModal
          isOpen={needsNicknameSetup}
          onComplete={completeNicknameSetup}
        />
      )}

      {canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome && (
        <CombinedPopup />
      )}
    </div>
  );
}

import { LayoutProvider } from "@/contexts/LayoutContext";

export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutProvider>
      <MainLayoutContent>{children}</MainLayoutContent>
    </LayoutProvider>
  );
}
