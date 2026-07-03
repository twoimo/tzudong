import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
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

function normalizeCount(result: SupabaseCountResult, label: string) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "count failed"}`);
  }

  return result.count ?? 0;
}

function isMissingRestaurantRequestLifecycleError(error: SupabaseRouteError | null | undefined) {
  if (!error) return false;
  if (error.code === "42703") return true;

  return /column\\s+restaurant_requests\\.(status|reviewed_by_admin_id|reviewed_at|admin_note|rejection_reason|review_audit_id|updated_at)\\s+does\\s+not\\s+exist/i.test(
    error.message ?? "",
  );
}

async function isRestaurantRequestLifecycleMissing(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
) {
  const probe = await supabase.from("restaurant_requests").select("status").limit(1);
  return isMissingRestaurantRequestLifecycleError(probe.error);
}

async function countPendingRestaurantRequests(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
) {
  const scopedResult = await supabase
    .from("restaurant_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (!scopedResult.error) {
    return {
      count: scopedResult.count ?? 0,
      lifecycleColumnsAvailable: true,
    };
  }

  if (!(await isRestaurantRequestLifecycleMissing(supabase))) {
    throw new Error(`restaurant_requests: ${scopedResult.error.message || "count failed"}`);
  }

  const legacyResult = await supabase
    .from("restaurant_requests")
    .select("id", { count: "exact", head: true });

  if (legacyResult.error) {
    throw new Error(
      `restaurant_requests: ${scopedResult.error.message || legacyResult.error.message || "count failed"}`,
    );
  }

  return {
    count: legacyResult.count ?? 0,
    lifecycleColumnsAvailable: false,
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

    return NextResponse.json({
      submissions: submissionsCount + recommendationRequestsCount,
      recommendationRequests: recommendationRequestsCount,
      reviews: normalizeCount(reviewsResult, "reviews"),
      recommendationRequestsLifecycleReady: recommendationRequestsResult.lifecycleColumnsAvailable,
    });
  } catch (error) {
    console.error("[admin/pending-counts] failed:", error);
    return NextResponse.json(
      { error: "Failed to load admin pending counts." },
      { status: 500 },
    );
  }
}
