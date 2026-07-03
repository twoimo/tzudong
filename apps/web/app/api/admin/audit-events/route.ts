import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function toSafeString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSafeObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
  const supabase = createSupabaseServiceRoleClient();

  try {
    const { data, error } = await supabase
      .from("admin_audit_events")
      .select(
        "id,actor_user_id,target_user_id,action,reason,status,correlation_id,applied_at,error_code,created_at,after_state",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const events = (data ?? []).map((event) => {
      const row = event as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        actorUserId: toSafeString(row.actor_user_id),
        targetUserId: toSafeString(row.target_user_id),
        action: toSafeString(row.action) ?? "unknown",
        reason: toSafeString(row.reason),
        status: toSafeString(row.status) ?? "unknown",
        correlationId: toSafeString(row.correlation_id),
        appliedAt: toSafeString(row.applied_at),
        errorCode: toSafeString(row.error_code),
        createdAt: toSafeString(row.created_at),
        afterState: toSafeObject(row.after_state),
      };
    });

    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        source: "admin_audit_events",
        events,
        unavailable: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin/audit-events] failed to read admin audit events:", error);
    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        source: "admin_audit_events",
        events: [],
        unavailable: {
          reason: "admin-audit-events-read-failed",
          message: "감사 로그를 읽지 못했습니다. 데이터베이스 권한과 admin_audit_events 마이그레이션 상태를 확인해 주세요.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
