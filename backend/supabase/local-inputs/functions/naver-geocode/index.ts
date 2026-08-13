// LOCAL_TEST_ONLY:NOT_PRODUCTION
//
// Deterministic local replacement for the hosted naver-geocode Edge Function.
// It never calls Naver (or any other network provider) and only returns the two
// synthetic restaurants installed by backend/supabase/scripts/local-seed.sql.

const MAX_BODY_BYTES = 1024;
const MAX_QUERY_LENGTH = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LOCAL_FIXTURE_PROVENANCE =
  "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:naver-geocode-fixture-v1";

type AddressElement = {
  types: readonly string[];
  longName: string;
  shortName: string;
  code: string;
};

type SyntheticAddress = {
  roadAddress: string;
  jibunAddress: string;
  englishAddress: string;
  addressElements: readonly AddressElement[];
  x: string;
  y: string;
};

const FIXTURES: readonly SyntheticAddress[] = Object.freeze([
  Object.freeze({
    roadAddress: "서울특별시 중구 세종대로 110",
    jibunAddress: "서울특별시 중구 태평로1가 31",
    englishAddress: "110 Sejong-daero, Jung-gu, Seoul",
    addressElements: Object.freeze([
      Object.freeze({
        types: Object.freeze(["SIDO"]),
        longName: "서울특별시",
        shortName: "서울",
        code: "11",
      }),
      Object.freeze({
        types: Object.freeze(["SIGUGUN"]),
        longName: "중구",
        shortName: "중구",
        code: "11140",
      }),
      Object.freeze({
        types: Object.freeze(["ROAD_NAME"]),
        longName: "세종대로",
        shortName: "세종대로",
        code: "",
      }),
      Object.freeze({
        types: Object.freeze(["BUILDING_NUMBER"]),
        longName: "110",
        shortName: "110",
        code: "",
      }),
    ]),
    x: "126.978",
    y: "37.5665",
  }),
  Object.freeze({
    roadAddress: "서울특별시 중구 을지로 30",
    jibunAddress: "서울특별시 을지로1가 50",
    englishAddress: "30 Eulji-ro, Jung-gu, Seoul",
    addressElements: Object.freeze([
      Object.freeze({
        types: Object.freeze(["SIDO"]),
        longName: "서울특별시",
        shortName: "서울",
        code: "11",
      }),
      Object.freeze({
        types: Object.freeze(["SIGUGUN"]),
        longName: "중구",
        shortName: "중구",
        code: "11140",
      }),
      Object.freeze({
        types: Object.freeze(["ROAD_NAME"]),
        longName: "을지로",
        shortName: "을지로",
        code: "",
      }),
      Object.freeze({
        types: Object.freeze(["BUILDING_NUMBER"]),
        longName: "30",
        shortName: "30",
        code: "",
      }),
    ]),
    x: "126.97885",
    y: "37.56695",
  }),
]);

const QUERY_FIXTURE_INDEXES = new Map<string, readonly number[]>([
  ["서울특별시 중구 세종대로 110", [0]],
  ["서울특별시 중구 태평로1가 31", [0]],
  ["서울특별시 중구 세종대로", [0]],
  ["서울특별시 중구 을지로 30", [1]],
  ["서울특별시 을지로1가 50", [1]],
  ["서울특별시 중구 을지로1가 50", [1]],
  ["서울특별시 중구 을지로", [1]],
  ["서울특별시 중구", [0, 1]],
]);

// The manifest-bound local Kong route is the sole browser CORS boundary. The
// worker deliberately emits no Access-Control-* headers on direct calls.
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-tzudong-local-fixture": LOCAL_FIXTURE_PROVENANCE,
});

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("invalid_body_length");
    }
    if (parsedLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
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
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export async function handleNaverGeocode(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST, OPTIONS" });
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonResponse({ error: "Invalid geocode request" }, 415);
  }

  let bodyText: string;
  try {
    bodyText = await readBoundedBody(request);
  } catch (error) {
    const status = error instanceof Error && error.message === "body_too_large"
      ? 413
      : 400;
    return jsonResponse({ error: "Invalid geocode request" }, status);
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: "Invalid geocode request" }, 400);
  }
  if (!isPlainRecord(body)) {
    return jsonResponse({ error: "Invalid geocode request" }, 400);
  }
  const keys = Object.keys(body);
  if (
    !keys.every((key) => key === "query" || key === "count") ||
    !keys.includes("query") ||
    typeof body.query !== "string"
  ) {
    return jsonResponse({ error: "Invalid geocode request" }, 400);
  }

  const count = body.count === undefined ? 3 : body.count;
  const query = normalizeQuery(body.query);
  if (
    !Number.isInteger(count) || Number(count) < 1 || Number(count) > 3 ||
    query.length === 0 || query.length > MAX_QUERY_LENGTH ||
    CONTROL_CHARACTERS.test(query)
  ) {
    return jsonResponse({ error: "Invalid geocode request" }, 400);
  }

  const indexes = QUERY_FIXTURE_INDEXES.get(query) ?? [];
  const addresses = indexes.slice(0, Number(count)).map((index) => FIXTURES[index]);
  return jsonResponse({ addresses });
}

Deno.serve(handleNaverGeocode);
