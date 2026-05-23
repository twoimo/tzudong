import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type SubmissionDeleteType = "new" | "edit" | "recommend";

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
          .select("id,user_id")
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

      const { error: deleteRequestError } = await supabaseAdmin
        .from("restaurant_requests")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (deleteRequestError) throw deleteRequestError;

      return NextResponse.json({ success: true });
    }

    const { data: submissionRow, error: submissionFetchError } =
      await supabaseAdmin
        .from("restaurant_submissions")
        .select("id,user_id,submission_type")
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

    const { error: deleteItemsError } = await supabaseAdmin
      .from("restaurant_submission_items")
      .delete()
      .eq("submission_id", id);

    if (deleteItemsError) throw deleteItemsError;

    const { error: deleteSubmissionError } = await supabaseAdmin
      .from("restaurant_submissions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("submission_type", type);

    if (deleteSubmissionError) throw deleteSubmissionError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[mypage/submissions/delete] failed:", error);
    return NextResponse.json(
      { error: "제보 내역 삭제 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
