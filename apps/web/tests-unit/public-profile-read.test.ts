import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLIC_PROFILE_LEADERBOARD_RPC,
  PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC,
  PUBLIC_PROFILE_READ_ERROR_CODE,
  PUBLIC_PROFILE_SUMMARIES_RPC,
  PublicProfileReadError,
  isPublicProfileInvalidSessionError,
  readCompletePublicProfileLeaderboard,
  readPublicProfileLeaderboard,
  readPublicProfileLeaderboardPage,
  readPublicProfileSummaries,
} from "../lib/public-profile-read";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const leaderboardRow = (userId: string, qualityScore: number) => ({
  user_id: userId,
  nickname: "사용자",
  review_count: 1,
  verified_review_count: 1,
  total_likes: 0,
  avg_likes_per_review: 0,
  quality_score: qualityScore,
});

const orderedUserId = (index: number) =>
  `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("public profile summary RPC boundary", () => {
  test("uses the exact RPC contract and preserves requested ordinal order", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = [];
    const client = {
      rpc: async (functionName: string, args: unknown) => {
        calls.push({ functionName, args });
        return {
          data: [
            { user_id: USER_A, nickname: "첫째", avatar_url: null },
            { user_id: USER_B, nickname: "둘째", avatar_url: "https://example.com/avatar.jpg" },
          ],
          error: null,
          count: null,
          status: 200,
          statusText: "OK",
        };
      },
    };

    await expect(readPublicProfileSummaries(client, [USER_A, USER_B])).resolves.toEqual([
      { user_id: USER_A, nickname: "첫째", avatar_url: null },
      { user_id: USER_B, nickname: "둘째", avatar_url: "https://example.com/avatar.jpg" },
    ]);
    expect(calls).toEqual([
      {
        functionName: PUBLIC_PROFILE_SUMMARIES_RPC,
        args: { p_user_ids: [USER_A, USER_B] },
      },
    ]);
  });

  test("allows omitted rows but rejects duplicates, reordered rows, and extra fields", async () => {
    const omittedClient = {
      rpc: async () => ({
        data: [{ user_id: USER_B, nickname: "둘째", avatar_url: null }],
        error: null,
      }),
    };
    await expect(readPublicProfileSummaries(omittedClient, [USER_A, USER_B])).resolves.toEqual([
      { user_id: USER_B, nickname: "둘째", avatar_url: null },
    ]);

    const invalidRows = [
      [
        { user_id: USER_B, nickname: "둘째", avatar_url: null },
        { user_id: USER_A, nickname: "첫째", avatar_url: null },
      ],
      [
        { user_id: USER_A, nickname: "첫째", avatar_url: null },
        { user_id: USER_A, nickname: "첫째", avatar_url: null },
      ],
      [{ user_id: USER_A, nickname: "탈퇴한 사용자", avatar_url: null }],
      [{ user_id: USER_A, nickname: "첫째", avatar_url: null, email: "hidden@example.com" }],
    ];

    for (const data of invalidRows) {
      await expect(
        readPublicProfileSummaries(
          { rpc: async () => ({ data, error: null }) },
          [USER_A, USER_B],
        ),
      ).rejects.toMatchObject({
        code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse,
      });
    }
  });

  test("bounds inputs before transport and returns no raw provider diagnostic", async () => {
    let callCount = 0;
    const client = {
      rpc: async () => {
        callCount += 1;
        return { data: null, error: { message: "private provider detail" } };
      },
    };

    await expect(readPublicProfileSummaries(client, ["not-a-uuid"])).rejects.toMatchObject({
      code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput,
    });
    await expect(readPublicProfileSummaries(client, [USER_A, USER_A])).rejects.toMatchObject({
      code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput,
    });
    expect(callCount).toBe(0);

    let error: unknown;
    try {
      await readPublicProfileSummaries(client, [USER_A]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PublicProfileReadError);
    expect(String(error)).toContain(PUBLIC_PROFILE_READ_ERROR_CODE.unavailable);
    expect(String(error)).not.toContain("private provider detail");
  });

  test("classifies an invalid session without preserving the provider error", async () => {
    let error: unknown;
    try {
      await readPublicProfileSummaries(
        {
          rpc: async () => ({
            data: null,
            error: { code: "PGRST303", message: "provider jwt diagnostic" },
          }),
        },
        [USER_A],
      );
    } catch (caught) {
      error = caught;
    }

    expect(isPublicProfileInvalidSessionError(error)).toBe(true);
    expect(String(error)).not.toContain("provider jwt diagnostic");
  });
});

describe("public profile leaderboard RPC boundary", () => {
  test("maps the exact ranked response and validates deterministic order", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = [];
    const client = {
      rpc: async (functionName: string, args: unknown) => {
        calls.push({ functionName, args });
        return {
          data: [
            {
              user_id: USER_A,
              nickname: "첫째",
              review_count: 4,
              verified_review_count: 3,
              total_likes: 8,
              avg_likes_per_review: 2.7,
              quality_score: 3.8,
            },
            {
              user_id: USER_B,
              nickname: "둘째",
              review_count: 0,
              verified_review_count: 0,
              total_likes: 0,
              avg_likes_per_review: 0,
              quality_score: 0,
            },
          ],
          error: null,
        };
      },
    };

    const rows = await readPublicProfileLeaderboard(client, "monthly", 100);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.review_count).toBe(0);
    expect(calls).toEqual([
      {
        functionName: PUBLIC_PROFILE_LEADERBOARD_RPC,
        args: { p_period: "monthly", p_limit: 100 },
      },
    ]);
  });

  test("rejects invalid parameters and malformed or unsorted results", async () => {
    const noCallClient = {
      rpc: async () => {
        throw new Error("must not run");
      },
    };
    await expect(readPublicProfileLeaderboard(noCallClient, "all", 0)).rejects.toMatchObject({
      code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput,
    });
    await expect(readPublicProfileLeaderboard(noCallClient, "all", 101)).rejects.toMatchObject({
      code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput,
    });

    await expect(
      readPublicProfileLeaderboard(
        {
          rpc: async () => ({
            data: [leaderboardRow(USER_A, 1), leaderboardRow(USER_B, 2)],
            error: null,
          }),
        },
        "all",
        2,
      ),
    ).rejects.toMatchObject({ code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse });

    await expect(
      readPublicProfileLeaderboard(
        {
          rpc: async () => ({
            data: [{ ...leaderboardRow(USER_A, 1), review_count: "1" }],
            error: null,
          }),
        },
        "all",
        1,
      ),
    ).rejects.toMatchObject({ code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse });
  });
});

describe("public profile leaderboard page RPC boundary", () => {
  test("uses the exact null-or-paired cursor contract and proves after-cursor order", async () => {
    const calls: Array<{ functionName: string; args: unknown }> = [];
    const client = {
      rpc: async (functionName: string, args: unknown) => {
        calls.push({ functionName, args });
        return { data: [leaderboardRow(USER_B, 3.8)], error: null };
      },
    };

    await expect(readPublicProfileLeaderboardPage(
      client,
      "monthly",
      100,
      { qualityScore: 3.8, userId: USER_A },
    )).resolves.toEqual([leaderboardRow(USER_B, 3.8)]);
    expect(calls).toEqual([{
      functionName: PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC,
      args: {
        p_period: "monthly",
        p_limit: 100,
        p_after_quality_score: 3.8,
        p_after_user_id: USER_A,
      },
    }]);

    await expect(readPublicProfileLeaderboardPage(
      { rpc: async () => ({ data: [leaderboardRow(USER_A, 3.8)], error: null }) },
      "monthly",
      100,
      { qualityScore: 3.8, userId: USER_B },
    )).rejects.toMatchObject({ code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse });
  });

  test("fetches 101+ equal-score rows sequentially across the UUID boundary", async () => {
    const allRows = Array.from({ length: 205 }, (_, index) =>
      leaderboardRow(orderedUserId(index + 1), 7.5));
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      rpc: async (functionName: string, args: Record<string, unknown>) => {
        expect(functionName).toBe(PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC);
        calls.push(args);
        const afterUserId = args.p_after_user_id;
        const start = afterUserId === null
          ? 0
          : allRows.findIndex((row) => row.user_id === afterUserId) + 1;
        return { data: allRows.slice(start, start + Number(args.p_limit)), error: null };
      },
    };

    const rows = await readCompletePublicProfileLeaderboard(client, "all");
    expect(rows).toEqual(allRows);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      p_period: "all",
      p_limit: 100,
      p_after_quality_score: null,
      p_after_user_id: null,
    });
    expect(calls[1]).toMatchObject({
      p_after_quality_score: 7.5,
      p_after_user_id: orderedUserId(100),
    });
    expect(calls[2]).toMatchObject({
      p_after_quality_score: 7.5,
      p_after_user_id: orderedUserId(200),
    });
  });

  test("rejects malformed, duplicate, and no-progress second pages without publishing a prefix", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      leaderboardRow(orderedUserId(index + 1), 5));
    const cases = [
      [{ ...leaderboardRow(orderedUserId(101), 4), extra: true }],
      [leaderboardRow(orderedUserId(1), 4)],
      [leaderboardRow(orderedUserId(100), 5)],
    ];

    for (const secondPage of cases) {
      let callCount = 0;
      await expect(readCompletePublicProfileLeaderboard({
        rpc: async () => ({
          data: callCount++ === 0 ? firstPage : secondPage,
          error: null,
        }),
      }, "all")).rejects.toMatchObject({
        code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidResponse,
      });
      expect(callCount).toBe(2);
    }
  });

  test("rejects malformed cursor pairs before transport", async () => {
    let callCount = 0;
    const client = { rpc: async () => {
      callCount += 1;
      return { data: [], error: null };
    } };
    for (const cursor of [
      { qualityScore: -1, userId: USER_A },
      { qualityScore: 1, userId: "not-a-uuid" },
      { qualityScore: 1, userId: USER_A, extra: true },
    ]) {
      await expect(readPublicProfileLeaderboardPage(
        client,
        "all",
        100,
        cursor,
      )).rejects.toMatchObject({ code: PUBLIC_PROFILE_READ_ERROR_CODE.invalidInput });
    }
    expect(callCount).toBe(0);
  });
});

describe("public profile caller convergence", () => {
  test("routes public and self reads through the bounded RPC helper", () => {
    const callers = [
      "contexts/AuthContext.tsx",
      "components/home/HomeMapUserMenu.tsx",
      "components/profile/ProfileModal.tsx",
      "app/mypage/profile/page.tsx",
      "hooks/useUserProfile.ts",
      "components/restaurant/RestaurantDetailPanel.tsx",
      "components/feed/FeedContent.tsx",
      "app/stamp/page.tsx",
      "components/map/NaverMapView.tsx",
    ];

    for (const caller of callers) {
      const callerSource = source(caller);
      expect(callerSource, caller).toContain("readPublicProfileSummaries");
      expect(callerSource, caller).not.toMatch(
        /\.from\(['"]profiles['"]\)\s*\.select\(/,
      );
    }

    const leaderboardSource = source("hooks/useLeaderboard.ts");
    expect(leaderboardSource).toContain("readCompletePublicProfileLeaderboard");
    expect(leaderboardSource).not.toContain(".from('profiles')");
    expect(leaderboardSource).not.toContain(".from('reviews')");

    const userProfileSource = source("hooks/useUserProfile.ts");
    expect(userProfileSource).toContain("Math.ceil(likerIds.length / 100)");
    expect(userProfileSource).toContain("likerIds.slice(batchIndex * 100, (batchIndex + 1) * 100)");
    expect(userProfileSource).not.toContain("readPublicProfileSummaries(supabase, likerIds)");

    const mobileFixtureSource = source("tests/mobile-home-map-helpers.ts");
    expect(mobileFixtureSource).toContain("Object.keys(payload).length !== 1");
    expect(mobileFixtureSource).toContain("request.headers()['content-type'] !== 'application/json'");
    expect(mobileFixtureSource).toContain("rawBody.byteLength > 4_096");
    expect(mobileFixtureSource).toContain("!PROFILE_SUMMARY_UUID.test(value)");
    expect(mobileFixtureSource).toContain("requestedValues.length > 100");
    expect(mobileFixtureSource).toContain("new Set(requestedValues).size !== requestedValues.length");
    expect(mobileFixtureSource).toContain("/rest/v1/rpc/read_public_profile_leaderboard_page");
    expect(mobileFixtureSource).toContain("Object.keys(payload).sort().join(',') !== expectedKeys.join(',')");
    expect(mobileFixtureSource).toContain("requestBody.p_after_quality_score === null");
    expect(mobileFixtureSource).toContain("Number.isFinite(requestBody.p_after_quality_score)");
    expect(mobileFixtureSource).toContain("PROFILE_SUMMARY_UUID.test(requestBody.p_after_user_id)");
    expect(mobileFixtureSource).toContain("hasDuplicateOrInvalidJsonMemberNames");
    expect(
      mobileFixtureSource.match(/hasDuplicateOrInvalidJsonMemberNames\(rawBody\.toString\('utf8'\)\)/g),
    ).toHaveLength(2);
    expect(mobileFixtureSource).not.toContain(".filter((value): value is string");
  });
});
