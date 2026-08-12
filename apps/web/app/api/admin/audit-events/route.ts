import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_USER_AUDIT_ACTIONS,
  ADMIN_USER_AUDIT_COUNT_KEYS,
  ADMIN_USER_AUDIT_FLAG_KEYS,
  ADMIN_USER_AUDIT_STATUSES,
  isAdminUserAuditReasonCode,
} from "@/lib/admin/user-audit";
import {
  ADMIN_AUDIT_PRIMARY_SOURCE,
  getAdminAuditCoverage,
} from "@/lib/admin/audit-contract";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_AUDIT_COUNT = 1_000_000_000;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type AuditCounts = Partial<Record<(typeof ADMIN_USER_AUDIT_COUNT_KEYS)[number], number>>;
type AuditFlags = Partial<Record<(typeof ADMIN_USER_AUDIT_FLAG_KEYS)[number], boolean>>;

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function toSafeIdentifier(value: unknown) {
  return typeof value === "string" && SAFE_IDENTIFIER_PATTERN.test(value) ? value : null;
}

function toSafeDateTime(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toBoundedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function toSafeCounts(value: unknown): AuditCounts {
  const record = toBoundedRecord(value);
  if (!record) return {};

  const counts: AuditCounts = {};
  for (const key of Object.keys(record).slice(0, ADMIN_USER_AUDIT_COUNT_KEYS.length)) {
    if (!(ADMIN_USER_AUDIT_COUNT_KEYS as readonly string[]).includes(key)) continue;
    const entry = record[key];
    if (
      typeof entry === "number"
      && Number.isSafeInteger(entry)
      && entry >= 0
      && entry <= MAX_AUDIT_COUNT
    ) {
      counts[key as (typeof ADMIN_USER_AUDIT_COUNT_KEYS)[number]] = entry;
    }
  }
  return counts;
}

function toSafeFlags(value: unknown): AuditFlags {
  const record = toBoundedRecord(value);
  if (!record) return {};

  const flags: AuditFlags = {};
  for (const key of Object.keys(record).slice(0, ADMIN_USER_AUDIT_FLAG_KEYS.length)) {
    if (!(ADMIN_USER_AUDIT_FLAG_KEYS as readonly string[]).includes(key)) continue;
    const entry = record[key];
    if (typeof entry === "boolean") {
      flags[key as (typeof ADMIN_USER_AUDIT_FLAG_KEYS)[number]] = entry;
    }
  }
  return flags;
}

function toAuditEvent(value: unknown) {
  const row = toBoundedRecord(value);
  if (!row) return null;

  const id = toSafeIdentifier(row.id);
  const action = typeof row.action === "string"
    && (ADMIN_USER_AUDIT_ACTIONS as readonly string[]).includes(row.action)
    ? row.action
    : null;
  const status = typeof row.status === "string"
    && (ADMIN_USER_AUDIT_STATUSES as readonly string[]).includes(row.status)
    ? row.status
    : null;

  if (!id || !action || !status || !isAdminUserAuditReasonCode(row.reason)) return null;

  return {
    id,
    actorUserId: toSafeIdentifier(row.actor_user_id),
    targetUserId: toSafeIdentifier(row.target_user_id),
    action,
    status,
    reasonCode: row.reason,
    errorCode: isAdminUserAuditReasonCode(row.error_code) ? row.error_code : null,
    correlationId: toSafeIdentifier(row.correlation_id),
    counts: toSafeCounts(row.audit_counts),
    flags: toSafeFlags(row.audit_flags),
    appliedAt: toSafeDateTime(row.applied_at),
    createdAt: toSafeDateTime(row.created_at),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
  const supabase = createSupabaseServiceRoleClient();

  try {
    const { data, error } = await supabase
      .rpc("read_admin_user_audit_events", { p_limit: limit });

    if (error) throw error;

    const rawEvents = data ?? [];
    if (rawEvents.length > limit) {
      throw new Error('관리자 감사 조회 응답이 허용 범위를 초과했습니다.');
    }
    const events = rawEvents.map(toAuditEvent);
    if (events.some((event) => event === null)) {
      throw new Error('관리자 감사 조회 응답이 유효하지 않습니다.');
    }

    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        source: ADMIN_AUDIT_PRIMARY_SOURCE,
        events: events as Array<NonNullable<(typeof events)[number]>>,
        unavailable: null,
        coverage: getAdminAuditCoverage(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("[admin/audit-events] admin audit read failed", {
      domain: "admin_user_management",
      code: "ADMIN_AUDIT_EVENTS_READ_FAILED",
    });
    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        source: ADMIN_AUDIT_PRIMARY_SOURCE,
        events: [],
        unavailable: {
          reason: "admin-audit-events-read-failed",
          message: "감사 로그를 읽지 못했습니다. 관리자 권한과 감사 기록 상태를 확인해 주세요.",
        },
        coverage: getAdminAuditCoverage(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
