import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  RESTAURANT_REQUESTS_LIFECYCLE_COLUMNS,
  buildAdminPendingCountsResponse,
} from "@/lib/admin/pending-counts";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type SupabaseRouteError = {
  code?: string;
  message?: string;
};

type SupabaseCountResult = {
  count: number | null;
  error: SupabaseRouteError | null;
};
const RESTAURANT_REQUESTS_LIFECYCLE_SELECT =
  RESTAURANT_REQUESTS_LIFECYCLE_COLUMNS.join(",");

function normalizeCount(result: SupabaseCountResult, label: string) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "count failed"}`);
  }

  return result.count ?? 0;
}

function isMissingRestaurantRequestLifecycleError(error: SupabaseRouteError | null | undefined) {
  if (!error) return false;
  if (error.code === "42703") return true;

  return /column\s+restaurant_requests\.(status|reviewed_by_admin_id|reviewed_at|admin_note|rejection_reason|review_audit_id|updated_at)\s+does\s+not\s+exist/i.test(
    error.message ?? "",
  );
}

async function isRestaurantRequestLifecycleMissing(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
) {
  const probe = await supabase
    .from("restaurant_requests")
    .select(RESTAURANT_REQUESTS_LIFECYCLE_SELECT)
    .limit(1);

  if (!probe.error) return false;
  if (isMissingRestaurantRequestLifecycleError(probe.error)) return true;

  throw new Error("restaurant_requests_lifecycle_probe: count failed");
}

async function countPendingRestaurantRequests(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
) {
  const lifecycleColumnsAvailable = !(await isRestaurantRequestLifecycleMissing(supabase));
  const countQuery = supabase
    .from("restaurant_requests")
    .select("id", { count: "exact", head: true });

  const result = lifecycleColumnsAvailable
    ? await countQuery.eq("status", "pending")
    : await countQuery;

  if (result.error) {
    throw new Error("restaurant_requests: count failed");
  }

  return {
    count: result.count ?? 0,
    lifecycleColumnsAvailable,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  try {
    const [submissionsResult, recommendationRequestsResult, reviewsResult] = await Promise.all([
      supabase
        .from("restaurant_submissions")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "partially_approved"]),
      countPendingRestaurantRequests(supabase),
      supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .eq("is_verified", false),
    ]);

    const submissionsCount = normalizeCount(submissionsResult, "restaurant_submissions");
    const recommendationRequestsCount = recommendationRequestsResult.count;

    return NextResponse.json(
      buildAdminPendingCountsResponse({
        restaurantSubmissions: submissionsCount,
        restaurantRecommendationRequests: recommendationRequestsCount,
        reviews: normalizeCount(reviewsResult, "reviews"),
        recommendationRequestsLifecycleReady: recommendationRequestsResult.lifecycleColumnsAvailable,
      }),
    );
  } catch (error) {
    console.error("[admin/pending-counts] failed:", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "Failed to load admin pending counts." },
      { status: 500 },
    );
  }
}
