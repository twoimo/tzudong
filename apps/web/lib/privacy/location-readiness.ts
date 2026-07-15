export const DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED = 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' as const;
export const DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED = 'DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED' as const;

export type DeviceLocationReadiness = Readonly<
  | { status: 'available'; reasonCode: typeof DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED }
  | { status: 'unavailable'; reasonCode: typeof DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED }
>;

const ALLOWED_EXTERNAL_STATUSES = new Set([
  'not_applicable_verified',
  'filing_receipt_verified',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const exactValue = (value: string | undefined) => value?.trim() ?? '';

export function resolveDeviceLocationReadiness(
  env: NodeJS.ProcessEnv = process.env,
): DeviceLocationReadiness {
  const confirmedAt = exactValue(env.DEVICE_LOCATION_RELEASE_CONFIRMED_AT);
  const confirmedAtMs = Date.parse(confirmedAt);
  const evidenceHashes = [
    env.DEVICE_LOCATION_OPERATOR_EVIDENCE_HASH,
    env.DEVICE_LOCATION_PROVIDER_EVIDENCE_HASH,
    env.DEVICE_LOCATION_EXTERNAL_EVIDENCE_HASH,
    env.DEVICE_LOCATION_LEGAL_EVIDENCE_HASH,
  ].map(exactValue);
  const available = exactValue(env.DEVICE_LOCATION_RELEASE_DECISION) === 'approved'
    && ALLOWED_EXTERNAL_STATUSES.has(exactValue(env.DEVICE_LOCATION_EXTERNAL_STATUS))
    && evidenceHashes.every((value) => SHA256_PATTERN.test(value))
    && Number.isFinite(confirmedAtMs)
    && confirmedAtMs <= Date.now()
    && new Date(confirmedAtMs).toISOString() === confirmedAt;

  return available
    ? { status: 'available', reasonCode: DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED }
    : { status: 'unavailable', reasonCode: DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED };
}
