import { describe, expect, test } from "bun:test";

const cron = await import("../scripts/restaurant-refresh-cron.mjs");

const baseRestaurant = {
  id: "restaurant-1",
  approved_name: "옛상호",
  naver_name: null,
  google_name: null,
  origin_name: "옛상호",
  phone: "02-111-2222",
  road_address: "서울특별시 마포구 망원로 1",
  jibun_address: "서울특별시 마포구 망원동 1-1",
  english_address: null,
  lat: 37.55,
  lng: 126.9,
  updated_at: "2026-05-31T00:00:00Z",
};

describe("restaurant refresh cron", () => {
  test("builds phone-first queries from approved restaurant state", () => {
    const queries = cron.buildQueriesForRestaurant(baseRestaurant, 4);
    expect(queries[0]).toBe("02-111-2222");
    expect(queries.some((query: string) => query.includes("옛상호"))).toBe(true);
    expect(queries.some((query: string) => query.includes("마포구"))).toBe(true);
  });

  test("records candidate snapshots for name phone and address drift without auto apply", () => {
    const candidate = cron.buildCandidateFromLocalItems(baseRestaurant, [{
      title: "<b>새상호</b>",
      telephone: "02-333-4444",
      roadAddress: "서울특별시 마포구 망원로 9",
      address: "서울특별시 마포구 망원동 9-1",
      category: "한식>백반",
      link: "https://example.test/place",
      mapx: "1269000000",
      mapy: "375500000",
    }], "2026-05-31T01:00:00Z", "옛상호 마포구");

    expect(candidate).not.toBeNull();
    expect(candidate.detected_change_types).toEqual(["name", "phone", "address"]);
    expect(candidate.candidate_snapshot.name).toBe("새상호");
    expect(candidate.evidence.source).toBe("naver_local_api");
  });

  test("turns all-local no-result into review-only closure candidate", () => {
    const candidate = cron.buildNoResultCandidate(baseRestaurant, [
      { query: "02-111-2222", status: "ok", items: [] },
      { query: "옛상호 마포구", status: "ok", items: [] },
    ], "2026-05-31T01:00:00Z");

    expect(candidate.detected_change_types).toEqual(["closure"]);
    expect(candidate.candidate_snapshot.business_state).toBe("not_found_needs_review");
    expect(candidate.evidence.decision_boundary).toContain("review_only");
  });

  test("readback mismatch creates a new review candidate instead of silently accepting drift", () => {
    const mismatch = cron.buildReadbackMismatchCandidate({
      id: "candidate-1",
      restaurant_id: "restaurant-1",
      candidate_snapshot: {
        name: "새상호",
        phone: "02-333-4444",
        road_address: "서울특별시 마포구 망원로 9",
      },
      applied_at: "2026-05-31T02:00:00Z",
    }, baseRestaurant, "2026-05-31T03:00:00Z");

    expect(mismatch.detected_change_types).toContain("readback_mismatch");
    expect(mismatch.evidence.applied_candidate_id).toBe("candidate-1");
  });
});
