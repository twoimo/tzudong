import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { adminReviewModerationStatus, selectAdminModerationRows, type AdminModerationFilter, type AdminModerationSort } from '../lib/admin/submission-list-view-model';
import {
  adminSubmissionQueueSummaryMatchesFilter,
  ADMIN_SUBMISSION_QUEUE_REASON_FILTERS,
  getAdminSubmissionQueueSafetySummary,
  type AdminSubmissionQueueSubmissionInput,
} from '../lib/admin/submission-queue-safety';

const webRoot = path.resolve(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(path.join(webRoot, relativePath), 'utf8');
}

function baseSubmission(overrides: Partial<AdminSubmissionQueueSubmissionInput> = {}): AdminSubmissionQueueSubmissionInput {
  return {
    submission_type: 'new',
    status: 'pending',
    restaurant_name: '명동 짜장면',
    restaurant_address: '서울 중구 명동길 123',
    restaurant_phone: '02-1234-5678',
    restaurant_categories: ['중식'],
    items: [{
      youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tzuyang_review: '쯔양이 소개한 맛집입니다.',
      item_status: 'pending',
    }],
    ...overrides,
  };
}

describe('admin submission queue safety badges', () => {
  test('reuses shared submission validation for missing required fields and invalid youtube links', () => {
    const missingRequired = getAdminSubmissionQueueSafetySummary(baseSubmission({
      restaurant_name: 'asdf',
      restaurant_categories: [],
    }));
    const invalidYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [{ youtube_link: 'https://example.com/watch?v=abc', tzuyang_review: '리뷰', item_status: 'pending' }],
    }));
    const laterInvalidYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [
        { youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '정상 리뷰입니다.', item_status: 'pending' },
        { youtube_link: 'https://example.com/watch?v=bad', tzuyang_review: '나중 항목입니다.', item_status: 'pending' },
      ],
    }));
    const laterJunkRecommendation = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'recommend',
      recommendation_reason: '충분히 정상적인 추천 이유입니다',
      items: [
        { youtube_link: '', tzuyang_review: '충분히 정상적인 추천 이유입니다', item_status: 'pending' },
        { youtube_link: '', tzuyang_review: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', item_status: 'pending' },
      ],
    }));


    expect(missingRequired.validationMessage).toBe('맛집 이름, 주소, 카테고리는 필수입니다');
    expect(missingRequired.reasons.map((reason) => reason.code)).toContain('missing-required');
    expect(invalidYoutube.validationMessage).toBe('유효한 유튜브 링크를 입력해주세요');
    expect(invalidYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
    expect(laterInvalidYoutube.validationMessage).toBeNull();
    expect(laterInvalidYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
    expect(laterJunkRecommendation.validationMessage).toBeNull();
    expect(laterJunkRecommendation.reasons.map((reason) => reason.code)).toContain('junk-text');
  });

  test('does not require recommendation review text for edit queue items', () => {
    const editSummary = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'edit',
      items: [{
        youtube_link: 'https://youtu.be/dQw4w9WgXcQ',
        tzuyang_review: '',
        item_status: 'pending',
      }],
    }));
    const invalidEditYoutube = getAdminSubmissionQueueSafetySummary(baseSubmission({
      submission_type: 'edit',
      items: [{
        youtube_link: 'https://example.com/watch?v=abc',
        tzuyang_review: '',
        item_status: 'pending',
      }],
    }));

    expect(editSummary.validationMessage).toBeNull();
    expect(editSummary.reasons.map((reason) => reason.code)).not.toContain('junk-text');
    expect(editSummary.filterCodes).toEqual([]);
    expect(invalidEditYoutube.reasons.map((reason) => reason.code)).toContain('invalid-youtube');
  });

  test('marks duplicate candidates and missing pending items without mutating the queue', () => {
    const summary = getAdminSubmissionQueueSafetySummary(baseSubmission({
      items: [{
        youtube_link: 'https://youtu.be/dQw4w9WgXcQ',
        tzuyang_review: '쯔양이 소개한 맛집입니다.',
        item_status: 'approved',
        duplicate_check_result: { isDuplicate: true, existingRestaurantName: '기존 맛집' },
      }],
    }));

    expect(summary.reasons.map((reason) => reason.code)).toEqual(['no-pending-items', 'duplicate-candidate']);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'needs-review')).toBe(true);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'duplicate-candidate')).toBe(true);
    expect(adminSubmissionQueueSummaryMatchesFilter(summary, 'all')).toBe(true);
  });
  test('exposes fallback shared-validation reasons as a direct filter option', () => {
    const values = ADMIN_SUBMISSION_QUEUE_REASON_FILTERS.map((option) => option.value);

    expect(values).toContain('shared-validation');
  });

  test('exposes non-destructive source hooks for reason filters and badges', () => {
    const helperSource = source('lib/admin/submission-queue-safety.ts');
    const listSource = source('components/admin/SubmissionListView.tsx');

    const filterMarkup = listSource.slice(
      listSource.indexOf('data-admin-submission-queue-reason-filter="true"'),
      listSource.indexOf('data-admin-moderation-list'),
    );

    expect(helperSource).toContain('validateRestaurantSubmission(mode, formData)');
    expect(helperSource).toContain('validateRestaurantSubmissionStep(1, \'request\', formData)');
    expect(helperSource).not.toContain('supabase');
    expect(listSource).toContain('data-admin-submission-queue-reason-filter="true"');
    expect(listSource).toContain('data-admin-submission-queue-reason-filter-option={option.value}');
    expect(listSource).toContain('data-admin-submission-safety-badge={reason.code}');
    expect(filterMarkup).toContain('handleQueueReasonFilterChange(option.value)');
    expect(filterMarkup).not.toContain('onApprove');
    expect(filterMarkup).not.toContain('onReject');
    expect(filterMarkup).not.toContain('fetch(');
  });
});


describe('admin moderation list selection', () => {
  const rows = [
    { id: 'partial', created_at: '2026-10-02T00:00:00Z', name: '가게 나', state: 'partially_approved', nickname: 'Tester', duplicate: false },
    { id: 'approved', created_at: '2026-10-03T00:00:00Z', name: '가게 가', state: 'approved', nickname: '작성자', duplicate: true },
    { id: 'pending', created_at: '2026-10-01T00:00:00Z', name: '가게 다', state: 'pending', nickname: 'tester', duplicate: false },
    { id: 'unknown', created_at: 'invalid', name: '가게 라', state: 'FutureState', nickname: '', duplicate: false },
  ];
  const project = (row: typeof rows[number]) => ({ name: row.name, status: row.state, duplicate: row.duplicate, search: [row.name, row.nickname, null, undefined] });
  const select = (query = '', status: AdminModerationFilter = 'all', sort: AdminModerationSort = 'priority') => selectAdminModerationRows(rows, { query, status, sort }, project).map(row => row.id);

  test('combines trimmed case-insensitive search, processing state and duplicate filters on loaded rows', () => {
    expect(select('  TESTER  ', 'pending')).toEqual(['pending', 'partial']);
    expect(select('', 'partially_approved')).toEqual(['partial']);
    expect(select('', 'duplicate')).toEqual(['approved']);
    expect(select('작성자', 'pending')).toEqual([]);
    expect(select('', 'unknown')).toEqual(['unknown']);
    expect(selectAdminModerationRows([], { query: '', status: 'all', sort: 'priority' }, project)).toEqual([]);
  });
  test('sorts deterministically without changing the input or promoting invalid dates', () => {
    const before = structuredClone(rows);
    expect(select()).toEqual(['pending', 'partial', 'approved', 'unknown']);
    expect(select('', 'all', 'newest')).toEqual(['approved', 'partial', 'pending', 'unknown']);
    expect(select('', 'all', 'oldest')).toEqual(['pending', 'partial', 'approved', 'unknown']);
    expect(select('', 'all', 'name')).toEqual(['approved', 'partial', 'pending', 'unknown']);
    const tied = [{ ...rows[0], id: 'b' }, { ...rows[0], id: 'a' }];
    expect(selectAdminModerationRows(tied, { query: '', status: 'all', sort: 'newest' }, project).map(row => row.id)).toEqual(['a', 'b']);
    expect(rows).toEqual(before);
    expect(selectAdminModerationRows(rows, { query: '', status: 'pending', sort: 'priority' }, project)[0]).toBe(rows[2]);
  });
  test('review status preserves verified precedence and the existing rejection-note contract', () => {
    expect(adminReviewModerationStatus({ is_verified: true, admin_note: '거부 후 재승인' })).toBe('approved');
    expect(adminReviewModerationStatus({ is_verified: false, admin_note: '거부: 중복 확인' })).toBe('rejected');
    expect(adminReviewModerationStatus({ is_verified: false, admin_note: null })).toBe('pending');
    expect(adminReviewModerationStatus({ is_verified: false, admin_note: '검토 중' })).toBe('pending');
  });
});
