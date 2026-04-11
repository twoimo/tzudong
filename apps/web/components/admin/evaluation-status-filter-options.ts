export const PRIMARY_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '미처리' },
  { value: 'approved', label: '승인됨' },
  { value: 'deleted', label: '삭제됨' },
  { value: 'ready_for_approval', label: '승인 대기' },
  { value: 'missing', label: 'Missing' },
  { value: 'not_selected', label: '평가 미대상' },
  { value: 'geocoding_failed', label: '지오코딩 실패' },
] as const;

const PRIMARY_STATUS_FILTER_OPTION_VALUES = new Set<string>(
  PRIMARY_STATUS_FILTER_OPTIONS.map(({ value }) => value)
);

export function sanitizePrimaryStatusFilterValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !PRIMARY_STATUS_FILTER_OPTION_VALUES.has(value)) {
    return undefined;
  }

  return value === 'all' ? undefined : value;
}
