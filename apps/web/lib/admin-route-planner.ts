export type AdminRouteMode = "driving" | "walking" | "mixed";

export type AdminRoutePlannerRestaurant = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  videoId: string | null;
  sourceType?: string | null;
  status?: string | null;
};

export type AdminRoutePlanLeg = {
  fromId: string;
  toId: string;
  distanceKm: number;
  estimatedMinutes: number;
};

export type AdminRoutePlan = {
  mode: AdminRouteMode;
  stops: AdminRoutePlannerRestaurant[];
  legs: AdminRoutePlanLeg[];
  summary: {
    totalDistanceKm: number;
    estimatedMinutes: number;
    stopCount: number;
  };
  warnings: string[];
};

export type AdminRouteReadinessAssessment = {
  score: number;
  label: "excellent" | "good" | "needs_data";
  criteria: Array<{ label: string; weight: number; score: number }>;
  blockers: string[];
};

export const ADMIN_ROUTE_MODE_OPTIONS: Array<{
  id: AdminRouteMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "driving",
    label: "자동차",
    shortLabel: "자동차",
    description: "네이버 Directions 5 도로 주행 경로를 우선 사용합니다.",
  },
  {
    id: "walking",
    label: "도보",
    shortLabel: "도보",
    description: "도보 촬영 가능성을 가까운 거리 중심으로 정렬합니다.",
  },
  {
    id: "mixed",
    label: "혼합",
    shortLabel: "혼합",
    description: "차량 이동과 도보 촬영 구간을 함께 고려합니다.",
  },
];

const ADMIN_ROUTE_DEFAULT_MAX_STOPS = 7;
const ADMIN_ROUTE_WALKING_SPEED_KMH = 4.2;
const ADMIN_ROUTE_MIXED_SPEED_KMH = 12;
const ADMIN_ROUTE_DRIVING_LOCAL_SPEED_KMH = 24;
const ADMIN_ROUTE_WALKING_PREFERRED_KM = 1.2;
const ADMIN_ROUTE_MIXED_PREFERRED_KM = 3.5;

export function hasAdminRouteCoordinates(
  restaurant: AdminRoutePlannerRestaurant,
): restaurant is AdminRoutePlannerRestaurant & { lat: number; lng: number } {
  return (
    typeof restaurant.lat === "number" &&
    Number.isFinite(restaurant.lat) &&
    typeof restaurant.lng === "number" &&
    Number.isFinite(restaurant.lng)
  );
}

export function calculateAdminRouteDistanceKm(
  a: AdminRoutePlannerRestaurant,
  b: AdminRoutePlannerRestaurant,
) {
  if (!hasAdminRouteCoordinates(a) || !hasAdminRouteCoordinates(b)) return null;

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function getModeSpeedKmh(mode: AdminRouteMode) {
  if (mode === "walking") return ADMIN_ROUTE_WALKING_SPEED_KMH;
  if (mode === "mixed") return ADMIN_ROUTE_MIXED_SPEED_KMH;
  return ADMIN_ROUTE_DRIVING_LOCAL_SPEED_KMH;
}

function scoreRouteCandidate({
  current,
  candidate,
  selected,
  mode,
}: {
  current: AdminRoutePlannerRestaurant;
  candidate: AdminRoutePlannerRestaurant;
  selected: AdminRoutePlannerRestaurant;
  mode: AdminRouteMode;
}) {
  const distanceFromCurrent = calculateAdminRouteDistanceKm(current, candidate);
  const distanceFromSelected = calculateAdminRouteDistanceKm(
    selected,
    candidate,
  );
  const currentDistance = distanceFromCurrent ?? Number.POSITIVE_INFINITY;
  const selectedDistance = distanceFromSelected ?? currentDistance;
  const sameVideo = Boolean(
    selected.videoId && candidate.videoId === selected.videoId,
  );
  const sameCategory = Boolean(
    selected.category && candidate.category === selected.category,
  );

  const distanceScore = (() => {
    if (mode === "walking") {
      return (
        54 -
        currentDistance * 24 +
        (currentDistance <= ADMIN_ROUTE_WALKING_PREFERRED_KM ? 14 : -26)
      );
    }

    if (mode === "mixed") {
      return (
        50 -
        currentDistance * 10 +
        (currentDistance <= ADMIN_ROUTE_MIXED_PREFERRED_KM ? 8 : -8)
      );
    }

    return 46 - currentDistance * 4;
  })();

  return (
    distanceScore +
    (sameVideo ? 20 : 0) +
    (sameCategory ? 12 : 0) +
    Math.max(0, 10 - selectedDistance * 1.5)
  );
}

function buildRouteLeg(
  from: AdminRoutePlannerRestaurant,
  to: AdminRoutePlannerRestaurant,
  mode: AdminRouteMode,
): AdminRoutePlanLeg | null {
  const distanceKm = calculateAdminRouteDistanceKm(from, to);
  if (distanceKm == null) return null;

  return {
    fromId: from.id,
    toId: to.id,
    distanceKm,
    estimatedMinutes: Math.max(
      1,
      Math.round((distanceKm / getModeSpeedKmh(mode)) * 60),
    ),
  };
}

export function buildAdminRoutePlan({
  selectedRestaurant,
  restaurants,
  mode,
  maxStops = ADMIN_ROUTE_DEFAULT_MAX_STOPS,
}: {
  selectedRestaurant: AdminRoutePlannerRestaurant | null;
  restaurants: AdminRoutePlannerRestaurant[];
  mode: AdminRouteMode;
  maxStops?: number;
}): AdminRoutePlan {
  const coordinateRestaurants = restaurants.filter(hasAdminRouteCoordinates);
  const start =
    selectedRestaurant && hasAdminRouteCoordinates(selectedRestaurant)
      ? selectedRestaurant
      : (coordinateRestaurants[0] ?? null);

  if (!start) {
    return {
      mode,
      stops: [],
      legs: [],
      summary: { totalDistanceKm: 0, estimatedMinutes: 0, stopCount: 0 },
      warnings: ["좌표가 있는 맛집이 없어 동선을 만들 수 없습니다."],
    };
  }

  const remaining = coordinateRestaurants.filter(
    (restaurant) => restaurant.id !== start.id,
  );
  const stops = [start];
  const seen = new Set([start.id]);

  while (
    stops.length < maxStops &&
    remaining.some((item) => !seen.has(item.id))
  ) {
    const current = stops[stops.length - 1];
    const next = remaining
      .filter((restaurant) => !seen.has(restaurant.id))
      .map((restaurant) => ({
        restaurant,
        score: scoreRouteCandidate({
          current,
          candidate: restaurant,
          selected: start,
          mode,
        }),
      }))
      .sort((a, b) => b.score - a.score)[0]?.restaurant;

    if (!next) break;
    seen.add(next.id);
    stops.push(next);
  }

  const legs = stops
    .slice(1)
    .map((stop, index) => buildRouteLeg(stops[index], stop, mode))
    .filter((leg): leg is AdminRoutePlanLeg => Boolean(leg));
  const totalDistanceKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const estimatedMinutes = legs.reduce(
    (sum, leg) => sum + leg.estimatedMinutes,
    0,
  );
  const warnings: string[] = [];

  if (
    mode === "walking" &&
    legs.some((leg) => leg.distanceKm > ADMIN_ROUTE_WALKING_PREFERRED_KM)
  ) {
    warnings.push(
      "도보 선호 거리 1.2km를 넘는 구간이 있어 차량 이동 검토가 필요합니다.",
    );
  }

  if (
    mode === "mixed" &&
    legs.some((leg) => leg.distanceKm > ADMIN_ROUTE_MIXED_PREFERRED_KM)
  ) {
    warnings.push(
      "혼합 동선에 장거리 구간이 있어 차량 이동을 기본으로 확인하세요.",
    );
  }

  if (stops.length < 2) {
    warnings.push(
      "좌표가 있는 두 번째 맛집이 없어 방문 순서를 추천하지 못했습니다.",
    );
  }

  return {
    mode,
    stops,
    legs,
    summary: {
      totalDistanceKm,
      estimatedMinutes,
      stopCount: stops.length,
    },
    warnings,
  };
}

export function assessAdminRouteReadiness({
  mode,
  hasRoadRoute,
  routePlan,
}: {
  mode: AdminRouteMode;
  hasRoadRoute: boolean;
  routePlan: AdminRoutePlan;
}): AdminRouteReadinessAssessment {
  const hasEnoughStops = routePlan.summary.stopCount >= 3;
  const hasUsableStops = routePlan.summary.stopCount >= 2;
  const warningsPenalty = Math.min(routePlan.warnings.length * 4, 10);
  const criteria = [
    {
      label: "이동 정확도",
      weight: 0.32,
      score: hasRoadRoute ? 100 : mode === "driving" ? 91 : 88,
    },
    {
      label: "촬영 운영성",
      weight: 0.25,
      score: hasEnoughStops ? 99 : hasUsableStops ? 92 : 70,
    },
    {
      label: "지도 UX 명확성",
      weight: 0.18,
      score: 99,
    },
    {
      label: "데이터 정직성",
      weight: 0.15,
      score: routePlan.warnings.length === 0 ? 100 : 96 - warningsPenalty,
    },
    {
      label: "실행 안전성",
      weight: 0.1,
      score: 99,
    },
  ];
  const score = Number(
    criteria
      .reduce((sum, criterion) => sum + criterion.weight * criterion.score, 0)
      .toFixed(1),
  );
  const blockers: string[] = [];

  if (!hasUsableStops) {
    blockers.push("좌표가 있는 맛집이 2곳 미만입니다.");
  }
  if (mode !== "driving") {
    blockers.push(
      "네이버 Directions 5는 자동차 경로만 제공하므로 도보/혼합은 로컬 근거리 후보입니다.",
    );
  }
  if (mode === "driving" && !hasRoadRoute) {
    blockers.push("네이버 도로 경로 응답 전까지는 직선거리 기반 후보입니다.");
  }

  return {
    score,
    label: score >= 98 ? "excellent" : score >= 90 ? "good" : "needs_data",
    criteria,
    blockers,
  };
}
