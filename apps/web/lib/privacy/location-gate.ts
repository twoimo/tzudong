import {
  DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED,
  LOCATION_READINESS_STATUS_AVAILABLE,
  type DeviceLocationReadiness,
} from './location-readiness';

export const LOCATION_GATE_SOURCE_DEVICE_MEMORY = 'device-memory';
export const LOCATION_GATE_SOURCE_BUSINESS_LOCATION = 'business-location';
export const LOCATION_GATE_SOURCE_EXTERNAL_DESTINATION = 'external-destination';
export const LOCATION_GATE_SOURCE_MAP_PROVIDER_NETWORK = 'map-provider-network';

export const LOCATION_GATE_REASON_DEVICE_MEMORY_ALLOWED = 'DEVICE_LOCATION_SOURCE_DEVICE_MEMORY_ALLOWED';
export const LOCATION_GATE_REASON_BUSINESS_LOCATION_ALLOWED = 'DEVICE_LOCATION_SOURCE_BUSINESS_LOCATION_ALLOWED';
export const LOCATION_GATE_REASON_EXTERNAL_DESTINATION_DENIED = 'DEVICE_LOCATION_SOURCE_EXTERNAL_DESTINATION_DENIED';
export const LOCATION_GATE_REASON_MAP_PROVIDER_ALLOWED = 'DEVICE_LOCATION_MAP_PROVIDER_NETWORK_ALLOWED';
export const LOCATION_GATE_REASON_MAP_PROVIDER_AUTHORIZATION_REQUIRED =
  'DEVICE_LOCATION_MAP_PROVIDER_NETWORK_AUTHORIZATION_REQUIRED';

export type LocationGateSource =
  | typeof LOCATION_GATE_SOURCE_DEVICE_MEMORY
  | typeof LOCATION_GATE_SOURCE_BUSINESS_LOCATION
  | typeof LOCATION_GATE_SOURCE_EXTERNAL_DESTINATION
  | typeof LOCATION_GATE_SOURCE_MAP_PROVIDER_NETWORK;

export type LocationGateDecision = {
  allowed: boolean;
  reasonCode: string;
};

export const DEFAULT_MAP_PROVIDER_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

export type MapProviderAuthorization = {
  grantedAtMs: number;
  expiresAtMs: number;
};

function isFinitePositiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeNowMs(value = Date.now()): number {
  return Number.isFinite(value) ? value : Date.now();
}

function toMapProviderAuthorization(
  grantedAtMs: number,
  ttlMs: number,
): MapProviderAuthorization | null {
  if (!isFinitePositiveNumber(ttlMs) || !isFinitePositiveNumber(grantedAtMs)) {
    return null;
  }

  return {
    grantedAtMs,
    expiresAtMs: grantedAtMs + ttlMs,
  };
}

export function buildMapProviderAuthorization(
  readiness: DeviceLocationReadiness,
  nowMs = Date.now(),
  ttlMs = DEFAULT_MAP_PROVIDER_AUTHORIZATION_TTL_MS,
): MapProviderAuthorization | null {
  if (readiness.status !== LOCATION_READINESS_STATUS_AVAILABLE || readiness.reasonCode !== DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED) {
    return null;
  }

  return toMapProviderAuthorization(normalizeNowMs(nowMs), ttlMs);
}

export function isMapProviderAuthorizationActive(
  authorization: MapProviderAuthorization | null,
  nowMs = Date.now(),
): authorization is MapProviderAuthorization {
  if (!authorization) return false;
  const now = normalizeNowMs(nowMs);
  return now >= authorization.grantedAtMs && now <= authorization.expiresAtMs;
}

export function resolveLocationGateDecision(params: {
  source: LocationGateSource;
  mapProviderAuthorization?: MapProviderAuthorization | null;
}): LocationGateDecision {
  switch (params.source) {
    case LOCATION_GATE_SOURCE_DEVICE_MEMORY:
      return {
        allowed: true,
        reasonCode: LOCATION_GATE_REASON_DEVICE_MEMORY_ALLOWED,
      };

    case LOCATION_GATE_SOURCE_BUSINESS_LOCATION:
      return {
        allowed: true,
        reasonCode: LOCATION_GATE_REASON_BUSINESS_LOCATION_ALLOWED,
      };

    case LOCATION_GATE_SOURCE_EXTERNAL_DESTINATION:
      return {
        allowed: false,
        reasonCode: LOCATION_GATE_REASON_EXTERNAL_DESTINATION_DENIED,
      };

    case LOCATION_GATE_SOURCE_MAP_PROVIDER_NETWORK:
      if (isMapProviderAuthorizationActive(params.mapProviderAuthorization ?? null)) {
        return {
          allowed: true,
          reasonCode: LOCATION_GATE_REASON_MAP_PROVIDER_ALLOWED,
        };
      }

      return {
        allowed: false,
        reasonCode: LOCATION_GATE_REASON_MAP_PROVIDER_AUTHORIZATION_REQUIRED,
      };

    default:
      return {
        allowed: false,
        reasonCode: LOCATION_GATE_REASON_MAP_PROVIDER_AUTHORIZATION_REQUIRED,
      };
  }
}
