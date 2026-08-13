import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
const repoSource = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", "..", "..", relativePath), "utf8");

describe("mypage CRUD QA/QC source contracts", () => {
  test("profile update flows guard nickname, avatar, and password mutations by the signed-in user", () => {
    const profileSource = source("app/mypage/profile/page.tsx");
    const sidebarSource = source("components/mypage/MyPageSidebar.tsx");

    for (const currentSource of [profileSource, sidebarSource]) {
      expect(currentSource).not.toContain('.from("profiles"');
      expect(currentSource).toContain('updateCurrentProfileNickname(');
      expect(currentSource).toContain("nextNickname.length < 2");
      expect(currentSource).toContain("nextNickname.length > 20");
      expect(currentSource).toContain("uploadCurrentProfileAvatar(");
      expect(currentSource).toContain("clearCurrentProfileAvatar(");
      expect(currentSource).not.toContain("upsert: true");
      expect(currentSource).not.toContain("update({ avatar_url:");
      expect(currentSource).toContain(
        'import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";',
      );
      expect(currentSource).toContain(
        "await invalidateProfileDisplayQueries(queryClient, user.id)",
      );
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
    const requestIdempotencyMigrationSource = source(
      "supabase/migrations/20260702000200_restaurant_request_client_idempotency.sql",
    );

    const submitRouteSource = source("app/api/mypage/submissions/submit/route.ts");

    expect(newSubmissionModalSource).toContain("fetch('/api/mypage/submissions/submit'");
    expect(newSubmissionModalSource).toContain("postRestaurantSubmission('new', data)");
    expect(newSubmissionModalSource).toContain("postRestaurantSubmission('request', data)");
    expect(newSubmissionModalSource).toContain("getRestaurantSubmissionClientKey");
    expect(newSubmissionModalSource).toContain("requestSubmitInFlightRef");
    expect(newSubmissionModalSource).toContain("admin-restaurant-requests-inline");
    expect(newSubmissionModalSource).toContain("queryKey: ['myRecommendRequests', user?.id]");
    expect(submitRouteSource).toContain("await supabase.auth.getUser()");
    expect(submitRouteSource).toContain('mode === "new"');
    expect(submitRouteSource).toContain("return await submitRequest(expected, user.id, clientRequestKey)");
    expect(submitRouteSource).toContain('rpc("submit_restaurant_submission"');
    expect(submitRouteSource).toContain('p_submission_type: "new"');
    expect(submitRouteSource).toContain('p_client_submission_key: clientRequestKey');
    expect(submitRouteSource).toContain('.from("restaurant_requests")');
    expect(submitRouteSource).toContain("recommendation_reason");
    expect(submitRouteSource).toContain("client_request_key: clientRequestKey");
    expect(submitRouteSource).toContain("readBackRequest");
    expect(submitRouteSource).toContain("restaurantSubmissionRequestReadbackMatches");
    expect(submitRouteSource).toContain("제보 저장 확인에 실패했습니다. 다시 시도해주세요.");
    expect(submitRouteSource).toContain("맛집 추천 저장 확인에 실패했습니다. 다시 시도해주세요.");
    expect(requestIdempotencyMigrationSource).toContain("add column if not exists client_request_key text");
    expect(requestIdempotencyMigrationSource).toContain("restaurant_requests_user_client_request_key_idx");
    expect(requestIdempotencyMigrationSource).toContain("where client_request_key is not null");

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
    const newSubmissionModalSource = source(
      "components/modals/RestaurantSubmissionModal.tsx",
    );
    const recommendSubmissionsSource = source(
      "app/mypage/submissions/recommend/page.tsx",
    );
    const lifecycleMigrationSource = source(
      "supabase/migrations/20260702000100_restaurant_request_review_lifecycle.sql",
    );


    expect(deleteRouteSource).toContain("await supabase.auth.getUser()");
    expect(deleteRouteSource).toContain('type === "recommend"');
    expect(deleteRouteSource).toContain('.from("restaurant_requests")');
    expect(deleteRouteSource).toContain('.from("restaurant_submissions")');
    expect(deleteRouteSource).toContain("delete_pending_restaurant_submission");
    expect(deleteRouteSource.match(/\.eq\("user_id", user\.id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(deleteRouteSource).toContain('select("id,user_id,status")');
    expect(deleteRouteSource).toContain('select("id,user_id,submission_type,status")');
    expect(deleteRouteSource).toContain('.eq("status", "pending")');
    expect(deleteRouteSource).toContain('submissionRow.status !== "pending"');
    expect(deleteRouteSource).toContain("deletedRequestRow");
    expect(deleteRouteSource).toContain("deletionResult");
    expect(deleteRouteSource).toContain("이미 검토가 완료된 쯔양 맛집 제보는 삭제할 수 없습니다.");
    expect(deleteRouteSource).toContain("이미 검토가 완료된 제보 내역은 삭제할 수 없습니다.");
    expect(deleteRouteSource).toContain('.eq("submission_type", type)');
    expect(deleteRouteSource).toContain("p_user_id: user.id");
    expect(lifecycleMigrationSource).toContain("create or replace function public.delete_pending_restaurant_submission");
    expect(lifecycleMigrationSource).toContain("from public.restaurant_submissions");
    expect(lifecycleMigrationSource).toContain("for update");
    expect(lifecycleMigrationSource).toContain("delete from public.restaurant_submission_items");
    expect(lifecycleMigrationSource).toContain("and restaurant_submissions.status = 'pending'");
    expect(lifecycleMigrationSource).toContain("revoke all on function public.delete_pending_restaurant_submission");
    expect(lifecycleMigrationSource).toContain("to service_role");

    expect(newSubmissionModalSource).toContain('<dt className="w-16 shrink-0 text-muted-foreground">전화</dt>');
    expect(newSubmissionsSource).toContain("submission.restaurant_phone");
    expect(editSubmissionsSource).toContain("submission.restaurant_phone");
    expect(recommendSubmissionsSource).toContain("request.phone");
    expect(recommendSubmissionsSource).toContain("RESTAURANT_REQUEST_SELECT");
    expect(recommendSubmissionsSource).toContain('"phone"');
    expect(recommendSubmissionsSource).toContain('request.phone || "전화번호 없음"');

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

  test("permanent account delete uses a bearer-bound one-time proof and preserves the durable worker/readback boundary", () => {
    const accountDeleteRouteSource = source("app/api/account/delete/route.ts");
    const profilePageSource = source("app/mypage/profile/page.tsx");
    const applyRequestParser = accountDeleteRouteSource.slice(
      accountDeleteRouteSource.indexOf("const parseAccountDeletionApplyRequest"),
      accountDeleteRouteSource.indexOf("export const runtime"),
    );
    const deleteHandler = accountDeleteRouteSource.slice(
      accountDeleteRouteSource.indexOf("const deleteAccount"),
      accountDeleteRouteSource.indexOf("export async function POST"),
    );
    const sameOrigin = deleteHandler.indexOf("if (!isTrustedSameOriginMutation(request))");
    const parse = deleteHandler.indexOf("const body = parseAccountDeletionApplyRequest(await request.json().catch(() => null));");
    const bearer = deleteHandler.indexOf("const bearerToken = bearerTokenFromAuthorization");
    const atomicBegin = deleteHandler.indexOf("rpc('begin_account_deletion_apply_with_reauth'");

    expect(sameOrigin).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(sameOrigin);
    expect(bearer).toBeGreaterThan(parse);
    expect(atomicBegin).toBeGreaterThan(bearer);
    expect(applyRequestParser).toContain("Object.keys(value).length !== 7");
    expect(applyRequestParser).toContain("hasOnlyKeys(value, [");
    expect(accountDeleteRouteSource).toContain("begin_account_deletion_apply_with_reauth");
    expect(accountDeleteRouteSource).toContain("p_proof_id: body.proofId");
    expect(accountDeleteRouteSource).toContain("p_actor_user_id: user.id");
    expect(accountDeleteRouteSource).toContain("p_target_user_id: body.userId");
    expect(accountDeleteRouteSource).not.toContain("consume_account_deletion_reauth_proof");
    expect(deleteHandler).toContain("supabaseAdmin.auth.getUser(bearerToken)");
    expect(deleteHandler).toContain("supabaseAdmin.auth.getClaims(bearerToken)");
    expect(deleteHandler).toContain("claims?.claims.sub !== user.id");
    expect(deleteHandler).toContain("if (body.userId !== user.id)");
    expect(deleteHandler).toContain("const reasonCode = rpcFailureReasonCode(result.error)");
    expect(accountDeleteRouteSource).not.toContain("getAuthenticatedActor");
    expect(accountDeleteRouteSource).not.toContain("auth.admin.deleteUser");
    expect(accountDeleteRouteSource).not.toContain("runAccountDeletionExternalWorker");
    expect(accountDeleteRouteSource).toContain("rpc('read_current_account_deletion_status'");
    expect(profilePageSource).toContain("issueAccountDeletionReauthenticationProof(user.id)");
    expect(profilePageSource).toContain("proofId: proof.proofId");
    expect(profilePageSource).toContain("Authorization: `Bearer ${freshSession.bearerToken}`");
    expect(profilePageSource).toContain("Authorization: `Bearer ${deletionSession.bearerToken}`");
    expect(profilePageSource).toContain("pollAccountDeletionReadback(deletionSession.preview");
  });
});
