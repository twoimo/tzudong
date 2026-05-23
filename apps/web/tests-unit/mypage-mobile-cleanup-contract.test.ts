import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("mypage mobile cleanup source contracts", () => {
  test("layout fills the viewport without duplicate return chrome", () => {
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");
    const returnButtonSource = source(
      "components/layout/ReturnToMapButton.tsx",
    );
    const topActionsSource = source("components/mypage/MyPageTopActions.tsx");
    const mapUserMenuSource = source("components/home/HomeMapUserMenu.tsx");
    const mapUserButtonClass =
      "h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
    const mapMenuItemClass =
      "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground";
    const mapMenuContentClass =
      "z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-serif shadow-2xl";
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
    expect(topActionsSource).toContain(mapUserButtonClass);
    expect(mapUserMenuSource).toContain(mapMenuItemClass);
    expect(topActionsSource).toContain(mapMenuItemClass);
    expect(mapUserMenuSource).toContain(mapMenuContentClass);
    expect(topActionsSource).toContain(mapMenuContentClass);
    expect(mapUserMenuSource).toContain(mapMenuLabelClass);
    expect(topActionsSource).toContain(mapMenuLabelClass);
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
    const profileSource = source("app/mypage/profile/page.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");

    expect(profileSource).toContain('data-mypage-profile-hero="mobile-only"');
    expect(profileSource).toContain('className="overflow-hidden md:hidden"');
    expect(profileSource).toContain(
      'data-mypage-profile-hero-layout="sidebar-match"',
    );
    expect(profileSource).toContain(
      'data-mypage-profile-identity="sidebar-match"',
    );
    expect(profileSource).toContain(
      "flex flex-col items-center space-y-4 border-b border-border p-6 text-center md:hidden",
    );
    expect(profileSource).not.toContain(
      'data-mypage-profile-hero-layout="standard"',
    );
    expect(profileSource).not.toContain(
      'data-mypage-profile-identity="standard"',
    );
    expect(profileSource).toContain("rounded-full border-2 border-border");
    expect(profileSource).toContain("grid w-full grid-cols-3 gap-2 pt-2");
    expect(profileSource).toContain("useUserProfile");
    expect(profileSource).toContain("userProfile?.tier");
    expect(profileSource).toContain("도장");
    expect(profileSource).toContain("리뷰");
    expect(profileSource).toContain("좋아요");
    expect(profileSource).toContain(
      'data-mypage-profile-session-action="logout"',
    );
    expect(profileSource).not.toContain("마이페이지 허브");
    expect(profileSource).toContain(
      "const { user, signOut, profileNickname } = useAuth();",
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
      'className="h-7 rounded-full px-2 text-[11px] text-muted-foreground"',
    );
    expect(profileSource).toContain('className="w-full space-y-2 md:hidden"');
    expect(profileSource).not.toContain("user.user_metadata?.full_name");
    expect(profileSource).toContain(
      'className="overflow-hidden md:flex md:min-h-0 md:flex-1 md:border-0 md:bg-transparent md:shadow-none"',
    );
    expect(profileSource).toContain('data-mypage-profile-main-column="true"');
    expect(profileSource).toContain('data-mypage-profile-side-column="true"');
    expect(profileSource).toContain(
      'data-mypage-profile-side-layout="right-stack"',
    );
    expect(profileSource).toContain(
      "grid min-w-0 gap-3 sm:gap-5 md:order-2 md:min-h-0 md:content-start lg:gap-3",
    );
    expect(profileSource).toContain(
      'CardTitle className="flex items-center gap-2 text-base"',
    );
    expect(profileSource).not.toContain("lg:text-xs");
    expect(profileSource).not.toContain("lg:text-base");
    expect(profileSource).toContain('data-mypage-profile-density="viewport-fill"');
    expect(profileSource).toContain('data-mypage-profile-viewport-fit="true"');
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
    expect(profileSource).toContain("md:h-full md:min-h-0");
    expect(profileSource).toContain("md:grid-rows-[minmax(0,1fr)_auto]");
    expect(profileSource).not.toContain("lg:max-h-[calc(100dvh-6.25rem)]");
    expect(profileSource).toContain(
      "md:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]",
    );
    expect(profileSource).toContain(
      "lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]",
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
    expect(profileSource).toContain("저장하고 작성한 기록");
    expect(profileSource).toContain("새 맛집과 정보 수정");
    expect(profileSource).toContain('data-mypage-desktop-quick-actions="list"');
    expect(profileSource).toContain(
      "data-mypage-desktop-action-section={section.id}",
    );
    expect(profileSource).toContain('data-mypage-desktop-action-row="true"');
    expect(profileSource).toContain(
      'className="hidden min-h-0 flex-1 space-y-3 rounded-3xl border border-border/70 bg-background/85 p-3 shadow-sm backdrop-blur-sm md:flex md:flex-col"',
    );
    expect(profileSource).toContain("data-mypage-action-group={section.id}");
    expect(profileSource).not.toContain("바로 할 수 있는 일");
    expect(profileSource).not.toContain(
      "grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2",
    );
    expect(profileSource).not.toContain("data-mypage-primary-action");
    expect(profileSource).not.toContain("lg:min-h-8 lg:rounded-xl");
    expect(profileSource).toContain("md:overflow-hidden");
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
    expect(profileSource).toContain('title: "맛집 수정 요청"');
    expect(profileSource).toContain('title: "쯔양 맛집 제보"');
    expect(profileSource).toContain("내 활동");
    expect(profileSource).toContain("제보하기");
    expect(
      profileSource.match(/data-mypage-session-card="true"/g)?.length ?? 0,
    ).toBe(0);
    expect(profileSource).toContain("{user.email}");
    expect(profileSource).not.toContain("가입일 {joinedDateLabel}");
    expect(profileSource).not.toContain("const joinedDateLabel");
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
    expect(sectionFrameSource).toContain("border-border/80 bg-card/95");
    expect(sectionFrameSource).toContain("shadow-sm");
    expect(sectionFrameSource).not.toContain("animate-pulse");
    expect(sectionFrameSource).not.toContain("bg-gradient");
    expect(sectionFrameSource).not.toContain("shadow-2xl");
    expect(sectionFrameSource).toContain("myPageListCardClass");
    expect(sectionFrameSource).toContain("myPageResponsiveListClass");
    expect(sectionFrameSource).toContain("myPageCardTitleClass");
    expect(sectionFrameSource).toContain("myPageInfoPanelClass");
    expect(sectionFrameSource).toContain("myPageFooterMetaClass");
    expect(sectionFrameSource).toContain("myPageInlineLinkClass");
    expect(sectionFrameSource).toContain("MyPageEmptyState");
    expect(sectionFrameSource).toContain("MyPageErrorState");
    expect(sectionFrameSource).not.toContain("myPageSoftPanelClass");

    for (const sectionSource of sectionSources) {
      expect(sectionSource).toContain("<MyPageSectionFrame");
      expect(sectionSource).toContain("<MyPageEmptyState");
      expect(sectionSource).toContain("<MyPageErrorState");
      expect(sectionSource).toContain("myPageListCardClass");
      expect(sectionSource).toContain("myPageResponsiveListClass");
      expect(sectionSource).toContain("myPageCardTitleClass");
      expect(sectionSource).toContain("data-mypage-responsive-list");
      expect(sectionSource).not.toContain('className="space-y-6"');
      expect(sectionSource).not.toContain('className="text-lg"');
      expect(sectionSource).not.toContain("더 불러오는 중...");
      expect(sectionSource).not.toContain("bg-gradient");
      expect(sectionSource).not.toContain("shadow-2xl");
    }
  });

  test("profile photo controls are compact and not duplicated as a large mobile identity card", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
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
    const profileSource = source("app/mypage/profile/page.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(sidebarSource).toContain('aria-label="프로필 사진 삭제"');
    expect(sidebarSource).toContain("rounded-full bg-destructive");
    expect(profileSource).toContain("min-h-14 min-w-0 touch-manipulation");
    expect(profileSource).toContain('data-mypage-danger-zone="true"');
    expect(profileSource).toContain(
      'data-mypage-danger-zone-layout="full-row"',
    );
    expect(profileSource).toContain(
      'className="min-w-0 border-destructive/30 md:order-3 md:col-span-2"',
    );
    expect(profileSource).toContain('className="mt-3 grid gap-2"');
    expect(profileSource).not.toContain(
      'className="mt-3 grid gap-2 sm:grid-cols-2"',
    );
    expect(profileSource).toContain('aria-label="계정 비활성화 확인 이메일"');
    expect(profileSource).toContain('aria-label="계정 영구 삭제 확인 이메일"');
    expect(profileSource).toContain('autoComplete="current-password"');
    expect(profileSource).toContain('autoComplete="new-password"');
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
      "h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive",
    );
    expect(reviewsSource).toContain(
      "aria-label={`${review.restaurantName} 리뷰 수정`}",
    );
    expect(reviewsSource).toContain('aria-label="리뷰 상태 필터"');
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
});
