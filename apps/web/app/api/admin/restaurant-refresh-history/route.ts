import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";
import type { Database, Json } from "@/integrations/supabase/types";

export const runtime = "nodejs";

type RefreshCandidateStatus = "needs_review" | "approved" | "rejected" | "applied" | "superseded";
type CandidateDecision = "approved" | "rejected" | "superseded";

// record_candidate carries nested candidate_snapshot, query, and evidence records.
const MAX_REFRESH_HISTORY_REQUEST_BYTES = 16 * 1024;

type JsonObject = { [key: string]: Json | undefined };
type RestaurantPatch = Database["public"]["Tables"]["restaurants"]["Update"];
type CandidateDecisionRow = {
  id: string;
  restaurant_id: string;
  candidate_status: RefreshCandidateStatus;
  detected_change_types: string[] | null;
  candidate_snapshot: JsonObject;
};
type IdRow = {
  id: string;
};
type RefreshHistorySummary = {
  approved_restaurants_total: number | null;
  needs_review: number;
  approved: number;
  rejected: number;
  applied: number;
  superseded: number;
  last_checked_at: string | null;
};
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
  previous_snapshot: JsonObject;
  candidate_snapshot: JsonObject;
  evidence: JsonObject | null;
  operator_decision: string | null;
  decided_at: string | null;
  applied_at: string | null;
  created_at: string;
};

type ReadbackRunRow = {
  id: string;
  restaurant_id: string;
  status: string | null;
  query: JsonObject | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isJsonValue(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRefreshCandidateStatus(value: unknown): value is RefreshCandidateStatus {
  return value === "needs_review"
    || value === "approved"
    || value === "rejected"
    || value === "applied"
    || value === "superseded";
}

function isCandidateDecision(value: unknown): value is CandidateDecision {
  return value === "approved" || value === "rejected" || value === "superseded";
}

function isRestaurantRow(value: unknown): value is RestaurantRow {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.approved_name === null || typeof value.approved_name === "string")
    && (value.phone === null || typeof value.phone === "string")
    && (value.road_address === null || typeof value.road_address === "string")
    && (value.jibun_address === null || typeof value.jibun_address === "string")
    && (value.lat === null || typeof value.lat === "number")
    && (value.lng === null || typeof value.lng === "number")
    && (value.status === null || typeof value.status === "string")
    && (value.updated_at === null || typeof value.updated_at === "string");
}

function isCandidateRow(value: unknown): value is CandidateRow {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.restaurant_id === "string"
    && (value.run_id === null || typeof value.run_id === "string")
    && isRefreshCandidateStatus(value.candidate_status)
    && (value.detected_change_types === null || isStringArray(value.detected_change_types))
    && isJsonObject(value.previous_snapshot)
    && isJsonObject(value.candidate_snapshot)
    && (value.evidence === null || isJsonObject(value.evidence))
    && (value.operator_decision === null || typeof value.operator_decision === "string")
    && (value.decided_at === null || typeof value.decided_at === "string")
    && (value.applied_at === null || typeof value.applied_at === "string")
    && typeof value.created_at === "string";
}

function isReadbackRunRow(value: unknown): value is ReadbackRunRow {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.restaurant_id === "string"
    && (value.status === null || typeof value.status === "string")
    && (value.query === null || isJsonObject(value.query))
    && (value.notes === null || typeof value.notes === "string")
    && (value.completed_at === null || typeof value.completed_at === "string")
    && typeof value.created_at === "string";
}

function isCandidateDecisionRow(value: unknown): value is CandidateDecisionRow {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.restaurant_id === "string"
    && isRefreshCandidateStatus(value.candidate_status)
    && (value.detected_change_types === null || isStringArray(value.detected_change_types))
    && isJsonObject(value.candidate_snapshot);
}

function isIdRow(value: unknown): value is IdRow {
  return isRecord(value) && typeof value.id === "string";
}

function parseRows<T>(value: unknown, isRow: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) throw new Error("Invalid database response.");
  const rows: T[] = [];
  for (const item of value) {
    if (!isRow(item)) throw new Error("Invalid database response.");
    rows.push(item);
  }
  return rows;
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function snapshotFromRestaurant(row: RestaurantRow): JsonObject {
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

function candidatePatchFromSnapshot(snapshot: JsonObject, adminUserId: string): RestaurantPatch {
  const patch: RestaurantPatch = { updated_by_admin_id: adminUserId };
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

function hasMaterialRestaurantPatch(patch: RestaurantPatch) {
  return Object.keys(patch).some((key) => key !== "updated_by_admin_id");
}

function hasClosureChange(types: unknown) {
  return Array.isArray(types) && types.some((type) => type === "closure");
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
    .overrideTypes<RestaurantRow[], { merge: false }>();

  if (error) throw error;
  const restaurants = parseRows(data ?? [], isRestaurantRow);
  return new Map(restaurants.map((row) => [row.id, row]));
}

async function fetchReadbackRunMap(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  candidates: CandidateRow[],
) {
  const appliedCandidateIds = new Set(
    candidates
      .filter((candidate) => candidate.candidate_status === "applied")
      .map((candidate) => candidate.id),
  );
  if (appliedCandidateIds.size === 0) return new Map<string, ReadbackRunRow>();

  const restaurantIds = [
    ...new Set(
      candidates
        .filter((candidate) => appliedCandidateIds.has(candidate.id))
        .map((candidate) => candidate.restaurant_id),
    ),
  ];
  if (restaurantIds.length === 0) return new Map<string, ReadbackRunRow>();

  const { data, error } = await supabase
    .from("restaurant_refresh_runs")
    .select("id, restaurant_id, status, query, notes, completed_at, created_at")
    .eq("run_type", "readback_recrawl")
    .in("restaurant_id", restaurantIds)
    .order("created_at", { ascending: false })
    .limit(200)
    .overrideTypes<ReadbackRunRow[], { merge: false }>();

  if (error) throw error;

  const readbackRunMap = new Map<string, ReadbackRunRow>();
  for (const run of parseRows(data ?? [], isReadbackRunRow)) {
    const appliedCandidateId = stringValue(run.query?.applied_candidate_id);
    if (appliedCandidateId && appliedCandidateIds.has(appliedCandidateId) && !readbackRunMap.has(appliedCandidateId)) {
      readbackRunMap.set(appliedCandidateId, run);
    }
  }
  return readbackRunMap;
}

function readbackStateForCandidate(candidate: CandidateRow, readbackRun?: ReadbackRunRow) {
  if (candidate.candidate_status !== "applied") {
    return { status: "not_required", checked_at: null, run_id: null, notes: null };
  }
  if (!readbackRun) {
    return { status: "pending", checked_at: null, run_id: null, notes: "guarded apply 후 readback/recrawl 대기" };
  }
  return {
    status: readbackRun.status === "failed" ? "failed" : readbackRun.status === "completed" ? "completed" : "pending",
    checked_at: readbackRun.completed_at ?? readbackRun.created_at,
    run_id: readbackRun.id,
    notes: readbackRun.notes,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const requestedStatus = searchParams.get("status");
    const status = isRefreshCandidateStatus(requestedStatus) ? requestedStatus : null;
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
        .overrideTypes<CandidateRow[], { merge: false }>(),
    ]);

    if (countError) throw countError;
    if (candidateError) throw candidateError;

    const candidateRows = parseRows(candidates ?? [], isCandidateRow);
    const [restaurantMap, readbackRunMap] = await Promise.all([
      fetchRestaurantMap(
        supabase,
        candidateRows.map((candidate) => candidate.restaurant_id),
      ),
      fetchReadbackRunMap(supabase, candidateRows),
    ]);

    const rows = candidateRows
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
          readback_state: readbackStateForCandidate(candidate, readbackRunMap.get(candidate.id)),
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

    const summary = rows.reduce<RefreshHistorySummary>(
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
        last_checked_at: null,
      },
    );

    return NextResponse.json({ summary, candidates: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/restaurant-refresh-history] failed to list refresh history:");
    return NextResponse.json({ error: "맛집 최신화 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set("Cache-Control", "no-store");
      return auth.response;
    }

    if (!isTrustedSameOriginMutation(request)) {
      return noStoreJson(
        { error: "요청을 처리할 수 없습니다." },
        { status: 403 },
      );
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_REFRESH_HISTORY_REQUEST_BYTES);
    if (!requestBody.ok) {
      return noStoreJson(
        { error: "요청 본문이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const body = requestBody.value;
    if (!isRecord(body)) {
      return noStoreJson(
        { error: "요청 본문이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const action = stringValue(body.action);
    const supabase = createSupabaseServiceRoleClient();

    if (action === "record_candidate") {
      const restaurantId = stringValue(body.restaurant_id);
      const candidateSnapshot = isJsonObject(body.candidate_snapshot) ? body.candidate_snapshot : null;
      if (!restaurantId || !candidateSnapshot) {
        return NextResponse.json({ error: "restaurant_id와 candidate_snapshot이 필요합니다." }, { status: 400 });
      }

      const { data: restaurant, error: restaurantError } = await supabase
        .from("restaurants")
        .select("id, approved_name, phone, road_address, jibun_address, lat, lng, status, updated_at")
        .eq("id", restaurantId)
        .eq("status", "approved")
        .single()
        .overrideTypes<RestaurantRow, { merge: false }>();

      if (restaurantError || !isRestaurantRow(restaurant)) {
        return NextResponse.json({ error: "승인된 맛집을 찾지 못했습니다." }, { status: 404 });
      }

      const { data: run, error: runError } = await supabase
        .from("restaurant_refresh_runs")
        .insert({
          restaurant_id: restaurantId,
          requested_by_admin_id: auth.userId,
          run_type: stringValue(body.run_type) || "manual_check",
          status: "completed",
          query: isJsonObject(body.query) ? body.query : {},
          source_snapshot: snapshotFromRestaurant(restaurant),
          notes: stringValue(body.notes),
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single()
        .overrideTypes<IdRow, { merge: false }>();

      if (runError || !isIdRow(run)) throw runError;

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
          evidence: isJsonObject(body.evidence) ? body.evidence : {},
          candidate_status: "needs_review",
        })
        .select("id")
        .single()
        .overrideTypes<IdRow, { merge: false }>();

      if (candidateError || !isIdRow(candidate)) throw candidateError;
      return NextResponse.json({ ok: true, candidate_id: candidate.id }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "decide_candidate") {
      const candidateId = stringValue(body.candidate_id);
      const decisionValue = stringValue(body.decision);
      const decision = isCandidateDecision(decisionValue) ? decisionValue : null;
      const apply = body.apply === true;
      if (!candidateId || !decision) {
        return NextResponse.json({ error: "candidate_id와 유효한 decision이 필요합니다." }, { status: 400 });
      }

      const { data: candidate, error: candidateError } = await supabase
        .from("restaurant_refresh_candidates")
        .select("id, restaurant_id, candidate_status, detected_change_types, candidate_snapshot")
        .eq("id", candidateId)
        .single()
        .overrideTypes<CandidateDecisionRow, { merge: false }>();

      if (candidateError || !isCandidateDecisionRow(candidate)) {
        return NextResponse.json({ error: "최신화 후보를 찾지 못했습니다." }, { status: 404 });
      }

      if (candidate.candidate_status !== "needs_review") {
        return NextResponse.json({ error: "이미 결정된 후보입니다." }, { status: 409 });
      }

      const now = new Date().toISOString();
      if (decision === "approved" && apply) {
        if (hasClosureChange(candidate.detected_change_types)) {
          return NextResponse.json(
            { error: "폐업 의심 후보는 자동 guarded apply 대상이 아닙니다. 운영자 결정만 기록하고 별도 검증 후 처리하세요." },
            { status: 400 },
          );
        }
        const patch = candidatePatchFromSnapshot(candidate.candidate_snapshot, auth.userId);
        if (!hasMaterialRestaurantPatch(patch)) {
          return NextResponse.json(
            { error: "적용 가능한 상호명·전화번호·주소·좌표 변경값이 없습니다." },
            { status: 400 },
          );
        }
        const { data: updatedRestaurant, error: updateError } = await supabase
          .from("restaurants")
          .update(patch)
          .eq("id", candidate.restaurant_id)
          .eq("status", "approved")
          .select("id")
          .single()
          .overrideTypes<IdRow, { merge: false }>();
        if (updateError || !isIdRow(updatedRestaurant)) {
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
    console.error("[admin/restaurant-refresh-history] failed to mutate refresh history:");
    return NextResponse.json({ error: "맛집 최신화 이력을 저장하지 못했습니다." }, { status: 500 });
  }
}
