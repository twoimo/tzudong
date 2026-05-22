import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("mypage mobile cleanup source contracts", () => {
  test("layout keeps one shared return control without mobile duplicate chrome", () => {
    const layoutSource = source("app/mypage/mypage-layout-content.tsx");
    const returnButtonSource = source("components/layout/ReturnToMapButton.tsx");

    expect(layoutSource.match(/<ReturnToMapButton/g)?.length ?? 0).toBe(1);
    expect(layoutSource.match(/data-mypage-return-slot="true"/g)?.length ?? 0).toBe(1);
    expect(layoutSource).not.toContain("data-mypage-mobile-return-slot");
    expect(layoutSource).not.toContain("data-mypage-mobile-return-skeleton");
    expect(returnButtonSource).toContain("touch-manipulation");
    expect(returnButtonSource).toContain('iconOnly ? "h-11 w-11" : "min-h-11 px-3 text-xs font-semibold"');
  });

  test("profile page folds mobile-only duplicate action cards into the main action menu", () => {
    const profileSource = source("app/mypage/profile/page.tsx");

    expect(profileSource).toContain('data-mypage-profile-hero="true"');
    expect(profileSource).toContain('data-mypage-next-actions="true"');
    expect(profileSource).toContain('data-mypage-session-card="true"');
    expect(profileSource).not.toContain("MOBILE_SECONDARY_ACTIONS");
    expect(profileSource).not.toContain('data-mypage-mobile-secondary-actions="true"');
    expect(profileSource).toContain('title: "수정 요청"');
    expect(profileSource).toContain('title: "쯔양 제보"');
    expect(profileSource).toContain("자주 쓰는 메뉴");
    expect(profileSource).toContain("const PRIMARY_QUICK_ACTION_HREFS = new Set");
    expect(profileSource).toContain('data-mypage-primary-action={isPrimaryAction ? "true" : "false"}');
    expect(profileSource).toContain("desktopAccent: \"md:bg-primary/10 md:text-primary\"");
    expect(profileSource.match(/data-mypage-session-card="true"/g)?.length ?? 0).toBe(1);
    expect(profileSource).toContain('<span className="md:hidden">가입일 {joinedDateLabel}</span>');
    expect(profileSource).toContain('<span className="hidden md:inline">{user.email} · 가입일 {joinedDateLabel}</span>');
  });

  test("profile photo controls are compact and not duplicated as a large mobile identity card", () => {
    const profileSource = source("app/mypage/profile/page.tsx");

    expect(profileSource).toContain('data-mypage-profile-photo-controls="true"');
    expect(profileSource).toContain('sizes="56px"');
    expect(profileSource).toContain("h-14 w-14");
    expect(profileSource).not.toContain('sizes="96px"');
    expect(profileSource).not.toContain("h-24 w-24");
    expect(profileSource).not.toContain("이미지 클릭하여 변경");
  });

  test("mobile icon-only mypage actions have labels and touch-sized targets", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
    const bookmarksSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(profileSource).toContain('aria-label="프로필 사진 삭제"');
    expect(profileSource).toContain("h-11 w-11 shrink-0 touch-manipulation");
    expect(profileSource).toContain('aria-label={showCurrentPassword ? "현재 비밀번호 숨기기" : "현재 비밀번호 보기"}');
    expect(profileSource).toContain('aria-label={showNewPassword ? "새 비밀번호 숨기기" : "새 비밀번호 보기"}');
    expect(profileSource).toContain('aria-label={showConfirmPassword ? "새 비밀번호 확인 숨기기" : "새 비밀번호 확인 보기"}');
    expect(bookmarksSource).toContain('aria-label={`${bookmark.restaurant.name} 북마크 삭제`}');
    expect(bookmarksSource).toContain("h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive");
    expect(reviewsSource).toContain('aria-label={`${review.restaurantName} 리뷰 수정`}');
    expect(reviewsSource).toContain('aria-label={`${review.restaurantName} 리뷰 삭제 확인 열기`}');
    expect(reviewsSource).toContain("h-11 w-11 touch-manipulation text-muted-foreground hover:text-foreground");
    expect(reviewsSource).toContain("h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive");
  });
});
