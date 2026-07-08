import { describe, expect, test } from "bun:test";
import {
  assessAdminRouteReadiness,
  buildAdminRoutePlan,
  buildAdminRouteCandidateSet,
  buildAdminRouteExportPackage,
  buildAdminRoutePlainTextExport,
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

  test("returns route candidates with readback metadata and selected anchor included", () => {
    const candidateSet = buildAdminRouteCandidateSet({
      restaurants: [farRestaurant, noCoordinate, nearbySameCategory, selected, nearbySameVideo],
      anchorRestaurantId: selected.id,
      bbox: { west: 127.02, south: 37.5, east: 127.04, north: 37.51 },
      limit: 3,
    });

    expect(candidateSet.items.map((item) => item.id)).toEqual([
      "start",
      "near-video",
      "near-category",
    ]);
    expect(candidateSet.readback).toMatchObject({
      candidateTotal: 4,
      candidateReturned: 3,
      candidateLimit: 3,
      truncated: true,
      candidateSource: "visible-bbox",
      excludedNoCoordinateCount: 1,
      selectedAnchorIncluded: true,
    });
  });

  test("expands a sparse bbox before falling back to k-nearest candidates", () => {
    const candidateSet = buildAdminRouteCandidateSet({
      restaurants: [selected, nearbySameVideo, farRestaurant],
      anchorRestaurantId: selected.id,
      bbox: { west: 127.024, south: 37.5005, east: 127.0255, north: 37.5015 },
      limit: 2,
    });

    expect(candidateSet.items.map((item) => item.id)).toEqual(["start", "near-video"]);
    expect(candidateSet.readback.candidateSource).toBe("expanded-bbox");
  });

  test("does not report selected anchor included when requested anchor is absent", () => {
    const candidateSet = buildAdminRouteCandidateSet({
      restaurants: [nearbySameVideo, farRestaurant],
      anchorRestaurantId: selected.id,
      limit: 2,
    });

    expect(candidateSet.items[0]?.id).toBe("near-video");
    expect(candidateSet.readback.selectedAnchorIncluded).toBe(false);
  });

  test("builds Tzudong route export JSON and plain text with provider cache readback", () => {
    const routePlan = buildAdminRoutePlan({
      selectedRestaurant: selected,
      restaurants: [selected, nearbySameVideo, nearbySameCategory],
      mode: "driving",
      maxStops: 3,
    });
    const candidateSet = buildAdminRouteCandidateSet({
      restaurants: [selected, nearbySameVideo, nearbySameCategory],
      anchorRestaurantId: selected.id,
      limit: 3,
    });
    const packageJson = buildAdminRouteExportPackage({
      routePlan,
      candidateReadback: candidateSet.readback,
      directionsReadback: {
        provider: "naver-directions5",
        providerCache: "hit",
        fallbackReasonCode: null,
      },
      generatedAt: "2026-07-07T00:00:00.000Z",
    });
    const plainText = buildAdminRoutePlainTextExport(packageJson);

    expect(packageJson.schemaVersion).toBe(1);
    expect(packageJson.anchorRestaurantId).toBe("start");
    expect(packageJson.directionsReadback.providerCache).toBe("hit");
    expect(plainText).toContain("Tzudong route plan v1");
    expect(plainText).toContain("후보:");
    expect(plainText).toContain("cache=hit");
  });
});
