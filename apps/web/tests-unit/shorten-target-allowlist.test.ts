import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const SITE_ORIGIN = "https://short.test";
const REVIEW_ID = "3f7c2f6a-9b7d-4c2e-8a1f-5b6c7d8e9f01";
const UPPERCASE_REVIEW_ID = "3F7C2F6A-9B7D-4C2E-8A1F-5B6C7D8E9F01";

type ReviewRow = { id: string; restaurant_id: string; is_verified: boolean } | null;
type AllocationRow = {
  code: string | null;
  rate_limited: boolean;
  retry_after_seconds: number;
  allocation_failed: boolean;
  is_existing: boolean;
} | null;

let review: ReviewRow = null;
let reviewError: { message: string } | null = null;
let allocation: AllocationRow = null;
let allocationError: { message: string } | null = null;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let serviceRoleCreations = 0;

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
] as const;

type ShortenPost = (request: NextRequest) => Promise<Response>;

/**
 * Module mocks are process-wide under `bun test`, so they are installed per test
 * and restored afterwards. The route also reads its Supabase configuration while
 * the module is evaluated, so the environment is set before the cache-busted import.
 */
async function withShortenRoute<T>(run: (post: ShortenPost) => Promise<T>): Promise<T> {
  const previousEnv = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://shorten-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "shorten-test-anon-key";
  process.env.NEXT_PUBLIC_SITE_URL = SITE_ORIGIN;

  mock.module("@supabase/supabase-js", () => ({
    createClient: () => ({
      from: (table: string) => {
        if (table !== "reviews") throw new Error("unexpected_public_table");
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({ data: review, error: reviewError });
        return builder;
      },
    }),
  }));
  mock.module("@/lib/supabase/service-role", () => ({
    createSupabaseServiceRoleClient: () => {
      serviceRoleCreations += 1;
      return {
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcCalls.push({ name, args });
          return { maybeSingle: async () => ({ data: allocation, error: allocationError }) };
        },
      };
    },
  }));

  try {
    const loaded = await import(`../app/api/shorten/route.ts?cache=${Math.random()}`) as unknown as {
      POST: ShortenPost;
    };
    return await run(loaded.POST);
  } finally {
    mock.restore();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function shortenRequest(rawBody: string, contentType = "application/json") {
  return new NextRequest("http://localhost:3000/api/shorten", {
    method: "POST",
    headers: { "content-type": contentType },
    body: rawBody,
  });
}

function grantReview(restaurantId = "00000000-0000-0000-0000-0000000000bb") {
  review = { id: REVIEW_ID, restaurant_id: restaurantId, is_verified: true };
  reviewError = null;
}

function grantAllocation(overrides: Partial<NonNullable<AllocationRow>> = {}) {
  allocation = {
    code: "Ab12Cd",
    rate_limited: false,
    retry_after_seconds: 0,
    allocation_failed: false,
    is_existing: false,
    ...overrides,
  };
  allocationError = null;
}

beforeEach(() => {
  review = null;
  reviewError = null;
  allocation = null;
  allocationError = null;
  rpcCalls.length = 0;
  serviceRoleCreations = 0;
});

describe("shorten target allowlist", () => {
  test("rejects a non-JSON content type", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${REVIEW_ID}` }), "text/plain"));
      expect(response.status).toBe(415);
    });
  });

  test("rejects a body that is not a JSON object", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest("[]"));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("올바르지 않");
    });
  });

  test("rejects duplicate JSON members", async () => {
    await withShortenRoute(async (post) => {
      const raw = `{"targetUrl":"/?review=${REVIEW_ID}","targetUrl":"/?review=${REVIEW_ID}"}`;
      const response = await post(shortenRequest(raw));
      expect(response.status).toBe(400);
    });
  });

  test("rejects unexpected request keys", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${REVIEW_ID}`, extra: 1 })));
      expect(response.status).toBe(400);
      expect(rpcCalls.length).toBe(0);
    });
  });

  test("rejects a blank target", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: "   " })));
      expect(response.status).toBe(400);
    });
  });

  test("rejects an over-long target", async () => {
    await withShortenRoute(async (post) => {
      const target = `/?review=${REVIEW_ID}${"a".repeat(3_000)}`;
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: target })));
      expect(response.status).toBe(400);
    });
  });

  test("rejects a protocol-relative target instead of redirecting off-site", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `//evil.example.com/?review=${REVIEW_ID}` })));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("허용되지 않는");
      expect(rpcCalls.length).toBe(0);
    });
  });

  test("rejects a foreign origin", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `https://evil.example.com/?review=${REVIEW_ID}` })));
      expect(response.status).toBe(400);
    });
  });

  test("rejects a same-origin target without a review id", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: "/?other=1" })));
      expect(response.status).toBe(400);
    });
  });

  test("rejects a non-uuid review id", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: "/?review=not-a-uuid" })));
      expect(response.status).toBe(400);
    });
  });

  test("rejects a same-origin target whose path is not the site root", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/admin?review=${REVIEW_ID}` })));
      expect(response.status).toBe(400);
    });
  });

  test("returns 404 for an unknown public review without touching the service role", async () => {
    await withShortenRoute(async (post) => {
      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${REVIEW_ID}` })));

      expect(response.status).toBe(404);
      expect(serviceRoleCreations).toBe(0);
      expect(rpcCalls.length).toBe(0);
    });
  });

  test("surfaces rate limiting as 429 with Retry-After", async () => {
    await withShortenRoute(async (post) => {
      grantReview();
      grantAllocation({ code: null, rate_limited: true, retry_after_seconds: 42 });

      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${REVIEW_ID}` })));

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("42");
    });
  });

  test("reports a missing short code as a generation failure", async () => {
    await withShortenRoute(async (post) => {
      grantReview();
      grantAllocation({ code: null, allocation_failed: true });

      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${REVIEW_ID}` })));

      expect(response.status).toBe(500);
    });
  });

  test("canonicalizes the review id and returns a same-origin short url", async () => {
    await withShortenRoute(async (post) => {
      grantReview();
      grantAllocation({ code: "Zz09Yy", is_existing: true });

      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `/?review=${UPPERCASE_REVIEW_ID}` })));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        shortUrl: `${SITE_ORIGIN}/s/Zz09Yy`,
        code: "Zz09Yy",
        isExisting: true,
      });
      expect(rpcCalls.length).toBe(1);
      expect(rpcCalls[0]?.name).toBe("allocate_short_url");
      expect(rpcCalls[0]?.args.p_target_url).toBe(`/?review=${REVIEW_ID}`);
      expect(rpcCalls[0]?.args.p_review_id).toBe(REVIEW_ID);
      expect(rpcCalls[0]?.args.p_client_bucket).toBe("unknown");
      const candidateCodes = rpcCalls[0]?.args.p_candidate_codes as string[];
      expect(candidateCodes.length).toBe(5);
      for (const code of candidateCodes) expect(code).toMatch(/^[A-Za-z0-9]{6}$/);
    });
  });

  test("accepts an absolute same-origin target", async () => {
    await withShortenRoute(async (post) => {
      grantReview();
      grantAllocation({ code: "Qq11Ww" });

      const response = await post(shortenRequest(JSON.stringify({ targetUrl: `${SITE_ORIGIN}/?review=${REVIEW_ID}` })));

      expect(response.status).toBe(200);
      expect((await response.json()).shortUrl).toBe(`${SITE_ORIGIN}/s/Qq11Ww`);
    });
  });
});
