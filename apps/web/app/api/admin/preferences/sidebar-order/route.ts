import { NextRequest, NextResponse } from "next/server";

import { normalizeAdminSidebarOrder } from "@/lib/admin/sidebar-order";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const SIDEBAR_ORDER_KEY = "admin_sidebar_order";

type PreferenceRow = {
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isAdminPreferenceUserIdPersistable(userId: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId,
  );
}


export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      return NextResponse.json(
        { order: normalizeAdminSidebarOrder(null) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("admin_user_preferences")
      .select("value")
      .eq("user_id", auth.userId)
      .eq("preference_key", SIDEBAR_ORDER_KEY)
      .maybeSingle()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminSidebarOrder(data?.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[admin/preferences/sidebar-order] failed to read sidebar order:",
      error,
    );
    return NextResponse.json(
      { error: "사이드바 순서를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      const body = await request.json().catch(() => null);
      return NextResponse.json(
        { order: normalizeAdminSidebarOrder(isRecord(body) ? body.order : null) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = await request.json().catch(() => null);
    const order = normalizeAdminSidebarOrder(
      isRecord(body) ? body.order : null,
    );
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("admin_user_preferences")
      .upsert(
        {
          user_id: auth.userId,
          preference_key: SIDEBAR_ORDER_KEY,
          value: order,
        },
        { onConflict: "user_id,preference_key" },
      )
      .select("value")
      .single()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminSidebarOrder(data.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[admin/preferences/sidebar-order] failed to save sidebar order:",
      error,
    );
    return NextResponse.json(
      { error: "사이드바 순서를 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
