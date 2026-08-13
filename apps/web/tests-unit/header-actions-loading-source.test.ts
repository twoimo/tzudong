import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("header action loading source contract", () => {
  test("desktop header action icons use independent skeleton slots instead of one grouped auth placeholder", () => {
    const headerSource = source("components/layout/Header.tsx");

    expect(headerSource).toContain("function HeaderActionSkeleton");
    expect(headerSource).toContain("shouldShowNotificationSkeleton");
    expect(headerSource).toContain("shouldShowBookmarkSkeleton");
    expect(headerSource).toContain("shouldShowFullscreenSkeleton");
    expect(headerSource).toContain("shouldShowAccountSkeleton");
    expect(headerSource).toContain('label="알림 로딩 중"');
    expect(headerSource).toContain('label="북마크 로딩 중"');
    expect(headerSource).toContain('label="전체화면 로딩 중"');
    expect(headerSource).toContain('label="사용자 메뉴 로딩 중"');
    expect(headerSource).toContain(
      "const HeaderBookmarkMenuButton = useDeferredComponent",
    );
    expect(headerSource).toContain(
      'HeaderBookmarkMenuButton ? <HeaderBookmarkMenuButton /> : <HeaderActionSkeleton label="북마크 로딩 중" />',
    );
    expect(headerSource).toContain(
      'fallback={<HeaderActionSkeleton label="북마크 로딩 중" />}',
    );
    expect(headerSource).not.toContain(
      "w-[84px] rounded-md md:ml-2 md:h-10 md:w-[96px]",
    );
  });

  test("runtime layouts no longer mount the legacy global header on routed pages", () => {
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");

    expect(mainLayoutSource).not.toContain(
      "dynamic(() => import('@/components/layout/Header')",
    );
    expect(overlayLayoutSource).not.toContain(
      'dynamic(() => import("@/components/layout/Header")',
    );
    expect(mainLayoutSource).not.toContain(
      "isAuthLoading={isLoading && !user}",
    );
    expect(overlayLayoutSource).not.toContain(
      "isAuthLoading={isLoading && !user}",
    );
    expect(mainLayoutSource).toContain(
      'root.style.setProperty(APP_HEADER_HEIGHT_VAR, "0px")',
    );
  });

  test("desktop map exposes a route-based user menu without opening the home panel", () => {
    const homeClientSource = source("app/home-client.tsx");
    const userMenuSource = source("components/home/HomeMapUserMenu.tsx");

    expect(homeClientSource).toContain("const HomeMapUserMenu = dynamic(");
    expect(homeClientSource).toContain("<HomeMapUserMenu");
    expect(homeClientSource).toContain("desktopPanelSide={desktopPanelSide}");
    expect(homeClientSource).toContain("isPanelCollapsed={isPanelCollapsed}");
    expect(homeClientSource).toContain(
      "function HomeMapUserMenuPendingShell()",
    );
    expect(homeClientSource).toContain(
      'data-desktop-map-user-menu-pending="true"',
    );
    expect(homeClientSource).toContain(
      "{ ssr: false, loading: () => <HomeMapUserMenuPendingShell /> }",
    );
    expect(homeClientSource).toContain(
      "DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT",
    );
    expect(homeClientSource).toContain("handleExpandLeftPanelForPageEntry");
    expect(homeClientSource).toContain("setIsPanelCollapsed(false);");
    expect(userMenuSource).toContain('data-desktop-map-user-menu="true"');
    expect(userMenuSource).toContain(
      'data-desktop-map-fullscreen-toggle="true"',
    );
    expect(userMenuSource).not.toContain("if (!user) return null");
    expect(userMenuSource).toContain("const DesktopAuthModal = dynamic(");
    expect(userMenuSource).toContain("setIsAuthModalOpen(true);");
    expect(userMenuSource).toContain("onAuthSuccess={closeAuthModal}");
    expect(userMenuSource).toContain('redirectTo="/mypage/profile"');
    expect(userMenuSource).toContain("isLoading: isAuthLoading");
    expect(userMenuSource).toContain('data-auth-session-pending="true"');
    expect(userMenuSource).toContain('aria-label="사용자 세션 확인 중"');
    expect(homeClientSource).toContain('<Maximize2 className="h-4 w-4" />');
    expect(homeClientSource).toContain('<UserRound className="h-4 w-4" />');
    expect(userMenuSource).not.toContain("[&_svg]:!size-5");
    expect(userMenuSource).toContain('aria-label="로그인 열기"');
    expect(userMenuSource).toContain(
      "fixed top-4 z-[120] h-11 w-11 rounded-full",
    );
    expect(userMenuSource).toContain(
      'shouldOffsetForRightPanel ? "" : "right-20"',
    );
    expect(userMenuSource).toContain("style={fullscreenButtonStyle}");
    expect(userMenuSource).toContain(
      'aria-label={isFullscreen ? "지도 전체화면 끄기" : "지도 전체화면 켜기"}',
    );
    expect(userMenuSource).toContain(
      "document.documentElement.requestFullscreen()",
    );
    expect(userMenuSource).toContain("document.exitFullscreen()");
    expect(userMenuSource).toContain(
      'document.addEventListener("fullscreenchange", syncFullscreenState)',
    );
    expect(userMenuSource).toContain(
      '<Maximize2 className="h-5 w-5" aria-hidden="true" />',
    );
    expect(userMenuSource).toContain(
      '<Minimize2 className="h-5 w-5" aria-hidden="true" />',
    );
    expect(userMenuSource).toContain(
      'queryKey: ["home-map-user-menu-avatar", user?.id]',
    );
    expect(userMenuSource).toContain('readPublicProfileSummaries(supabase, [user.id])');
    expect(userMenuSource).toContain("nickname: profile.nickname");
    expect(userMenuSource).toContain(
      "const displayName = profileMenuIdentity?.nickname ?? fallbackDisplayName",
    );
    expect(userMenuSource).not.toContain('.from("profiles")');
    expect(userMenuSource).toContain(
      'className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary"',
    );
    expect(userMenuSource).toContain("profileAvatarUrl ? (");
    expect(userMenuSource).toContain('sizes="36px"');
    expect(userMenuSource).toContain('<UserRound className="h-5 w-5" />');
    expect(userMenuSource).toContain('navigateToPage("/mypage/profile")');
    expect(userMenuSource).toContain('navigateToPage("/?panel=settings")');
    expect(userMenuSource).toContain("환경설정");
    expect(userMenuSource).toContain('navigateToPage("/admin")');
    expect(userMenuSource).toContain(
      "shouldExpandDesktopLeftPanelForRoute(href)",
    );
    expect(userMenuSource).toContain(
      "DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT",
    );
    const desktopLeftPanelEntrySource = source("lib/desktop-left-panel-entry.ts");
    expect(desktopLeftPanelEntrySource).toContain(
      "DESKTOP_LEFT_PANEL_ROUTE_PANELS",
    );
    expect(desktopLeftPanelEntrySource).toContain('"settings"');
    expect(desktopLeftPanelEntrySource).toContain(
      "DESKTOP_LEFT_PANEL_ROUTE_PANELS.has(panel)",
    );
    expect(userMenuSource).toContain("{isAdmin && (");
    expect(userMenuSource).toContain("await signOut();");
    expect(userMenuSource).not.toContain("dispatchWindowEvent('openMyPage')");
    expect(userMenuSource).toContain("isBusinessInfoExpanded");
    expect(userMenuSource).toContain('data-desktop-map-business-info="true"');
    expect(userMenuSource).toContain('aria-label="사업자 정보 펼치기/접기"');
    expect(userMenuSource).toContain("aria-expanded={isBusinessInfoExpanded}");
    const siteConfigSource = source("lib/site-config.ts");
    expect(userMenuSource).toContain("siteConfig.operator.copyrightLabel");
    expect(userMenuSource).toContain("siteConfig.operator.companyName");
    expect(userMenuSource).toContain("siteConfig.operator.representative");
    expect(userMenuSource).toContain("siteConfig.operator.businessRegistrationNumber");
    expect(userMenuSource).toContain("siteConfig.contact.email");
    expect(siteConfigSource).toContain("NEXT_PUBLIC_SUPPORT_EMAIL");
    expect(siteConfigSource).toContain("cs@tzudong.app");
    expect(userMenuSource).toContain("<ChevronDown");
    expect(userMenuSource).toContain("<ChevronUp");
    expect(userMenuSource).toContain(
      'className="z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl',
    );
    expect(userMenuSource).not.toContain('className="z-[180] w-64 rounded-2xl');
    expect(userMenuSource).toContain("text-foreground whitespace-nowrap");
    expect(userMenuSource).toContain("text-left whitespace-nowrap");
    expect(userMenuSource).toContain(
      'className="flex w-max max-w-full items-center justify-between',
    );
  });

  test("desktop admin route keeps full-page console chrome instead of map overlay chrome", () => {
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const adminConsoleSource = source(
      "components/admin/AdminConsoleOverview.tsx",
    );
    const tailwindConfigSource = source("app/app-globals.css");

    expect(overlayLayoutSource).toContain(
      "const shouldRenderRouteOverlayChrome =",
    );
    expect(overlayLayoutSource).toContain(
      "!isHomeRoute && routeDirectPanelParam !== null",
    );
    expect(overlayLayoutSource).toContain(
      "{shouldRenderRouteOverlayChrome && (",
    );
    expect(overlayLayoutSource).not.toContain("{!isHomeRoute && (");
    expect(adminConsoleSource).toContain(
      "h-[var(--full-height,100vh)] min-h-0 min-w-0 w-full overflow-hidden",
    );
    expect(tailwindConfigSource).toContain(
      '[data-admin-console-shell="true"] {',
    );
    expect(tailwindConfigSource).toContain(
      "height: var(--full-height, 100vh);",
    );
  });

  test("account dropdown does not expose the announcement shortcut", () => {
    const headerSource = source("components/layout/Header.tsx");

    expect(headerSource).not.toContain("handleAnnouncementListClick");
    expect(headerSource).not.toContain(
      "<DropdownMenuItem onClick={handleAnnouncementListClick}",
    );
    expect(headerSource).not.toContain(
      'aria-label="관리자 콘솔에서 공지사항 관리"',
    );
    expect(headerSource).toContain('HeaderAnnouncementPanel');
  });

  test("bookmark dropdown keeps its own list skeleton while bookmark data loads", () => {
    const bookmarkSource = source(
      "components/layout/HeaderBookmarkMenuButton.tsx",
    );

    expect(bookmarkSource).toContain("isLoading: isBookmarksLoading");
    expect(bookmarkSource).toContain('aria-label="북마크 목록 로딩 중"');
    expect(bookmarkSource).toContain(
      '<Skeleton className="h-4 w-3/4 rounded" />',
    );
  });
});
