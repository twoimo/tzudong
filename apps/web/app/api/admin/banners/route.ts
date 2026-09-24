import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const AD_BANNER_SELECT = [
  "id",
  "title",
  "description",
  "image_url",
  "video_url",
  "media_type",
  "link_url",
  "is_active",
  "priority",
  "display_target",
  "created_at",
  "updated_at",
  "created_by",
].join(",");

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("ad_banners")
      .select(AD_BANNER_SELECT)
      .order("priority", { ascending: false });

    if (error) {
      return NextResponse.json({ code: "banner_read_failed" }, { status: 500 });
    }

    return NextResponse.json({ banners: data ?? [] });
  } catch {
    return NextResponse.json({ code: "banner_read_failed" }, { status: 500 });
  }

}
