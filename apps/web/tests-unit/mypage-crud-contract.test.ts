import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("mypage CRUD QA/QC source contracts", () => {
  test("profile update flows guard nickname, avatar, and password mutations by the signed-in user", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");

    for (const currentSource of [profileSource, sidebarSource]) {
      expect(currentSource).toContain('.from("profiles"');
      expect(currentSource).toContain('update({ nickname: nextNickname }');
      expect(currentSource).toContain('.eq("user_id", user.id)');
      expect(currentSource).toContain("nextNickname.length < 2");
      expect(currentSource).toContain("nextNickname.length > 20");
      expect(currentSource).toContain('from("profile-avatars")');
      expect(currentSource).toContain("upsert: true");
      expect(currentSource).toContain("update({ avatar_url:");
      expect(currentSource).toMatch(/queryKey: \["user-profile"(?:, user\.id)?\]/);
      if (currentSource === sidebarSource) {
        expect(currentSource).toContain('queryKey: ["user-profile-identity", user.id]');
      }
    }

    expect(profileSource).toContain("supabase.auth.signInWithPassword");
    expect(profileSource).toContain("password: currentPassword");
    expect(profileSource).toContain("supabase.auth.updateUser");
    expect(profileSource).toContain("password: newPassword");
    expect(profileSource).toContain("newPassword !== confirmPassword");
    expect(profileSource).toContain("newPassword.length < 8");
    expect(profileSource).toContain("newPassword.length > 12");
  });

  test("bookmark and review deletion are owner-scoped and invalidate their read models", () => {
    const bookmarksHookSource = source("hooks/use-bookmarks.tsx");
    const bookmarksPageSource = source("app/mypage/bookmarks/page.tsx");
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(bookmarksHookSource).toContain(".from('user_bookmarks')");
    expect(bookmarksHookSource).toContain(".delete()");
    expect(bookmarksHookSource).toContain(".eq('user_id', user.id)");
    expect(bookmarksHookSource).toContain(".in('restaurant_id', relatedRestaurantIds)");
    expect(bookmarksHookSource).toContain("queryClient.invalidateQueries({ queryKey: ['user-bookmarks'] })");
    expect(bookmarksPageSource).toContain(
      "aria-label={`${bookmark.restaurant.name} 북마크 삭제`}",
    );

    expect(reviewsSource).toContain(
      'const REVIEW_DELETE_CONFIRMATION = "리뷰삭제"',
    );
    expect(reviewsSource).toContain('.from("reviews")');
    expect(reviewsSource).toContain(".delete()");
    expect(reviewsSource).toContain('.eq("id", reviewId)');
    expect(reviewsSource).toContain('.eq("user_id", user.id)');
    expect(reviewsSource).toContain('queryKey: ["user-reviews"]');
    expect(reviewsSource).toContain('aria-label="리뷰 삭제 확인"');
  });

  test("submission create flows insert parent and child rows with rollback on child insert failure", () => {
    const newSubmissionModalSource = source(
      "components/modals/RestaurantSubmissionModal.tsx",
    );
    const editSubmissionModalSource = source(
      "components/modals/EditRestaurantModal.tsx",
    );

    expect(newSubmissionModalSource).toContain(".from('restaurant_submissions')");
    expect(newSubmissionModalSource).toContain("submission_type: 'new'");
    expect(newSubmissionModalSource).toContain(
      ".from('restaurant_submission_items')",
    );
    expect(newSubmissionModalSource).toContain(
      "await supabase.from('restaurant_submissions').delete().eq('id', submissionId)",
    );
    expect(newSubmissionModalSource).toContain(".from('restaurant_requests')");
    expect(newSubmissionModalSource).toContain("recommendation_reason");

    expect(editSubmissionModalSource).toContain(".from('restaurant_submissions')");
    expect(editSubmissionModalSource).toContain("submission_type: 'edit'");
    expect(editSubmissionModalSource).toContain(
      ".from('restaurant_submission_items')",
    );
    expect(editSubmissionModalSource).toContain(
      "await supabase.from('restaurant_submissions').delete().eq('id', submissionId)",
    );
  });

  test("submission history deletion goes through an authenticated owner-checking API route", () => {
    const deleteRouteSource = source("app/api/mypage/submissions/delete/route.ts");
    const newSubmissionsSource = source("app/mypage/submissions/new/page.tsx");
    const editSubmissionsSource = source("app/mypage/submissions/edit/page.tsx");
    const recommendSubmissionsSource = source(
      "app/mypage/submissions/recommend/page.tsx",
    );

    expect(deleteRouteSource).toContain("await supabase.auth.getUser()");
    expect(deleteRouteSource).toContain('type === "recommend"');
    expect(deleteRouteSource).toContain('.from("restaurant_requests")');
    expect(deleteRouteSource).toContain('.from("restaurant_submissions")');
    expect(deleteRouteSource).toContain('.from("restaurant_submission_items")');
    expect(deleteRouteSource.match(/\.eq\("user_id", user\.id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(deleteRouteSource).toContain('.eq("submission_type", type)');

    const pageExpectations = [
      [newSubmissionsSource, "new", "신규 맛집 제보"],
      [editSubmissionsSource, "edit", "맛집 수정 요청"],
      [recommendSubmissionsSource, "recommend", "쯔양 맛집 제보"],
    ] as const;

    for (const [pageSource, type, label] of pageExpectations) {
      expect(pageSource).toContain("내역삭제");
      expect(pageSource).toContain("/api/mypage/submissions/delete");
      expect(pageSource).toContain(`type: "${type}"`);
      expect(pageSource).toContain(`${label} 삭제 확인`);
      expect(pageSource).toContain(`${label} 삭제 확인 문구`);
      expect(pageSource).toContain("deleteConfirmation !==");
      expect(pageSource).toContain("queryClient.invalidateQueries");
    }
  });

  test("permanent account delete cleans the same bookmark table used by the mypage bookmark feature", () => {
    const accountDeleteRouteSource = source("app/api/account/delete/route.ts");

    expect(accountDeleteRouteSource).toContain(".from('user_bookmarks')");
    expect(accountDeleteRouteSource).not.toContain(".from('restaurant_bookmarks')");
    expect(accountDeleteRouteSource).toContain("supabaseAdmin.auth.admin.deleteUser");
    expect(accountDeleteRouteSource).toContain("targetUserId !== user.id");
    expect(accountDeleteRouteSource).toContain("requireAdmin()");
  });
});
