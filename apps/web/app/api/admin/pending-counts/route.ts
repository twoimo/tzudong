import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type SupabaseCountResult = {
  count: number | null;
  error: { message?: string } | null;
};

function normalizeCount(result: SupabaseCountResult, label: string) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "count failed"}`);
  }

  return result.count ?? 0;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  try {
    const [submissionsResult, reviewsResult] = await Promise.all([
      supabase
        .from("restaurant_submissions")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "partially_approved"]),
      supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .eq("is_verified", false),
    ]);

    return NextResponse.json({
      submissions: normalizeCount(submissionsResult, "restaurant_submissions"),
      reviews: normalizeCount(reviewsResult, "reviews"),
    });
  } catch (error) {
    console.error("[admin/pending-counts] failed:", error);
    return NextResponse.json(
      { error: "Failed to load admin pending counts." },
      { status: 500 },
    );
  }
}
