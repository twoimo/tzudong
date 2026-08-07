export const LOCATION_READINESS_STATUS_AVAILABLE = 'available';
export const LOCATION_READINESS_STATUS_UNAVAILABLE = 'unavailable';

export const DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED = 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED';
export const DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED = 'DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED';

export type DeviceLocationReadinessStatus = typeof LOCATION_READINESS_STATUS_AVAILABLE | typeof LOCATION_READINESS_STATUS_UNAVAILABLE;

export type DeviceLocationReadinessReasonCode =
  | typeof DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED
  | typeof DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED;

export type DeviceLocationReadiness = {
  status: DeviceLocationReadinessStatus;
  reasonCode: DeviceLocationReadinessReasonCode;
};

type DeviceLocationEvidenceTuple = {
  decision: string;
  externalStatus: string;
  operatorEvidenceHash: string;
  providerEvidenceHash: string;
  externalEvidenceHash: string;
  legalEvidenceHash: string;
  confirmedAt: string;
};

const APPROVED_RELEASE_DECISION = 'approved';
const ALLOWED_EXTERNAL_STATUSES = new Set([
  'not_applicable_verified',
  'filing_receipt_verified',
]);

const HEX_HASH_RE = /^[a-fA-F0-9]{64}$/;

function trimOrNull(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function isAllowedDecision(value: string | null): boolean {
  return value === APPROVED_RELEASE_DECISION;
}

function isAllowedExternalStatus(value: string | null): boolean {
  return value !== null && ALLOWED_EXTERNAL_STATUSES.has(value);
}

function isSha256Hex(value: string | null): boolean {
  return value !== null && HEX_HASH_RE.test(value);
}

function isValidIsoTimestamp(value: string | null): boolean {
  if (!value) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis);
}

function readEvidenceTuple(env: NodeJS.ProcessEnv): DeviceLocationEvidenceTuple | null {
  const decision = trimOrNull(env.DEVICE_LOCATION_RELEASE_DECISION);
  const externalStatus = trimOrNull(env.DEVICE_LOCATION_EXTERNAL_STATUS);
  const operatorEvidenceHash = trimOrNull(env.DEVICE_LOCATION_OPERATOR_EVIDENCE_HASH);
  const providerEvidenceHash = trimOrNull(env.DEVICE_LOCATION_PROVIDER_EVIDENCE_HASH);
  const externalEvidenceHash = trimOrNull(env.DEVICE_LOCATION_EXTERNAL_EVIDENCE_HASH);
  const legalEvidenceHash = trimOrNull(env.DEVICE_LOCATION_LEGAL_EVIDENCE_HASH);
  const confirmedAt = trimOrNull(env.DEVICE_LOCATION_RELEASE_CONFIRMED_AT);

  if (
    !isAllowedDecision(decision) ||
    !isAllowedExternalStatus(externalStatus) ||
    !isSha256Hex(operatorEvidenceHash) ||
    !isSha256Hex(providerEvidenceHash) ||
    !isSha256Hex(externalEvidenceHash) ||
    !isSha256Hex(legalEvidenceHash) ||
    !isValidIsoTimestamp(confirmedAt)
  ) {
    return null;
  }

  return {
    decision,
    externalStatus,
    operatorEvidenceHash,
    providerEvidenceHash,
    externalEvidenceHash,
    legalEvidenceHash,
    confirmedAt,
  };
}

export function resolveDeviceLocationReadiness(env: NodeJS.ProcessEnv = process.env): DeviceLocationReadiness {
  const tuple = readEvidenceTuple(env);
  return tuple
    ? {
      status: LOCATION_READINESS_STATUS_AVAILABLE,
      reasonCode: DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED,
    }
    : {
      status: LOCATION_READINESS_STATUS_UNAVAILABLE,
      reasonCode: DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED,
    };
}
