import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

// The single page-level surface class string, used to guard against
// viewport-clamped rows that previously clipped the password form.
const profilePageSurfaceClass = (profileSource: string) =>
  profileSource.match(/className="([^"]*)"\s+data-mypage-profile-page="true"/)?.[0] ??
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

  test("profile keeps identity and form ownership while activity precedes grouped settings", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");

    expect(layoutSource).toContain('data-mypage-mobile-route-header="true"');
    expect(profileSource).toContain('data-mypage-profile-hero="mobile-only"');
    expect(profileSource).toContain('data-mypage-mobile-nickname-controls="true"');
    expect(profileSource).toContain('data-mypage-mobile-avatar-controls="true"');
    expect(sidebarSource).toContain('data-mypage-sidebar-nickname-controls="true"');
    expect(sidebarSource).toContain('aria-current={isActive ? "page" : undefined}');
    expect(profileSource).toContain("handleMobileNicknameChange");
    expect(profileSource).toContain("handleMobileAvatarUpload");
    expect(profileSource).toContain("handleMobileAvatarDelete");
    expect(profileSource).not.toContain("user.user_metadata?.full_name");
    expect(profilePageSurfaceClass(profileSource)).not.toContain("h-full");
    expect(profilePageSurfaceClass(profileSource)).not.toContain("grid-rows-");
    expect(profileSource).not.toContain("lg:max-h-[calc(100dvh-6.25rem)]");
    expect(profileSource.indexOf('data-mypage-next-actions="true"'))
      .toBeLessThan(profileSource.indexOf('aria-labelledby="account-settings-title"'));
    expect(profileSource).toContain('data-privacy-consent-group="ordinary"');
    expect(profileSource).toContain('data-privacy-consent-group="night"');
    for (const route of ["new", "edit", "recommend"]) {
      expect(profileSource.match(new RegExp(`href: "/mypage/submissions/${route}"`, "g"))?.length).toBe(1);
    }
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
    expect(layoutSource).toContain("<LoadingSurface");
    expect(layoutSource).not.toContain("STAT_SKELETON_WIDTHS");
    expect(layoutSource).toContain("grid gap-2 sm:grid-cols-3");
    expect(layoutSource).not.toContain("ACTION_SKELETON_WIDTHS");
    expect(layoutSource).toContain("grid gap-2 sm:grid-cols-2");
    expect(layoutSource).toContain('data-mypage-content-actions-skeleton="true"');
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
      "hidden border-b border-border pb-4 md:block",
    );
    expect(sectionFrameSource).toContain(
      "hidden h-11 w-11 shrink-0 items-center justify-center text-muted-foreground sm:flex",
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
    expect(profileSource).toContain('sizes="64px"');
    expect(profileSource).toContain("h-16 w-16");
    expect(profileSource).not.toContain("이미지 클릭하여 변경");
  });

  test("mobile icon-only mypage actions have labels and touch-sized targets", () => {
    const profileSource = source("app/mypage/profile/page.tsx").replace(/\r\n/g, "\n");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(sidebarSource).toContain('aria-label="프로필 사진 삭제"');
    expect(profileSource).toContain("min-h-12 min-w-0 touch-manipulation");
    expect(profileSource).toContain('data-mypage-danger-zone="true"');
    expect(profileSource).toContain(
      'data-mypage-danger-zone-layout="settings-end"',
    );
    expect(profileSource).not.toContain("계정 위험 작업");
    expect(profileSource).not.toContain(
      "자주 쓰지 않는 작업은 한곳에 모았습니다.",
    );
    expect(profileSource).not.toContain(
      'className="group rounded-2xl border border-border/70 bg-background p-3 md:flex md:flex-1 md:flex-col lg:p-2.5"',
    );
    expect(profileSource).not.toContain("<details\n              open");
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

  test("mypage desktop cards keep content height and touch targets", () => {
    const sectionFrameSource = source("components/mypage/MyPageSectionFrame.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const profileSource = source("app/mypage/profile/page.tsx");

    // The tier dashboard follows its content height while the shared actions
    // retain their measured touch-target floor.
    expect(profileSource).toContain(
      'className="space-y-2"',
    );
    expect(profileSource).toContain(
      'className="hidden space-y-4 p-4 md:block',
    );

    // Keep the 44px target on the shared map/video link, without negative
    // margins that could overlap the following metadata row.
    expect(sectionFrameSource).toContain(
      '"inline-flex min-h-11 min-w-0 items-center gap-2 rounded-sm py-2',
    );

    // Nickname editing remains reachable with a 44px target on desktop.
    expect(sidebarSource).toContain(
      'className="h-11 min-w-11 rounded-lg px-2 text-xs text-muted-foreground"',
    );
    expect(sidebarSource).not.toContain(
      'className="h-7 rounded-full px-2 text-2xs text-muted-foreground"',
    );
  });
});
