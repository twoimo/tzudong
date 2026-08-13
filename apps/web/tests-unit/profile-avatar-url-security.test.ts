import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const AUTHENTICATED_USER_ID = "08a8662c-6de8-4d4f-b54d-01d385451b42";
const OTHER_USER_ID = "73e1435d-b03f-44d3-8c2a-9bdaea2b73cb";
const AVATAR_URL = `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${AUTHENTICATED_USER_ID}/avatar.jpg`;
const AVATAR_OPERATION_ID = "abcdefab-1111-4111-8111-111111111111";
const VERSIONED_AVATAR_REFERENCE = `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}.jpg`;
const VERSIONED_AVATAR_KEY = `${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}.jpg`;
const VERSIONED_AVATAR_URL = `${SUPABASE_ORIGIN}/storage/v1/object/public/profile-avatars/${VERSIONED_AVATAR_KEY}`;
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorLocalRuntime = process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;

const {
  classifyProfileAvatarUrl,
  getProfileAvatarDeletionKey,
  getProfileAvatarVersionedReference,
  getProfileAvatarVersionedStorageKey,
  resolveProfileAvatarUrl,
} = await import("../lib/profile-avatar-url.ts?security-contract");

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
});

afterAll(() => {
  if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
  if (priorLocalRuntime === undefined) delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
  else process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = priorLocalRuntime;
});

describe("profile avatar URL trust boundary", () => {
  test("resolves only the signed-in user's exact profile avatar object", () => {
    expect(resolveProfileAvatarUrl(AVATAR_URL, AUTHENTICATED_USER_ID)).toBe(AVATAR_URL);
    expect(getProfileAvatarDeletionKey(AVATAR_URL, AUTHENTICATED_USER_ID)).toBe(
      `${AUTHENTICATED_USER_ID}/avatar.jpg`,
    );
  });

  test("resolves a strict versioned internal reference without exposing the marker to Image", () => {
    expect(
      getProfileAvatarVersionedStorageKey(AUTHENTICATED_USER_ID, AVATAR_OPERATION_ID),
    ).toBe(VERSIONED_AVATAR_KEY);
    expect(
      getProfileAvatarVersionedReference(AUTHENTICATED_USER_ID, AVATAR_OPERATION_ID),
    ).toBe(VERSIONED_AVATAR_REFERENCE);
    expect(resolveProfileAvatarUrl(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toBe(
      VERSIONED_AVATAR_URL,
    );
    expect(getProfileAvatarDeletionKey(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toBe(
      VERSIONED_AVATAR_KEY,
    );
    expect(classifyProfileAvatarUrl(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toEqual({
      kind: "owned_storage",
      storageKey: VERSIONED_AVATAR_KEY,
    });
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

  test("resolves an internal marker against exact loopback only in explicit local runtime", () => {
    const localOrigin = "http://127.0.0.1:54321";
    const localAvatarUrl = `${localOrigin}/storage/v1/object/public/profile-avatars/${VERSIONED_AVATAR_KEY}`;

    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = localOrigin;
      delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
      expect(resolveProfileAvatarUrl(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toBeNull();

      process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = "1";
      expect(resolveProfileAvatarUrl(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toBe(
        localAvatarUrl,
      );
      expect(getProfileAvatarDeletionKey(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID)).toBe(
        VERSIONED_AVATAR_KEY,
      );
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
      if (priorLocalRuntime === undefined) delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
      else process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = priorLocalRuntime;
    }
  });

  test("rejects unsafe local origin variants even in explicit local runtime", () => {
    try {
      process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = "1";
      for (const configuredUrl of [
        "http://localhost:54321",
        "http://0.0.0.0:54321",
        "http://127.0.0.1",
        "http://127.0.0.1:80",
        "http://127.0.0.1:54321/path",
        "http://127.0.0.1:54321?query=1",
        "http://user:password@127.0.0.1:54321",
      ]) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = configuredUrl;
        expect(
          resolveProfileAvatarUrl(VERSIONED_AVATAR_REFERENCE, AUTHENTICATED_USER_ID),
          configuredUrl,
        ).toBeNull();
      }
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
      if (priorLocalRuntime === undefined) delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
      else process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = priorLocalRuntime;
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
      `profile-avatar://${OTHER_USER_ID}/avatar-${AVATAR_OPERATION_ID}.jpg`,
      `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID.toUpperCase()}.jpg`,
      `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}.png`,
      `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}.jpg?cache=1`,
      `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}.jpg#fragment`,
      `profile-avatar://${AUTHENTICATED_USER_ID}/avatar-${AVATAR_OPERATION_ID}%2Ejpg`,
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
