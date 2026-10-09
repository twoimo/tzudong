/** SDK coordinate methods read their receiver's internal fields. */
export function readAdminNaverCoordinate(
  value: { lat?: number | (() => number); lng?: number | (() => number) } | undefined,
  key: 'lat' | 'lng',
) {
  const coordinate = value?.[key];
  return typeof coordinate === 'function' ? coordinate.call(value) : coordinate;
}
