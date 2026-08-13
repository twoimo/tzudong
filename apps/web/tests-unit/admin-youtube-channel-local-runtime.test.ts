import { afterEach, describe, expect, mock, test } from "bun:test";

const originalLocalRuntime = process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
const originalYouTubeApiKey = process.env.YOUTUBE_API_KEY;

afterEach(() => {
  if (originalLocalRuntime === undefined) {
    delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
  } else {
    process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = originalLocalRuntime;
  }
  if (originalYouTubeApiKey === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = originalYouTubeApiKey;
  }
  mock.restore();
});

describe("admin YouTube channel local runtime fallback", () => {
  test("returns a fixed local-unavailable shape while hosted mode keeps failing closed", async () => {
    mock.module("@/lib/auth/require-admin", () => ({
      requireAdmin: async () => ({ ok: true, userId: "admin-user" }),
    }));
    mock.module("@/lib/admin/youtube-kpi-snapshots", () => ({
      getLatestYouTubeChannelSnapshot: async () => null,
    }));

    delete process.env.YOUTUBE_API_KEY;
    process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME = "1";
    const route = await import(
      `../app/api/admin/youtube-channel/route.ts?cache=${Math.random()}`
    );
    const request = new Request(
      "http://127.0.0.1:8080/api/admin/youtube-channel?period=1M",
    );

    const localResponse = await route.GET(request);
    const localPayload = await localResponse.json();
    expect(localResponse.status).toBe(200);
    expect(localResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(localPayload).toMatchObject({
      subscriberCount: null,
      viewCount: null,
      videoCount: null,
      deltaSource: "unavailable",
      unavailable: { code: "LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE" },
    });
    expect(localPayload.error).toBeUndefined();

    delete process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME;
    const hostedResponse = await route.GET(request);
    const hostedPayload = await hostedResponse.json();
    expect(hostedResponse.status).toBe(500);
    expect(hostedPayload).toEqual({ error: "YouTube API key is not configured" });
    expect(hostedPayload.unavailable).toBeUndefined();
  });
});
