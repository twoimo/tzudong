import { describe, expect, mock, test } from "bun:test";

import {
  RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
  buildAdminPendingCountsResponse,
  getAdminPendingCountsTotal,
  getAdminPendingReviewCount,
  getAdminPendingSubmissionCount,
  normalizeAdminPendingCountsResponse,
} from "../lib/admin/pending-counts";
type PendingCountsSupabaseError = {
  code?: string;
  message?: string;
};

type PendingCountsSupabaseResult = {
  count?: number | null;
  data?: unknown;
  error?: PendingCountsSupabaseError | null;
};

type PendingCountsQueryState = {
  table: string;
  selectColumns?: string;
  filters: Array<{ op: "eq" | "in"; column: string; value: unknown }>;
  limitCount?: number;
};

function createPendingCountsSupabaseMock(
  handler: (state: PendingCountsQueryState) => PendingCountsSupabaseResult,
) {
  function resolve(state: PendingCountsQueryState) {
    const result = handler(state);
    return Promise.resolve({
      count: result.count ?? null,
      data: result.data ?? null,
      error: result.error ?? null,
    });
  }

  function createQuery(state: PendingCountsQueryState): any {
    return {
      select(columns: string) {
        return createQuery({ ...state, selectColumns: columns });
      },
      eq(column: string, value: unknown) {
        return resolve({
          ...state,
          filters: [...state.filters, { op: "eq", column, value }],
        });
      },
      in(column: string, value: unknown[]) {
        return resolve({
          ...state,
          filters: [...state.filters, { op: "in", column, value }],
        });
      },
      limit(limitCount: number) {
        return resolve({ ...state, limitCount });
      },
      then(onFulfilled: unknown, onRejected: unknown) {
        return resolve(state).then(
          onFulfilled as Parameters<Promise<PendingCountsSupabaseResult>["then"]>[0],
          onRejected as Parameters<Promise<PendingCountsSupabaseResult>["then"]>[1],
        );
      },
    };
  }

  return {
    from(table: string) {
      return createQuery({ table, filters: [] });
    },
  };
}

async function loadPendingCountsRoute(
  auth: "ok" | "forbidden",
  handler: (state: PendingCountsQueryState) => PendingCountsSupabaseResult = () => {
    throw new Error("unexpected-service-role-call");
  },
) {
  let serviceRoleCalls = 0;
  mock.module("@/lib/auth/require-admin", () => ({
    requireAdmin: async () =>
      auth === "ok"
        ? { ok: true, userId: "admin-user" }
        : {
            ok: false,
            response: Response.json({ error: "Forbidden" }, { status: 403 }),
          },
  }));
  mock.module("@/lib/supabase/service-role", () => ({
    createSupabaseServiceRoleClient: () => {
      serviceRoleCalls += 1;
      return createPendingCountsSupabaseMock(handler);
    },
  }));

  const route = await import(`../app/api/admin/pending-counts/route.ts?cache=${Math.random()}`);
  return {
    GET: route.GET as () => Promise<Response>,
    getServiceRoleCalls: () => serviceRoleCalls,
  };
}


describe("admin pending counts contract", () => {
  test("builds a ready canonical response while preserving legacy totals", () => {
    const response = buildAdminPendingCountsResponse({
      restaurantSubmissions: 2,
      restaurantRecommendationRequests: 3,
      reviews: 4,
      recommendationRequestsLifecycleReady: true,
      asOf: "2026-07-03T00:00:00.000Z",
    });

    expect(response.submissions).toBe(5);
    expect(response.recommendationRequests).toBe(3);
    expect(response.reviews).toBe(4);
    expect(response.recommendationRequestsLifecycleReady).toBe(true);
    expect(response.total).toBe(9);
    expect(response.asOf).toBe("2026-07-03T00:00:00.000Z");
    expect(response.domains.restaurant_submissions.count).toBe(2);
    expect(response.domains.restaurant_recommendation_requests.count).toBe(3);
    expect(response.domains.restaurant_recommendation_requests.ready).toBe(true);
    expect(response.domains.reviews.count).toBe(4);
    expect(response.readiness.status).toBe("ready");
    expect(response.readiness.reasons).toEqual([]);
    expect(response.diagnostics).toEqual({});
    expect(getAdminPendingCountsTotal(response)).toBe(9);
    expect(getAdminPendingSubmissionCount(response)).toBe(5);
    expect(getAdminPendingReviewCount(response)).toBe(4);
  });

  test("marks restaurant-request lifecycle fallback as degraded with bounded diagnostics", () => {
    const response = buildAdminPendingCountsResponse({
      restaurantSubmissions: 1,
      restaurantRecommendationRequests: 7,
      reviews: 2,
      recommendationRequestsLifecycleReady: false,
      asOf: "2026-07-03T00:00:00.000Z",
    });

    expect(response.submissions).toBe(8);
    expect(response.total).toBe(10);
    expect(response.recommendationRequestsLifecycleReady).toBe(false);
    expect(response.readiness.status).toBe("degraded");
    expect(response.readiness.reasons).toEqual([
      RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
    ]);
    expect(response.readiness.remediation).toContain(
      "restaurant request lifecycle migration",
    );
    expect(response.domains.restaurant_recommendation_requests).toMatchObject({
      id: "restaurant_recommendation_requests",
      count: 7,
      ready: false,
      status: "degraded",
      reason: RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
    });
    expect(response.domains.restaurant_recommendation_requests.remediation).toContain(
      "restaurant request lifecycle migration",
    );
    expect(response.diagnostics.restaurantRequestsLifecycle).toEqual({
      reason: RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
      table: "restaurant_requests",
      columns: [
        "status",
        "reviewed_by_admin_id",
        "reviewed_at",
        "admin_note",
        "rejection_reason",
        "review_audit_id",
        "updated_at",
      ],
      fallback: "count_all_restaurant_requests",
    });
    expect(JSON.stringify(response.diagnostics)).not.toContain("does not exist");
    expect(JSON.stringify(response.diagnostics)).not.toContain("42703");
  });

  test("normalizes legacy payloads into the canonical response defensively", () => {
    const response = normalizeAdminPendingCountsResponse({
      submissions: 11,
      recommendationRequests: 4,
      reviews: 5,
      recommendationRequestsLifecycleReady: false,
      asOf: "2026-07-03T00:00:00.000Z",
    });

    expect(response.asOf).toBe("2026-07-03T00:00:00.000Z");
    expect(response.submissions).toBe(11);
    expect(response.recommendationRequests).toBe(4);
    expect(response.reviews).toBe(5);
    expect(response.total).toBe(16);
    expect(response.domains.restaurant_submissions.count).toBe(7);
    expect(response.domains.restaurant_recommendation_requests.count).toBe(4);
    expect(response.domains.restaurant_recommendation_requests.ready).toBe(false);
    expect(response.readiness.status).toBe("degraded");
  });
  test("clamps non-finite and negative count inputs before deriving totals", () => {
    const response = buildAdminPendingCountsResponse({
      restaurantSubmissions: -2,
      restaurantRecommendationRequests: Number.POSITIVE_INFINITY,
      reviews: 4.9,
      recommendationRequestsLifecycleReady: true,
      asOf: "2026-07-03T00:00:00.000Z",
    });

    expect(response.submissions).toBe(0);
    expect(response.recommendationRequests).toBe(0);
    expect(response.reviews).toBe(4);
    expect(response.total).toBe(4);
  });

  test("keeps pending-counts service-role work behind admin auth", async () => {
    try {
      const { GET, getServiceRoleCalls } = await loadPendingCountsRoute("forbidden");
      const response = await GET();

      expect(response.status).toBe(403);
      expect(getServiceRoleCalls()).toBe(0);
    } finally {
      mock.restore();
    }
  });

  test("route returns canonical ready counts after probing every lifecycle column", async () => {
    try {
      const { GET } = await loadPendingCountsRoute("ok", (state) => {
        if (state.table === "restaurant_submissions") {
          expect(state.filters).toContainEqual({
            op: "in",
            column: "status",
            value: ["pending", "partially_approved"],
          });
          return { count: 2 };
        }

        if (state.table === "reviews") {
          expect(state.filters).toContainEqual({
            op: "eq",
            column: "is_verified",
            value: false,
          });
          return { count: 4 };
        }

        if (state.table === "restaurant_requests" && state.limitCount === 1) {
          expect(state.selectColumns).toContain("reviewed_by_admin_id");
          expect(state.selectColumns).toContain("review_audit_id");
          return { data: [] };
        }

        if (state.table === "restaurant_requests") {
          expect(state.filters).toContainEqual({
            op: "eq",
            column: "status",
            value: "pending",
          });
          return { count: 3 };
        }

        throw new Error(`unexpected table ${state.table}`);
      });

      const response = await GET();
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.submissions).toBe(5);
      expect(payload.recommendationRequests).toBe(3);
      expect(payload.reviews).toBe(4);
      expect(payload.total).toBe(9);
      expect(payload.domains.restaurant_submissions.count).toBe(2);
      expect(payload.domains.restaurant_recommendation_requests.ready).toBe(true);
      expect(payload.readiness.status).toBe("ready");
    } finally {
      mock.restore();
    }
  });

  test("route degrades with bounded diagnostics when any lifecycle column is missing", async () => {
    try {
      const rawMessage = "column restaurant_requests.reviewed_at does not exist";
      const { GET } = await loadPendingCountsRoute("ok", (state) => {
        if (state.table === "restaurant_submissions") return { count: 1 };
        if (state.table === "reviews") return { count: 2 };
        if (state.table === "restaurant_requests" && state.limitCount === 1) {
          return { error: { message: rawMessage } };
        }
        if (state.table === "restaurant_requests") {
          expect(state.filters).toEqual([]);
          return { count: 7 };
        }
        throw new Error(`unexpected table ${state.table}`);
      });

      const response = await GET();
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.recommendationRequests).toBe(7);
      expect(payload.recommendationRequestsLifecycleReady).toBe(false);
      expect(payload.readiness.status).toBe("degraded");
      expect(payload.readiness.reasons).toContain(RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON);
      expect(payload.diagnostics.restaurantRequestsLifecycle.columns).toContain("reviewed_at");
      expect(JSON.stringify(payload)).not.toContain(rawMessage);
    } finally {
      mock.restore();
    }
  });

  test("route returns generic 500 for non-lifecycle database errors", async () => {
    try {
      const { GET } = await loadPendingCountsRoute("ok", (state) => {
        if (state.table === "restaurant_submissions") {
          return { error: { message: "raw db secret should not leak" } };
        }
        if (state.table === "reviews") return { count: 0 };
        if (state.table === "restaurant_requests" && state.limitCount === 1) return { data: [] };
        if (state.table === "restaurant_requests") return { count: 0 };
        throw new Error(`unexpected table ${state.table}`);
      });

      const response = await GET();
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.error).toBe("Failed to load admin pending counts.");
      expect(JSON.stringify(payload)).not.toContain("raw db secret");
    } finally {
      mock.restore();
    }
  });
});
