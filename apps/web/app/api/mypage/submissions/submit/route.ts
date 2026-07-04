import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import {
  canonicalizeRestaurantSubmissionPayload,
  isValidClientRequestKey,
  restaurantSubmissionCoreMatches,
  restaurantSubmissionRequestReadbackMatches,
  type CanonicalRestaurantSubmissionPayload,
} from "@/lib/restaurant-submission-submit-contract";
import {
  validateRestaurantSubmission,
  type RestaurantSubmissionFormData,
  type RestaurantSubmissionMode,
} from "@/lib/restaurant-submission-flow";

export const runtime = "nodejs";

type SubmitBody = {
  mode?: unknown;
  payload?: Partial<RestaurantSubmissionFormData> | null;
  clientRequestKey?: unknown;
};

type SubmitRpcRow = {
  submission_id: string;
  item_id: string;
  user_id: string;
  submission_type: string;
  client_submission_key: string;
  status: string;
  restaurant_name: string;
  restaurant_address: string;
  restaurant_phone: string | null;
  restaurant_categories: string[] | null;
  youtube_link: string;
  tzuyang_review: string | null;
};

type RequestReadbackRow = {
  id: string;
  user_id: string;
  restaurant_name: string;
  origin_address: string | null;
  phone: string | null;
  categories: string[] | null;
  recommendation_reason: string | null;
  youtube_link: string | null;
  client_request_key: string | null;
  status: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normalizeMode(value: unknown): RestaurantSubmissionMode | null {
  return value === "new" || value === "request" ? value : null;
}

function normalizeFormPayload(value: SubmitBody["payload"]): RestaurantSubmissionFormData | null {
  if (!value || typeof value !== "object") return null;

  return {
    restaurant_name: typeof value.restaurant_name === "string" ? value.restaurant_name : "",
    address: typeof value.address === "string" ? value.address : "",
    phone: typeof value.phone === "string" ? value.phone : "",
    categories: Array.isArray(value.categories)
      ? value.categories
          .filter((category): category is string => typeof category === "string")
          .map((category) => category.trim())
          .filter(Boolean)
      : [],
    youtube_link: typeof value.youtube_link === "string" ? value.youtube_link : "",
    description: typeof value.description === "string" ? value.description : "",
  };
}

async function readBackRequest(
  supabaseAdmin: ReturnType<typeof createSupabaseServiceRoleClient>,
  userId: string,
  clientRequestKey: string,
) {
  const { data, error } = await supabaseAdmin
    .from("restaurant_requests")
    .select("id,user_id,restaurant_name,origin_address,phone,categories,recommendation_reason,youtube_link,client_request_key,status")
    .eq("user_id", userId)
    .eq("client_request_key", clientRequestKey)
    .maybeSingle();

  if (error) throw error;
  return data as RequestReadbackRow | null;
}

function verifyNewReadback(
  row: SubmitRpcRow | null,
  expected: CanonicalRestaurantSubmissionPayload,
  userId: string,
  clientRequestKey: string,
): row is SubmitRpcRow {
  return Boolean(row)
    && row?.user_id === userId
    && row.submission_type === "new"
    && row.client_submission_key === clientRequestKey
    && row.status === "pending"
    && Boolean(row.item_id)
    && restaurantSubmissionCoreMatches(expected, row)
    && row.youtube_link === expected.youtube_link
    && ((row.tzuyang_review ?? null) === (expected.description || null));
}

async function submitNew(
  expected: CanonicalRestaurantSubmissionPayload,
  userId: string,
  clientRequestKey: string,
) {
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const { data, error } = await supabaseAdmin
    .rpc("submit_restaurant_submission" as never, {
      p_user_id: userId,
      p_submission_type: "new",
      p_client_submission_key: clientRequestKey,
      p_restaurant_name: expected.restaurant_name,
      p_restaurant_address: expected.address,
      p_restaurant_phone: expected.phone,
      p_restaurant_categories: expected.categories.length > 0 ? expected.categories : null,
      p_youtube_link: expected.youtube_link,
      p_tzuyang_review: expected.description || null,
    } as never);

  const rpcRows = data as SubmitRpcRow[] | SubmitRpcRow | null;

  if (error) throw error;

  const row = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) ?? null;
  if (!verifyNewReadback(row, expected, userId, clientRequestKey)) {
    return jsonError("제보 저장 확인에 실패했습니다. 다시 시도해주세요.", 409);
  }

  return NextResponse.json({ ok: true, mode: "new", id: row.submission_id, status: row.status });
}

async function submitRequest(
  expected: CanonicalRestaurantSubmissionPayload,
  userId: string,
  clientRequestKey: string,
) {
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const insertPayload = {
    user_id: userId,
    restaurant_name: expected.restaurant_name,
    origin_address: expected.address,
    phone: expected.phone,
    categories: expected.categories.length > 0 ? expected.categories : null,
    recommendation_reason: expected.description,
    youtube_link: expected.youtube_link,
    client_request_key: clientRequestKey,
    status: "pending",
  };

  const { error: insertError } = await supabaseAdmin
    .from("restaurant_requests")
    .insert(insertPayload as never)
    .select("id")
    .single();

  if (insertError) {
    const existing = await readBackRequest(supabaseAdmin, userId, clientRequestKey);
    if (!existing) throw insertError;
  }

  const requestRow = await readBackRequest(supabaseAdmin, userId, clientRequestKey);
  if (!requestRow || !restaurantSubmissionRequestReadbackMatches(expected, requestRow, clientRequestKey)) {
    return jsonError("맛집 추천 저장 확인에 실패했습니다. 다시 시도해주세요.", 409);
  }

  return NextResponse.json({ ok: true, mode: "request", id: requestRow.id, status: requestRow.status });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const body = await request.json().catch(() => null) as SubmitBody | null;
    const mode = normalizeMode(body?.mode);
    const formPayload = normalizeFormPayload(body?.payload);
    const clientRequestKey = typeof body?.clientRequestKey === "string" ? body.clientRequestKey.trim() : "";

    if (!mode || !formPayload) {
      return jsonError("제출 정보가 올바르지 않습니다.", 400);
    }

    if (!isValidClientRequestKey(clientRequestKey)) {
      return jsonError("제출 식별자가 올바르지 않습니다.", 400);
    }

    const validationError = validateRestaurantSubmission(mode, formPayload);
    if (validationError) {
      return jsonError(validationError, 400);
    }

    const expected = canonicalizeRestaurantSubmissionPayload(mode, formPayload);

    if (mode === "new") {
      return await submitNew(expected, user.id, clientRequestKey);
    }

    return await submitRequest(expected, user.id, clientRequestKey);
  } catch (error) {
    console.error("[mypage/submissions/submit] failed:", error);
    return jsonError("제출 처리 중 오류가 발생했습니다. 다시 시도해주세요.", 500);
  }
}
