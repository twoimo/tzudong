import { NextRequest } from "next/server";

import { adminJson, logAdminFixedError } from "@/lib/admin/admin-json";
import { normalizeAdminSidebarOrder } from "@/lib/admin/sidebar-order";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";

const SIDEBAR_ORDER_KEY = "admin_sidebar_order";
const MAX_SIDEBAR_ORDER_REQUEST_BYTES = 4 * 1024;
const MENU_DOMAIN = "preferences";
const ACTION_NAME = "sidebar-order";

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

function logAdminPreferenceError(code: string) {
  logAdminFixedError({
    menu: MENU_DOMAIN,
    action: ACTION_NAME,
    code,
  });
}

function bodyFailureResponse(
  code:
    | typeof BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge
    | typeof BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType
    | "UNREADABLE",
) {
  if (code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge) {
    logAdminPreferenceError("ADMIN_BODY_TOO_LARGE");
    return adminJson({ error: "ADMIN_BODY_TOO_LARGE" }, 413);
  }
  if (code === BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType) {
    logAdminPreferenceError("ADMIN_UNSUPPORTED_MEDIA_TYPE");
    return adminJson({ error: "ADMIN_UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  logAdminPreferenceError("ADMIN_BODY_UNREADABLE");
  return adminJson({ error: "ADMIN_BODY_UNREADABLE" }, 400);
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      return adminJson({ order: normalizeAdminSidebarOrder(null) });
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

    return adminJson({ order: normalizeAdminSidebarOrder(data?.value) });
  } catch {
    logAdminPreferenceError("ADMIN_SIDEBAR_ORDER_UNAVAILABLE");
    return adminJson({ error: "ADMIN_SIDEBAR_ORDER_UNAVAILABLE" }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if (!isTrustedSameOriginMutation(request)) {
      logAdminPreferenceError("ADMIN_ORIGIN_REJECTED");
      return adminJson({ error: "ADMIN_ORIGIN_REJECTED" }, 403);
    }

    const requestBody = await readBoundedJsonRequest(
      request,
      MAX_SIDEBAR_ORDER_REQUEST_BYTES,
    );
    if (!requestBody.ok) {
      if (requestBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge) {
        return bodyFailureResponse(BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge);
      }
      if (requestBody.code === BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType) {
        return bodyFailureResponse(
          BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
        );
      }
      return bodyFailureResponse("UNREADABLE");
    }
    if (!isRecord(requestBody.value) || !isRecord(requestBody.value.order)) {
      return bodyFailureResponse("UNREADABLE");
    }
    if (!isAdminPreferenceUserIdPersistable(auth.userId)) {
      return adminJson({
        order: normalizeAdminSidebarOrder(requestBody.value.order),
      });
    }
    const order = normalizeAdminSidebarOrder(requestBody.value.order);
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

    return adminJson({ order: normalizeAdminSidebarOrder(data.value) });
  } catch {
    logAdminPreferenceError("ADMIN_SIDEBAR_ORDER_UNAVAILABLE");
    return adminJson({ error: "ADMIN_SIDEBAR_ORDER_UNAVAILABLE" }, 500);
  }
}

