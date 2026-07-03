import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import {
  RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE,
  buildMutationAuditReceipt,
} from "@/lib/admin/audit-contract";
import { getAdminSafeErrorName } from "@/lib/admin/guarded-mutation-contract";

export const runtime = "nodejs";

type ReviewAction = "approve" | "reject";
type RouteContext = { params: Promise<{ requestId: string }> };
type RestaurantRequestReviewRow = {
  id: string;
  user_id: string;
  restaurant_name: string;
  origin_address: string | null;
  road_address: string | null;
  jibun_address: string | null;
  english_address: string | null;
  phone: string | null;
  categories: string[] | null;
  recommendation_reason: string | null;
  youtube_link: string | null;
  lat: number | null;
  lng: number | null;
  geocoding_success: boolean | null;
  status: "pending" | "approved" | "rejected" | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  rejection_reason: string | null;
  review_audit_id: string | null;
  created_at: string;
  updated_at: string | null;
};
type ReviewRpcResult = {
  success: boolean;
  message: string;
  audit_id: string | null;
};



const MAX_NOTE_LENGTH = 500;
const REQUEST_SELECT = [
  "id",
  "user_id",
  "restaurant_name",
  "origin_address",
  "road_address",
  "jibun_address",
  "english_address",
  "phone",
  "categories",
  "recommendation_reason",
  "youtube_link",
  "lat",
  "lng",
  "geocoding_success",
  "status",
  "reviewed_by_admin_id",
  "reviewed_at",
  "admin_note",
  "rejection_reason",
  "review_audit_id",
  "created_at",
  "updated_at",
].join(",");

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NOTE_LENGTH);
}

function normalizeAction(value: unknown): ReviewAction | null {
  if (value === "approve" || value === "approved") return "approve";
  if (value === "reject" || value === "rejected") return "reject";
  return null;
}

function conflict(message: string) {
  return NextResponse.json({ success: false, message }, { status: 409 });
}

function getSafeReviewSuccessMessage(action: ReviewAction) {
  return action === "approve"
    ? "맛집 추천 요청을 승인했습니다."
    : "맛집 추천 요청을 반려했습니다.";
}

function getSafeReviewFailureMessage(message: string) {
  if (message.includes("찾을 수 없습니다")) {
    return { status: 404, message: "맛집 추천 요청을 찾을 수 없습니다." };
  }
  return { status: 409, message: "맛집 추천 요청 검토 상태를 변경하지 못했습니다." };
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { requestId } = await context.params;
    const id = normalizeId(decodeURIComponent(requestId || ""));
    if (!id) {
      return NextResponse.json(
        { success: false, message: "검토할 맛집 추천 요청을 찾을 수 없습니다." },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => null);
    const action = normalizeAction(body?.action);
    if (!action) {
      return NextResponse.json(
        { success: false, message: "승인 또는 반려 중 하나를 선택해 주세요." },
        { status: 400 },
      );
    }

    const adminNote = normalizeText(body?.adminNote ?? body?.admin_note);
    const rejectionReason = normalizeText(
      body?.rejectionReason ?? body?.rejection_reason,
    );
    if (action === "reject" && !rejectionReason) {
      return NextResponse.json(
        { success: false, message: "반려 사유를 입력해 주세요." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data: reviewResultData, error: reviewError } = await supabase
      .rpc("review_restaurant_request" as never, {
        p_request_id: id,
        p_admin_user_id: auth.userId,
        p_action: action,
        p_admin_note: adminNote,
        p_rejection_reason: action === "reject" ? rejectionReason : null,
      } as never)
      .returns<ReviewRpcResult>();

    if (reviewError) throw reviewError;

    const reviewResult = Array.isArray(reviewResultData)
      ? reviewResultData[0]
      : reviewResultData;
    if (!reviewResult?.success || !reviewResult.audit_id) {
      const safeFailure = getSafeReviewFailureMessage(reviewResult?.message ?? "");
      if (safeFailure.status === 404) {
        return NextResponse.json({ success: false, message: safeFailure.message }, { status: 404 });
      }
      return conflict(safeFailure.message);
    }

    const auditId = reviewResult.audit_id;
    const { data: reviewedRequest, error: readbackError } = await supabase
      .from("restaurant_requests" as never)
      .select(REQUEST_SELECT)
      .eq("id", id)
      .maybeSingle()
      .returns<RestaurantRequestReviewRow>();

    if (readbackError) throw readbackError;
    if (!reviewedRequest || reviewedRequest.review_audit_id !== auditId) {
      return conflict("검토 상태를 확인하지 못했습니다. 새로고침 후 다시 확인해 주세요.");
    }

    return NextResponse.json({
      success: true,
      request: reviewedRequest,
      auditId,
      audit: buildMutationAuditReceipt({
        domain: "restaurant_request_reviews",
        source: RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE,
        readbackId: auditId,
        correlationId: auditId,
        auditIds: [auditId],
      }),
      message: getSafeReviewSuccessMessage(action),
    });
  } catch (error) {
    console.error("[admin/restaurant-requests/review] guarded mutation failed", {
      domain: "restaurant_request_reviews",
      action: "review_restaurant_request",
      step: "unexpected",
      errorName: getAdminSafeErrorName(error),
    });
    return NextResponse.json(
      { success: false, message: "맛집 추천 요청 검토 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
