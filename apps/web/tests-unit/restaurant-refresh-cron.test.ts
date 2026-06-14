import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  test("filters ineligible approved restaurants before applying the scan limit", () => {
    const source = readFileSync(join(process.cwd(), "scripts/restaurant-refresh-cron.mjs"), "utf8");
    const statusIndex = source.indexOf(".eq('status', 'approved')");
    const missingIndex = source.indexOf(".not('is_missing', 'is', true)");
    const notSelectedIndex = source.indexOf(".not('is_not_selected', 'is', true)");
    const limitIndex = source.indexOf(".limit(limit || DEFAULT_LIMIT)");

    expect(statusIndex).toBeGreaterThan(0);
    expect(missingIndex).toBeGreaterThan(statusIndex);
    expect(notSelectedIndex).toBeGreaterThan(missingIndex);
    expect(limitIndex).toBeGreaterThan(notSelectedIndex);
  });

  test("builds phone-first queries from approved restaurant state", () => {
    const queries = cron.buildQueriesForRestaurant(baseRestaurant, 4);
    expect(queries[0]).toBe("02-111-2222");
    expect(queries.some((query: string) => query.includes("옛상호"))).toBe(true);
    expect(queries.some((query: string) => query.includes("마포구"))).toBe(true);
  });

  test("records anchored candidate snapshots for name and address drift without auto apply", () => {
    const candidate = cron.buildCandidateFromLocalItems(baseRestaurant, [{
      title: "<b>새상호</b>",
      telephone: "02-111-2222",
      roadAddress: "서울특별시 마포구 망원로 9",
      address: "서울특별시 마포구 망원동 9-1",
      category: "한식>백반",
      link: "https://example.test/place",
      mapx: "1269000000",
      mapy: "375500000",
    }], "2026-05-31T01:00:00Z", "옛상호 마포구");

    expect(candidate).not.toBeNull();
    expect(candidate.detected_change_types).toEqual(["name", "address"]);
    expect(candidate.candidate_snapshot.name).toBe("새상호");
    expect(candidate.evidence.source).toBe("naver_local_api");
  });

  test("ignores weak local results that only share a broad query region", () => {
    const candidate = cron.buildCandidateFromLocalItems({
      ...baseRestaurant,
      approved_name: "진미평양냉면",
      phone: "02-515-3469",
      road_address: "서울특별시 강남구 학동로 305-3",
      jibun_address: "서울특별시 강남구 논현동 115-10",
    }, [{
      title: "크레스타운 논현세관사거리점",
      telephone: "",
      roadAddress: "서울특별시 강남구 언주로 652 1층 크레스타운커피",
      address: "서울특별시 강남구 논현동 238 1층 크레스타운커피",
      category: "음식점>카페,디저트",
    }], "2026-05-31T01:00:00Z", "서울특별시 강남구 학동 진미평양냉면");

    expect(candidate).toBeNull();
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

  test("does not turn foreign local-search misses into closure candidates", () => {
    const candidate = cron.buildNoResultCandidate({
      ...baseRestaurant,
      id: "restaurant-foreign",
      approved_name: "라오허제 야시장(饒河街夜市)",
      phone: "+886 2 2766 8876",
      road_address: "Raohe St, Songshan District, Taipei City, 대만 105",
      jibun_address: "Raohe St, Songshan District, Taipei City, 대만 105",
      lat: 25.0508854,
      lng: 121.5774891,
    }, [
      { query: "+886 2 2766 8876", status: "ok", items: [] },
      { query: "Raohe St 라오허제 야시장", status: "ok", items: [] },
    ], "2026-05-31T01:00:00Z");

    expect(candidate).toBeNull();
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
