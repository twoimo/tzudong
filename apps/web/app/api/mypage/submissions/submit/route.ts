import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PRIVACY_UNSAFE_VALUE_REASON,
  PrivacyUnsafeValueError,
  assertPrivacySafe,
} from "@/lib/privacy/sanitize";
import {
  canonicalizeRestaurantSubmissionPayload,
  normalizeRestaurantSubmissionPhone,
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
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";

type SubmitBody = {
  mode: RestaurantSubmissionMode;
  payload: RestaurantSubmissionFormData;
  clientRequestKey: string;
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

const PRIVACY_REJECTION_MESSAGE = "민감정보가 포함된 제보는 저장할 수 없습니다.";
const MAX_SUBMISSION_REQUEST_BYTES = 64 * 1024;
const MAX_RESTAURANT_NAME_LENGTH = 160;
const MAX_RESTAURANT_ADDRESS_LENGTH = 500;
const MAX_RESTAURANT_PHONE_LENGTH = 40;
const MAX_SUBMISSION_CATEGORY_COUNT = 10;
const MAX_SUBMISSION_CATEGORY_LENGTH = 50;
const MAX_YOUTUBE_LINK_LENGTH = 2_048;
const MAX_SUBMISSION_DESCRIPTION_LENGTH = 4_000;
const MAX_CLIENT_REQUEST_KEY_LENGTH = 128;
const SUBMISSION_BODY_KEYS = ["mode", "payload", "clientRequestKey"] as const;
const SUBMISSION_PAYLOAD_KEYS: Record<
  RestaurantSubmissionMode,
  readonly (keyof RestaurantSubmissionFormData)[]
> = {
  new: ["restaurant_name", "address", "phone", "categories", "youtube_link", "description"],
  request: ["restaurant_name", "address", "phone", "categories", "youtube_link", "description"],
};

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function jsonError(message: string, status: number, code?: string) {
  return noStoreJson({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const receivedKeys = Object.keys(value);
  return receivedKeys.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function hasExactCategories(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_SUBMISSION_CATEGORY_COUNT) return false;

  const canonicalCategories = new Set<string>();
  for (const category of value) {
    if (!isBoundedString(category, MAX_SUBMISSION_CATEGORY_LENGTH)) return false;

    const canonicalCategory = category.trim();
    if (!canonicalCategory || canonicalCategories.has(canonicalCategory)) return false;
    canonicalCategories.add(canonicalCategory);
  }

  return true;
}

function isBusinessPhone(value: unknown): value is string {
  if (!isBoundedString(value, MAX_RESTAURANT_PHONE_LENGTH)) return false;
  if (!value.trim()) return true;
  if (!/^[\d().\s-]+$/.test(value)) return false;

  const normalized = normalizeRestaurantSubmissionPhone(value);
  return /^(?:02\d{7,8}|0[3-6]\d{7,8}|1[5-8]\d{6,7})$/.test(normalized);
}

function isExactFormPayload(
  mode: RestaurantSubmissionMode,
  value: unknown,
): value is RestaurantSubmissionFormData {
  if (!isPlainObject(value) || !hasExactKeys(value, SUBMISSION_PAYLOAD_KEYS[mode])) return false;

  return isBoundedString(value.restaurant_name, MAX_RESTAURANT_NAME_LENGTH)
    && isBoundedString(value.address, MAX_RESTAURANT_ADDRESS_LENGTH)
    && isBusinessPhone(value.phone)
    && hasExactCategories(value.categories)
    && isBoundedString(value.youtube_link, MAX_YOUTUBE_LINK_LENGTH)
    && isBoundedString(value.description, MAX_SUBMISSION_DESCRIPTION_LENGTH);
}

function isExactSubmitBody(value: unknown): value is SubmitBody {
  if (!isPlainObject(value) || !hasExactKeys(value, SUBMISSION_BODY_KEYS)) return false;

  const mode = value.mode;
  return (mode === "new" || mode === "request")
    && isBoundedString(value.clientRequestKey, MAX_CLIENT_REQUEST_KEY_LENGTH)
    && value.clientRequestKey === value.clientRequestKey.trim()
    && isExactFormPayload(mode, value.payload);
}
function assertPrivacySafeRawSubmission(body: SubmitBody) {
  const { phone: _phone, ...payload } = body.payload;
  assertPrivacySafe({ ...body, payload });
}

function assertPrivacySafeCanonicalSubmission(expected: CanonicalRestaurantSubmissionPayload) {
  const { phone: _phone, ...payload } = expected;
  assertPrivacySafe(payload, { locationClass: "business" });
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
  assertPrivacySafeCanonicalSubmission(expected);
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

  return noStoreJson({ ok: true, mode: "new", id: row.submission_id, status: row.status });
}

async function submitRequest(
  expected: CanonicalRestaurantSubmissionPayload,
  userId: string,
  clientRequestKey: string,
) {
  assertPrivacySafeCanonicalSubmission(expected);
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

  return noStoreJson({ ok: true, mode: "request", id: requestRow.id, status: requestRow.status });
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

    if (!isTrustedSameOriginMutation(request)) {
      return jsonError("요청을 처리할 수 없습니다.", 403);
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_SUBMISSION_REQUEST_BYTES);
    if (!requestBody.ok) {
      return jsonError("제출 정보가 올바르지 않습니다.", 400);
    }

    const body = requestBody.value;
    if (!isExactSubmitBody(body)) {
      return jsonError("제출 정보가 올바르지 않습니다.", 400);
    }
    assertPrivacySafeRawSubmission(body);

    const { mode, payload: formPayload, clientRequestKey } = body;

    if (!isValidClientRequestKey(clientRequestKey)) {
      return jsonError("제출 식별자가 올바르지 않습니다.", 400);
    }

    const validationError = validateRestaurantSubmission(mode, formPayload);
    if (validationError) {
      return jsonError(validationError, 400);
    }

    const expected = canonicalizeRestaurantSubmissionPayload(mode, formPayload);
    assertPrivacySafeCanonicalSubmission(expected);

    if (mode === "new") {
      return await submitNew(expected, user.id, clientRequestKey);
    }

    return await submitRequest(expected, user.id, clientRequestKey);
  } catch (error) {
    if (error instanceof PrivacyUnsafeValueError) {
      return jsonError(PRIVACY_REJECTION_MESSAGE, 400, PRIVACY_UNSAFE_VALUE_REASON);
    }
    return jsonError("제출 처리 중 오류가 발생했습니다. 다시 시도해주세요.", 500);
  }
}
