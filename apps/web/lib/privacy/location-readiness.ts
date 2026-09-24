export const DEVICE_LOCATION_AVAILABLE = 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' as const;

export type DeviceLocationReadiness = Readonly<{
  status: 'available';
  reasonCode: typeof DEVICE_LOCATION_AVAILABLE;
}>;

export function resolveDeviceLocationReadiness(): DeviceLocationReadiness {
  return { status: 'available', reasonCode: DEVICE_LOCATION_AVAILABLE };
}
