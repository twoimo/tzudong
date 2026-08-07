import { isPublicRestrictedMode } from "@/lib/site-config";
export type LocationDestination =
  | "memory"
  | "network"
  | "url"
  | "analytics"
  | "log"
  | "localStorage"
  | "indexedDB"
  | "notification"
  | "supabase";

export const DEVICE_LOCATION_NETWORK_SINK = "naver-maps-javascript" as const;
const DEVICE_LOCATION_MAP_PURPOSE = "home-map-device-marker";
const DEVICE_LOCATION_READINESS_PATH = "/api/privacy/location-readiness";
const DEVICE_LOCATION_READINESS_TIMEOUT_MS = 3000;

export type DeviceLocationUseAuthorization = Readonly<{
  grantedAt: number;
  expiresAt: number;
}>;

export type LocationUse = Readonly<{
  purpose: string;
  destination: LocationDestination;
  networkSink?: string;
  authorization?: DeviceLocationUseAuthorization | null;
}>;

export type LocationUseDecision = Readonly<{
  allowed: boolean;
  reasonCode:
    | "DEVICE_LOCATION_MEMORY_ONLY"
    | "DEVICE_LOCATION_MAP_PROVIDER_NETWORK_ALLOWED"
    | "DEVICE_LOCATION_DESTINATION_DENIED";
}>;

export const DEVICE_LOCATION_DENIED_DESTINATIONS = [
  "network",
  "url",
  "analytics",
  "log",
  "localStorage",
  "indexedDB",
  "notification",
  "supabase",
] as const satisfies readonly LocationDestination[];
const LOCATION_DESTINATIONS = new Set<LocationDestination>([
  "memory",
  ...DEVICE_LOCATION_DENIED_DESTINATIONS,
]);
const LOCATION_USE_FIELDS = new Set([
  "purpose",
  "destination",
  "networkSink",
  "authorization",
]);
const DEVICE_LOCATION_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1000;
const capturedMonotonicNow = globalThis.performance.now.bind(globalThis.performance);

type DeviceLocationAuthorizationState = Readonly<{
  grantedAt: number;
  expiresAt: number;
}>;

const deviceLocationAuthorizationRegistry = new WeakMap<
  DeviceLocationUseAuthorization,
  DeviceLocationAuthorizationState
>();

const isSafeTimestamp = (value: unknown): value is number =>
  typeof value === "number"
  && Number.isFinite(value)
  && Math.abs(value) <= Number.MAX_SAFE_INTEGER;

const hasFixedAuthorizationLifetime = (
  grantedAt: number,
  expiresAt: number,
): boolean =>
  isSafeTimestamp(grantedAt)
  && isSafeTimestamp(expiresAt)
  && expiresAt > grantedAt
  && expiresAt - grantedAt === DEVICE_LOCATION_AUTHORIZATION_LIFETIME_MS;

const isActiveAuthorization = (
  authorization: DeviceLocationUseAuthorization | null | undefined,
): boolean => {
  if (!authorization || typeof authorization !== "object") return false;

  const state = deviceLocationAuthorizationRegistry.get(authorization);
  if (!state) return false;

  const now = capturedMonotonicNow();
  const isValid = isSafeTimestamp(now)
    && hasFixedAuthorizationLifetime(state.grantedAt, state.expiresAt)
    && authorization.grantedAt === state.grantedAt
    && authorization.expiresAt === state.expiresAt
    && state.grantedAt <= now
    && now < state.expiresAt;

  if (!isValid) deviceLocationAuthorizationRegistry.delete(authorization);
  return isValid;
};

const mintDeviceLocationUseAuthorization = (): DeviceLocationUseAuthorization | null => {
  const grantedAt = capturedMonotonicNow();
  const expiresAt = grantedAt + DEVICE_LOCATION_AUTHORIZATION_LIFETIME_MS;
  if (!hasFixedAuthorizationLifetime(grantedAt, expiresAt)) return null;

  const authorization = Object.freeze({ grantedAt, expiresAt });
  deviceLocationAuthorizationRegistry.set(authorization, { grantedAt, expiresAt });
  return authorization;
};

const isExactReadinessPayload = (payload: unknown): boolean => {
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || Object.getPrototypeOf(payload) !== Object.prototype
    || Object.keys(payload).length !== 2
  ) {
    return false;
  }

  const readiness = payload as Record<string, unknown>;
  return Object.hasOwn(readiness, "status")
    && Object.hasOwn(readiness, "reasonCode")
    && readiness.status === "available"
    && readiness.reasonCode === "DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED";
};

/**
 * Reads the server-owned readiness result and privately mints a short-lived
 * capability only for the approved home-map Naver renderer boundary.
 */
export const acquireDeviceLocationUseAuthorization = async (): Promise<
  DeviceLocationUseAuthorization | null
> => {
  if (isPublicRestrictedMode) return null;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    DEVICE_LOCATION_READINESS_TIMEOUT_MS,
  );

  try {
    const response = await globalThis.fetch(DEVICE_LOCATION_READINESS_PATH, {
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isExactReadinessPayload(payload)) return null;

    return mintDeviceLocationUseAuthorization();
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

/** Explicitly invalidates a capability. Calling it again is safe. */
export const revokeDeviceLocationUseAuthorization = (
  authorization: DeviceLocationUseAuthorization | null | undefined,
): void => {
  if (authorization && typeof authorization === "object") {
    deviceLocationAuthorizationRegistry.delete(authorization);
  }
};

/**
 * Device coordinates stay in current React memory. The browser map-provider
 * boundary is limited to the approved Naver JavaScript renderer.
 */
export const evaluateLocationUse = (
  locationUse: LocationUse,
): LocationUseDecision => {
  if (isPublicRestrictedMode) {
    return {
      allowed: false,
      reasonCode: "DEVICE_LOCATION_DESTINATION_DENIED",
    };
  }
  const {
    purpose,
    destination,
    networkSink,
    authorization,
  } = locationUse;
  if (
    Object.getPrototypeOf(locationUse) !== Object.prototype
    || Object.keys(locationUse).some((key) => !LOCATION_USE_FIELDS.has(key))
    || purpose !== DEVICE_LOCATION_MAP_PURPOSE
    || !LOCATION_DESTINATIONS.has(destination)
  ) {
    return {
      allowed: false,
      reasonCode: "DEVICE_LOCATION_DESTINATION_DENIED",
    };
  }

  if (destination === "memory") {
    return {
      allowed: true,
      reasonCode: "DEVICE_LOCATION_MEMORY_ONLY",
    };
  }

  if (
    destination === "network"
    && networkSink === DEVICE_LOCATION_NETWORK_SINK
    && isActiveAuthorization(authorization)
  ) {
    return {
      allowed: true,
      reasonCode: "DEVICE_LOCATION_MAP_PROVIDER_NETWORK_ALLOWED",
    };
  }

  return {
    allowed: false,
    reasonCode: "DEVICE_LOCATION_DESTINATION_DENIED",
  };
};

export class DeviceLocationDestinationError extends Error {
  readonly code = "DEVICE_LOCATION_DESTINATION_DENIED" as const;
  readonly destination: Exclude<LocationDestination, "memory">;

  constructor(destination: Exclude<LocationDestination, "memory">) {
    super("기기 위치 좌표는 이 대상에 사용할 수 없습니다.");
    this.name = "DeviceLocationDestinationError";
    this.destination = destination;
  }
}

/**
 * Use before a device-location sink. It deliberately accepts no coordinates so
 * rejected paths cannot retain a precise value in an error or audit record.
 */
export const assertDeviceLocationDestination = (
  destination: LocationDestination,
  purpose: string,
): void => {
  const decision = evaluateLocationUse({
    destination,
    purpose,
  });

  if (!decision.allowed) {
    throw new DeviceLocationDestinationError(
      destination as Exclude<LocationDestination, "memory">,
    );
  }
};

export type DeviceLocationTrackingLifecycle = Readonly<{
  onModeChange: (enabled: boolean) => void;
  onVisibilityChange: (visibilityState: DocumentVisibilityState) => void;
  dispose: () => void;
}>;

/**
 * Keeps watcher cleanup testable and makes mode-off, hidden-page, and unmount
 * shutdown paths revoke the capability through the same idempotent stop.
 */
export const createDeviceLocationTrackingLifecycle = (
  stopTracking: () => void,
  authorization?: DeviceLocationUseAuthorization | null,
): DeviceLocationTrackingLifecycle => {
  let stopped = false;
  const stopOnce = () => {
    if (stopped) return;
    stopped = true;
    revokeDeviceLocationUseAuthorization(authorization);
    stopTracking();
  };

  return {
    onModeChange: (enabled) => {
      if (!enabled) stopOnce();
    },
    onVisibilityChange: (visibilityState) => {
      if (visibilityState === "hidden") stopOnce();
    },
    dispose: stopOnce,
  };
};