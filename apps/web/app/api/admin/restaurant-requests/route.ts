import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const REQUEST_SELECT = [
  "id", "user_id", "restaurant_name", "origin_address", "road_address", "jibun_address",
  "english_address", "phone", "categories", "recommendation_reason", "youtube_link",
  "status", "reviewed_by_admin_id", "reviewed_at", "admin_note", "rejection_reason",
  "review_audit_id", "created_at", "updated_at",
].join(",");
const REQUEST_LEGACY_SELECT = [
  "id", "user_id", "restaurant_name", "origin_address", "road_address", "jibun_address",
  "english_address", "phone", "categories", "recommendation_reason", "youtube_link", "created_at",
].join(",");

function privateNoStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

function isMissingLifecycleColumn(error: { code?: string } | null) {
  return error?.code === "42703";
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return auth.response;
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const current = await supabase
      .from("restaurant_requests")
      .select(REQUEST_SELECT)
      .in("status", ["pending", "approved", "rejected"])
      .order("created_at", { ascending: false });

    if (!current.error) return privateNoStoreJson({ requests: current.data ?? [], legacy: false });
    if (!isMissingLifecycleColumn(current.error)) {
      return privateNoStoreJson({ code: "request_read_failed" }, { status: 500 });
    }

    const legacy = await supabase
      .from("restaurant_requests")
      .select(REQUEST_LEGACY_SELECT)
      .order("created_at", { ascending: false });
    if (legacy.error) return privateNoStoreJson({ code: "request_read_failed" }, { status: 500 });
    return privateNoStoreJson({ requests: legacy.data ?? [], legacy: true });
  } catch {
    return privateNoStoreJson({ code: "request_read_failed" }, { status: 500 });
  }
}
