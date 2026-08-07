import { describe, expect, it } from "bun:test";

import { getSupabaseStorageRemotePattern } from "../next.config.mjs";

const NIGHTLY_ORIGIN = "http://127.0.0.1:54321";
const STORAGE_PATHNAME = "/storage/v1/object/public/**";
const LOCAL_NIGHTLY_OPTIONS = {
  nightlyOffline: true,
  isProduction: false,
  isVercel: false,
};

describe("Next Image Supabase storage origins", () => {
  it("permits only the canonical offline loopback origin during a local nightly run", () => {
    expect(
      getSupabaseStorageRemotePattern(NIGHTLY_ORIGIN, LOCAL_NIGHTLY_OPTIONS),
    ).toEqual({
      protocol: "http",
      hostname: "127.0.0.1",
      port: "54321",
      pathname: STORAGE_PATHNAME,
    });
  });

  it("keeps HTTPS Supabase storage origins on the production-safe pattern", () => {
    expect(
      getSupabaseStorageRemotePattern("https://project.supabase.co", {
        nightlyOffline: false,
        isProduction: true,
        isVercel: true,
      }),
    ).toEqual({
      protocol: "https",
      hostname: "project.supabase.co",
      pathname: STORAGE_PATHNAME,
    });
  });

  it("rejects the loopback HTTP origin outside the local nightly context", () => {
    expect(
      getSupabaseStorageRemotePattern(NIGHTLY_ORIGIN, {
        nightlyOffline: false,
        isProduction: false,
        isVercel: false,
      }),
    ).toBeNull();

    expect(
      getSupabaseStorageRemotePattern(NIGHTLY_ORIGIN, {
        nightlyOffline: true,
        isProduction: true,
        isVercel: false,
      }),
    ).toBeNull();

    expect(
      getSupabaseStorageRemotePattern(NIGHTLY_ORIGIN, {
        nightlyOffline: true,
        isProduction: false,
        isVercel: true,
      }),
    ).toBeNull();
  });

  it("rejects offline origin near misses", () => {
    for (const origin of [
      "http://localhost:54321",
      "http://127.0.0.1:54322",
      "http://127.0.0.1:54321/",
      "http://127.0.0.1:54321/storage/v1/object/public",
      "http://user:password@127.0.0.1:54321",
      "http://127.0.0.1:54321#fragment",
    ]) {
      expect(getSupabaseStorageRemotePattern(origin, LOCAL_NIGHTLY_OPTIONS)).toBeNull();
    }
  });
});
