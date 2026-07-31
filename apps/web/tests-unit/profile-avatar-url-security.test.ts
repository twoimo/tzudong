import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const AUTHENTICATED_USER_ID = "08a8662c-6de8-4d4f-b54d-01d385451b42";
const OTHER_USER_ID = "73e1435d-b03f-44d3-8c2a-9bdaea2b73cb";
const AVATAR_URL = `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}/avatar.jpg`;
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const {
  classifyProfileAvatarUrl,
  getProfileAvatarDeletionKey,
  resolveProfileAvatarUrl,
} = await import("../lib/profile-avatar-url.ts?security-contract");

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
});

afterAll(() => {
  if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
});

describe("profile avatar URL trust boundary", () => {
  test("resolves only the signed-in user's exact profile avatar object", () => {
    expect(resolveProfileAvatarUrl(AVATAR_URL, AUTHENTICATED_USER_ID)).toBe(AVATAR_URL);
    expect(getProfileAvatarDeletionKey(AVATAR_URL, AUTHENTICATED_USER_ID)).toBe(
      `${AUTHENTICATED_USER_ID}/avatar.jpg`,
    );
  });
  test("fails closed when the configured Supabase origin includes a port", () => {
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = `${SUPABASE_ORIGIN}:443`;
      expect(resolveProfileAvatarUrl(AVATAR_URL, AUTHENTICATED_USER_ID)).toBeNull();
      expect(getProfileAvatarDeletionKey(AVATAR_URL, AUTHENTICATED_USER_ID)).toBeNull();
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    }
  });

  test("allows a canonical Google OAuth avatar for rendering but never deletion", () => {
    const googleAvatar = "https://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c";

    expect(resolveProfileAvatarUrl(googleAvatar, AUTHENTICATED_USER_ID)).toBe(googleAvatar);
    expect(getProfileAvatarDeletionKey(googleAvatar, AUTHENTICATED_USER_ID)).toBeNull();
  });
  test("classifies owned storage, Google OAuth, and invalid values for deletion", () => {
    expect(classifyProfileAvatarUrl(AVATAR_URL, AUTHENTICATED_USER_ID)).toEqual({
      kind: "owned_storage",
      storageKey: `${AUTHENTICATED_USER_ID}/avatar.jpg`,
    });
    expect(
      classifyProfileAvatarUrl(
        "https://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c",
        AUTHENTICATED_USER_ID,
      ),
    ).toEqual({ kind: "google_oauth" });
    expect(
      classifyProfileAvatarUrl(
        `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${OTHER_USER_ID}/avatar.jpg`,
        AUTHENTICATED_USER_ID,
      ),
    ).toEqual({ kind: "invalid" });
  });

  test("rejects untrusted origins, credentials, ports, query strings, and fragments", () => {
    for (const value of [
      AVATAR_URL.replace("https://", "http://"),
      AVATAR_URL.replace(SUPABASE_ORIGIN, "https://evil.example"),
      AVATAR_URL.replace(SUPABASE_ORIGIN, "https://project-ref.supabase.co.evil.example"),
      AVATAR_URL.replace("https://", "https://user:password@"),
      AVATAR_URL.replace(SUPABASE_ORIGIN, `${SUPABASE_ORIGIN}:443`),
      `${AVATAR_URL}?t=1`,
      `${AVATAR_URL}#fragment`,
      "https://evil.example/a/ACg8ocJ01d385451b42=s96-c",
      "http://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c",
      "https://user:password@lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c",
      "https://lh3.googleusercontent.com:443/a/ACg8ocJ01d385451b42=s96-c",
      "https://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c?sz=96",
      "https://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42=s96-c#fragment",
    ]) {
      expect(resolveProfileAvatarUrl(value, AUTHENTICATED_USER_ID)).toBeNull();
      expect(getProfileAvatarDeletionKey(value, AUTHENTICATED_USER_ID)).toBeNull();
    }
  });

  test("rejects traversal, encoded separators, other users, buckets, keys, and SVG", () => {
    for (const value of [
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${OTHER_USER_ID}/avatar.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/other-bucket/${AUTHENTICATED_USER_ID}/avatar.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}/other.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}/avatar.svg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}/../avatar.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}%2Favatar.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/%2e%2e/${AUTHENTICATED_USER_ID}/avatar.jpg`,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}\\avatar.jpg`,
      "https://lh3.googleusercontent.com/a/../ACg8ocJ01d385451b42=s96-c",
      "https://lh3.googleusercontent.com/a/%2e%2e/ACg8ocJ01d385451b42=s96-c",
      "https://lh3.googleusercontent.com/a/ACg8ocJ01d385451b42%2Fs96-c",
      "https://lh3.googleusercontent.com/a/avatar.svg",
      "https://lh3.googleusercontent.com/a/avatar.svg=s96-c",
    ]) {
      expect(resolveProfileAvatarUrl(value, AUTHENTICATED_USER_ID)).toBeNull();
      expect(getProfileAvatarDeletionKey(value, AUTHENTICATED_USER_ID)).toBeNull();
    }
  });

  test("fails closed for malformed authenticated identities", () => {
    for (const authenticatedUserId of [
      "",
      " user-id",
      "user/id",
      "user%2Fid",
      "user\\id",
      "user\nname",
    ]) {
      expect(resolveProfileAvatarUrl(AVATAR_URL, authenticatedUserId)).toBeNull();
      expect(getProfileAvatarDeletionKey(AVATAR_URL, authenticatedUserId)).toBeNull();
    }
  });
});
