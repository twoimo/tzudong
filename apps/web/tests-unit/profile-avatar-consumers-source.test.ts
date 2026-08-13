import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const avatarConsumers = [
  {
    name: "home map user menu",
    path: "components/home/HomeMapUserMenu.tsx",
    resolverCall: "resolveProfileAvatarUrl(profile.avatar_url, user.id)",
  },
  {
    name: "my page top actions",
    path: "components/mypage/MyPageTopActions.tsx",
    resolverCall: "resolveProfileAvatarUrl(profile?.avatarUrl, user?.id)",
  },
  {
    name: "user profile panel",
    path: "components/profile/UserProfilePanel.tsx",
    resolverCall: "resolveProfileAvatarUrl(profile?.avatarUrl, profile?.userId)",
  },
] as const;

describe("profile avatar consumer source contract", () => {
  test("all avatar renderers resolve untrusted values through the canonical boundary", () => {
    for (const consumer of avatarConsumers) {
      const consumerSource = source(consumer.path);

      expect(consumerSource, consumer.name).toContain(
        'import { resolveProfileAvatarUrl } from "@/lib/profile-avatar-url";',
      );
      expect(consumerSource, consumer.name).toContain(consumer.resolverCall);
      expect(consumerSource, consumer.name).toContain("src={profileAvatarUrl}");
      expect(
        consumerSource.indexOf(consumer.resolverCall),
        consumer.name,
      ).toBeLessThan(consumerSource.indexOf("src={profileAvatarUrl}"));
    }
  });

  test("no avatar renderer passes a raw database, hook, or prop value to an image source", () => {
    for (const consumer of avatarConsumers) {
      const consumerSource = source(consumer.path);

      expect(consumerSource, consumer.name).not.toContain("src={data?.avatar_url}");
      expect(consumerSource, consumer.name).not.toContain("src={profile?.avatar_url}");
      expect(consumerSource, consumer.name).not.toContain("src={profile.avatarUrl}");
      expect(consumerSource, consumer.name).not.toContain("src={profile?.avatarUrl}");
      expect(consumerSource, consumer.name).not.toContain("avatar_url.trim()");
      expect(consumerSource, consumer.name).not.toContain("avatarUrl.trim()");
    }
  });
});

describe("review card avatar source contract", () => {
  test("binds the review author's avatar to the review author's identity", () => {
    const reviewCardSource = source("components/reviews/ReviewCard.tsx");

    expect(reviewCardSource).toContain(
      "resolveProfileAvatarUrl(review.userAvatarUrl, review.userId)",
    );
    expect(reviewCardSource).toContain("src={profileAvatarUrl}");
    expect(reviewCardSource).not.toContain("src={review.userAvatarUrl}");
  });
});
describe("profile avatar mutation source contract", () => {
  const mutationConsumers = [
    {
      name: "mobile profile",
      path: "app/mypage/profile/page.tsx",
      handlerStart: "const handleMobileAvatarDelete = async () => {",
      handlerEnd: "const handlePasswordChange",
      profileValue: "currentAvatarReference",
    },
    {
      name: "my page sidebar",
      path: "components/mypage/MyPageSidebar.tsx",
      handlerStart: "const handleAvatarDelete = async () => {",
      handlerEnd: "const handleLogout",
      profileValue: "profile.avatarUrl",
    },
  ] as const;

  test("delegates raw-reference CAS and cleanup ordering to the shared saga", () => {
    for (const consumer of mutationConsumers) {
      const consumerSource = source(consumer.path);
      const handlerStart = consumerSource.indexOf(consumer.handlerStart);
      const handlerEnd = consumerSource.indexOf(consumer.handlerEnd, handlerStart);
      const handlerSource = consumerSource.slice(handlerStart, handlerEnd);
      const clearIndex = handlerSource.indexOf("clearCurrentProfileAvatar(");
      const profileValueIndex = handlerSource.indexOf(consumer.profileValue, clearIndex);
      const userIdIndex = handlerSource.indexOf("user.id", clearIndex);
      const successIndex = handlerSource.indexOf('toast.success("프로필 사진이 삭제되었습니다")');
      const catchIndex = handlerSource.indexOf("} catch {");
      const failureIndex = handlerSource.indexOf(
        'toast.error("프로필 사진 삭제에 실패했습니다")',
        catchIndex,
      );

      expect(handlerStart, consumer.name).toBeGreaterThan(-1);
      expect(handlerEnd, consumer.name).toBeGreaterThan(handlerStart);
      expect(clearIndex, consumer.name).toBeGreaterThan(-1);
      expect(userIdIndex, consumer.name).toBeGreaterThan(clearIndex);
      expect(profileValueIndex, consumer.name).toBeGreaterThan(clearIndex);
      expect(successIndex, consumer.name).toBeGreaterThan(profileValueIndex);
      expect(catchIndex, consumer.name).toBeGreaterThan(successIndex);
      expect(failureIndex, consumer.name).toBeGreaterThan(catchIndex);
      expect(handlerSource, consumer.name).not.toContain('.from("profiles")');
      expect(handlerSource, consumer.name).not.toContain('.from("profile-avatars")');
    }
  });

  test("refreshes every raw profile/avatar cache before success or failure releases the UI", () => {
    const cacheBoundary = source("lib/profile-display-cache.ts");
    for (const expectedKey of [
      '["user-profile", userId]',
      '["user-profile-identity", userId]',
      '["home-map-user-menu-avatar", userId]',
      '["review-feed"]',
      '["review-feed-overlay"]',
      '["restaurant-reviews"]',
      '["leaderboard-users"]',
    ]) {
      expect(cacheBoundary).toContain(`queryKey: ${expectedKey}`);
    }

    for (const consumer of mutationConsumers) {
      const consumerSource = source(consumer.path);
      const refreshStart = consumerSource.indexOf("const refreshProfileAvatarQueries = async () => {");
      const uploadStart = consumerSource.indexOf(
        consumer.name === "mobile profile"
          ? "const handleMobileAvatarUpload = async ("
          : "const handleAvatarUpload = async (",
      );
      const deleteStart = consumerSource.indexOf(consumer.handlerStart);
      const handlerEnd = consumerSource.indexOf(consumer.handlerEnd, deleteStart);
      const avatarHandlers = consumerSource.slice(uploadStart, handlerEnd);

      expect(refreshStart, consumer.name).toBeGreaterThan(-1);
      expect(consumerSource, consumer.name).toContain(
        'import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";',
      );
      expect(consumerSource, consumer.name).toContain(
        "await invalidateProfileDisplayQueries(queryClient, user.id)",
      );
      const directRefreshCount = avatarHandlers.match(
        /await refreshProfileAvatarQueries\(\)/g,
      )?.length ?? 0;
      const groupedRefreshCount = avatarHandlers.match(
        /refreshProfileAvatarQueries\(\),/g,
      )?.length ?? 0;
      expect(directRefreshCount + groupedRefreshCount, consumer.name)
        .toBeGreaterThanOrEqual(4);

      if (consumer.name === "mobile profile") {
        expect(consumerSource, consumer.name).toContain(
          "const refreshLocalProfileState = async () => {",
        );
        expect(avatarHandlers.match(/refreshLocalProfileState\(\)/g)?.length, consumer.name)
          .toBe(2);
      }
    }
  });

  test("exposes repair controls for every non-null raw reference without rendering it directly", () => {
    const sidebar = source("components/mypage/MyPageSidebar.tsx");
    const mobile = source("app/mypage/profile/page.tsx");
    const profileHook = source("hooks/useUserProfile.ts");

    expect(profileHook).toContain("avatarUrl: typedProfile.avatar_url ?? undefined,");
    expect(profileHook).not.toContain("typedProfile.avatar_url || undefined");
    expect(sidebar).toContain(
      "profile?.avatarUrl !== null && profile?.avatarUrl !== undefined",
    );
    expect(sidebar).toContain("{hasAvatarReference && (");
    expect(sidebar).toContain("resolveProfileAvatarUrl(profile?.avatarUrl, user.id)");
    expect(mobile).toContain("const hasAvatarReference = currentAvatarReference !== null;");
    expect(mobile).toContain("{hasAvatarReference && (");
    expect(mobile).toContain("resolveProfileAvatarUrl(currentAvatarReference, user.id)");
    expect(sidebar).not.toContain("src={profile?.avatarUrl}");
    expect(mobile).not.toContain("src={currentAvatarReference}");
  });

  test("distinguishes committed mutations with pending object cleanup in the UI", () => {
    for (const path of [
      "components/mypage/MyPageSidebar.tsx",
      "app/mypage/profile/page.tsx",
    ]) {
      const caller = source(path);
      expect(caller, path).toContain('result.cleanup.status === "pending"');
      expect(caller, path).toContain(
        "프로필 사진은 변경되었지만 이전 사진 정리가 지연되고 있습니다",
      );
      expect(caller, path).toContain(
        "프로필 사진은 삭제되었지만 이전 사진 정리가 지연되고 있습니다",
      );
    }
  });
});
