import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { reserveAdminProviderBudget } from "@/lib/security/admin-provider-budget";
import { getAdminSafeErrorName } from "@/lib/admin/guarded-mutation-contract";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";
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
const MAX_DIRECTIONS_POINT_ID_LENGTH = 96;
const MAX_DIRECTIONS_POINT_NAME_LENGTH = 160;
const MAX_NAVER_DIRECTIONS_RESPONSE_BYTES = 256 * 1024;
const MAX_NAVER_DIRECTIONS_ROUTE_GROUPS = 6;
const MAX_NAVER_DIRECTIONS_CANDIDATES_PER_GROUP = 3;
const MAX_NAVER_DIRECTIONS_PATH_POINTS = 2_000;
const NAVER_DIRECTIONS_PROVIDER_TIMEOUT_MS = 7_500;
const NAVER_DIRECTIONS_OPTIONS = [
  "trafast",
  "tracomfort",
  "traoptimal",
  "trarecommend",
  "traavoidcaronly",
  "traavoidtoll",
] as const;
const MAX_DIRECTIONS_REQUEST_BYTES = 16 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ADMIN_DIRECTIONS_REQUEST_KEYS = ["points", "option", "mode"] as const;
const ADMIN_DIRECTIONS_REQUIRED_REQUEST_KEYS = ["points"] as const;
const ADMIN_DIRECTIONS_POINT_KEYS = ["id", "name", "lat", "lng"] as const;
const ADMIN_DIRECTIONS_REQUIRED_POINT_KEYS = ["lat", "lng"] as const;
const ADMIN_DIRECTIONS_MODES = ["driving", "walking", "mixed"] as const;

type AdminDirectionsProviderCacheState = "hit" | "miss" | "bypass";

type NaverDirectionsOption = (typeof NAVER_DIRECTIONS_OPTIONS)[number];
type AdminDirectionsMode = (typeof ADMIN_DIRECTIONS_MODES)[number];

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
  path: [number, number][];
};

type NaverDirectionsResponse = {
  route: Partial<Record<NaverDirectionsOption, NaverDirectionsCandidate[]>>;
};

function getCheckedAt() {
  return new Date().toISOString();
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatitude(value: unknown): value is number {
  return isFiniteCoordinate(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return isFiniteCoordinate(value) && value >= -180 && value <= 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasExactDirectionsKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
) {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key))
  );
}

function hasExactDirectionsRequestKeys(value: Record<string, unknown>) {
  return hasExactDirectionsKeys(
    value,
    ADMIN_DIRECTIONS_REQUEST_KEYS,
    ADMIN_DIRECTIONS_REQUIRED_REQUEST_KEYS,
  );
}

function hasExactDirectionsPointKeys(value: Record<string, unknown>) {
  return hasExactDirectionsKeys(
    value,
    ADMIN_DIRECTIONS_POINT_KEYS,
    ADMIN_DIRECTIONS_REQUIRED_POINT_KEYS,
  );
}

function hasValidDirectionsPointTypes(value: Record<string, unknown>) {
  return (
    typeof value.lat === "number"
    && typeof value.lng === "number"
    && (!Object.hasOwn(value, "id") || typeof value.id === "string")
    && (!Object.hasOwn(value, "name") || typeof value.name === "string")
  );
}

function normalizeDirectionsLabel(value: unknown, maximumLength: number) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
    || value.trim().length === 0
    || CONTROL_CHARACTERS.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizeDirectionsPoint(
  point: AdminDirectionsRequestPoint,
): AdminDirectionsPoint | null {
  if (!isValidLatitude(point.lat) || !isValidLongitude(point.lng)) {
    return null;
  }

  const id = normalizeDirectionsLabel(point.id, MAX_DIRECTIONS_POINT_ID_LENGTH);
  const name = normalizeDirectionsLabel(point.name, MAX_DIRECTIONS_POINT_NAME_LENGTH);
  if (id === null || name === null) return null;

  return {
    id,
    name,
    lat: point.lat,
    lng: point.lng,
  };
}

function formatDirectionsCoordinate(point: AdminDirectionsPoint) {
  return `${point.lng},${point.lat}`;
}

function isNaverDirectionsOption(value: string): value is NaverDirectionsOption {
  return (NAVER_DIRECTIONS_OPTIONS as readonly string[]).includes(value);
}
function isAdminDirectionsMode(value: string): value is AdminDirectionsMode {
  return (ADMIN_DIRECTIONS_MODES as readonly string[]).includes(value);
}

function normalizeDirectionsMode(value: unknown): AdminDirectionsMode | null {
  if (value === undefined) return "driving";
  return typeof value === "string" && isAdminDirectionsMode(value) ? value : null;
}


function normalizeDirectionsOption(option: unknown): NaverDirectionsOption | null {
  if (option === undefined) return "trafast";
  return typeof option === "string" && isNaverDirectionsOption(option) ? option : null;
}


async function readBoundedNaverDirectionsJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error("NAVER_DIRECTIONS_RESPONSE_LENGTH_INVALID");
    }
    if (declaredLength > MAX_NAVER_DIRECTIONS_RESPONSE_BYTES) {
      throw new Error("NAVER_DIRECTIONS_RESPONSE_TOO_LARGE");
    }
  }

  if (!response.body) throw new Error("NAVER_DIRECTIONS_RESPONSE_MISSING");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_NAVER_DIRECTIONS_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("NAVER_DIRECTIONS_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function normalizeNaverDirectionsSummary(value: unknown): NaverDirectionsSummary | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("NAVER_DIRECTIONS_SUMMARY_INVALID");

  const summary: NaverDirectionsSummary = {};
  for (const key of ["distance", "duration", "tollFare", "taxiFare", "fuelPrice"] as const) {
    const amount = value[key];
    if (amount === undefined) continue;
    if (!isFiniteCoordinate(amount) || amount < 0) {
      throw new Error("NAVER_DIRECTIONS_SUMMARY_INVALID");
    }
    summary[key] = amount;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function parseNaverDirectionsResponse(
  value: unknown,
): NaverDirectionsResponse {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.route)) {
    throw new Error("NAVER_DIRECTIONS_RESPONSE_INVALID");
  }

  const routeEntries = Object.entries(value.route);
  if (
    routeEntries.length === 0
    || routeEntries.length > MAX_NAVER_DIRECTIONS_ROUTE_GROUPS
  ) {
    throw new Error("NAVER_DIRECTIONS_ROUTE_GROUPS_INVALID");
  }

  const route: Partial<Record<NaverDirectionsOption, NaverDirectionsCandidate[]>> = {};
  for (const [label, rawCandidates] of routeEntries) {
    if (
      !isNaverDirectionsOption(label)
      || !Array.isArray(rawCandidates)
      || rawCandidates.length > MAX_NAVER_DIRECTIONS_CANDIDATES_PER_GROUP
    ) {
      throw new Error("NAVER_DIRECTIONS_ROUTE_INVALID");
    }

    route[label] = rawCandidates.map((rawCandidate) => {
      if (!isRecord(rawCandidate) || !Array.isArray(rawCandidate.path)) {
        throw new Error("NAVER_DIRECTIONS_CANDIDATE_INVALID");
      }
      if (rawCandidate.path.length > MAX_NAVER_DIRECTIONS_PATH_POINTS) {
        throw new Error("NAVER_DIRECTIONS_PATH_TOO_LARGE");
      }

      const path = rawCandidate.path.map((coordinate) => {
        if (!Array.isArray(coordinate) || coordinate.length !== 2) {
          throw new Error("NAVER_DIRECTIONS_PATH_INVALID");
        }
        const [lng, lat] = coordinate;
        if (!isValidLongitude(lng) || !isValidLatitude(lat)) {
          throw new Error("NAVER_DIRECTIONS_PATH_INVALID");
        }
        return [lng, lat] as [number, number];
      });

      return {
        path,
        summary: normalizeNaverDirectionsSummary(rawCandidate.summary),
      };
    });
  }

  return { route };
}

function extractNaverDirectionsCandidate(
  data: NaverDirectionsResponse,
  option: NaverDirectionsOption,
) {
  return data.route[option]?.find((candidate) => candidate.path.length > 1);
}

function normalizeNaverDirectionsPath(path: [number, number][]) {
  if (path.length > MAX_NAVER_DIRECTIONS_PATH_POINTS) return [];

  const normalized: { lat: number; lng: number }[] = [];
  for (const coordinate of path) {
    const [lng, lat] = coordinate;
    if (!isValidLatitude(lat) || !isValidLongitude(lng)) return [];
    normalized.push({ lat, lng });
  }
  return normalized;
}

type AdminDirectionsFallbackReason =
  | "naver-directions-provider-non-ok"
  | "naver-directions-request-failed"
  | "naver-directions-credentials-missing"
  | "naver-directions-auth-failed"
  | "naver-directions-empty-route"
  | "naver-directions-rate-limited"
  | "naver-directions-budget-unavailable";

type AdminDirectionsFallbackContract = {
  mode: "read_only_local_heuristic";
  readOnly: true;
  localHeuristic: true;
  provider: "local-heuristic";
  fallbackReasonCode: AdminDirectionsFallbackReason;
  roadRouteAvailable: false;
  roadDistanceTrusted: false;
  routeGeometrySource: "none";
  distanceSource: "none";
  providerRequestAttempted: boolean;
};

function buildDirectionsReadback({
  provider,
  providerCache,
  fallbackReasonCode = null,
}: {
  provider: "naver-directions5" | "local-heuristic";
  providerCache: AdminDirectionsProviderCacheState;
  fallbackReasonCode?: AdminDirectionsFallbackReason | null;
}) {
  return {
    provider,
    providerCache,
    fallbackReasonCode,
  };
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
    distanceSource: "none",
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
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function buildInvalidDirectionsPointsResponse(validPointCount: number) {
  return NextResponse.json(
    {
      error: "At least two valid route points are required",
      readiness: buildProviderReadiness({
        provider: NAVER_DIRECTIONS_PROVIDER_ID,
        status: "unknown",
        reasonCode: "naver-directions-points-invalid",
        checkedAt: getCheckedAt(),
        remediation: "Send two to seven valid, bounded route points before calling Naver Directions.",
        diagnostics: { validPointCount },
      }),
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_DIRECTIONS_REQUEST_BYTES);
  if (!requestBody.ok) {
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

  if (
    !isRecord(requestBody.value)
    || !hasExactDirectionsRequestKeys(requestBody.value)
  ) {
    return buildInvalidDirectionsPointsResponse(0);
  }

  const body = requestBody.value as AdminDirectionsRequestBody;
  const requestPoints = body.points;
  if (
    !Array.isArray(requestPoints)
    || requestPoints.length > MAX_DIRECTIONS_POINTS
    || !requestPoints.every(
      (point) =>
        isRecord(point)
        && hasExactDirectionsPointKeys(point)
        && hasValidDirectionsPointTypes(point),
    )
  ) {
    return buildInvalidDirectionsPointsResponse(0);
  }

  const option = normalizeDirectionsOption(body.option);
  if (!option) {
    return NextResponse.json(
      {
        error: "Invalid route option",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unknown",
          reasonCode: "naver-directions-request-invalid",
          checkedAt: getCheckedAt(),
          remediation: "Use a supported Naver Directions route option.",
          diagnostics: {},
        }),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!normalizeDirectionsMode(body.mode)) {
    return NextResponse.json(
      {
        error: "Invalid route mode",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unknown",
          reasonCode: "naver-directions-request-invalid",
          checkedAt: getCheckedAt(),
          remediation: "Use a supported route planning mode.",
          diagnostics: {},
        }),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const points = requestPoints.map((point) => normalizeDirectionsPoint(point));
  if (points.some((point) => point === null)) {
    return buildInvalidDirectionsPointsResponse(
      points.filter((point): point is AdminDirectionsPoint => point !== null).length,
    );
  }

  const normalizedPoints = points as AdminDirectionsPoint[];
  if (normalizedPoints.length < 2) {
    return buildInvalidDirectionsPointsResponse(normalizedPoints.length);
  }

  const credentials = resolveNaverDirectionsCredentials(process.env);
  const configuredReadiness = buildNaverDirectionsReadiness(process.env, getCheckedAt());
  if (!credentials.clientId || !credentials.clientSecret) {
    return buildLocalDirectionsFallback(
      normalizedPoints,
      "naver-directions-credentials-missing",
      "네이버 Directions 키가 없어 직선거리 기반 후보로 표시합니다.",
      configuredReadiness,
    );
  }

  let budget: Awaited<ReturnType<typeof reserveAdminProviderBudget>>;
  try {
    budget = await reserveAdminProviderBudget({
      actorUserId: auth.userId,
      provider: "naver_directions",
    });
  } catch {
    return NextResponse.json(
      {
        error: "Provider budget unavailable",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "unavailable",
          reasonCode: "naver-directions-budget-unavailable",
          checkedAt: getCheckedAt(),
          remediation: "Restore the durable provider budget service before retrying.",
          diagnostics: {},
        }),
        providerCache: "bypass",
        directionsReadback: buildDirectionsReadback({
          provider: "local-heuristic",
          providerCache: "bypass",
          fallbackReasonCode: "naver-directions-budget-unavailable",
        }),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: "Provider request limit exceeded",
        readiness: buildProviderReadiness({
          provider: NAVER_DIRECTIONS_PROVIDER_ID,
          status: "degraded",
          reasonCode: "naver-directions-rate-limited",
          checkedAt: getCheckedAt(),
          remediation: "Retry after the durable provider budget resets.",
          diagnostics: {},
        }),
        providerCache: "bypass",
        directionsReadback: buildDirectionsReadback({
          provider: "local-heuristic",
          providerCache: "bypass",
          fallbackReasonCode: "naver-directions-rate-limited",
        }),
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(budget.retryAfterSeconds),
        },
      },
    );
  }

  const [start, ...remainingPoints] = normalizedPoints;
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
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(NAVER_DIRECTIONS_PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return buildLocalDirectionsFallback(
          normalizedPoints,
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
          }),
        },
        { status: response.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.startsWith("application/json")) {
      await response.body?.cancel();
      throw new Error("NAVER_DIRECTIONS_RESPONSE_CONTENT_TYPE_INVALID");
    }

    const data = parseNaverDirectionsResponse(await readBoundedNaverDirectionsJson(response));
    const candidate = extractNaverDirectionsCandidate(data, option);
    const path = candidate ? normalizeNaverDirectionsPath(candidate.path) : [];

    if (path.length < 2) {
      return buildLocalDirectionsFallback(
        normalizedPoints,
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
      );
    }

    const successPayload = {
      provider: "naver-directions5",
      points: normalizedPoints,
      path,
      summary: candidate?.summary ?? null,
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
      }),
    };

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
        }),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}