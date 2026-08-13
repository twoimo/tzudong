import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const avatarConsumers = [
  {
    name: "home map user menu",
    path: "components/home/HomeMapUserMenu.tsx",
    resolverCall: "resolveProfileAvatarUrl(profile?.avatar_url, user.id)",
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
describe("profile avatar deletion source contract", () => {
  const deletionConsumers = [
    {
      name: "mobile profile",
      path: "app/mypage/profile/page.tsx",
      handlerStart: "const handleMobileAvatarDelete = async () => {",
      handlerEnd: "const handlePasswordChange",
      profileValue: "profile.avatar_url",
    },
    {
      name: "my page sidebar",
      path: "components/mypage/MyPageSidebar.tsx",
      handlerStart: "const handleAvatarDelete = async () => {",
      handlerEnd: "const handleLogout",
      profileValue: "profile.avatarUrl",
    },
  ] as const;

  test("uses the shared classifier to clear OAuth references without storage deletion", () => {
    for (const consumer of deletionConsumers) {
      const consumerSource = source(consumer.path);
      const handlerStart = consumerSource.indexOf(consumer.handlerStart);
      const handlerEnd = consumerSource.indexOf(consumer.handlerEnd, handlerStart);
      const handlerSource = consumerSource.slice(handlerStart, handlerEnd);
      const classificationIndex = handlerSource.indexOf("classifyProfileAvatarUrl(");
      const profileValueIndex = handlerSource.indexOf(consumer.profileValue, classificationIndex);
      const userIdIndex = handlerSource.indexOf("user.id", profileValueIndex);
      const invalidIndex = handlerSource.indexOf('if (avatar.kind === "invalid")');
      const ownedStorageIndex = handlerSource.indexOf('if (avatar.kind === "owned_storage")');
      const removeIndex = handlerSource.indexOf(".remove([avatar.storageKey])");
      const removeErrorIndex = handlerSource.indexOf("if (removeError) throw removeError;");
      const profileClearIndex = handlerSource.indexOf(".update({ avatar_url: null } as never)");
      const profileScopeIndex = handlerSource.indexOf('.eq("user_id", user.id)');
      const successIndex = handlerSource.indexOf('toast.success("프로필 사진이 삭제되었습니다")');
      const catchIndex = handlerSource.indexOf("} catch {");
      const failureIndex = handlerSource.indexOf(
        'toast.error("프로필 사진 삭제에 실패했습니다")',
        catchIndex,
      );

      expect(handlerStart, consumer.name).toBeGreaterThan(-1);
      expect(handlerEnd, consumer.name).toBeGreaterThan(handlerStart);
      expect(classificationIndex, consumer.name).toBeGreaterThan(-1);
      expect(profileValueIndex, consumer.name).toBeGreaterThan(classificationIndex);
      expect(userIdIndex, consumer.name).toBeGreaterThan(profileValueIndex);
      expect(invalidIndex, consumer.name).toBeGreaterThan(userIdIndex);
      expect(ownedStorageIndex, consumer.name).toBeGreaterThan(invalidIndex);
      expect(removeIndex, consumer.name).toBeGreaterThan(ownedStorageIndex);
      expect(removeErrorIndex, consumer.name).toBeGreaterThan(removeIndex);
      expect(profileClearIndex, consumer.name).toBeGreaterThan(removeErrorIndex);
      expect(profileScopeIndex, consumer.name).toBeGreaterThan(profileClearIndex);
      expect(successIndex, consumer.name).toBeGreaterThan(profileScopeIndex);
      expect(catchIndex, consumer.name).toBeGreaterThan(successIndex);
      expect(failureIndex, consumer.name).toBeGreaterThan(catchIndex);
    }
  });
});
