import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type SubmissionDeleteType = "new" | "edit" | "recommend";
type DeleteSubmissionRpcResult = {
  success: boolean;
  message: string;
};


function normalizeDeleteType(value: unknown): SubmissionDeleteType | null {
  if (value === "new" || value === "edit" || value === "recommend") {
    return value;
  }

  return null;
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const id = normalizeId(body?.id);
    const type = normalizeDeleteType(body?.type);

    if (!id || !type) {
      return NextResponse.json(
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
          .maybeSingle();

      if (requestFetchError) throw requestFetchError;
      if (!requestRow) {
        return NextResponse.json(
          { error: "삭제할 쯔양 맛집 제보 내역을 찾지 못했습니다." },
          { status: 404 },
        );
      }

      if (requestRow.status && requestRow.status !== "pending") {
        return NextResponse.json(
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
        .maybeSingle();

      if (deleteRequestError) throw deleteRequestError;
      if (!deletedRequestRow) {
        return NextResponse.json(
          { error: "이미 검토가 완료된 쯔양 맛집 제보는 삭제할 수 없습니다." },
          { status: 409 },
        );
      }

      return NextResponse.json({ success: true });
    }

    const { data: submissionRow, error: submissionFetchError } =
      await supabaseAdmin
        .from("restaurant_submissions")
        .select("id,user_id,submission_type,status")
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("submission_type", type)
        .maybeSingle();

    if (submissionFetchError) throw submissionFetchError;
    if (!submissionRow) {
      return NextResponse.json(
        { error: "삭제할 제보 내역을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    if (submissionRow.status !== "pending") {
      return NextResponse.json(
        { error: "이미 검토가 완료된 제보 내역은 삭제할 수 없습니다." },
        { status: 409 },
      );
    }

    const { data: deletionResultData, error: deletionError } = await supabaseAdmin
      .rpc("delete_pending_restaurant_submission" as never, {
        p_submission_id: id,
        p_user_id: user.id,
        p_submission_type: type,
      } as never)
      .returns<DeleteSubmissionRpcResult>();

    if (deletionError) throw deletionError;

    const deletionResult = Array.isArray(deletionResultData)
      ? deletionResultData[0]
      : deletionResultData;
    if (!deletionResult?.success) {
      const message = deletionResult?.message || "제보 내역을 삭제하지 못했습니다.";
      if (message.includes("찾지 못했습니다")) {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[mypage/submissions/delete] failed:", error);
    return NextResponse.json(
      { error: "제보 내역 삭제 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
