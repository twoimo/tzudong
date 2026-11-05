import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const SUBMISSION_SELECT = [
  "id",
  "user_id",
  "submission_type",
  "status",
  "restaurant_name",
  "restaurant_address",
  "restaurant_phone",
  "restaurant_categories",
  "admin_notes",
  "rejection_reason",
  "resolved_by_admin_id",
  "reviewed_at",
  "created_at",
  "updated_at",
].join(",");
const SUBMISSION_ITEM_SELECT = [
  "id",
  "submission_id",
  "youtube_link",
  "tzuyang_review",
  "target_restaurant_id",
  "item_status",
  "rejection_reason",
  "created_at",
].join(",");

function privateNoStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return auth.response;
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("restaurant_submissions")
      .select(SUBMISSION_SELECT)
      .in("status", ["pending", "partially_approved"])
      .order("created_at", { ascending: false })
      .overrideTypes<Array<{ id: string }>, { merge: false }>();

    if (error || !Array.isArray(data)) {
      return privateNoStoreJson({ code: "submission_read_failed" }, { status: 500 });
    }
    if (!data.length) return privateNoStoreJson({ submissions: [], items: [] });

    const { data: items, error: itemsError } = await supabase
      .from("restaurant_submission_items")
      .select(SUBMISSION_ITEM_SELECT)
      .in("submission_id", data.map((submission) => submission.id))
      .order("created_at", { ascending: true });

    if (itemsError || !Array.isArray(items)) {
      return privateNoStoreJson({ code: "submission_read_failed" }, { status: 500 });
    }
    return privateNoStoreJson({ submissions: data, items });
  } catch {
    return privateNoStoreJson({ code: "submission_read_failed" }, { status: 500 });
  }
}
