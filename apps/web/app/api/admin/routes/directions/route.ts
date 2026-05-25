import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

export const runtime = "nodejs";

const NAVER_DIRECTIONS_ENDPOINT =
  "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const MAX_DIRECTIONS_POINTS = 7; // start + goal + up to 5 waypoints (Directions 5)
const DEFAULT_DIRECTIONS_OPTION = "trafast";

const NAVER_DIRECTIONS_CLIENT_ID =
  process.env.NEXT_PUBLIC_NAVER_CLIENT_ID ||
  process.env.NEXT_PUBLIC_NAVER_CLIENT_ID_BYEON ||
  process.env.NEXT_NAVER_CLIENT_ID ||
  process.env.NEXT_NAVER_CLIENT_ID_BYEON;

const NAVER_DIRECTIONS_CLIENT_SECRET =
  process.env.NEXT_PUBLIC_NAVER_CLIENT_SECRET ||
  process.env.NEXT_PUBLIC_NAVER_CLIENT_SECRET_BYEON ||
  process.env.NEXT_NAVER_CLIENT_SECRET ||
  process.env.NEXT_NAVER_CLIENT_SECRET_BYEON;

type AdminDirectionsRequestPoint = {
  id?: unknown;
  name?: unknown;
  lat?: unknown;
  lng?: unknown;
};

type AdminDirectionsRequestBody = {
  points?: AdminDirectionsRequestPoint[];
  option?: unknown;
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

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!NAVER_DIRECTIONS_CLIENT_ID || !NAVER_DIRECTIONS_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Naver Directions credentials are not configured" },
      { status: 500 },
    );
  }

  let body: AdminDirectionsRequestBody;
  try {
    body = (await request.json()) as AdminDirectionsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const points = (body.points ?? [])
    .map(normalizeDirectionsPoint)
    .filter((point): point is AdminDirectionsPoint => Boolean(point))
    .slice(0, MAX_DIRECTIONS_POINTS);

  if (points.length < 2) {
    return NextResponse.json(
      { error: "At least two valid route points are required" },
      { status: 400 },
    );
  }

  const [start, ...remainingPoints] = points;
  const goal = remainingPoints[remainingPoints.length - 1];
  const waypoints = remainingPoints.slice(0, -1);
  const url = new URL(NAVER_DIRECTIONS_ENDPOINT);
  url.searchParams.set("start", formatDirectionsCoordinate(start));
  url.searchParams.set("goal", formatDirectionsCoordinate(goal));
  url.searchParams.set("option", normalizeDirectionsOption(body.option));
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
        "x-ncp-apigw-api-key-id": NAVER_DIRECTIONS_CLIENT_ID,
        "x-ncp-apigw-api-key": NAVER_DIRECTIONS_CLIENT_SECRET,
      },
      cache: "no-store",
    });

    const data = (await response.json()) as NaverDirectionsResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Naver Directions request failed",
          message: data.message ?? "Unable to calculate route",
        },
        { status: response.status },
      );
    }

    const candidate = extractNaverDirectionsCandidate(data);
    const path = normalizeNaverDirectionsPath(candidate?.path);

    if (path.length < 2) {
      return NextResponse.json(
        { error: "Naver Directions returned an empty route" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      provider: "naver-directions5",
      points,
      path,
      summary: candidate?.summary ?? null,
    });
  } catch (error) {
    console.error("[Admin Directions] Naver Directions request failed", error);
    return NextResponse.json(
      { error: "Failed to calculate route" },
      { status: 500 },
    );
  }
}
