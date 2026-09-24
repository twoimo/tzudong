import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

// The single page-level surface class string, used to guard against
// viewport-clamped rows that previously clipped the password form.
const profilePageSurfaceClass = (profileSource: string) =>
  profileSource.match(/className="grid min-w-0 gap-3 rounded-2xl[^"]*"/)?.[0] ??
  "";

describe("mypage mobile cleanup source contracts", () => {
  test("layout fills the viewport without duplicate return chrome", () => {
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");
    const returnButtonSource = source(
      "components/layout/ReturnToMapButton.tsx",
    );
    const topActionsSource = source("components/mypage/MyPageTopActions.tsx");
    const mapUserMenuSource = source("components/home/HomeMapUserMenu.tsx");
    const mapUserButtonClass =
      "h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-sm hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
    const mapMenuItemClass =
      "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground";
    const mapMenuContentClass =
      "z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl";
    const mapMenuLabelClass =
      "max-w-[min(22rem,calc(100vw-4rem))] rounded-xl px-3 py-2 text-foreground";
    const myPageCenteredAvatarClass =
      "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary";
    const myPageCenteredAvatarIconClass =
      "absolute left-1/2 top-1/2 !h-5 !w-5 -translate-x-1/2 -translate-y-1/2";

    expect(layoutSource.match(/<ReturnToMapButton/g)?.length ?? 0).toBe(0);
    expect(layoutSource).not.toContain('data-mypage-return-slot="true"');
    expect(layoutSource).not.toContain(
      'className="mb-2 hidden items-center justify-between gap-3 md:flex"',
    );
    expect(layoutSource).not.toContain("import { MyPageTopActions }");
    expect(layoutSource).not.toContain("<MyPageTopActions />");
    expect(layoutSource).toContain(
      'data-mypage-content-density="viewport-profile"',
    );
    expect(layoutSource).toContain("md:h-full md:min-h-0");
    expect(layoutSource).not.toContain("data-mypage-mobile-return-slot");
    expect(layoutSource).not.toContain("data-mypage-mobile-return-skeleton");
    expect(returnButtonSource).toContain("touch-manipulation");
    expect(returnButtonSource).toContain(
      'iconOnly ? "h-11 w-11" : "min-h-11 px-3 text-xs font-semibold"',
    );
    expect(topActionsSource).toContain('data-mypage-top-actions="map-style"');
    expect(topActionsSource).toContain('data-mypage-fullscreen-toggle="true"');
    expect(topActionsSource).toContain('data-mypage-user-menu="true"');
    expect(mapUserMenuSource).toContain(mapUserButtonClass);
    expect(topActionsSource).toContain(
      "h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    );
    expect(mapUserMenuSource).toContain(mapMenuItemClass);
    expect(topActionsSource).toContain(mapMenuItemClass);
    expect(mapUserMenuSource).toContain(mapMenuContentClass);
    expect(topActionsSource).toContain(mapMenuContentClass);
    expect(mapUserMenuSource).toContain(mapMenuLabelClass);
    expect(topActionsSource).toContain(mapMenuLabelClass);
    expect(mapUserMenuSource).toContain('onSelect={() => navigateToPage("/admin")}');
    expect(mapUserMenuSource).toContain('data-admin-console-menu-item="true"');
    expect(topActionsSource).toContain('onSelect={() => router.push("/admin")}');
    expect(topActionsSource).toContain('data-admin-console-menu-item="true"');
    expect(topActionsSource).toContain(myPageCenteredAvatarClass);
    expect(topActionsSource).toContain(myPageCenteredAvatarIconClass);
    expect(topActionsSource).toContain('data-mypage-user-avatar="centered"');
    expect(topActionsSource).toContain('sizes="36px"');
    expect(topActionsSource).not.toContain('<UserRound className="h-5 w-5" />');
    expect(topActionsSource).toContain('data-desktop-map-business-info="true"');
    expect(topActionsSource).toContain(
      'aria-controls="desktop-map-business-info-content"',
    );
    expect(topActionsSource).toContain(
      'document.addEventListener("fullscreenchange", syncFullscreenState)',
    );
    expect(topActionsSource).toContain(
      '<Maximize2 className="h-5 w-5" aria-hidden="true" />',
    );
    expect(topActionsSource).toContain(
      '<Minimize2 className="h-5 w-5" aria-hidden="true" />',
    );
    expect(topActionsSource).toContain('aria-label="사용자 메뉴 열기"');
  });

  test("profile page keeps a quiet mobile-first action hierarchy without noisy duplicate chrome", () => {
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");
    const profileSource = source("app/mypage/profile/page.tsx").replace(/\r\n/g, "\n");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");

    expect(layoutSource).toContain('data-mypage-mobile-route-header="true"');
    expect(layoutSource).toContain(
      "shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4 md:hidden",
    );
    expect(layoutSource).toContain("쯔동여지도 마이페이지");
    expect(layoutSource).toContain("flex min-w-0 flex-wrap items-center");
    expect(layoutSource).toContain(
      "내 활동과 계정 정보를 관리하세요.",
    );
    expect(layoutSource).toContain(
      'data-mypage-mobile-route-header-action="logout"',
    );
    expect(layoutSource).toContain("await signOut();");
    expect(layoutSource).toContain('aria-label="로그아웃"');
    expect(layoutSource).toContain(
      'className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"',
    );
    expect(layoutSource).not.toContain("<span>로그아웃</span>");
    expect(profileSource).not.toContain('data-mypage-mobile-page-header="true"');
    expect(profileSource).not.toContain(
      'className="rounded-3xl border border-border/80 bg-card/95 p-4 shadow-sm md:hidden"',
    );
    expect(profileSource).toContain('data-mypage-profile-hero="mobile-only"');
    expect(profileSource).toContain(
      'className="overflow-hidden border-0 bg-transparent shadow-none md:hidden"',
    );
    expect(profileSource).toContain(
      'data-mypage-profile-hero-layout="sidebar-match"',
    );
    expect(profileSource).toContain(
      'data-mypage-profile-identity="sidebar-match"',
    );
    expect(profileSource).toContain(
      "flex flex-col items-center space-y-4 p-6 text-center md:hidden",
    );
    expect(profileSource).not.toContain(
      "flex flex-col items-center space-y-4 border-b border-border p-6 text-center md:hidden",
    );
    expect(profileSource).not.toContain(
      'data-mypage-profile-hero-layout="standard"',
    );
    expect(profileSource).not.toContain(
      'data-mypage-profile-identity="standard"',
    );
    expect(profileSource).toContain("rounded-full border-2 border-border shadow-sm");
    expect(profileSource).not.toContain("transition-[border-color,box-shadow]");
    expect(profileSource).toContain("grid w-full grid-cols-3 gap-2 pt-2");
    expect(profileSource).toContain("useUserProfile");
    expect(profileSource).toContain("userProfile?.tier");
    expect(profileSource).toContain("도장");
    expect(profileSource).toContain("리뷰");
    expect(profileSource).toContain("좋아요");
    expect(profileSource).not.toContain(
      'data-mypage-profile-session-action="logout"',
    );
    expect(profileSource).not.toContain("마이페이지 허브");
    expect(profileSource).toContain(
      "const { user, profileNickname } = useAuth();",
    );
    expect(profileSource).toContain(
      'profile?.nickname || userProfile?.nickname || profileNickname || "사용자"',
    );
    expect(profileSource).toContain(
      'data-mypage-mobile-nickname-controls="true"',
    );
    expect(profileSource).toContain(
      'data-mypage-mobile-avatar-controls="true"',
    );
    expect(profileSource).toContain('htmlFor="mypage-mobile-avatar-upload"');
    expect(profileSource).toContain('id="mypage-mobile-avatar-upload"');
    expect(profileSource).toContain(
      'className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2',
    );
    expect(profileSource).toContain('sizes="96px"');
    expect(profileSource).toContain('width: "6rem"');
    expect(profileSource).toContain(
      '<User className="h-9 w-9 text-muted-foreground" />',
    );
    expect(profileSource).toContain("handleMobileAvatarUpload");
    expect(profileSource).toContain("handleMobileAvatarDelete");
    expect(profileSource).toContain('className="sr-only md:hidden"');
    expect(profileSource).toContain(
      'data-mypage-mobile-nickname-field="display"',
    );
    expect(profileSource).toContain('data-mypage-mobile-nickname-field="edit"');
    expect(profileSource).toContain('id="mypage-mobile-nickname"');
    expect(profileSource).toContain("handleMobileNicknameChange");
    expect(profileSource).toContain(
      'className="h-7 rounded-full px-2 text-2xs text-muted-foreground"',
    );
    expect(profileSource).toContain('className="w-full space-y-2 md:hidden"');
    expect(profileSource).not.toContain("user.user_metadata?.full_name");
    expect(profileSource).toContain(
      'className="overflow-hidden rounded-2xl border-0 bg-muted/35 shadow-none md:order-1 lg:col-start-1 lg:row-start-1 lg:h-full lg:min-h-0"',
    );
    expect(profileSource).toContain('data-mypage-profile-main-column="true"');
    expect(profileSource).toContain(
      'className="min-w-0 space-y-3 sm:space-y-5 md:contents md:space-y-0"',
    );
    expect(profileSource).toContain('data-mypage-profile-side-column="true"');
    expect(profileSource).toContain(
      'data-mypage-profile-side-layout="matrix"',
    );
    expect(profileSource).toContain(
      "grid min-w-0 gap-3 sm:gap-5 md:contents",
    );
    expect(profileSource).toContain(
      'CardTitle className="flex items-center gap-2 text-base"',
    );
    expect(profileSource).not.toContain("lg:text-xs");
    expect(profileSource).not.toContain("lg:text-base");
    expect(profileSource).toContain('data-mypage-profile-density="dashboard-matrix"');
    expect(profileSource).toContain('data-mypage-profile-viewport-fit="content"');
    expect(profileSource).toContain('data-mypage-profile-matrix="content-2x2"');
    expect(profileSource).toContain('data-mypage-profile-matrix-size="content-track"');
    expect(profileSource).toContain("lg:min-h-0");
    expect(profileSource).toContain("lg:content-stretch lg:items-stretch");
    expect(profileSource).not.toContain(
      'data-mypage-profile-account-column="true"',
    );
    expect(sidebarSource).toContain(
      'data-mypage-sidebar-nickname-controls="true"',
    );
    expect(sidebarSource).toContain(
      'data-mypage-sidebar-nickname-field="display"',
    );
    expect(sidebarSource).toContain(
      'data-mypage-sidebar-nickname-field="edit"',
    );
    expect(sidebarSource).toContain("수정");
    expect(sidebarSource).toContain("저장");
    expect(sidebarSource).toContain("취소");
    expect(sidebarSource).toContain(
      '<h3 className="truncate text-lg font-bold">{displayName}</h3>',
    );
    expect(sidebarSource).toContain(
      'data-mypage-sidebar-session-action="logout"',
    );
    expect(sidebarSource).toContain(
      "hidden h-full w-64 shrink-0 flex-col border-r border-border bg-card md:flex",
    );
    expect(sidebarSource.match(/border-r border-border/g)?.length ?? 0).toBe(1);
    expect(sidebarSource).not.toContain("border-b border-border");
    expect(sidebarSource).not.toContain("border-t border-border");
    expect(sidebarSource).toContain(
      'variant="ghost"\n          className="h-9 w-full rounded-xl text-xs"',
    );
    expect(profileSource).toContain("lg:h-full");
    // The page surface must stay content-sized: pinning two viewport rows
    // clipped the password form inside its card. The matrix breakpoint is lg
    // because md leaves ~431px, where two tracks squeezed the tier headline.
    expect(profilePageSurfaceClass(profileSource)).toContain(
      "rounded-2xl border border-border/70",
    );
    expect(profilePageSurfaceClass(profileSource)).not.toContain(
      "md:grid-rows-2",
    );
    expect(profilePageSurfaceClass(profileSource)).not.toContain("md:h-full");
    expect(profileSource).not.toContain("lg:max-h-[calc(100dvh-6.25rem)]");
    expect(profileSource).toContain("lg:grid-cols-2");
    expect(profileSource).toContain("2xl:grid-cols-3");
    expect(profileSource).not.toContain("md:grid-cols-2");
    expect(profileSource).toContain(
      "lg:gap-3",
    );
    expect(profileSource).toContain("md:order-1");
    expect(profileSource).toContain("md:order-2");
    expect(profileSource).toContain('data-mypage-quick-actions="combined"');
    expect(profileSource).not.toContain("const profileQuickActions = [");
    expect(profileSource).toContain("const quickActionSections = [");
    expect(profileSource).toContain(
      'data-mypage-mobile-quick-actions="grouped"',
    );
    expect(profileSource).toContain(
      "data-mypage-mobile-action-section={section.id}",
    );
    expect(profileSource).toContain('data-mypage-mobile-action-row="true"');
    expect(profileSource).toContain("grid gap-2");
    expect(profileSource).toContain(
      "group flex min-h-14 min-w-0 touch-manipulation items-center gap-3",
    );
    expect(profileSource).not.toContain("min-h-[5.25rem]");
    expect(profileSource).not.toContain("data-mypage-mobile-action-primary");
    expect(profileSource).not.toContain("바로가기");
    expect(profileSource).not.toContain("내 활동 · 제보하기");
    expect(profileSource).not.toContain(
      "필요한 메뉴를 목적별로 바로 찾을 수 있어요",
    );
    expect(profileSource).not.toContain(
      "내 활동과 제보 메뉴를 한곳에서 확인합니다",
    );
    expect(profileSource).toContain('className="space-y-3 p-4 md:hidden"');
    expect(profileSource).toContain(
      '<h4 className="px-1 text-sm font-semibold">{section.title}</h4>',
    );
    expect(profileSource).toContain('data-mypage-desktop-tier-dashboard="true"');
    expect(profileSource).toContain(
      "data-mypage-desktop-tier-progress",
    );
    expect(profileSource).toContain('data-mypage-desktop-tier-metrics="true"');
    expect(profileSource).toContain('data-mypage-desktop-recent-activity="true"');
    expect(profileSource).toContain(
      'data-mypage-danger-zone-guidance="compact"',
    );
    expect(profileSource).toContain("완전 삭제는 복구할 수 없습니다.");
    expect(profileSource).not.toContain("진행 전 확인");
    expect(profileSource).toContain(
      'className="min-w-0 rounded-2xl border-0 bg-muted/35 shadow-none md:order-2 md:flex md:flex-col lg:col-start-2 lg:row-start-1 lg:h-full lg:min-h-0 lg:overflow-hidden"',
    );
    expect(profileSource).toContain(
      'className="hidden min-w-0 rounded-2xl border-0 bg-muted/35 shadow-none md:order-3 md:flex md:flex-col lg:col-start-1 lg:row-start-2 lg:h-full lg:min-h-0 lg:overflow-hidden"',
    );
    expect(profileSource).toContain('data-mypage-desktop-recent-activity-row="true"');
    expect(profileSource).toContain("최근 활동");
    expect(profileSource).toContain(
      "flex min-h-0 min-w-0 items-center gap-3 py-2.5",
    );
    expect(profileSource).toContain(
      'className="hidden h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:flex md:flex-col md:gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"',
    );
    expect(profileSource).toContain(
      'data-mypage-desktop-tier-action-guide="true"',
    );
    for (const nestedPanelClass of [
      "rounded-2xl border border-border/70 bg-card px-3 py-2.5",
      "rounded-2xl border border-border/70 bg-card px-3 py-3",
      "rounded-2xl border border-border/70 bg-muted/20 p-3",
      "rounded-2xl border border-amber-500/60 bg-amber-50/60 p-3",
      "rounded-xl border border-border/70 bg-background p-3",
      "rounded-xl border border-amber-500/40 bg-background/90 p-3",
    ]) {
      expect(profileSource).not.toContain(nestedPanelClass);
    }
    for (const nestedBorderClass of [
      "border-t border-border/60",
      "divide-y divide-border/60",
      "rounded-xl border border-destructive/40 bg-destructive/5 p-3",
      "rounded-md border border-amber-500/40 bg-amber-50/60 p-3",
      "border border-transparent md:mt-auto",
    ]) {
      expect(profileSource).not.toContain(nestedBorderClass);
    }
    expect(profileSource).not.toContain(
      'data-mypage-password-guidance="true"',
    );
    expect(profileSource).not.toContain("안전한 비밀번호 기준");
    expect(profileSource).not.toContain("bg-amber-600 text-white");
    expect(profileSource).toContain("space-y-1 pt-2");
    expect(profileSource).toContain('text-2xs font-semibold text-amber-600');
    for (const tonalPanelClass of [
      "rounded-2xl bg-muted/40 px-3 py-2.5",
      "rounded-xl bg-muted/40 px-2.5 py-1.5",
      "hidden rounded-2xl bg-muted/40 px-3 py-3 md:block",
      "rounded-xl bg-background px-2 py-2",
      "flex min-h-24 flex-col justify-between",
      "rounded-2xl bg-amber-50/70 p-3",
      "rounded-2xl bg-muted/40 p-3",
    ]) {
      expect(profileSource).not.toContain(tonalPanelClass);
    }
    expect(profileSource).toContain("data-mypage-action-group={section.id}");
    expect(profileSource).not.toContain("바로 할 수 있는 일");
    expect(profileSource).not.toContain(
      "grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2",
    );
    expect(profileSource).not.toContain("data-mypage-primary-action");
    expect(profileSource).not.toContain("lg:min-h-8 lg:rounded-xl");
    expect(profileSource).toContain('data-mypage-next-actions="true"');
    expect(profileSource).not.toContain('data-mypage-session-card="true"');
    expect(profileSource).not.toContain("MOBILE_SECONDARY_ACTIONS");
    expect(profileSource).not.toContain(
      'data-mypage-mobile-secondary-actions="true"',
    );
    expect(profileSource).not.toContain(
      "const PRIMARY_QUICK_ACTION_HREFS = new Set",
    );
    expect(profileSource).not.toContain("프로필 완성도");
    expect(profileSource).not.toContain("다음 추천");
    expect(profileSource).not.toContain("지도 환경설정");
    expect(profileSource).toContain("const activityActions = [");
    expect(profileSource).toContain("const reportActions = [");
    expect(profileSource).toContain('title: "수정 요청"');
    expect(profileSource).toContain('title: "쯔양 제보"');
    expect(
      profileSource.match(/href: "\/mypage\/submissions\/edit"/g)?.length ??
        0,
    ).toBe(1);
    expect(
      profileSource.match(/href: "\/mypage\/submissions\/recommend"/g)
        ?.length ?? 0,
    ).toBe(1);
    expect(profileSource).not.toContain('title: "맛집 수정 요청"');
    expect(profileSource).not.toContain('title: "쯔양 맛집 제보"');
    expect(profileSource).toContain("내 활동");
    expect(profileSource).toContain("제보하기");
    expect(
      profileSource.match(/data-mypage-session-card="true"/g)?.length ?? 0,
    ).toBe(0);
    expect(profileSource).toContain("{user.email}");
    expect(profileSource).not.toContain("가입일 {joinedDateLabel}");
    expect(profileSource).not.toContain("const joinedDateLabel");
  });

  test("profile dashboard keeps exactly one border around the whole surface", () => {
    const profileSource = source("app/mypage/profile/page.tsx");

    expect(profileSource).toContain(
      'className="grid min-w-0 gap-3 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm sm:gap-4 sm:p-4 md:rounded-3xl lg:grid-cols-2 lg:auto-rows-auto lg:content-stretch lg:items-stretch lg:gap-3 2xl:grid-cols-3"',
    );
    expect(profileSource).toContain('data-mypage-profile-page="true"');

    // The old per-section frame drew a second border inside the page frame.
    expect(profileSource).not.toContain("md:bg-background/85");
    expect(profileSource).not.toContain("md:backdrop-blur-sm");
    expect(profileSource).not.toContain("md:border md:border-border/70");
    expect(profileSource).not.toContain('className="min-w-0 border-border/70');

    // The five inner sections are toned panels; the mobile hero stays flat.
    expect(profileSource.match(/rounded-2xl border-0/g)?.length ?? 0).toBe(5);
    expect(profileSource.match(/shadow-none/g)?.length ?? 0).toBe(6);

    // The duplicate card title repeated the two consent group headings.
    expect(profileSource).not.toContain("선택 마케팅 수신 설정</CardTitle>");
    expect(profileSource).toContain('aria-label="선택 마케팅 수신 설정"');
    expect(profileSource).toContain('data-privacy-consent-group="ordinary"');
    expect(profileSource).toContain('data-privacy-consent-group="night"');
  });

  test("mobile loading keeps static mypage chrome and uses borderless dynamic skeletons", () => {
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");
    const routeLoadingSource = source("app/mypage/loading.tsx");
    const sectionSkeletonSource = source(
      "components/mypage/MyPageSectionSkeleton.tsx",
    );

    expect(layoutSource).toContain('data-mypage-mobile-route-header="true"');
    expect(layoutSource).toContain(
      'data-mypage-content-loading-behavior="static-shell-dynamic-skeleton"',
    );
    expect(layoutSource).toContain(
      'data-mypage-content-hero-skeleton="borderless-mobile"',
    );
    expect(layoutSource).toContain(
      "space-y-5 md:rounded-3xl md:border md:border-border md:bg-card md:p-5",
    );
    expect(layoutSource).not.toContain(
      "rounded-3xl border border-border bg-card p-4",
    );
    expect(layoutSource).toContain("STAT_SKELETON_WIDTHS.map");
    expect(layoutSource).toContain("ACTION_SKELETON_WIDTHS.map");
    expect(routeLoadingSource).toContain("return null;");
    expect(routeLoadingSource).not.toContain("animate-pulse");
    expect(sectionSkeletonSource).toContain(
      'data-mypage-section-skeleton-card="borderless-mobile"',
    );
    expect(sectionSkeletonSource).not.toContain(
      "rounded-2xl border border-border bg-card p-4",
    );
  });

  test("mypage sections share a calm responsive frame across desktop and mobile", () => {
    const sectionFrameSource = source(
      "components/mypage/MyPageSectionFrame.tsx",
    );
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");
    const newSubmissionsSource = source("app/mypage/submissions/new/page.tsx");
    const editSubmissionsSource = source(
      "app/mypage/submissions/edit/page.tsx",
    );
    const recommendSubmissionsSource = source(
      "app/mypage/submissions/recommend/page.tsx",
    );
    const sectionSources = [
      bookmarksSource,
      reviewsSource,
      newSubmissionsSource,
      editSubmissionsSource,
      recommendSubmissionsSource,
    ];

    expect(sectionFrameSource).toContain("data-mypage-section-hero");
    expect(sectionFrameSource).toContain('data-mypage-section-hero="quiet"');
    expect(sectionFrameSource).toContain(
      "hidden rounded-3xl border border-border/80 bg-card/95 p-5 shadow-sm md:block",
    );
    expect(sectionFrameSource).toContain(
      "hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex",
    );
    expect(sectionFrameSource).toContain(
      "mt-1 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block",
    );
    expect(sectionFrameSource).toContain(
      "data-mypage-section-mobile-controls",
    );
    expect(sectionFrameSource).not.toContain(
      "rounded-3xl border border-border/80 bg-card/95 p-4 shadow-sm sm:p-5",
    );
    expect(sectionFrameSource).not.toContain("animate-pulse");
    expect(sectionFrameSource).not.toContain("bg-gradient");
    expect(sectionFrameSource).not.toContain("shadow-2xl");
    expect(sectionFrameSource).toContain("myPageListCardClass");
    expect(sectionFrameSource).toContain("myPageResponsiveListClass");
    expect(sectionFrameSource).toContain("myPageCardTitleClass");
    expect(sectionFrameSource).toContain("myPageInfoPanelClass");
    expect(sectionFrameSource).toContain("myPageItemGroupClass");
    expect(sectionFrameSource).toContain("myPageFooterMetaClass");
    expect(sectionFrameSource).toContain("myPageInlineLinkClass");
    expect(sectionFrameSource).toContain("MyPageEmptyState");
    expect(sectionFrameSource).toContain("MyPageErrorState");
    expect(sectionFrameSource).not.toContain("myPageSoftPanelClass");
    expect(sectionFrameSource).not.toContain("myPageNestedCardClass");
    for (const nestedItemPanelClass of [
      "rounded-xl border border-border/70 bg-background/70 p-3",
      "border border-border/70 bg-background/70",
    ]) {
      expect(sectionFrameSource).not.toContain(nestedItemPanelClass);
    }

    for (const sectionSource of sectionSources) {
      expect(sectionSource).toContain("<MyPageSectionFrame");
      expect(sectionSource).toContain("<MyPageEmptyState");
      expect(sectionSource).toContain("<MyPageErrorState");
      expect(sectionSource).toContain("myPageListCardClass");
      expect(sectionSource).toMatch(/myPageResponsive(?:Media)?ListClass/);
      expect(sectionSource).toContain("myPageCardTitleClass");
      expect(sectionSource).toContain("data-mypage-responsive-list");
      expect(sectionSource).not.toContain('className="space-y-6"');
      expect(sectionSource).not.toContain('className="text-lg"');
      expect(sectionSource).not.toContain("더 불러오는 중...");
      expect(sectionSource).not.toContain("bg-gradient");
      expect(sectionSource).not.toContain("shadow-2xl");
      expect(sectionSource).not.toContain("myPageNestedCardClass");
      expect(sectionSource).not.toContain(
        "border border-border/70 bg-background/70",
      );
    }
  });

  test("profile photo controls are compact and not duplicated as a large mobile identity card", () => {
    const profileSource = source("app/mypage/profile/page.tsx").replace(/\r\n/g, "\n");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");

    expect(profileSource).not.toContain(
      'data-mypage-profile-photo-controls="true"',
    );
    expect(profileSource).not.toContain('id="profile-avatar-upload"');
    expect(profileSource).toContain(
      'data-mypage-mobile-avatar-controls="true"',
    );
    expect(profileSource).toContain('id="mypage-mobile-avatar-upload"');
    expect(profileSource).toContain('accept="image/*"');
    expect(profileSource).toContain("handleMobileAvatarUpload");
    expect(profileSource).toContain("handleMobileAvatarDelete");
    expect(profileSource).toContain('aria-label="프로필 사진 변경"');
    expect(profileSource).toContain('aria-label="프로필 사진 삭제"');
    expect(profileSource).toContain("md:pointer-events-none");
    expect(profileSource).toContain("md:hidden");
    expect(profileSource).toContain('await import("@/lib/image-utils")');
    expect(sidebarSource).toContain('id="mypage-sidebar-avatar-upload"');
    expect(sidebarSource).toContain('sizes="80px"');
    expect(sidebarSource).toContain("h-20 w-20");
    expect(profileSource).toContain('sizes="96px"');
    expect(profileSource).toContain("h-24 w-24");
    expect(profileSource).not.toContain("이미지 클릭하여 변경");
  });

  test("mobile icon-only mypage actions have labels and touch-sized targets", () => {
    const profileSource = source("app/mypage/profile/page.tsx").replace(/\r\n/g, "\n");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(sidebarSource).toContain('aria-label="프로필 사진 삭제"');
    expect(sidebarSource).toContain("rounded-full bg-destructive");
    expect(profileSource).toContain("min-h-14 min-w-0 touch-manipulation");
    expect(profileSource).toContain('data-mypage-danger-zone="true"');
    expect(profileSource).toContain(
      'data-mypage-danger-zone-layout="matrix-bottom-right"',
    );
    expect(profileSource).toContain(
      'className="min-w-0 rounded-2xl border-0 bg-muted/35 shadow-none md:order-4 md:flex md:flex-col lg:col-start-2 lg:row-start-2 lg:h-full lg:min-h-0 lg:overflow-hidden"',
    );
    expect(profileSource).not.toContain("계정 위험 작업");
    expect(profileSource).not.toContain(
      "자주 쓰지 않는 작업은 한곳에 모았습니다.",
    );
    expect(profileSource).toContain(
      'className="min-h-0 p-3 md:flex md:flex-1 md:flex-col lg:p-3"',
    );
    expect(profileSource).toContain(
      'className="group p-1 md:flex md:flex-1 md:flex-col lg:p-0"',
    );
    expect(profileSource).not.toContain(
      'className="group rounded-2xl border border-border/70 bg-background p-3 md:flex md:flex-1 md:flex-col lg:p-2.5"',
    );
    expect(profileSource).toContain("<details\n              open");
    expect(profileSource).toContain("계정 삭제 옵션 보기");
    expect(profileSource).toContain('className="mt-3 grid gap-2 md:flex-1"');
    expect(profileSource).not.toContain(
      'data-mypage-danger-zone-impact-grid="true"',
    );
    expect(profileSource).not.toContain("재로그인 복구");
    expect(profileSource).not.toContain("리뷰 표시");
    expect(profileSource).not.toContain(
      'className="mt-3 grid gap-2 sm:grid-cols-2"',
    );
    expect(profileSource).not.toContain('aria-label="계정 비활성화 확인 이메일"');
    expect(profileSource).toContain('aria-label="계정 삭제 확인 문구"');
    expect(profileSource).toContain('ACCOUNT_DELETION_CONFIRMATION_TEXT');
    expect(profileSource).not.toContain('aria-label="계정 영구 삭제 확인 이메일"');
    expect(profileSource).toContain('autoComplete="current-password"');
    expect(profileSource).toContain('autoComplete="new-password"');
    expect(profileSource).toContain("onSubmit={handlePasswordChange}");
    expect(profileSource).toContain('type="submit"');
    expect(profileSource).not.toContain("onClick={handlePasswordChange}");
    expect(profileSource).toContain("현재 비밀번호 숨기기");
    expect(profileSource).toContain("현재 비밀번호 보기");
    expect(profileSource).toContain("새 비밀번호 숨기기");
    expect(profileSource).toContain("새 비밀번호 보기");
    expect(profileSource).toContain("새 비밀번호 확인 숨기기");
    expect(profileSource).toContain("새 비밀번호 확인 보기");
    expect(bookmarksSource).toContain(
      "aria-label={`${bookmark.restaurant.name} 북마크 삭제`}",
    );
    expect(bookmarksSource).toContain(
      "h-11 w-11 shrink-0 touch-manipulation text-muted-foreground hover:text-destructive",
    );
    expect(reviewsSource).toContain(
      "aria-label={`${review.restaurantName} 리뷰 수정`}",
    );
    expect(reviewsSource).toContain('aria-label="리뷰 상태 필터"');
    expect(reviewsSource).toContain(
      "h-9 w-[104px] rounded-full border-0 bg-transparent px-2 text-xs shadow-none md:h-10 md:w-[140px] md:border md:bg-background md:px-3 md:text-sm",
    );
    expect(reviewsSource).toContain(
      "aria-label={`${review.restaurantName} 리뷰 삭제 확인 열기`}",
    );
    expect(reviewsSource).toContain(
      "h-11 w-11 touch-manipulation text-muted-foreground hover:text-foreground",
    );
    expect(reviewsSource).toContain(
      "h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive",
    );
  });

  test("mypage list cards avoid cramped md columns and clipped card content", () => {
    const sectionFrameSource = source("components/mypage/MyPageSectionFrame.tsx");
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    // md columns stay single-track: the sidebar leaves ~465px there, so a
    // two-up grid produced ~227px cards that clipped their own header rows.
    expect(sectionFrameSource).toContain(
      '"grid gap-3 lg:grid-cols-2 2xl:grid-cols-3"',
    );
    // A card that pairs a 128px thumbnail with text needs a wider track: at lg
    // the text column fell to ~180px and ellipsized the title and address, so
    // the media list waits for xl and never adds a third track.
    expect(sectionFrameSource).toContain('"grid gap-3 xl:grid-cols-2"');
    expect(sectionFrameSource).not.toContain("md:grid-cols-2");

    // Load-more rows must span the same track count as the list grid.
    expect(bookmarksSource).toContain("myPageResponsiveMediaListClass");
    expect(bookmarksSource).toContain("xl:col-span-2");
    expect(bookmarksSource).not.toContain("2xl:col-span-3");
    expect(reviewsSource).toContain("myPageResponsiveListClass");
    expect(reviewsSource).toContain("lg:col-span-2 2xl:col-span-3");
    for (const submissionsPath of [
      "app/mypage/submissions/new/page.tsx",
      "app/mypage/submissions/edit/page.tsx",
      "app/mypage/submissions/recommend/page.tsx",
    ]) {
      // md:col-span-* inside a grid without explicit md columns created two
      // implicit tracks, halving every submission card on tablet.
      const submissionsSource = source(submissionsPath);
      expect(submissionsSource).toContain("lg:col-span-2 2xl:col-span-3");
      expect(submissionsSource).not.toContain("md:col-span-2");
    }

    // Cards that mix a thumbnail with text must let the text column shrink
    // and keep the action button fixed instead of overflowing the card.
    expect(bookmarksSource).toContain(
      '<div className="flex min-w-0 flex-col gap-3 sm:flex-row md:gap-4">',
    );
    expect(bookmarksSource).toContain(
      '<div className="relative aspect-video w-full shrink-0 overflow-hidden rounded bg-muted sm:w-32">',
    );
    expect(bookmarksSource).toContain('<div className="min-w-0 flex-1">');
    expect(bookmarksSource).toContain(
      'sizes="(max-width: 640px) 100vw, 128px"',
    );
    expect(reviewsSource).toContain('<div className="min-w-0 flex-1">');
    expect(reviewsSource).toContain('<div className="flex shrink-0 gap-1">');
  });

  test("mypage desktop cards fill stretched rows and keep touch targets", () => {
    const sectionFrameSource = source("components/mypage/MyPageSectionFrame.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const profileSource = source("app/mypage/profile/page.tsx");

    // The lg matrix stretches the tier card to the password card's height
    // (306px) while its own content is ~180px, which left ~139px of empty
    // panel below the metrics. The progress block grows into that space.
    expect(profileSource).toContain(
      'className="space-y-2 lg:flex lg:flex-1 lg:flex-col lg:justify-center"',
    );
    expect(profileSource).toContain(
      'className="hidden h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:flex md:flex-col md:gap-3',
    );

    // Inline video links measured 68x20, under the 24px target floor. The
    // shared class grows the hit box to 32px and pulls the row back with
    // -my-1 so the metadata line keeps its original rhythm.
    expect(sectionFrameSource).toContain(
      '"inline-flex -my-1 min-h-8 min-w-0 items-center gap-1 truncate py-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"',
    );

    // The sidebar nickname edit control was the smallest button on desktop at
    // 35x28; it now matches the 32px touch rhythm used elsewhere.
    expect(sidebarSource).toContain(
      'className="h-8 rounded-full px-2.5 text-2xs text-muted-foreground"',
    );
    expect(sidebarSource).not.toContain(
      'className="h-7 rounded-full px-2 text-2xs text-muted-foreground"',
    );
  });
});
