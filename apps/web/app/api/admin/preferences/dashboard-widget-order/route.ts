import { NextRequest, NextResponse } from "next/server";

import { normalizeAdminDashboardWidgetOrder } from "@/lib/admin/dashboard-widget-order";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";

const DASHBOARD_WIDGET_ORDER_KEY = "admin_dashboard_widget_order";
const MAX_DASHBOARD_WIDGET_ORDER_REQUEST_BYTES = 4 * 1024;

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
        { order: normalizeAdminDashboardWidgetOrder(null) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }


    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("admin_user_preferences")
      .select("value")
      .eq("user_id", auth.userId)
      .eq("preference_key", DASHBOARD_WIDGET_ORDER_KEY)
      .maybeSingle()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminDashboardWidgetOrder(data?.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin/preferences/dashboard-widget-order] failed to read widget order:");
    return NextResponse.json(
      { error: "KPI 카드 순서를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isTrustedSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const requestBody = await readBoundedJsonRequest(
      request,
      MAX_DASHBOARD_WIDGET_ORDER_REQUEST_BYTES,
    );
    const body = requestBody.ok ? requestBody.value : null;
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      return NextResponse.json(
        { order: normalizeAdminDashboardWidgetOrder(isRecord(body) ? body.order : null) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const order = normalizeAdminDashboardWidgetOrder(
      isRecord(body) ? body.order : null,
    );
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("admin_user_preferences")
      .upsert(
        {
          user_id: auth.userId,
          preference_key: DASHBOARD_WIDGET_ORDER_KEY,
          value: order,
        },
        { onConflict: "user_id,preference_key" },
      )
      .select("value")
      .single()
      .returns<PreferenceRow>();

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminDashboardWidgetOrder(data.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin/preferences/dashboard-widget-order] failed to save widget order:");
    return NextResponse.json(
      { error: "KPI 카드 순서를 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isTrustedSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      return NextResponse.json(
        { order: normalizeAdminDashboardWidgetOrder(null) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("admin_user_preferences")
      .delete()
      .eq("user_id", auth.userId)
      .eq("preference_key", DASHBOARD_WIDGET_ORDER_KEY);

    if (error) throw error;

    return NextResponse.json(
      { order: normalizeAdminDashboardWidgetOrder(null) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin/preferences/dashboard-widget-order] failed to reset widget order:");
    return NextResponse.json(
      { error: "KPI 카드 순서를 초기화하지 못했습니다." },
      { status: 500 },
    );
  }
}
