import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PRIMARY_STATUS_FILTER_OPTIONS,
  sanitizePrimaryStatusFilterValue,
} from '@/components/admin/evaluation-status-filter-options';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

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
    ]);

    expect(PRIMARY_STATUS_FILTER_OPTIONS.map(({ label }) => label)).toEqual([
      '전체',
      '미처리',
      '승인됨',
      '삭제됨',
      '승인 대기',
      'Missing',
      '평가 미대상',
    ]);
  });

  test('sanitizes only visible primary status values', () => {
    expect(sanitizePrimaryStatusFilterValue('all')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('pending')).toBe('pending');
    expect(sanitizePrimaryStatusFilterValue('approved')).toBe('approved');
    expect(sanitizePrimaryStatusFilterValue('deleted')).toBe('deleted');
    expect(sanitizePrimaryStatusFilterValue('ready_for_approval')).toBe('ready_for_approval');
    expect(sanitizePrimaryStatusFilterValue('evaluation_incomplete')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('missing')).toBe('missing');
    expect(sanitizePrimaryStatusFilterValue('not_selected')).toBe('not_selected');
    expect(sanitizePrimaryStatusFilterValue('geocoding_failed')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('address_review_geocode_recovered')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('hold')).toBeUndefined();
    expect(sanitizePrimaryStatusFilterValue('db_conflict')).toBeUndefined();
  });

  test('keeps table and slide approval gates on the shared address-consistency helper', () => {
    const tableSource = source('components/admin/EvaluationTableNew.tsx');
    const slideSource = source('components/admin/EvaluationSlideView.tsx');

    expect(tableSource).toContain('canApproveAddressConsistencyRecord');
    expect(slideSource).toContain('canApproveAddressConsistencyRecord');
    expect(tableSource).not.toContain('const canApprove =');
    expect(tableSource).not.toMatch(/disabled=\{loading \|\| !record\.geocoding_success\}/);
    expect(slideSource).not.toMatch(/disabled=\{loading \|\| !currentRecord\.geocoding_success\}/);
  });
});
