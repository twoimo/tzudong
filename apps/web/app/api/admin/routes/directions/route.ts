import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminSafeErrorName } from "@/lib/admin/guarded-mutation-contract";
import {
  buildNaverDirectionsReadiness,
  buildProviderReadiness,
  NAVER_DIRECTIONS_PROVIDER_ID,
  resolveNaverDirectionsCredentials,
} from "@/lib/admin/provider-readiness";

export const runtime = "nodejs";

const NAVER_DIRECTIONS_ENDPOINT =
  "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const MAX_DIRECTIONS_POINTS = 7; // start + goal + up to 5 waypoints (Directions 5)
const DEFAULT_DIRECTIONS_OPTION = "trafast";
const NAVER_DIRECTIONS_PROVIDER_CACHE_TTL_MS = 60 * 1000;
const NAVER_DIRECTIONS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const NAVER_DIRECTIONS_RATE_LIMIT_MAX = 20;

type AdminDirectionsProviderCacheState = "hit" | "miss" | "bypass";

type AdminDirectionsRouteMode = "driving" | "walking" | "mixed";

const adminDirectionsProviderCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
const adminDirectionsRateLimits = new Map<string, { windowStartedAt: number; count: number }>();

function getCheckedAt() {
  return new Date().toISOString();
}


type AdminDirectionsRequestPoint = {
  id?: unknown;
  name?: unknown;
  lat?: unknown;
  lng?: unknown;
};

type AdminDirectionsRequestBody = {
  points?: AdminDirectionsRequestPoint[];
  option?: unknown;
  mode?: unknown;
};

type AdminDirectionsPoint = {
  id?: string;
  name?: string;
  lat: number;
  lng: number;
};

type NaverDirectionsSummary = {
  distance?: number;
  duration?: number;
  tollFare?: number;
  taxiFare?: number;
  fuelPrice?: number;
};

type NaverDirectionsCandidate = {
  summary?: NaverDirectionsSummary;
  path?: unknown;
};

type NaverDirectionsResponse = {
  code?: number;
  message?: string;
  route?: Record<string, NaverDirectionsCandidate[] | undefined>;
};

function normalizeNaverDirectionsSummary(summary: NaverDirectionsSummary | undefined): NaverDirectionsSummary | null {
  if (!summary) return null;

  const normalized: NaverDirectionsSummary = {};
  for (const key of ["distance", "duration", "tollFare", "taxiFare", "fuelPrice"] as const) {
    const value = summary[key];
    if (isFiniteCoordinate(value)) normalized[key] = value;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

type AdminDirectionsFallbackReason =
  | "naver-directions-provider-non-ok"
  | "naver-directions-request-failed"
  | "naver-directions-credentials-missing"
  | "naver-directions-auth-failed"
  | "naver-directions-empty-route"
  | "naver-directions-rate-limited";

type AdminDirectionsFallbackContract = {
  mode: "read_only_local_heuristic";
  readOnly: true;
  localHeuristic: true;
  provider: "local-heuristic";
  fallbackReasonCode: AdminDirectionsFallbackReason;
  roadRouteAvailable: false;
  roadDistanceTrusted: false;
  routeGeometrySource: "none";
  distanceSource: "local-coordinate-estimate";
  providerRequestAttempted: boolean;
};

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeDirectionsPoint(
  point: AdminDirectionsRequestPoint,
): AdminDirectionsPoint | null {
  if (!isFiniteCoordinate(point.lat) || !isFiniteCoordinate(point.lng)) {
    return null;
  }

  if (
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    return null;
  }

  return {
    id: typeof point.id === "string" ? point.id : undefined,
    name: typeof point.name === "string" ? point.name : undefined,
    lat: point.lat,
    lng: point.lng,
  };
}

function formatDirectionsCoordinate(point: AdminDirectionsPoint) {
  return `${point.lng},${point.lat}`;
}

function normalizeDirectionsOption(option: unknown) {
  if (typeof option !== "string") return DEFAULT_DIRECTIONS_OPTION;

  return /^[a-z]+$/i.test(option) ? option : DEFAULT_DIRECTIONS_OPTION;
}

function normalizeDirectionsMode(mode: unknown): AdminDirectionsRouteMode {
  return mode === "walking" || mode === "mixed" || mode === "driving" ? mode : "driving";
}

function buildDirectionsProviderCacheKey(
  points: AdminDirectionsPoint[],
  option: string,
  mode: AdminDirectionsRouteMode,
) {
  return [
    mode,
    option,
    ...points.map((point) => `${point.id ?? ""}:${point.name ?? ""}:${point.lat},${point.lng}`),
  ].join("|");
}

function readAdminDirectionsRateLimit(userId: string) {
  const now = Date.now();
  const current = adminDirectionsRateLimits.get(userId);
  if (!current || now - current.windowStartedAt >= NAVER_DIRECTIONS_RATE_LIMIT_WINDOW_MS) {
    const next = { windowStartedAt: now, count: 1 };
    adminDirectionsRateLimits.set(userId, next);
    return { limited: false, remaining: NAVER_DIRECTIONS_RATE_LIMIT_MAX - 1, windowSeconds: 60 };
  }
  const windowSeconds = Math.ceil((NAVER_DIRECTIONS_RATE_LIMIT_WINDOW_MS - (now - current.windowStartedAt)) / 1000);
  if (current.count >= NAVER_DIRECTIONS_RATE_LIMIT_MAX) {
    return { limited: true, remaining: 0, windowSeconds };
  }
  current.count += 1;
  return { limited: false, remaining: NAVER_DIRECTIONS_RATE_LIMIT_MAX - current.count, windowSeconds };
}

function buildDirectionsReadback({
  provider,
  providerCache,
  fallbackReasonCode = null,
  rateLimit,
}: {
  provider: "naver-directions5" | "local-heuristic";
  providerCache: AdminDirectionsProviderCacheState;
  fallbackReasonCode?: AdminDirectionsFallbackReason | null;
  rateLimit?: { limited: boolean; remaining: number; windowSeconds: number };
}) {
  return {
    provider,
    providerCache,
    rateLimit,
    fallbackReasonCode,
  };
}

function extractNaverDirectionsCandidate(data: NaverDirectionsResponse) {
  const routeGroups = data.route ? Object.values(data.route) : [];
  return routeGroups
    .flatMap((group) => group ?? [])
    .find(
      (candidate) => Array.isArray(candidate.path) && candidate.path.length > 1,
    );
}

function normalizeNaverDirectionsPath(path: unknown) {
  if (!Array.isArray(path)) return [];

  return path
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const [lng, lat] = coordinate;
      if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) return null;
      return { lat, lng };
    })
    .filter((coordinate): coordinate is { lat: number; lng: number } =>
      Boolean(coordinate),
    );
}

function buildLocalDirectionsFallbackContract(
  fallbackReasonCode: AdminDirectionsFallbackReason,
): AdminDirectionsFallbackContract {
  return {
    mode: "read_only_local_heuristic",
    readOnly: true,
    localHeuristic: true,
    provider: "local-heuristic",
    fallbackReasonCode,
    roadRouteAvailable: false,
    roadDistanceTrusted: false,
    routeGeometrySource: "none",
    distanceSource: "local-coordinate-estimate",
    providerRequestAttempted: fallbackReasonCode !== "naver-directions-credentials-missing",
  };
}

function buildLocalDirectionsFallback(
  points: AdminDirectionsPoint[],
  fallbackReasonCode: AdminDirectionsFallbackReason,
  message: string,
  readiness = buildProviderReadiness({
    provider: NAVER_DIRECTIONS_PROVIDER_ID,
    status: "degraded",
    reasonCode: fallbackReasonCode,
    checkedAt: getCheckedAt(),
    remediation: "Use local route fallback while Naver Directions readiness is restored.",
    diagnostics: {},
  }),
  providerCache: AdminDirectionsProviderCacheState = "bypass",
  rateLimit?: { limited: boolean; remaining: number; windowSeconds: number },
) {
  const fallbackContract = buildLocalDirectionsFallbackContract(fallbackReasonCode);
  return NextResponse.json(
    {
      provider: "local-heuristic",
      points,
      path: [],
      summary: null,
      fallbackReasonCode,
      fallbackContract,
      mode: fallbackContract.mode,
      readOnly: fallbackContract.readOnly,
      readiness,
      message,
      providerCache,
      directionsReadback: buildDirectionsReadback({
        provider: "local-heuristic",
        providerCache,
        fallbackReasonCode,
        rateLimit,
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }


  let body: AdminDirectionsRequestBody;
  try {
    const rawBody = await request.json();
    body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody as AdminDirectionsRequestBody
      : {};
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unknown",
          reasonCode: "naver-directions-request-invalid",
          checkedAt: getCheckedAt(),
          remediation: "Send a valid route JSON body before provider readiness can be applied.",
          diagnostics: {},
        }),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestPoints = Array.isArray(body.points) ? body.points : [];
  const points = requestPoints
    .map((point) =>
      point && typeof point === "object" && !Array.isArray(point)
        ? normalizeDirectionsPoint(point)
        : null,
    )
    .filter((point): point is AdminDirectionsPoint => Boolean(point))
    .slice(0, MAX_DIRECTIONS_POINTS);

  if (points.length < 2) {
    return NextResponse.json(
      {
        error: "At least two valid route points are required",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unknown",
          reasonCode: "naver-directions-points-invalid",
          checkedAt: getCheckedAt(),
          remediation: "Send at least two valid latitude/longitude points before calling Naver Directions.",
          diagnostics: { validPointCount: points.length },
        }),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const credentials = resolveNaverDirectionsCredentials(process.env);
  const configuredReadiness = buildNaverDirectionsReadiness(process.env, getCheckedAt());
  const option = normalizeDirectionsOption(body.option);
  const mode = normalizeDirectionsMode(body.mode);
  const providerCacheKey = buildDirectionsProviderCacheKey(points, option, mode);

  if (!credentials.clientId || !credentials.clientSecret) {
    return buildLocalDirectionsFallback(
      points,
      "naver-directions-credentials-missing",
      "네이버 Directions 키가 없어 직선거리 기반 후보로 표시합니다.",
      configuredReadiness,
    );
  }

  const rateLimit = readAdminDirectionsRateLimit(auth.userId);
  if (rateLimit.limited) {
    return buildLocalDirectionsFallback(
      points,
      "naver-directions-rate-limited",
      "네이버 Directions 요청이 분당 한도를 넘어 직선거리 기반 후보를 표시합니다.",
      buildProviderReadiness({
        provider: NAVER_DIRECTIONS_PROVIDER_ID,
        status: "degraded",
        reasonCode: "naver-directions-rate-limited",
        checkedAt: getCheckedAt(),
        remediation: "Wait for the one-minute admin Directions window to reset.",
        diagnostics: { maxPerMinute: NAVER_DIRECTIONS_RATE_LIMIT_MAX },
      }),
      "bypass",
      rateLimit,
    );
  }

  const cachedProviderRoute = adminDirectionsProviderCache.get(providerCacheKey);
  if (cachedProviderRoute && cachedProviderRoute.expiresAt > Date.now()) {
    return NextResponse.json(
      {
        ...cachedProviderRoute.payload,
        providerCache: "hit",
        directionsReadback: buildDirectionsReadback({
          provider: "naver-directions5",
          providerCache: "hit",
          rateLimit,
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [start, ...remainingPoints] = points;
  const goal = remainingPoints[remainingPoints.length - 1];
  const waypoints = remainingPoints.slice(0, -1);
  const url = new URL(NAVER_DIRECTIONS_ENDPOINT);
  url.searchParams.set("start", formatDirectionsCoordinate(start));
  url.searchParams.set("goal", formatDirectionsCoordinate(goal));
  url.searchParams.set("option", option);
  if (waypoints.length > 0) {
    url.searchParams.set(
      "waypoints",
      waypoints.map(formatDirectionsCoordinate).join("|"),
    );
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret,
      },
      cache: "no-store",
    });

    const responseText = await response.text();
    let data: NaverDirectionsResponse = {};
    if (responseText && response.ok) {
      try {
        data = JSON.parse(responseText) as NaverDirectionsResponse;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return buildLocalDirectionsFallback(
          points,
          "naver-directions-auth-failed",
          `네이버 Directions 인증 실패(${response.status})로 직선거리 기반 후보를 표시합니다.`,
          buildProviderReadiness({
            provider: NAVER_DIRECTIONS_PROVIDER_ID,
            status: "unavailable",
            reasonCode: "naver-directions-auth-failed",
            checkedAt: getCheckedAt(),
            remediation: "Verify Naver Directions client id and secret.",
            diagnostics: { httpStatus: response.status },
          }),
          "miss",
          rateLimit,
        );
      }

      return NextResponse.json(
        {
          error: "Naver Directions request failed",
          message: "Unable to calculate route",
          readiness: buildProviderReadiness({
            provider: NAVER_DIRECTIONS_PROVIDER_ID,
            status: "degraded",
            reasonCode: "naver-directions-provider-non-ok",
            checkedAt: getCheckedAt(),
            remediation: "Check Naver Directions provider status and request limits.",
            diagnostics: { httpStatus: response.status },
          }),
          providerCache: "miss",
          directionsReadback: buildDirectionsReadback({
            provider: "local-heuristic",
            providerCache: "miss",
            fallbackReasonCode: "naver-directions-provider-non-ok",
            rateLimit,
          }),
        },
        { status: response.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const candidate = extractNaverDirectionsCandidate(data);
    const path = normalizeNaverDirectionsPath(candidate?.path);

    if (path.length < 2) {
      return buildLocalDirectionsFallback(
        points,
        "naver-directions-empty-route",
        "네이버 Directions가 빈 경로를 반환해 직선거리 기반 후보를 표시합니다.",
        buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "degraded",
          reasonCode: "naver-directions-empty-route",
          checkedAt: getCheckedAt(),
          remediation: "Use the local fallback and review waypoint coordinates.",
          diagnostics: { routeCandidateFound: Boolean(candidate) },
        }),
        "miss",
        rateLimit,
      );
    }

    const successPayload = {
      provider: "naver-directions5",
      points,
      path,
      summary: normalizeNaverDirectionsSummary(candidate?.summary),
      readiness: buildProviderReadiness({
        provider: NAVER_DIRECTIONS_PROVIDER_ID,
        status: "ready",
        reasonCode: "naver-directions-ready",
        checkedAt: getCheckedAt(),
        remediation: "Naver Directions returned a route.",
        diagnostics: {
          pathPointCount: path.length,
          waypointCount: waypoints.length,
        },
      }),
      providerCache: "miss",
      directionsReadback: buildDirectionsReadback({
        provider: "naver-directions5",
        providerCache: "miss",
        rateLimit,
      }),
    };

    adminDirectionsProviderCache.set(providerCacheKey, {
      expiresAt: Date.now() + NAVER_DIRECTIONS_PROVIDER_CACHE_TTL_MS,
      payload: successPayload,
    });

    return NextResponse.json(successPayload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const errorName = getAdminSafeErrorName(error);
    console.error("[admin/routes/directions] provider request failed", {
      domain: "route_planner",
      action: "naver_directions",
      step: "provider-request",
      provider: NAVER_DIRECTIONS_PROVIDER_ID,
      errorName,
    });
    return NextResponse.json(
      {
        error: "Failed to calculate route",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unavailable",
          reasonCode: "naver-directions-request-failed",
          checkedAt: getCheckedAt(),
          remediation: "Retry after checking server network access to Naver Directions.",
          diagnostics: { errorType: errorName },
        }),
        providerCache: "miss",
        directionsReadback: buildDirectionsReadback({
          provider: "local-heuristic",
          providerCache: "miss",
          fallbackReasonCode: "naver-directions-request-failed",
          rateLimit,
        }),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
