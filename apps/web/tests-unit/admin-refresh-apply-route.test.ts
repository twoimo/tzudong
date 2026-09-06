import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const actor = "00000000-0000-0000-0000-000000000001";
const candidateId = "00000000-0000-0000-0000-000000000003";
const restaurantId = "00000000-0000-0000-0000-000000000002";
let allowed = true;
let factoryCalls = 0;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let tableCalls: string[] = [];
let updates: Array<{ patch: unknown; filters: unknown[][] }> = [];
let decisionMatched = true;
let candidate: Record<string, unknown>;
let rpcError: { code: string; message: string } | null;
let receipt: Record<string, unknown>;
let readback: Record<string, unknown> | null;

mock.module("@/lib/auth/require-admin", () => ({
  requireAdmin: async () => allowed ? { ok: true, userId: actor }
    : { ok: false, response: new Response("denied", { status: 403 }) },
}));
mock.module("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => {
    factoryCalls++;
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: receipt, error: rpcError };
      },
      from: (table: string) => {
        tableCalls.push(table);
        if (table !== "restaurant_refresh_candidates") throw new Error("unexpected_table_access");
        const value = tableCalls.length === 1 ? candidate : readback;
        const query: Record<string, unknown> = {};
        query.select = () => query;
        let mutation: { patch: unknown; filters: unknown[][] } | undefined;
        query.eq = (...filter: unknown[]) => { mutation?.filters.push(filter); return query; };
        query.update = (patch: unknown) => {
          mutation = { patch, filters: [] }; updates.push(mutation); return query;
        };
        query.single = () => {
          const result = Promise.resolve({ data: mutation ? (decisionMatched ? { id: candidateId } : null) : value, error: null });
          return Object.assign(result, { overrideTypes: () => result });
        };
        return query;
      },
    };
  },
}));
const { POST } = await import("../app/api/admin/restaurant-refresh-history/route");
function request(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/admin/restaurant-refresh-history", {
    method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
  });
}
const applyBody = { action: "decide_candidate", candidate_id: candidateId, decision: "approved", apply: true };

beforeEach(() => {
  allowed = true; factoryCalls = 0; rpcCalls = []; tableCalls = []; rpcError = null; updates = []; decisionMatched = true;
  candidate = { id: candidateId, restaurant_id: restaurantId, candidate_status: "needs_review",
    detected_change_types: ["name"], candidate_snapshot: { name: "fixture", lat: null, lng: null },
    previous_snapshot: { name: "before", phone: null, road_address: null, jibun_address: null,
      lat: 37, lng: 127, updated_at: "2026-01-01T00:00:00Z" } };
  receipt = { ok: true, readback: true, candidate_status: "applied", candidate_id: candidateId,
    restaurant_id: restaurantId, audit_id: "00000000-0000-0000-0000-000000000004", preview_hash: "a".repeat(64) };
  readback = { id: candidateId, candidate_status: "applied", operator_decision: "approved",
    decided_by_admin_id: actor, applied_at: "2026-01-01T01:00:00Z" };
});

describe("restaurant refresh apply RPC boundary", () => {
  test("requireAdmin and origin rejection run before privileged work", async () => {
    allowed = false;
    expect((await POST(request(applyBody))).status).toBe(403);
    expect(factoryCalls).toBe(0);
    allowed = true;
    expect((await POST(request(applyBody, "https://attacker.invalid"))).status).toBe(403);
    expect(factoryCalls).toBe(0);
  });

  test("binds server actor and database preview, returns existing response after committed readback", async () => {
    const res = await POST(request({ ...applyBody, p_actor_user_id: "ignored", patch: { status: "deleted" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, candidate_status: "applied" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpcCalls).toEqual([{ name: "apply_restaurant_refresh_candidate", args: {
      p_actor_user_id: actor, p_candidate_id: candidateId,
      p_expected_previous_snapshot: candidate.previous_snapshot,
      p_expected_candidate_snapshot: candidate.candidate_snapshot, p_operator_notes: null,
    } }]);
    expect(tableCalls).toEqual(["restaurant_refresh_candidates", "restaurant_refresh_candidates"]);
    expect(updates).toHaveLength(0);
  });

  test("closure and empty/null-only patches do not call apply", async () => {
    candidate.detected_change_types = ["closure"];
    expect((await POST(request(applyBody))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
    tableCalls = []; candidate.detected_change_types = [];
    candidate.candidate_snapshot = { lat: null, lng: null };
    expect((await POST(request(applyBody))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("already-decided candidates are rejected without a write", async () => {
    candidate.candidate_status = "applied";
    expect((await POST(request(applyBody))).status).toBe(409);
    expect(rpcCalls).toHaveLength(0);
  });

  test("stale/identity conflicts return fixed responses without diagnostic leakage or retries", async () => {
    for (const code of ["40001", "23505", "42501"]) {
      tableCalls = []; rpcCalls = [];
      rpcError = { code, message: "PRIVATE_PROVIDER_DIAGNOSTIC" };
      const res = await POST(request(applyBody));
      expect(res.status).toBe(409);
      expect(await res.text()).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
      expect(rpcCalls).toHaveLength(1);
      expect(tableCalls).toHaveLength(1);
    }
  });

  test("invalid database input maps to 400", async () => {
    rpcError = { code: "22023", message: "private" };
    expect((await POST(request(applyBody))).status).toBe(400);
  });

  test("non-apply decision is compare-and-set and cannot overwrite a concurrently applied candidate", async () => {
    const body = { ...applyBody, decision: "rejected", apply: false };
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, candidate_status: "rejected" });
    expect(updates[0].filters).toEqual([["id", candidateId], ["candidate_status", "needs_review"]]);
    expect(rpcCalls).toHaveLength(0);
    tableCalls = []; updates = []; decisionMatched = false;
    expect((await POST(request(body))).status).toBe(409);
  });

  test("wrong receipt or failed committed readback never reports success or retries", async () => {
    receipt.candidate_id = "wrong";
    expect((await POST(request(applyBody))).status).toBe(500);
    expect(rpcCalls).toHaveLength(1);
    tableCalls = []; rpcCalls = []; receipt.candidate_id = candidateId; readback = null;
    expect((await POST(request(applyBody))).status).toBe(500);
    expect(rpcCalls).toHaveLength(1);
  });
});
