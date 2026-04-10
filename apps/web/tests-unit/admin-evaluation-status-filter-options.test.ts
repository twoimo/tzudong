import { describe, expect, test } from 'bun:test';

import {
  PRIMARY_STATUS_FILTER_OPTIONS,
  sanitizePrimaryStatusFilterValue,
} from '@/components/admin/evaluation-status-filter-options';

describe('PRIMARY_STATUS_FILTER_OPTIONS', () => {
  test('keeps the visible primary status menu in the approved order', () => {
    expect(PRIMARY_STATUS_FILTER_OPTIONS.map(({ value }) => value)).toEqual([
      'all',
      'pending',
      'approved',
      'deleted',
      'ready_for_approval',
      'missing',
      'not_selected',
      'geocoding_failed',
    ]);
  });

  test('sanitizes only visible primary status values', () => {
    expect(sanitizePrimaryStatusFilterValue('all')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('pending')).toBe('pending');
    expect(sanitizePrimaryStatusFilterValue('approved')).toBe('approved');
    expect(sanitizePrimaryStatusFilterValue('deleted')).toBe('deleted');
    expect(sanitizePrimaryStatusFilterValue('ready_for_approval')).toBe('ready_for_approval');
    expect(sanitizePrimaryStatusFilterValue('missing')).toBe('missing');
    expect(sanitizePrimaryStatusFilterValue('not_selected')).toBe('not_selected');
    expect(sanitizePrimaryStatusFilterValue('geocoding_failed')).toBe('geocoding_failed');
    expect(sanitizePrimaryStatusFilterValue('hold')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('db_conflict')).toBeUndefined();
  });
});
