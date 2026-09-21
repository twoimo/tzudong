import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeRestaurants } from "../hooks/use-restaurants";
import { hasRelatedVerifiedUserReview } from "../lib/restaurant-visit-matching";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

type Row = Record<string, unknown> & { id: string };
type Review = {
  restaurant_id: string;
  is_verified: boolean;
  restaurant?: {
    id: string;
    name: string | null;
    approved_name: string | null;
    road_address: string | null;
    jibun_address: string | null;
  } | null;
};

function makeRow(index: number, overrides: Record<string, unknown> = {}): Row {
  const name = `쯔동분식 ${index}`;
  const address = `서울 중구 쯔동로 ${index}`;
  return {
    id: `restaurant-${index}`,
    name,
    approved_name: name,
    origin_name: null,
    naver_name: null,
    google_name: null,
    status: "approved",
    source_type: "youtube",
    categories: ["분식"],
    origin_address: address,
    road_address: address,
    jibun_address: address,
    youtube_link: `https://www.youtube.com/watch?v=${index}`,
    lat: 37.5,
    lng: 127,
    review_count: index % 11,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeReview(index: number, row: Row, withCandidate: boolean): Review {
  return {
    restaurant_id: row.id,
    is_verified: true,
    restaurant: withCandidate
      ? {
        id: row.id,
        name: row.approved_name as string,
        approved_name: row.approved_name as string,
        road_address: row.road_address as string,
        jibun_address: row.jibun_address as string,
      }
      : null,
  };
}

// 최적화 이전 구현: 병합 후 같은 목록을 두 번 순회하며 방문 판정도 두 번 계산한다.
function referenceDerivation(rows: Row[], reviews: Review[]) {
  const reviewedRestaurantIds = new Set(reviews.map((review) => review.restaurant_id));
  const reviewedRestaurants = reviews
    .map((review) => review.restaurant)
    .filter((restaurant): restaurant is NonNullable<Review["restaurant"]> => Boolean(restaurant));
  const mergedRestaurants = mergeRestaurants(rows as never);

  const isVisited = (restaurant: unknown) => hasRelatedVerifiedUserReview({
    restaurant: restaurant as never,
    reviewedRestaurantIds,
    reviewedRestaurants: reviewedRestaurants as never,
  });

  const unvisitedRestaurants = mergedRestaurants.filter((restaurant) => !isVisited(restaurant));
  const visitedCount = mergedRestaurants.filter(isVisited).length;
  return {
    unvisitedIds: unvisitedRestaurants.map((restaurant) => restaurant.id),
    visitedCount,
  };
}

// 현재 구현: 방문 여부를 한 번만 계산해 미방문 목록과 방문 수를 함께 만든다.
function currentDerivation(rows: Row[], reviews: Review[]) {
  const reviewedRestaurantIds = new Set(reviews.map((review) => review.restaurant_id));
  const reviewedRestaurants = reviews
    .map((review) => review.restaurant)
    .filter((restaurant): restaurant is NonNullable<Review["restaurant"]> => Boolean(restaurant));
  const mergedRestaurants = mergeRestaurants(rows as never);

  const unvisitedIds: string[] = [];
  let visitedCount = 0;
  for (const restaurant of mergedRestaurants) {
    if (hasRelatedVerifiedUserReview({
      restaurant: restaurant as never,
      reviewedRestaurantIds,
      reviewedRestaurants: reviewedRestaurants as never,
    })) {
      visitedCount += 1;
    } else {
      unvisitedIds.push(restaurant.id);
    }
  }
  return { unvisitedIds, visitedCount };
}

describe("unvisited restaurants derivation", () => {
  test("미방문 목록과 방문 수를 한 번의 순회로 계산해도 이전 구현과 결과가 같다", () => {
    let seed = 20260921;
    const nextRandom = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let round = 0; round < 150; round += 1) {
      const size = 1 + Math.floor(nextRandom() * 40);
      const rows: Row[] = [];
      for (let index = 0; index < size; index += 1) {
        rows.push(makeRow(index));
        if (nextRandom() < 0.3) {
          rows.push(makeRow(index, { id: `restaurant-${index}-duplicate`, status: "deleted" }));
        }
      }

      const reviews: Review[] = [];
      for (const row of rows) {
        if (nextRandom() < 0.25) {
          reviews.push(makeReview(reviews.length, row, nextRandom() < 0.6));
        }
      }

      const expected = referenceDerivation(rows, reviews);
      const actual = currentDerivation(rows, reviews);
      expect(actual.unvisitedIds).toEqual(expected.unvisitedIds);
      expect(actual.visitedCount).toBe(expected.visitedCount);
    }
  });

  test("리뷰가 없으면 전부 미방문이고 빈 입력은 빈 목록을 돌려준다", () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    expect(currentDerivation(rows, [])).toEqual({
      unvisitedIds: rows.map((row) => row.id),
      visitedCount: 0,
    });
    expect(currentDerivation([], [])).toEqual({ unvisitedIds: [], visitedCount: 0 });
  });

  test("리뷰 후보 객체가 없어도 restaurant_id가 같으면 방문으로 계산한다", () => {
    const rows = [makeRow(0), makeRow(1)];
    const reviews = [makeReview(0, rows[0], false)];
    const result = currentDerivation(rows, reviews);
    expect(result.visitedCount).toBe(1);
    expect(result.unvisitedIds).toEqual([rows[1].id]);
  });

  test("승인 목록에 없는 식당을 리뷰한 경우 미방문 목록을 그대로 유지한다", () => {
    const rows = [makeRow(0), makeRow(1)];
    const reviews: Review[] = [{
      restaurant_id: "restaurant-not-approved",
      is_verified: true,
      restaurant: null,
    }];
    const result = currentDerivation(rows, reviews);
    expect(result.visitedCount).toBe(0);
    expect(result.unvisitedIds).toEqual(rows.map((row) => row.id));
  });

  test("후보의 이름과 주소가 모두 다르면 같은 동네라도 방문으로 세지 않는다", () => {
    const rows = [makeRow(0)];
    const reviews: Review[] = [{
      restaurant_id: "restaurant-other",
      is_verified: true,
      restaurant: {
        id: "restaurant-other",
        name: "다른상호",
        approved_name: "다른상호",
        road_address: "부산 해운대구 다른로 9",
        jibun_address: "부산 해운대구 다른로 9",
      },
    }];
    expect(currentDerivation(rows, reviews).visitedCount).toBe(0);
  });

  test("훅은 병합과 방문 판정 파생값을 입력이 바뀔 때만 다시 계산한다", () => {
    const hookSource = source("hooks/useUnvisitedRestaurants.tsx");
    expect(hookSource).toContain("}, [mergedRestaurants, userReviewData]);");
    expect(hookSource).toContain("mergeRestaurants(restaurantsData || [])");
    expect(hookSource).not.toContain("mergedRestaurants.filter");
    expect(hookSource).toContain("hasRelatedVerifiedUserReview({");
  });
});
