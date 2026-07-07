import { describe, expect, test } from "bun:test";
import {
  assessAdminRouteReadiness,
  buildAdminRoutePlan,
  calculateAdminRouteDistanceKm,
  calculateAdminRoutePathDistanceKm,
  optimizeAdminRouteStopOrder,
} from "../lib/admin-route-planner";

const selected = {
  id: "start",
  name: "시작 맛집",
  category: "한식",
  address: "서울 강남구",
  lat: 37.501,
  lng: 127.025,
  videoId: "video-a",
};

const nearbySameVideo = {
  id: "near-video",
  name: "가까운 같은 영상 맛집",
  category: "분식",
  address: "서울 강남구",
  lat: 37.503,
  lng: 127.027,
  videoId: "video-a",
};

const nearbySameCategory = {
  id: "near-category",
  name: "가까운 같은 카테고리 맛집",
  category: "한식",
  address: "서울 강남구",
  lat: 37.506,
  lng: 127.031,
  videoId: "video-b",
};

const farRestaurant = {
  id: "far",
  name: "먼 맛집",
  category: "한식",
  address: "서울 마포구",
  lat: 37.556,
  lng: 126.923,
  videoId: "video-c",
};

const noCoordinate = {
  id: "no-coordinate",
  name: "좌표 없는 맛집",
  category: "한식",
  address: "주소만 있음",
  lat: null,
  lng: null,
  videoId: "video-a",
};

describe("admin route planner", () => {
  test("calculates finite haversine distance for route scoring", () => {
    const distance = calculateAdminRouteDistanceKm(selected, nearbySameVideo);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1);
  });

  test("builds a coordinate-only multi-stop route with selected restaurant first", () => {
    const plan = buildAdminRoutePlan({
      selectedRestaurant: selected,
      restaurants: [
        farRestaurant,
        noCoordinate,
        nearbySameCategory,
        selected,
        nearbySameVideo,
      ],
      mode: "driving",
      maxStops: 4,
    });

    expect(plan.stops.map((stop) => stop.id)).toEqual([
      "start",
      "near-video",
      "near-category",
      "far",
    ]);
    expect(plan.legs).toHaveLength(3);
    expect(plan.summary.stopCount).toBe(4);
    expect(plan.summary.totalDistanceKm).toBeGreaterThan(0);
  });

  test("flags walking routes that exceed realistic filming walking distance", () => {
    const plan = buildAdminRoutePlan({
      selectedRestaurant: selected,
      restaurants: [selected, farRestaurant],
      mode: "walking",
    });

    expect(plan.warnings.join(" ")).toContain("도보 선호 거리 1.2km");
  });

  test("respects the operator-selected maximum stop count", () => {
    const plan = buildAdminRoutePlan({
      selectedRestaurant: selected,
      restaurants: [
        selected,
        nearbySameVideo,
        nearbySameCategory,
        farRestaurant,
      ],
      mode: "mixed",
      maxStops: 3,
    });

    expect(plan.stops).toHaveLength(3);
    expect(plan.summary.stopCount).toBe(3);
    expect(plan.legs).toHaveLength(2);
  });

  test("caps route requests at seven stops even when callers pass a larger limit", () => {
    const restaurants = Array.from({ length: 10 }, (_, index) => ({
      id: `r-${index}`,
      name: `맛집 ${index}`,
      category: "한식",
      address: "서울",
      lat: 37.5 + index * 0.001,
      lng: 127.0 + index * 0.001,
      videoId: `video-${index}`,
    }));

    const plan = buildAdminRoutePlan({
      selectedRestaurant: restaurants[0],
      restaurants,
      mode: "driving",
      maxStops: 10,
    });

    expect(plan.stops).toHaveLength(7);
  });

  test("applies bounded 2-opt without moving the selected anchor", () => {
    const start = { ...selected, lat: 0, lng: 0 };
    const initialStops = [
      start,
      { ...nearbySameVideo, id: "east", name: "동쪽", lat: 0, lng: 3 },
      { ...nearbySameCategory, id: "west", name: "서쪽", lat: 0, lng: -3 },
      { ...farRestaurant, id: "north", name: "북쪽", lat: 1, lng: 0 },
    ];

    const optimizedStops = optimizeAdminRouteStopOrder(initialStops);

    expect(optimizedStops[0].id).toBe("start");
    expect(calculateAdminRoutePathDistanceKm(optimizedStops)).toBeLessThan(
      calculateAdminRoutePathDistanceKm(initialStops),
    );
  });

  test("AHP assessment reaches the 98 gate only when road route and enough stops are present", () => {
    const plan = buildAdminRoutePlan({
      selectedRestaurant: selected,
      restaurants: [
        selected,
        nearbySameVideo,
        nearbySameCategory,
        farRestaurant,
      ],
      mode: "driving",
    });

    const ready = assessAdminRouteReadiness({
      mode: "driving",
      hasRoadRoute: true,
      routePlan: plan,
    });
    const localOnly = assessAdminRouteReadiness({
      mode: "driving",
      hasRoadRoute: false,
      routePlan: plan,
    });

    expect(ready.score).toBeGreaterThanOrEqual(98);
    expect(ready.label).toBe("excellent");
    expect(localOnly.score).toBeLessThan(98);
    expect(localOnly.blockers.join(" ")).toContain("네이버 도로 경로 응답 전");
  });
});
