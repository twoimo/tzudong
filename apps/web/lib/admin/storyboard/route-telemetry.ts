const utf8Encoder = new TextEncoder();

export const STORYBOARD_ROUTE_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
} as const;

export const STORYBOARD_ROUTE_SSE_HEADERS = {
  'Cache-Control': 'no-store, no-transform',
  'Content-Type': 'text/event-stream; charset=utf-8',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export const STORYBOARD_ROUTE_STATUS_CACHE_SECONDS = 15;
export const STORYBOARD_ROUTE_STATUS_STALE_SECONDS = 45;
export const STORYBOARD_ROUTE_STATUS_CACHE_CONTROL = `private, max-age=${STORYBOARD_ROUTE_STATUS_CACHE_SECONDS}, stale-while-revalidate=${STORYBOARD_ROUTE_STATUS_STALE_SECONDS}`;
export const STORYBOARD_ROUTE_PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store, max-age=0';

export type StoryboardRouteTelemetry = {
  route: string;
  startedAt: number;
  requestBytes: number;
};

export function createStoryboardRouteTelemetry(route: string): StoryboardRouteTelemetry {
  return {
    route,
    startedAt: Date.now(),
    requestBytes: 0,
  };
}

export function getStoryboardUtf8Bytes(value: string) {
  return utf8Encoder.encode(value).byteLength;
}

export function getStoryboardJsonPayloadBytes(value: unknown) {
  return getStoryboardUtf8Bytes(JSON.stringify(value));
}

export async function readStoryboardRouteJson(
  request: Request,
  telemetry: StoryboardRouteTelemetry,
) {
  try {
    const bodyText = await request.text();
    telemetry.requestBytes = getStoryboardUtf8Bytes(bodyText);
    return bodyText.trim() ? JSON.parse(bodyText) as unknown : null;
  } catch {
    return null;
  }
}

export function buildStoryboardRouteHeaders(
  telemetry: StoryboardRouteTelemetry,
  init?: HeadersInit,
  responsePayload?: unknown,
) {
  const headers = new Headers(init);
  headers.set('X-Storyboard-Route', telemetry.route);
  headers.set('X-Storyboard-Route-Duration-Ms', String(Date.now() - telemetry.startedAt));
  headers.set('X-Storyboard-Request-Bytes', String(telemetry.requestBytes));
  if (responsePayload !== undefined) {
    headers.set('X-Storyboard-Response-Bytes', String(getStoryboardJsonPayloadBytes(responsePayload)));
  }
  return headers;
}

export function buildStoryboardRouteFreshness(
  source: string,
  options: {
    cacheControl: string;
    maxAgeSeconds: number;
    staleWhileRevalidateSeconds?: number;
    generatedAt?: Date;
  },
) {
  return {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    source,
    cacheControl: options.cacheControl,
    maxAgeSeconds: options.maxAgeSeconds,
    ...(options.staleWhileRevalidateSeconds == null
      ? {}
      : { staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds }),
  };
}
