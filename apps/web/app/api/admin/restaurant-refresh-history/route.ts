import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type RefreshCandidateStatus = "needs_review" | "approved" | "rejected" | "applied" | "superseded";
type CandidateDecision = "approved" | "rejected" | "superseded";

type RestaurantRow = {
  id: string;
  approved_name: string | null;
  phone: string | null;
  road_address: string | null;
  jibun_address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  updated_at: string | null;
};

type CandidateRow = {
  id: string;
  restaurant_id: string;
  run_id: string | null;
  candidate_status: RefreshCandidateStatus;
  detected_change_types: string[] | null;
  previous_snapshot: Record<string, unknown>;
  candidate_snapshot: Record<string, unknown>;
  evidence: Record<string, unknown> | null;
  operator_decision: string | null;
  decided_at: string | null;
  applied_at: string | null;
  created_at: string;
};

const candidateStatuses = new Set<RefreshCandidateStatus>([
  "needs_review",
  "approved",
  "rejected",
  "applied",
  "superseded",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function snapshotFromRestaurant(row: RestaurantRow) {
  return {
    name: row.approved_name,
    phone: row.phone,
    road_address: row.road_address,
    jibun_address: row.jibun_address,
    lat: row.lat,
    lng: row.lng,
    updated_at: row.updated_at,
  };
}

function candidatePatchFromSnapshot(snapshot: Record<string, unknown>, adminUserId: string) {
  const patch: Record<string, unknown> = { updated_by_admin_id: adminUserId };
  const name = stringValue(snapshot.name ?? snapshot.approved_name);
  const phone = stringValue(snapshot.phone);
  const roadAddress = stringValue(snapshot.road_address);
  const jibunAddress = stringValue(snapshot.jibun_address);
  const lat = Number(snapshot.lat);
  const lng = Number(snapshot.lng);

  if (name) patch.approved_name = name;
  if (phone !== null) patch.phone = phone;
  if (roadAddress !== null) patch.road_address = roadAddress;
  if (jibunAddress !== null) patch.jibun_address = jibunAddress;
  if (Number.isFinite(lat)) patch.lat = lat;
  if (Number.isFinite(lng)) patch.lng = lng;

  return patch;
}

async function fetchRestaurantMap(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  restaurantIds: string[],
) {
  if (restaurantIds.length === 0) return new Map<string, RestaurantRow>();
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, approved_name, phone, road_address, jibun_address, lat, lng, status, updated_at")
    .in("id", [...new Set(restaurantIds)])
    .returns<RestaurantRow[]>();

  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row]));
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const requestedStatus = searchParams.get("status") as RefreshCandidateStatus | null;
    const status = requestedStatus && candidateStatuses.has(requestedStatus) ? requestedStatus : null;
    const search = searchParams.get("search")?.trim() || "";
    const supabase = createSupabaseServiceRoleClient();

    const countRequest = supabase
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");

    const baseCandidateQuery = supabase
      .from("restaurant_refresh_candidates")
      .select("id, restaurant_id, run_id, candidate_status, detected_change_types, previous_snapshot, candidate_snapshot, evidence, operator_decision, decided_at, applied_at, created_at");
    const filteredCandidateQuery = status
      ? baseCandidateQuery.eq("candidate_status", status)
      : baseCandidateQuery;

    const [{ count, error: countError }, { data: candidates, error: candidateError }] = await Promise.all([
      countRequest,
      filteredCandidateQuery
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<CandidateRow[]>(),
    ]);

    if (countError) throw countError;
    if (candidateError) throw candidateError;

    const restaurantMap = await fetchRestaurantMap(
      supabase,
      (candidates ?? []).map((candidate) => candidate.restaurant_id),
    );

    const rows = (candidates ?? [])
      .map((candidate) => {
        const restaurant = restaurantMap.get(candidate.restaurant_id);
        return {
          id: candidate.id,
          restaurant_id: candidate.restaurant_id,
          restaurant_name: restaurant?.approved_name || stringValue(candidate.previous_snapshot?.name) || "이름 없음",
          restaurant_address: restaurant?.road_address || restaurant?.jibun_address || null,
          current_phone: restaurant?.phone || null,
          candidate_status: candidate.candidate_status,
          detected_change_types: candidate.detected_change_types ?? [],
          previous_snapshot: candidate.previous_snapshot,
          candidate_snapshot: candidate.candidate_snapshot,
          evidence: candidate.evidence ?? {},
          created_at: candidate.created_at,
          decided_at: candidate.decided_at,
          applied_at: candidate.applied_at,
        };
      })
      .filter((row) => {
        if (!search) return true;
        const haystack = [
          row.restaurant_name,
          row.restaurant_address,
          row.current_phone,
          stringValue(row.candidate_snapshot.name),
          stringValue(row.candidate_snapshot.phone),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(search.toLowerCase());
      });

    const summary = rows.reduce(
      (acc, row) => {
        acc[row.candidate_status] += 1;
        if (!acc.last_checked_at || row.created_at > acc.last_checked_at) acc.last_checked_at = row.created_at;
        return acc;
      },
      {
        approved_restaurants_total: count ?? null,
        needs_review: 0,
        approved: 0,
        rejected: 0,
        applied: 0,
        superseded: 0,
        last_checked_at: null as string | null,
      },
    );

    return NextResponse.json({ summary, candidates: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/restaurant-refresh-history] failed to list refresh history:", error);
    return NextResponse.json({ error: "맛집 최신화 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
    }

    const action = stringValue(body.action);
    const supabase = createSupabaseServiceRoleClient();

    if (action === "record_candidate") {
      const restaurantId = stringValue(body.restaurant_id);
      const candidateSnapshot = isRecord(body.candidate_snapshot) ? body.candidate_snapshot : null;
      if (!restaurantId || !candidateSnapshot) {
        return NextResponse.json({ error: "restaurant_id와 candidate_snapshot이 필요합니다." }, { status: 400 });
      }

      const { data: restaurant, error: restaurantError } = await supabase
        .from("restaurants")
        .select("id, approved_name, phone, road_address, jibun_address, lat, lng, status, updated_at")
        .eq("id", restaurantId)
        .eq("status", "approved")
        .single()
        .returns<RestaurantRow>();

      if (restaurantError || !restaurant) {
        return NextResponse.json({ error: "승인된 맛집을 찾지 못했습니다." }, { status: 404 });
      }

      const { data: run, error: runError } = await supabase
        .from("restaurant_refresh_runs")
        .insert({
          restaurant_id: restaurantId,
          requested_by_admin_id: auth.userId,
          run_type: stringValue(body.run_type) || "manual_check",
          status: "completed",
          query: isRecord(body.query) ? body.query : {},
          source_snapshot: snapshotFromRestaurant(restaurant),
          notes: stringValue(body.notes),
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single()
        .returns<{ id: string }>();

      if (runError || !run) throw runError;

      const detectedChangeTypes = Array.isArray(body.detected_change_types)
        ? body.detected_change_types.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : ["manual_review"];

      const { data: candidate, error: candidateError } = await supabase
        .from("restaurant_refresh_candidates")
        .insert({
          restaurant_id: restaurantId,
          run_id: run.id,
          detected_change_types: detectedChangeTypes,
          previous_snapshot: snapshotFromRestaurant(restaurant),
          candidate_snapshot: candidateSnapshot,
          evidence: isRecord(body.evidence) ? body.evidence : {},
          candidate_status: "needs_review",
        })
        .select("id")
        .single()
        .returns<{ id: string }>();

      if (candidateError || !candidate) throw candidateError;
      return NextResponse.json({ ok: true, candidate_id: candidate.id }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "decide_candidate") {
      const candidateId = stringValue(body.candidate_id);
      const decision = stringValue(body.decision) as CandidateDecision | null;
      const apply = body.apply === true;
      if (!candidateId || !decision || !["approved", "rejected", "superseded"].includes(decision)) {
        return NextResponse.json({ error: "candidate_id와 유효한 decision이 필요합니다." }, { status: 400 });
      }

      const { data: candidate, error: candidateError } = await supabase
        .from("restaurant_refresh_candidates")
        .select("id, restaurant_id, candidate_status, candidate_snapshot")
        .eq("id", candidateId)
        .single()
        .returns<{ id: string; restaurant_id: string; candidate_status: RefreshCandidateStatus; candidate_snapshot: Record<string, unknown> }>();

      if (candidateError || !candidate) {
        return NextResponse.json({ error: "최신화 후보를 찾지 못했습니다." }, { status: 404 });
      }

      if (candidate.candidate_status !== "needs_review") {
        return NextResponse.json({ error: "이미 결정된 후보입니다." }, { status: 409 });
      }

      const now = new Date().toISOString();
      if (decision === "approved" && apply) {
        const patch = candidatePatchFromSnapshot(candidate.candidate_snapshot, auth.userId);
        const { data: updatedRestaurant, error: updateError } = await supabase
          .from("restaurants")
          .update(patch)
          .eq("id", candidate.restaurant_id)
          .eq("status", "approved")
          .select("id")
          .single()
          .returns<{ id: string }>();
        if (updateError || !updatedRestaurant) {
          return NextResponse.json({ error: "승인된 맛집에만 최신화 후보를 적용할 수 있습니다." }, { status: 409 });
        }
      }

      const nextStatus: RefreshCandidateStatus = decision === "approved" && apply ? "applied" : decision;
      const { error: decisionError } = await supabase
        .from("restaurant_refresh_candidates")
        .update({
          candidate_status: nextStatus,
          operator_decision: decision,
          operator_notes: stringValue(body.operator_notes),
          decided_by_admin_id: auth.userId,
          decided_at: now,
          applied_at: nextStatus === "applied" ? now : null,
        })
        .eq("id", candidateId);

      if (decisionError) throw decisionError;
      return NextResponse.json({ ok: true, candidate_status: nextStatus }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
  } catch (error) {
    console.error("[admin/restaurant-refresh-history] failed to mutate refresh history:", error);
    return NextResponse.json({ error: "맛집 최신화 이력을 저장하지 못했습니다." }, { status: 500 });
  }
}
