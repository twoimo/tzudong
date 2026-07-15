import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PRIVACY_UNSAFE_VALUE_REASON,
  PrivacyUnsafeValueError,
  assertPrivacySafe,
} from "@/lib/privacy/sanitize";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";

type SubmissionDeleteType = "new" | "edit" | "recommend";
type DeleteSubmissionRpcResult = {
  success: boolean;
  message: string;
};
type DeleteSubmissionRpcResults = DeleteSubmissionRpcResult[];
type RestaurantRequestDeleteRow = {
  id: string;
  user_id: string;
  status: string | null;
};
type SubmissionDeleteRow = {
  id: string;
  user_id: string;
  submission_type: string;
  status: string;
};
type IdRow = {
  id: string;
};

const PRIVACY_REJECTION_MESSAGE = "민감정보가 포함된 요청은 처리할 수 없습니다.";
const MAX_SUBMISSION_DELETE_REQUEST_BYTES = 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function privacyErrorResponse() {
  return noStoreJson(
    { error: PRIVACY_REJECTION_MESSAGE, code: PRIVACY_UNSAFE_VALUE_REASON },
    { status: 400 },
  );
}


function normalizeDeleteType(value: unknown): SubmissionDeleteType | null {
  if (value === "new" || value === "edit" || value === "recommend") {
    return value;
  }

  return null;
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRestaurantRequestDeleteRow(value: unknown): value is RestaurantRequestDeleteRow {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.user_id === "string"
    && (value.status === null || typeof value.status === "string");
}

function isSubmissionDeleteRow(value: unknown): value is SubmissionDeleteRow {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.user_id === "string"
    && typeof value.submission_type === "string"
    && typeof value.status === "string";
}

function isIdRow(value: unknown): value is IdRow {
  return isRecord(value) && typeof value.id === "string";
}

function parseDeleteSubmissionRpcResults(value: unknown): DeleteSubmissionRpcResults | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const [result] = value;
  if (!isRecord(result) || typeof result.success !== "boolean" || typeof result.message !== "string") {
    return null;
  }
  return [{ success: result.success, message: result.message }];
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return noStoreJson({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isTrustedSameOriginMutation(request)) {
      return noStoreJson({ error: "요청을 처리할 수 없습니다." }, { status: 403 });
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_SUBMISSION_DELETE_REQUEST_BYTES);
    if (!requestBody.ok) {
      return noStoreJson(
        { error: "삭제할 내역 정보가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const rawBody = requestBody.value;
    assertPrivacySafe(rawBody);
    const body = isRecord(rawBody) ? rawBody : {};
    const id = normalizeId(body.id);
    const type = normalizeDeleteType(body.type);

    if (!id || !type) {
      return noStoreJson(
        { error: "삭제할 내역 정보가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseServiceRoleClient();

    if (type === "recommend") {
      const { data: requestRow, error: requestFetchError } =
        await supabaseAdmin
          .from("restaurant_requests")
          .select("id,user_id,status")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle()
          .overrideTypes<RestaurantRequestDeleteRow, { merge: false }>();

      if (requestFetchError) throw requestFetchError;
      if (!isRestaurantRequestDeleteRow(requestRow)) {
        return noStoreJson(
          { error: "삭제할 쯔양 맛집 제보 내역을 찾지 못했습니다." },
          { status: 404 },
        );
      }

      if (requestRow.status && requestRow.status !== "pending") {
        return noStoreJson(
          { error: "이미 검토가 완료된 쯔양 맛집 제보는 삭제할 수 없습니다." },
          { status: 409 },
        );
      }

      const { data: deletedRequestRow, error: deleteRequestError } = await supabaseAdmin
        .from("restaurant_requests")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle()
        .overrideTypes<IdRow, { merge: false }>();

      if (deleteRequestError) throw deleteRequestError;
      if (!isIdRow(deletedRequestRow)) {
        return noStoreJson(
          { error: "이미 검토가 완료된 쯔양 맛집 제보는 삭제할 수 없습니다." },
          { status: 409 },
        );
      }

      return noStoreJson({ success: true });
    }

    const { data: submissionRow, error: submissionFetchError } =
      await supabaseAdmin
        .from("restaurant_submissions")
        .select("id,user_id,submission_type,status")
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("submission_type", type)
        .maybeSingle()
        .overrideTypes<SubmissionDeleteRow, { merge: false }>();

    if (submissionFetchError) throw submissionFetchError;
    if (!isSubmissionDeleteRow(submissionRow)) {
      return noStoreJson(
        { error: "삭제할 제보 내역을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    if (submissionRow.status !== "pending") {
      return noStoreJson(
        { error: "이미 검토가 완료된 제보 내역은 삭제할 수 없습니다." },
        { status: 409 },
      );
    }

    const { data: deletionResultData, error: deletionError } = await supabaseAdmin
      .rpc("delete_pending_restaurant_submission", {
        p_submission_id: id,
        p_user_id: user.id,
        p_submission_type: type,
      })
      .overrideTypes<DeleteSubmissionRpcResults, { merge: false }>();

    if (deletionError) throw deletionError;

    const [deletionResult] = parseDeleteSubmissionRpcResults(deletionResultData) ?? [];
    if (!deletionResult?.success) {
      return noStoreJson({ error: "제보 내역을 삭제하지 못했습니다." }, { status: 409 });
    }

    return noStoreJson({ success: true });
  } catch (error) {
    if (error instanceof PrivacyUnsafeValueError) {
      return privacyErrorResponse();
    }
    return noStoreJson(
      { error: "제보 내역 삭제 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
